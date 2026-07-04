<!--
Copyright (c) 2026, RTE (http://www.rte-france.com)
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

# Performance benchmarks

Two complementary layers:

## 1. Micro-benchmarks (`npm run bench`, vitest)

Data-structure / algorithmic wins, comparing the optimized code against inline
copies of the pre-change baselines. See `*.bench.ts` next to the code they
exercise. No browser needed.

## 2. Browser drag benchmark (`benchmarks/nad-drag-bench.mjs`, Playwright)

Drives a **real node drag** on the large PEGASE diagram (1312 nodes / 1991
edges) in the demo, and times the synchronous `mousemove` handler. This
captures the DOM / forced-layout costs (`getScreenCTM`, `scrollWidth`,
attribute-selector queries) that jsdom cannot reproduce.

```bash
# terminal 1 — serve the demo (aliases to workspace src, so it reflects the
# currently checked-out source)
npm run start

# terminal 2 — measure, and optionally CPU-profile to find remaining hotspots
node benchmarks/nad-drag-bench.mjs --label=optimized --steps=150 --repeats=7 --profile
```

To get a before/after number, overlay the baseline source, restart the dev
server, and re-run:

```bash
git restore --source=origin/main --worktree packages/network-viewer-core/src
# restart `npm run start`, then:
node benchmarks/nad-drag-bench.mjs --label=baseline
# restore:
git checkout HEAD -- packages/network-viewer-core/src
```

Requires `playwright-core` (installed as a devDependency). The Chromium binary
is taken from `PW_CHROMIUM` or the default sandbox path
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`.

### Measured result (PEGASE node drag, per-frame median)

| build | per-frame | 150-move drag |
| --- | --- | --- |
| baseline (`main`) | ~1.25 ms | ~187 ms |
| optimized | ~0.08 ms | ~12 ms |

~15× faster per drag frame. After the change, a CPU profile of the drag shows
the former linear metadata scans are gone; the residual cost is inherent DOM
mutation (`setAttribute`) plus number formatting (`toFixed`).
