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
elements, which happens asynchronously and is **not** in that number — and is
likely larger. There is direct evidence already in the code: the
`attachCursorOverlay` comment documents a *"multi-second freeze from CSS
recalculation across thousands of descendants"*. So the real time-to-visible is
probably style/layout-bound, not parse-bound.

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

- **Phase 0 — validate (~0.5–1 day).** Production build + real network; capture a
  full Performance timeline (not just a CPU profile) to split JS construction vs
  style-recalc vs layout vs paint. This decides whether to invest in #2/#3
  (parse-bound) or #4/#5 (style/layout-bound).
- **Phase 1 — quick win (~1–2 days).** #1 lazy off-screen construction — highest
  ROI for the common multi-viewer page, low risk. (Prototyped below.) Optionally
  #2 chunked insertion if a single diagram is still a long task.
- **Phase 2 — sustained (depends on Phase 0).** #3 lighter SVG (with
  powsybl-diagram) and/or #4 CSS/style-recalc.
- **Phase 3 — only if needed.** #5 virtualization for extreme single diagrams.

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
