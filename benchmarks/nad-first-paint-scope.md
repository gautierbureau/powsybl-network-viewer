<!--
Copyright (c) 2026, RTE (http://www.rte-france.com)
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

# Scope: Network Area Diagram first-paint performance

## Problem

Opening a large network area diagram (NAD) has a one-time first-paint cost that
the interactive optimizations (drag/hover/zoom) do not address. This document
scopes what that cost is, where it comes from, and the options to reduce it.

## Measured baseline

Measured in Chromium against the demo's `case1354pegase` diagram
(**1312 nodes / 1991 edges / 1354 bus nodes**, a **1.3 MiB** SVG string),
constructing the viewer in isolation (median of 5, see
`benchmarks/nad-fp-scope` methodology below):

| phase | median |
| --- | --- |
| `new NetworkAreaDiagramViewer()` construction (JS) | **38.5 ms** |
| — of which `div.innerHTML(svg)` (building the DOM from the string) | **33.2 ms (~86%)** |
| adaptive-text-zoom first pass | **+0.9 ms** (negligible) |
| raw `DOMParser(svg)` (reference) | 46.6 ms |

A whole-page dev-mode CPU profile (all ~20 demo viewers) corroborates this: our
own functions are tiny in the profile (`init` 0.1%, `getDimensionsFromSvg` 0.1%,
`adaptiveZoomViewboxUpdate` 0.6%); the notable NAD-attributable cost is the
svg.js XML parse (~8%). The rest of the profile is React/dev-bundle overhead (a
dev-mode artifact) and idle.

## Root cause

First-paint construction is ~38 ms, and **~86% of it is the browser building the
SVG DOM** from the 1.3 MiB server-generated string (`svgDraw.svg(svgContent)`).
Everything the viewer itself does — `getDimensionsFromSvg`, panzoom setup,
section creation, event binding, adaptive-text-zoom — sums to ~5 ms. **There is
no JS hotspot to micro-optimize**; the cost is inherent to injecting a large
server-rendered SVG into the DOM.

### Important caveat — the number above is JS only

The 38 ms measures JavaScript construction. After it, the browser must run
**style recalculation + layout + paint** over the thousands of injected SVG
elements, which happens asynchronously and is **not** in that number. Phase 0
below measures it — and it is more than half of first-paint.

## Phase 0 results — full first-paint breakdown

Measured on the demo page (so the `.nad-*` CSS is loaded, giving realistic
style matching) by constructing the viewer then forcing each browser phase in
turn: `getComputedStyle(...)` to flush style recalc, `getBoundingClientRect()`
to flush layout. Median of 6, LOD/adaptive off so construction itself does not
read layout.

| phase | case1354pegase (1.3 MiB) | ieee300-VL9006 (28 KiB) |
| --- | --- | --- |
| construct (JS + build SVG DOM) | 44.4 ms (44%) | 1.5 ms (43%) |
| style recalc | 32.3 ms (32%) | 1.2 ms (34%) |
| layout | 24.4 ms (24%) | 0.8 ms (23%) |
| **synchronous first-paint** | **~101 ms** | **~3.5 ms** |
| + to painted frame (paint/composite/idle) | ~62 ms | ~30 ms |

**Findings:**

- **First-paint is ~101 ms for pegase — the JS-only figure (~38 ms) was under
  half of it.** The style-recalc + layout tail hypothesised above is real: it is
  **~56%** of the synchronous work.
- The split (**~44% construct / ~32% style / ~24% layout**) is **stable across
  diagram sizes** (pegase vs ieee300), so all three phases scale together with
  element count.
- It is therefore **not purely parse-bound nor purely style-bound** — it is
  roughly balanced. The highest-leverage levers are the ones that cut **element
  count / size**, because those reduce all three phases at once (#3 lighter SVG,
  #5 virtualization). A CSS-only fix (#4) only touches the ~32% style share.
- Measured in dev mode; style/layout/paint are native (dev ≈ prod) and ~86% of
  `construct` is native `innerHTML`, so these numbers are close to production for
  the dominant phases. A production Performance-timeline capture is still worth
  doing to confirm paint/composite.

## Options

| # | Option | Effort | Risk | Payoff |
| --- | --- | --- | --- | --- |
| 1 | **Lazy-construct off-screen viewers** (IntersectionObserver). A page with many NADs builds them all at once; build only the visible ones. | S | Low | **High** on multi-viewer pages |
| 2 | **Chunk the SVG insertion** across frames so it is not one > 50 ms long task. | M | Low | Perceived responsiveness |
| 3 | **Trim the emitted SVG** (coordinate precision, structure) + brotli/gzip transfer. Needs powsybl-diagram coordination. | M | Low | Transfer + parse |
| 4 | **Reduce style-recalc cost** — audit NAD CSS selectors matching thousands of elements; consider `content-visibility` / `contain`. | M | Med | Potentially high if style/layout-bound |
| 5 | **Virtualize the SVG DOM** — inject only viewport elements, stream on pan/zoom. | XL | High | High for single huge diagrams |
| 6 | **Canvas/WebGL rendering** (like the map layers). | XXL | High | Highest; not realistic short-term |

## Recommended phased plan

- **Phase 0 — validate. ✅ Done (see results above).** First-paint is ~101 ms for
  pegase, split ~44% construct / ~32% style / ~24% layout — roughly balanced, so
  the biggest levers are the ones that cut element count/size (they reduce all
  three phases). A production Performance-timeline capture remains a nice-to-have
  to confirm the paint/composite tail.
- **Phase 1 — quick win. ✅ Prototyped + shipped as `lazyMount`.** Highest ROI for
  the common multi-viewer page (each viewer costs ~101 ms, so not building the
  off-screen ones is the biggest single win), low risk. Optionally #2 chunked
  insertion if a single diagram is still a long task (~101 ms is over the 50 ms
  long-task threshold).
- **Phase 2 — sustained (now informed by Phase 0).** Because the cost is balanced
  across construct/style/layout, prioritise **element-count/size reduction**,
  which cuts all three: #3 lighter emitted SVG (with powsybl-diagram) and, for
  extreme single diagrams, #5 virtualization. #4 (CSS/`content-visibility`) is a
  smaller, isolated win on the ~32% style share and can be done independently.
- **Phase 3 — only if needed.** #6 canvas/WebGL rendering for the very largest
  single diagrams.

## Explicitly not worth doing

Micro-optimizing the JS construction: it is already ~5 ms outside the
unavoidable DOM build. Replacing svg.js `.svg()` with raw `innerHTML` saves
~5 ms — not worth the churn.

---

## Phase 1 prototype — lazy off-screen construction

The prototype (`benchmarks/nad-lazy-mount-prototype.mjs`) stacks several
`case1354pegase` viewers in a scroll container the size of one viewport, and
compares:

- **eager**: construct every viewer on load (current demo behaviour);
- **lazy**: construct each viewer only when its slot enters the viewport, via an
  `IntersectionObserver`.

Result (8 `case1354pegase` viewers, 900 px viewport, Chromium; `npm run start`
then `node benchmarks/nad-lazy-mount-prototype.mjs`):

| mode | constructed on load | initial main-thread work |
| --- | --- | --- |
| eager (build all 8) | 8 | ~300–630 ms |
| lazy (IntersectionObserver) | **2** (visible) | ~75–160 ms |

- Absolute numbers vary run-to-run in dev mode (GC/JIT), but the **~4× ratio is
  stable**: lazy builds **2 of 8** viewers on load and the remaining **6 on
  demand** while scrolling (8/8 after scroll — correctness confirmed).
- Initial-load main-thread construction work drops by ~4× here; the ratio scales
  with how many viewers are off-screen — a page showing 1 of N approaches an
  N× reduction, and the first viewer is ready sooner (~70 ms vs building the
  whole stack first).

### Takeaway

Lazy construction moves the off-screen viewers' construction cost off the
initial-load main thread. On a page with N stacked viewers of which only ~1 is
visible, initial construction work drops roughly N×, and the deferred viewers
build on demand as the user scrolls. It is a consumer-side change (the consumer
decides when to call `new NetworkAreaDiagramViewer`); the library could ship a
small `lazyMount(container, factory)` helper to make it turn-key.
