/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Phase 1 prototype for the NAD first-paint scope: lazy off-screen construction.
 *
 * Stacks N case1354pegase viewers in a viewport-sized scroll container and
 * compares eager construction (all on load) vs lazy construction (each built
 * only when its slot enters the viewport, via IntersectionObserver).
 *
 * Requires the demo dev server running (npm run start) and playwright-core.
 * Imports the viewer source + data through Vite's /@fs, so it reflects the
 * currently checked-out source.
 */
import { chromium } from 'playwright-core';

const EXE = globalThis.process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = globalThis.process.env.REPO_ROOT ?? '/home/user/powsybl-network-viewer';
const N = Number(globalThis.process.env.N ?? 8);
const P = `/@fs${ROOT}/packages/network-viewer-core/src/network-area-diagram-viewer/network-area-diagram-viewer.ts`;
const SVG = `/@fs${ROOT}/demo/src/diagram-viewers/data/case1354pegase.svg?raw`;
const META = `/@fs${ROOT}/demo/src/diagram-viewers/data/case1354pegase_metadata.json`;

async function main() {
    const browser = await chromium.launch({ executablePath: EXE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 60000 });

    const result = await page.evaluate(
        async ([modUrl, svgUrl, metaUrl, n]) => {
            const [mod, svgMod, metaMod] = await Promise.all([import(modUrl), import(svgUrl), import(metaUrl)]);
            const NAD = mod.NetworkAreaDiagramViewer;
            const svg = svgMod.default;
            const meta = metaMod.default;
            const params = { enableDragInteraction: true, addButtons: true };
            const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            const makeScroller = () => {
                const s = document.createElement('div');
                s.style.cssText = 'position:absolute;left:0;top:0;width:1250px;height:900px;overflow:auto;';
                const slots = [];
                for (let i = 0; i < n; i++) {
                    const slot = document.createElement('div');
                    slot.style.cssText = 'width:1200px;height:900px;box-sizing:border-box;';
                    s.appendChild(slot);
                    slots.push(slot);
                }
                document.body.appendChild(s);
                return { s, slots };
            };

            // ---- EAGER: construct every viewer immediately (current demo behaviour) ----
            const eager = makeScroller();
            const tE = performance.now();
            for (const slot of eager.slots) {
                new NAD(slot, svg, meta, params);
            }
            const eagerMs = performance.now() - tE;
            eager.s.remove();

            // ---- LAZY: construct on first intersection ----
            const lazy = makeScroller();
            let built = 0;
            let firstBuildMs = 0;
            const tL0 = performance.now();
            const observer = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        if (entry.isIntersecting && !entry.target.dataset.built) {
                            entry.target.dataset.built = '1';
                            new NAD(entry.target, svg, meta, params);
                            built++;
                            if (built === 1) firstBuildMs = performance.now() - tL0;
                            observer.unobserve(entry.target);
                        }
                    }
                },
                { root: lazy.s, rootMargin: '0px', threshold: 0 }
            );
            lazy.slots.forEach((slot) => observer.observe(slot));

            // let the observer fire for what's visible at the top (no scroll yet)
            await nextFrame();
            await sleep(50);
            const builtOnLoad = built;

            // now scroll through to confirm the rest build on demand
            for (let y = 0; y <= lazy.s.scrollHeight; y += 900) {
                lazy.s.scrollTop = y;
                await nextFrame();
                await sleep(40);
            }
            await sleep(50);
            const builtAfterScroll = built;
            observer.disconnect();
            lazy.s.remove();

            return { n, eagerMs, firstBuildMs, builtOnLoad, builtAfterScroll, perViewerMs: eagerMs / n };
        },
        [P, SVG, META, N]
    );

    const r = result;
    console.log(`\n=== Phase 1 prototype: lazy off-screen NAD construction (case1354pegase x ${r.n}) ===`);
    console.log(`per-viewer construction:        ~${r.perViewerMs.toFixed(1)} ms`);
    console.log(`EAGER  build all ${r.n} on load:   ${r.eagerMs.toFixed(0)} ms of main-thread work`);
    console.log(
        `LAZY   built on load (visible): ${r.builtOnLoad}  (~${(r.builtOnLoad * r.perViewerMs).toFixed(0)} ms; first ready in ${r.firstBuildMs.toFixed(0)} ms)`
    );
    console.log(`LAZY   built after scrolling:   ${r.builtAfterScroll} / ${r.n}  (deferred ones built on demand)`);
    const saved = r.eagerMs - r.builtOnLoad * r.perViewerMs;
    console.log(
        `initial-load main-thread work saved: ~${saved.toFixed(0)} ms (${(r.n / Math.max(1, r.builtOnLoad)).toFixed(1)}x fewer constructions)`
    );
    await browser.close();
}

main().catch((e) => {
    console.error(e);
    globalThis.process.exit(1);
});
