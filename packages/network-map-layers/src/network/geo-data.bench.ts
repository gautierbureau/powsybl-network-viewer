/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { bench, describe } from 'vitest';
import { GeoData, type GeoDataSubstation } from './geo-data';
import { type Coordinate } from '../powsybl';

// Confirms the O(n*m) -> O(n) improvement in GeoData.updateSubstationPositions.
// The optimized version builds a Set of fetched ids once; the pre-change version
// rebuilt `fetchedPositions.map((pos) => pos.id)` and ran includes() for every id
// to update.

function makeSubstations(count: number): GeoDataSubstation[] {
    const substations: GeoDataSubstation[] = [];
    for (let i = 0; i < count; i++) {
        substations.push({ id: 'sub-' + i, coordinate: { lon: i * 0.001, lat: i * 0.001 } });
    }
    return substations;
}

// pre-change implementation, kept here as a benchmark baseline only
function updateSubstationPositionsNaive(
    substationPositionsById: Map<string, Coordinate>,
    substationIdsToUpdate: string[],
    fetchedPositions: GeoDataSubstation[]
) {
    fetchedPositions.forEach((pos) => substationPositionsById.set(pos.id, pos.coordinate));
    substationIdsToUpdate
        .filter((id) => !fetchedPositions.map((pos) => pos.id).includes(id))
        .forEach((id) => substationPositionsById.delete(id));
}

for (const size of [2000, 10000]) {
    const fetched = makeSubstations(size);
    const idsToUpdate = fetched.map((substation) => substation.id);

    describe(`GeoData.updateSubstationPositions (${size} positions)`, () => {
        bench('optimized (Set membership)', () => {
            const geoData = new GeoData(new Map(), new Map());
            geoData.updateSubstationPositions(idsToUpdate, fetched);
        });

        bench('baseline (map().includes per id)', () => {
            updateSubstationPositionsNaive(new Map(), idsToUpdate, fetched);
        });
    });
}
