/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Browser-driven benchmark of a node drag in the Network Area Diagram viewer.
 *
 * It drives a real drag (mousedown -> N mousemove -> mouseup) on a node of the
 * large PEGASE diagram in the running demo, and times the synchronous mousemove
 * handler. Because the handler reads layout (getScreenCTM / scrollWidth) and
 * mutates the SVG, this captures the DOM / forced-layout costs that the jsdom
 * micro-benchmarks cannot.
 *
 * Usage:
 *   node benchmarks/nad-drag-bench.mjs [--url=http://localhost:5173/] \
 *        [--container=svg-container-nad-pegase-network] [--steps=150] \
 *        [--repeats=7] [--profile] [--label=optimized]
 *
 * Requires the demo dev server running (npm run start) and playwright-core.
 */

import { chromium } from 'playwright-core';

const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const m = a.match(/^--([^=]+)(?:=(.*))?$/);
        return m ? [m[1], m[2] ?? true] : [a, true];
    })
);

const SCENARIO = args.scenario ?? 'drag'; // 'drag' | 'zoom'
const URL = args.url ?? 'http://localhost:5173/';
const CONTAINER =
    args.container ?? (SCENARIO === 'zoom' ? 'svg-container-nad-pegase-network-adaptive-zoom' : 'svg-container-nad-pegase-network');
const STEPS = Number(args.steps ?? (SCENARIO === 'zoom' ? 60 : 150));
const REPEATS = Number(args.repeats ?? 7);
const LABEL = args.label ?? 'run';
const EXECUTABLE =
    process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Runs one drag of `steps` mousemove events on a node near the container centre.
// Returns timing plus the chosen node id (so we can confirm both runs drag the
// same node) and whether the node actually moved.
function dragInPage(containerId, steps) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error('container not found: ' + containerId);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('svg not rendered in ' + containerId);

    const crect = container.getBoundingClientRect();
    const cx = crect.left + crect.width / 2;
    const cy = crect.top + crect.height / 2;

    let best = null;
    let bestD = Infinity;
    for (const node of svg.querySelectorAll('.nad-vl-nodes > g[id]')) {
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const nx = r.left + r.width / 2;
        const ny = r.top + r.height / 2;
        if (nx < crect.left || nx > crect.right || ny < crect.top || ny > crect.bottom) continue;
        const d = (nx - cx) ** 2 + (ny - cy) ** 2;
        if (d < bestD) {
            bestD = d;
            best = { node, nx, ny };
        }
    }
    if (!best) throw new Error('no draggable node visible in ' + containerId);

    const { node, nx, ny } = best;
    const fire = (type, x, y) =>
        node.dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
        );

    const before = node.getAttribute('transform');

    fire('mousedown', nx, ny);
    const t0 = performance.now();
    for (let i = 1; i <= steps; i++) {
        // small looping motion so the node stays in view and edges keep re-routing
        const x = nx + Math.round(40 * Math.sin(i / 5));
        const y = ny + Math.round(40 * Math.cos(i / 5));
        fire('mousemove', x, y);
    }
    const t1 = performance.now();
    fire('mouseup', nx, ny);

    const after = node.getAttribute('transform');
    return {
        totalMs: t1 - t0,
        perFrameMs: (t1 - t0) / steps,
        steps,
        nodeId: node.id,
        moved: before !== after,
    };
}

// Drives a zoom in/out sequence with wheel events, awaiting a frame between
// each so panzoom + the viewBox MutationObserver (adaptive text zoom) actually
// run. Zooming in past the adaptive threshold rebuilds edge infos / legends in
// the viewbox, which is the hot path here. Timing includes rAF waits, so the
// CPU profile (not the wall time) is what identifies the hotspots.
async function zoomInPage(containerId, steps) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error('container not found: ' + containerId);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('svg not rendered in ' + containerId);

    const crect = container.getBoundingClientRect();
    const cx = crect.left + crect.width / 2;
    const cy = crect.top + crect.height / 2;
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

    const fire = (deltaY) =>
        svg.dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY })
        );

    const t0 = performance.now();
    // first zoom in hard to cross the adaptive threshold, then oscillate
    for (let i = 0; i < steps; i++) {
        const phase = i % 24;
        fire(phase < 14 ? -120 : 120); // -deltaY = zoom in
        await nextFrame();
    }
    const t1 = performance.now();
    return { totalMs: t1 - t0, steps };
}

