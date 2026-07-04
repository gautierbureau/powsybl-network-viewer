/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

import { lazyMount } from './lazy-mount';

// jsdom does not implement IntersectionObserver, so we install a controllable mock.
class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];
    callback: IntersectionObserverCallback;
    options?: IntersectionObserverInit;
    observed: Element[] = [];
    disconnected = false;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        this.options = options;
        MockIntersectionObserver.instances.push(this);
    }
    observe(element: Element) {
        this.observed.push(element);
    }
    unobserve() {}
    disconnect() {
        this.disconnected = true;
    }
    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
    // test helper: simulate the observed target crossing the root
    fire(isIntersecting: boolean, target: Element) {
        this.callback(
            [{ isIntersecting, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
        );
    }
}

afterEach(() => {
    MockIntersectionObserver.instances = [];
    vi.unstubAllGlobals();
});

test('lazyMount runs the factory immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const factory = vi.fn();
    lazyMount(document.createElement('div'), factory);
    expect(factory).toHaveBeenCalledTimes(1);
});

test('lazyMount defers the factory until the container intersects', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const container = document.createElement('div');
    const factory = vi.fn();

    lazyMount(container, factory, { rootMargin: '100px' });

    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer.observed).toContain(container);
    expect(observer.options?.rootMargin).toBe('100px');
    // not yet visible -> not built
    expect(factory).not.toHaveBeenCalled();

    // a non-intersecting notification must not trigger it
    observer.fire(false, container);
    expect(factory).not.toHaveBeenCalled();

    // first intersection builds exactly once and disconnects
    observer.fire(true, container);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(observer.disconnected).toBe(true);

    // subsequent intersections do nothing
    observer.fire(true, container);
    expect(factory).toHaveBeenCalledTimes(1);
});

test('lazyMount cancel() prevents a pending build', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const container = document.createElement('div');
    const factory = vi.fn();

    const cancel = lazyMount(container, factory);
    const observer = MockIntersectionObserver.instances[0];

    cancel();
    expect(observer.disconnected).toBe(true);

    observer.fire(true, container);
    expect(factory).not.toHaveBeenCalled();
});

test('lazyMount reports a synchronous factory error to onError', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const error = new Error('boom');
    const onError = vi.fn();

    lazyMount(
        document.createElement('div'),
        () => {
            throw error;
        },
        { onError }
    );

    MockIntersectionObserver.instances[0].fire(true, document.createElement('div'));
    expect(onError).toHaveBeenCalledWith(error);
});

test('lazyMount reports a rejected async factory to onError', async () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const error = new Error('async boom');
    const onError = vi.fn();

    lazyMount(document.createElement('div'), () => Promise.reject(error), { onError });
    MockIntersectionObserver.instances[0].fire(true, document.createElement('div'));

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
});
