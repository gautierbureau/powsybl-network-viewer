/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

import { NadViewerParameters } from './nad-viewer-parameters';

test('getGeometryPrecision returns undefined when unset, so the writer applies its default', () => {
    expect(new NadViewerParameters(undefined).getGeometryPrecision()).toBeUndefined();
    expect(new NadViewerParameters({}).getGeometryPrecision()).toBeUndefined();
});

test('getGeometryPrecision returns the configured value', () => {
    expect(new NadViewerParameters({ geometryPrecision: 1 }).getGeometryPrecision()).toBe(1);
    expect(new NadViewerParameters({ geometryPrecision: 0 }).getGeometryPrecision()).toBe(0);
});
