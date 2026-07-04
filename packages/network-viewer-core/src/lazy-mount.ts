/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

export type LazyMountOptions = {
    /** The element used as the intersection root. Defaults to the browser viewport (`null`). */
    root?: Element | Document | null;
    /**
     * Margin around the root so the factory can run slightly before the container becomes
     * visible. Same syntax as `IntersectionObserver`'s `rootMargin`. Defaults to `'200px'`.
     */
    rootMargin?: string;
    /** Called if `factory` throws synchronously or returns a promise that rejects. */
    onError?: (error: unknown) => void;
};

/**
 * Defer an expensive construction until its container is (near) the viewport.
 *
 * `factory` is invoked at most once, the first time `container` intersects the root
 * (expanded by `rootMargin`). This is useful for pages that show several heavy diagrams:
 * instead of constructing all of them on load, each is built only when scrolled into view,
 * which keeps the initial-load main thread free and makes the first visible diagram appear
 * sooner.
 *
 * Returns a function that cancels a still-pending mount (a no-op once the factory has run).
 *
 * Falls back to invoking `factory` immediately when `IntersectionObserver` is unavailable
 * (e.g. non-DOM environments), so callers never have to branch on support.
 *
 * The `container` must reserve layout space (e.g. a `min-height`) before it is filled.
 * A zero-height container collapses to the top of the page and will be reported as
 * intersecting right away, mounting immediately — which defeats the purpose. Give each
 * deferred container the size its diagram will occupy.
 *
 * @example
 * lazyMount(container, () => {
 *     new NetworkAreaDiagramViewer(container, svg, metadata, options);
 * });
 */
export function lazyMount(
    container: Element,
    factory: () => void | Promise<void>,
    options: LazyMountOptions = {}
): () => void {
    const runFactory = () => {
        try {
            const result = factory();
            if (result instanceof Promise) {
                result.catch((error) => options.onError?.(error));
            }
        } catch (error) {
            options.onError?.(error);
        }
    };

    if (typeof IntersectionObserver === 'undefined') {
        // No observer support: build immediately rather than never.
        runFactory();
        return () => {};
    }

    let done = false;
    const observer = new IntersectionObserver(
        (entries) => {
            if (done) {
                return;
            }
            if (entries.some((entry) => entry.isIntersecting)) {
                done = true;
                observer.disconnect();
                runFactory();
            }
        },
        { root: options.root ?? null, rootMargin: options.rootMargin ?? '200px', threshold: 0 }
    );
    observer.observe(container);

    return () => {
        if (!done) {
            done = true;
            observer.disconnect();
        }
    };
}
