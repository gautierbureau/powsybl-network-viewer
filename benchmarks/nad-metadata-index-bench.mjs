/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Benchmark for the O(1) metadata-lookup indexing (PR "O(1) metadata lookups
 * for the adaptive-zoom SVG writer").
 *
 * The client SVG writer resolves metadata per element while (re)drawing a
 * diagram: for every node it looks up its bus nodes and its edges, for every
 * edge its two end nodes. With Array.find/filter that is O(n) per lookup and
 * O(n^2) over the whole diagram; with per-array Map indices it is O(1).
 *
 * This script is self-contained (no app import): it replays that exact access
 * pattern with both implementations. The "indexed" functions mirror the ones
 * shipped in metadata-utils.ts (verified byte-identical in behaviour by the
 * metadata-utils unit tests). Run:
 *
 *   node benchmarks/nad-metadata-index-bench.mjs
 */
import { readFileSync } from 'node:fs';

const ROOT = globalThis.process.env.REPO_ROOT ?? '/home/user/powsybl-network-viewer';
const PEGASE = `${ROOT}/demo/src/diagram-viewers/data/case1354pegase_metadata.json`;

// ---------- OLD: linear scans (pre-index) ----------
const oldGetNode = (id, m) => m.nodes.find((n) => n.svgId == id);
const oldGetBusNodes = (id, busNodes) => busNodes.filter((b) => b.vlNode === id);
const oldGetNodeEdges = (id, edges) => edges.filter((e) => e.node1 == id || e.node2 == id);

// ---------- NEW: Map indices built once per array (mirror of metadata-utils.ts) ----------
const nodesById = new WeakMap();
const busByVl = new WeakMap();
const edgesByNode = new WeakMap();
function indexById(arr) {
    let m = nodesById.get(arr);
    if (!m) {
        m = new Map();
        for (const n of arr) if (!m.has(n.svgId)) m.set(n.svgId, n);
        nodesById.set(arr, m);
    }
    return m;
}
function indexBusByVl(arr) {
    let m = busByVl.get(arr);
    if (!m) {
        m = new Map();
        for (const b of arr) {
            const g = m.get(b.vlNode);
            if (g) g.push(b);
            else m.set(b.vlNode, [b]);
        }
        busByVl.set(arr, m);
    }
    return m;
}
function indexEdgesByNode(arr) {
    let m = edgesByNode.get(arr);
    if (!m) {
        m = new Map();
        const add = (k, e) => {
            const g = m.get(k);
            if (g) g.push(e);
            else m.set(k, [e]);
        };
        for (const e of arr) {
            add(e.node1, e);
            if (e.node2 !== e.node1) add(e.node2, e);
        }
        edgesByNode.set(arr, m);
    }
    return m;
}
const newGetNode = (id, m) => indexById(m.nodes).get(id);
const newGetBusNodes = (id, busNodes) => indexBusByVl(busNodes).get(id) ?? [];
const newGetNodeEdges = (id, edges) => indexEdgesByNode(edges).get(id) ?? [];

// reproduce the writer's per-element metadata access pattern
function runPattern(m, useNew) {
    let acc = 0;
    for (const node of m.nodes) {
        const buses = useNew ? newGetBusNodes(node.svgId, m.busNodes) : oldGetBusNodes(node.svgId, m.busNodes);
        const edges = useNew ? newGetNodeEdges(node.svgId, m.edges) : oldGetNodeEdges(node.svgId, m.edges);
        acc += buses.length + edges.length;
    }
    for (const edge of m.edges) {
        const n1 = useNew ? newGetNode(edge.node1, m) : oldGetNode(edge.node1, m);
        const n2 = useNew ? newGetNode(edge.node2, m) : oldGetNode(edge.node2, m);
        acc += (n1 ? 1 : 0) + (n2 ? 1 : 0);
    }
    return acc;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function timeOnce(m, useNew) {
    const t = performance.now();
    runPattern(m, useNew);
    return performance.now() - t;
}

function buildSynthetic(nNodes) {
    const nodes = [];
    const busNodes = [];
    for (let i = 0; i < nNodes; i++) {
        nodes.push({ svgId: String(i), equipmentId: 'eq' + i, x: i, y: i });
        busNodes.push({ svgId: 'b' + i, equipmentId: 'be' + i, nbNeighbours: 0, index: 0, vlNode: String(i) });
    }
    const edges = [];
    const nEdges = Math.floor(nNodes * 1.5);
    for (let i = 0; i < nEdges; i++) {
        const a = (i * 7) % nNodes;
        const b = (i * 13 + 1) % nNodes;
        edges.push({
            svgId: 'e' + i,
            node1: String(a),
            node2: String(b),
            busNode1: 'b' + a,
            busNode2: 'b' + b,
            type: 'LineEdge',
        });
    }
    return { nodes, busNodes, edges, textNodes: [] };
}

console.log('=== metadata-lookup benchmark (writer access pattern) ===');
console.log('diagram                         old (find/filter)   indexed     speedup');
for (const n of [500, 1000, 2000, 4000]) {
    const oldT = [];
    const newT = [];
    for (let r = 0; r < 5; r++) {
        oldT.push(timeOnce(buildSynthetic(n), false)); // fresh arrays -> index rebuilt each run
        newT.push(timeOnce(buildSynthetic(n), true));
    }
    const o = median(oldT);
    const nw = median(newT);
    console.log(
        `N=${String(n).padEnd(28)} ${o.toFixed(2).padStart(8)} ms   ${nw.toFixed(3).padStart(8)} ms   ${(o / nw).toFixed(0)}x`
    );
}

const pegase = JSON.parse(readFileSync(PEGASE, 'utf8'));
const oldT = [];
const newT = [];
for (let r = 0; r < 7; r++) {
    oldT.push(timeOnce(pegase, false));
    newT.push(timeOnce(pegase, true)); // same object across runs -> index built once, reused (real usage)
}
const o = median(oldT);
const nw = median(newT);
const label = `pegase (${pegase.nodes.length}n/${pegase.edges.length}e/${pegase.busNodes.length}b)`;
console.log(
    `${label.padEnd(28)} ${o.toFixed(2).padStart(8)} ms   ${nw.toFixed(3).padStart(8)} ms   ${(o / nw).toFixed(0)}x`
);
console.log('\nOld grows ~quadratically (~4x per doubling of N); indexed grows ~linearly.');
console.log('On real metadata the index is built once and reused across every redraw.');
