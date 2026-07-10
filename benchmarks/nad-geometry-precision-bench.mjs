/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Benchmark for the configurable geometry precision (PR "configurable geometry
 * precision in the client SVG writer").
 *
 * The client SVG writer formats every coordinate with toFixed(precision). This
 * script measures the size of the emitted coordinate text at several precisions
 * on the real case1354pegase geometry (node positions, edge bending points and
 * text-node shifts), raw and gzipped. It is self-contained (no app import).
 *
 * The full generated-SVG figures (raw + gzip of the whole document) are
 * produced by the writer's own size test on the geometry-precision branch and
 * are recorded in benchmarks/README.md. Coordinate text is the part this lever
 * acts on, so the percentages here track those closely. Run:
 *
 *   node benchmarks/nad-geometry-precision-bench.mjs
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ROOT = globalThis.process.env.REPO_ROOT ?? '/home/user/powsybl-network-viewer';
const PEGASE = `${ROOT}/demo/src/diagram-viewers/data/case1354pegase_metadata.json`;

const m = JSON.parse(readFileSync(PEGASE, 'utf8'));

// collect the geometry coordinate values the writer emits from the metadata
function collectCoords() {
    const v = [];
    for (const n of m.nodes ?? []) v.push(n.x, n.y);
    for (const e of m.edges ?? []) for (const p of e.bendingPoints ?? []) v.push(p.x, p.y);
    for (const t of m.textNodes ?? []) v.push(t.shiftX, t.shiftY, t.connectionShiftX, t.connectionShiftY);
    return v.filter((x) => typeof x === 'number');
}

const coords = collectCoords();
// emulate how the coordinates appear in the SVG: "x,y x,y ..." pairs
function renderAt(precision) {
    let s = '';
    for (let i = 0; i < coords.length; i += 2) {
        s += coords[i].toFixed(precision) + ',' + (coords[i + 1] ?? 0).toFixed(precision) + ' ';
    }
    return s;
}

const enc = (s) => new TextEncoder().encode(s);
const base = enc(renderAt(2)).length;
const baseGz = gzipSync(enc(renderAt(2))).length;

console.log(`=== geometry-precision benchmark (pegase coordinate text, ${coords.length} values) ===`);
console.log('precision   raw            vs p2      gzip           vs p2');
for (const p of [3, 2, 1, 0]) {
    const s = renderAt(p);
    const raw = enc(s).length;
    const gz = gzipSync(enc(s)).length;
    const dRaw = (((raw - base) / base) * 100).toFixed(1);
    const dGz = (((gz - baseGz) / baseGz) * 100).toFixed(1);
    console.log(
        `${String(p).padEnd(11)} ${(raw / 1024).toFixed(1).padStart(6)} KB   ${(dRaw + '%').padStart(7)}    ${(gz / 1024).toFixed(1).padStart(6)} KB   ${(dGz + '%').padStart(7)}`
    );
}
console.log('\nGzip savings exceed raw: fewer decimal digits lower symbol entropy, which compresses better.');