// Aggregate a CDP CPU profile into self-time by function (hitCount per node).
function summarizeProfile(profile, topN = 25) {
    const byFn = new Map();
    for (const node of profile.nodes ?? []) {
        const hit = node.hitCount ?? 0;
        if (!hit) continue;
        const cf = node.callFrame;
        const name = cf.functionName || '(anonymous)';
        const loc = (cf.url || '').replace(/^.*\/(packages|node_modules)\//, '$1/') + ':' + (cf.lineNumber + 1);
        const key = name + ' @ ' + loc;
        byFn.set(key, (byFn.get(key) ?? 0) + hit);
    }
    const total = [...byFn.values()].reduce((a, b) => a + b, 0) || 1;
    return [...byFn.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([key, hits]) => ({ key, hits, pct: ((100 * hits) / total).toFixed(1) }));
}

async function main() {
    const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));

    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    // wait until the big diagram is rendered with draggable nodes
    await page.waitForFunction(
        (id) => {
            const c = document.getElementById(id);
            const svg = c && c.querySelector('svg');
            return !!svg && svg.querySelectorAll('.nad-vl-nodes > g[id]').length > 0;
        },
        CONTAINER,
        { timeout: 60000 }
    );
    // let layout settle
    await page.waitForTimeout(500);

    const fnName = SCENARIO === 'zoom' ? '__zoom' : '__drag';
    const fnSrc = SCENARIO === 'zoom' ? zoomInPage.toString() : dragInPage.toString();
    await page.addScriptTag({ content: `window.${fnName} = ${fnSrc}` });

    const runOnce = (steps) => page.evaluate(({ c, s, f }) => window[f](c, s), { c: CONTAINER, s: steps, f: fnName });

    // warmup (JIT, first-time index build, adaptive threshold crossing, ...)
    const warm = await runOnce(SCENARIO === 'zoom' ? 20 : 40);

    const results = [];
    for (let r = 0; r < REPEATS; r++) {
        results.push(await runOnce(STEPS));
        await page.waitForTimeout(60);
    }

    const totals = results.map((r) => r.totalMs);
    console.log(`\n=== ${LABEL} :: ${SCENARIO} :: ${CONTAINER} :: ${STEPS} steps x ${REPEATS} repeats ===`);
    if (SCENARIO === 'drag') {
        const perFrame = results.map((r) => r.perFrameMs);
        console.log(`node dragged: ${warm.nodeId}  moved=${results.every((r) => r.moved)}`);
        console.log(`per-frame ms:  median=${median(perFrame).toFixed(3)}  min=${Math.min(...perFrame).toFixed(3)}`);
    }
    console.log(`total ms:      median=${median(totals).toFixed(2)}  min=${Math.min(...totals).toFixed(2)}`);

    if (args.profile) {
        const client = await page.context().newCDPSession(page);
        await client.send('Profiler.enable');
        await client.send('Profiler.setSamplingInterval', { interval: 50 });
        await client.send('Profiler.start');
        for (let r = 0; r < REPEATS; r++) {
            await runOnce(STEPS);
        }
        const { profile } = await client.send('Profiler.stop');
        console.log(`\n--- CPU profile self-time (top functions during ${SCENARIO}) ---`);
        for (const row of summarizeProfile(profile)) {
            console.log(`${row.pct.padStart(5)}%  ${row.key}`);
        }
    }

    await browser.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
