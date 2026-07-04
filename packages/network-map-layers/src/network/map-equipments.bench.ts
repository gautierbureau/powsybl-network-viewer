/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { bench, describe } from 'vitest';
import { MapEquipments } from './map-equipments';
import { type MapLine } from '../equipment-types';

// Confirms the O(n*m) -> O(n) improvement in MapEquipments.updateEquipments.
// The optimized version indexes the new equipments by id (Map) and tracks the
// current ids in a Set; the pre-change version re-scanned the whole new-equipment
// array (filter) for every current equipment and re-scanned the whole current
// array (some) for every new equipment.

function makeLines(count: number, idPrefix: string): MapLine[] {
    const lines: MapLine[] = [];
    for (let i = 0; i < count; i++) {
        lines.push({ id: idPrefix + i } as MapLine);
    }
    return lines;
}

// pre-change implementation, kept here as a benchmark baseline only
function updateEquipmentsNaive<T extends { id: string }>(currentEquipments: T[], newEquipments: T[]) {
    currentEquipments.forEach((equipment1, index) => {
        const found = newEquipments.filter((equipment2) => equipment2.id === equipment1.id);
        currentEquipments[index] = found.length > 0 ? found[0] : equipment1;
    });
    const eqptsToAdd = newEquipments.filter((eqpt) => !currentEquipments.some((otherEqpt) => otherEqpt.id === eqpt.id));
    if (eqptsToAdd.length === 0) {
        return currentEquipments;
    }
    return [...currentEquipments, ...eqptsToAdd];
}

for (const size of [1000, 5000]) {
    // half the updates replace existing equipments, half are new: exercises both scans
    const existing = makeLines(size, 'line-');
    const updates = [...makeLines(size / 2, 'line-'), ...makeLines(size / 2, 'new-')];

    describe(`MapEquipments.updateEquipments (${size} existing, ${size} updates)`, () => {
        bench('optimized (Map/Set lookups)', () => {
            const mapEquipments = new MapEquipments();
            mapEquipments.updateEquipments(existing.slice(), updates);
        });

        bench('baseline (nested array scans)', () => {
            updateEquipmentsNaive(existing.slice(), updates);
        });
    });
}
