<!--
Copyright (c) 2026, RTE (http://www.rte-france.com)
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

# NAD adaptive-zoom writer benchmarks

Reproducible benchmarks for the three performance changes stacked on the
adaptive-zoom SVG-writer branch (`integration/nad_create_svg_adaptive_zoom`, PR
#423 upstream):

| bench                              | measures                                                    | PR                              |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| `nad-metadata-index-bench.mjs`     | writer metadata-lookup cost, `find`/`filter` vs Map index   | O(1) metadata lookups           |
| `nad-geometry-precision-bench.mjs` | emitted coordinate-text size at each precision              | configurable geometry precision |
| `nad-lazy-mount-bench.mjs`         | eager vs lazy off-screen viewer construction (real browser) | lazyMount off-screen gate       |

All three use the `case1354pegase` demo diagram (1312 nodes / 1991 edges / 1354
bus nodes).

## Running

The two node benches are self-contained (no build, no server):

```bash
node benchmarks/nad-metadata-index-bench.mjs
node benchmarks/nad-geometry-precision-bench.mjs
```

The lazy-mount bench drives a real headless Chromium and needs the demo dev
server plus `playwright-core`:

```bash
npm install --no-save playwright-core   # if not already present
npm run start &                         # serves the demo on :5173
node benchmarks/nad-lazy-mount-bench.mjs                       # N=8 viewers, raw-SVG path
N=16 node benchmarks/nad-lazy-mount-bench.mjs                  # more off-screen viewers
CREATE_SVG_FROM_METADATA=1 node benchmarks/nad-lazy-mount-bench.mjs  # exercise the #423 client writer
```

Env vars: `N` (viewer count, default 8), `CREATE_SVG_FROM_METADATA=1` (build via
the client SVG writer instead of injecting the raw SVG), `PW_CHROMIUM`,
`REPO_ROOT`.

## Recorded results

Headless Chromium, dev mode, one shared container. Absolute times are
machine- and run-dependent (dev-mode GC/JIT); the **ratios** are the stable,
portable figures.

### Metadata-lookup indexing

Replays the writer's per-element access pattern (per node: bus-node + node-edge
lookups; per edge: two node lookups):

| diagram    | old (`find`/`filter`) | indexed     | speedup   |
| ---------- | --------------------- | ----------- | --------- |
| N = 500    | 9.7 ms                | 0.76 ms     | 13×       |
| N = 1000   | 24.1 ms               | 0.49 ms     | 50×       |
| N = 2000   | 71.7 ms               | 1.23 ms     | 58×       |
| N = 4000   | 325.7 ms              | 2.73 ms     | 119×      |
| **pegase** | **33.2 ms**           | **0.31 ms** | **~100×** |

Old time roughly quadruples per doubling of N (O(n²)); indexed grows ~linearly.
On real metadata the index is built once and reused across every redraw.

### Geometry precision (coordinate text)

Size of the emitted coordinate text on real pegase geometry:

| precision       | raw     | vs p2  | gzip    | vs p2      |
| --------------- | ------- | ------ | ------- | ---------- |
| 3               | 64.8 KB | +13.5% | 10.8 KB | +4.0%      |
| **2 (default)** | 57.1 KB | —      | 10.4 KB | —          |
| 1               | 49.4 KB | −13.5% | 8.7 KB  | **−16.5%** |
| 0               | 34.0 KB | −40.4% | 6.6 KB  | **−36.2%** |

These are the **coordinate-text** bytes. Measured on the **whole generated SVG**
by the writer's own size test (on the geometry-precision branch), the document
is 1093 KB raw / 168.5 KB gzip at precision 2, dropping to 156.0 KB gzip
(−7.4%) at precision 1 and 140.8 KB gzip (−16.4%) at precision 0 — smaller
percentages because coordinates are only part of the document, but the same
direction, and gzip savings exceed raw in both views.

### Lazy off-screen construction (real browser)

N `case1354pegase` viewers stacked in a one-viewport scroll container, eager
(build all on load) vs lazy (`IntersectionObserver`, build on view):

| path               | N   | per-viewer | eager on load | lazy on load     | saved      | ratio    |
| ------------------ | --- | ---------- | ------------- | ---------------- | ---------- | -------- |
| raw SVG inject     | 8   | ~41 ms     | 326 ms        | 81 ms (2 built)  | ~244 ms    | **4.0×** |
| raw SVG inject     | 16  | ~41 ms     | 658 ms        | 82 ms (2 built)  | ~575 ms    | **8.0×** |
| #423 client writer | 8   | ~373 ms    | 2985 ms       | 746 ms (2 built) | **~2.2 s** | **4.0×** |

- The ratio is `N / visible` (≈2 visible here), so a page showing ~1 of N
  approaches an **N×** reduction in initial-load construction work.
- After scrolling, all N viewers are built on demand (correctness confirmed).
- The client-writer path costs ~9× more per viewer than raw injection because it
  builds the SVG DOM element-by-element in JS — which is exactly where the
  metadata-lookup indexing above pays off.
