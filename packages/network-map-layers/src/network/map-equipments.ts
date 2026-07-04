/**
 * Copyright (c) 2022, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import {
    EQUIPMENT_TYPES,
    type MapEquipment,
    type MapHvdcLine,
    type MapLine,
    type MapSubstation,
    type MapTieLine,
    type MapVoltageLevel,
} from '../equipment-types';

const elementIdIndexer = <T extends MapEquipment>(map: Map<string, T>, element: T) => map.set(element.id, element);

export class MapEquipments {
    substations: MapSubstation[] = [];
    substationsById = new Map<string, MapSubstation>();
    lines: MapLine[] = [];
    linesById = new Map<string, MapLine>();
    tieLines: MapTieLine[] = [];
    tieLinesById = new Map<string, MapTieLine>();
    hvdcLines: MapHvdcLine[] = [];
    hvdcLinesById = new Map<string, MapHvdcLine>();
    voltageLevels: MapVoltageLevel[] = [];
    voltageLevelsById = new Map<string, MapVoltageLevel>();
    nominalVoltages: number[] = [];

    constructor() {
        // dummy constructor, to make children classes constructors happy
    }

    newMapEquipmentForUpdate(): typeof this {
        /* shallow clone of the map-equipment https://stackoverflow.com/a/44782052 */
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    }

    checkAndGetValues<T extends MapEquipment>(equipments: T[] | null | undefined) {
        return equipments ?? [];
    }

    completeSubstationsInfos(equipmentsToIndex: MapSubstation[]) {
        const nominalVoltagesSet = new Set(this.nominalVoltages);
        if (equipmentsToIndex?.length === 0) {
            this.substationsById = new Map();
            this.voltageLevelsById = new Map();
        }
        const substations = equipmentsToIndex?.length > 0 ? equipmentsToIndex : this.substations;

        substations.forEach((substation) => {
            // sort voltage levels inside substations by nominal voltage
            substation.voltageLevels.sort(
                (voltageLevel1, voltageLevel2) => voltageLevel1.nominalV - voltageLevel2.nominalV
            );

            this.substationsById.set(substation.id, substation);
            substation.voltageLevels.forEach((voltageLevel) => {
                voltageLevel.substationId = substation.id;
                voltageLevel.substationName = substation.name;

                this.voltageLevelsById.set(voltageLevel.id, voltageLevel);
                nominalVoltagesSet.add(voltageLevel.nominalV);
            });
        });

        this.voltageLevels = Array.from(this.voltageLevelsById.values());
        this.nominalVoltages = Array.from(nominalVoltagesSet).sort((a, b) => b - a);
    }

    updateEquipments<T extends MapEquipment>(currentEquipments: T[], newEquipments: T[]) {
        // index new equipments by id (keep the first occurrence in case of duplicates)
        const newEquipmentsById = new Map<string, T>();
        newEquipments.forEach((equipment) => {
            if (!newEquipmentsById.has(equipment.id)) {
                newEquipmentsById.set(equipment.id, equipment);
            }
        });

        // replace current modified equipments
        const currentEquipmentIds = new Set<string>();
        currentEquipments.forEach((equipment1, index) => {
            currentEquipmentIds.add(equipment1.id);
            const found = newEquipmentsById.get(equipment1.id);
            currentEquipments[index] = found ?? equipment1;
        });

        // add newly created equipments
        const eqptsToAdd = newEquipments.filter((eqpt) => !currentEquipmentIds.has(eqpt.id));
        if (eqptsToAdd.length === 0) {
            return currentEquipments;
        }
        return [...currentEquipments, ...eqptsToAdd];
    }

    updateSubstations(substations: MapSubstation[], fullReload: boolean) {
        if (fullReload) {
            this.substations = [];
            this.nominalVoltages = [];
        }

        // index new substations by id (keep the first occurrence in case of duplicates)
        const newSubstationsById = new Map<string, MapSubstation>();
        substations.forEach((substation) => {
            if (!newSubstationsById.has(substation.id)) {
                newSubstationsById.set(substation.id, substation);
            }
        });

        // replace current modified substations
        let voltageLevelAdded = false;
        const currentSubstationIds = new Set<string>();
        this.substations.forEach((substation1, index) => {
            currentSubstationIds.add(substation1.id);
            const found = newSubstationsById.get(substation1.id);
            if (found !== undefined) {
                if (found.voltageLevels.length > substation1.voltageLevels.length) {
                    voltageLevelAdded = true;
                }
                this.substations[index] = found;
            }
        });

        // add newly created substations
        let substationAdded = false;
        substations.forEach((substation1) => {
            if (!currentSubstationIds.has(substation1.id)) {
                this.substations.push(substation1);
                currentSubstationIds.add(substation1.id);
                substationAdded = true;
            }
        });

        if (substationAdded || voltageLevelAdded) {
            this.substations = [...this.substations];
        }

        // add more infos
        this.completeSubstationsInfos(fullReload ? [] : substations);
    }

    completeLinesInfos(equipmentsToIndex: MapLine[]) {
        if (equipmentsToIndex?.length > 0) {
            equipmentsToIndex.forEach((line) => {
                this.linesById?.set(line.id, line);
            });
        } else {
            this.linesById = this.lines.reduce((map, line) => elementIdIndexer(map, line), new Map());
        }
    }

    completeTieLinesInfos(equipmentsToIndex: MapTieLine[]) {
        if (equipmentsToIndex?.length > 0) {
            equipmentsToIndex.forEach((tieLine) => {
                this.tieLinesById?.set(tieLine.id, tieLine);
            });
        } else {
            this.tieLinesById = this.tieLines.reduce((map, tieLine) => elementIdIndexer(map, tieLine), new Map());
        }
    }

    updateLines(lines: MapLine[], fullReload: boolean) {
        if (fullReload) {
            this.lines = [];
        }
        this.lines = this.updateEquipments(this.lines, lines);
        this.completeLinesInfos(fullReload ? [] : lines);
    }

    updateTieLines(tieLines: MapTieLine[], fullReload: boolean) {
        if (fullReload) {
            this.tieLines = [];
        }
        this.tieLines = this.updateEquipments(this.tieLines, tieLines);
        this.completeTieLinesInfos(fullReload ? [] : tieLines);
    }

    updateHvdcLines(hvdcLines: MapHvdcLine[], fullReload: boolean) {
        if (fullReload) {
            this.hvdcLines = [];
        }
        this.hvdcLines = this.updateEquipments(this.hvdcLines, hvdcLines);
        this.completeHvdcLinesInfos(fullReload ? [] : hvdcLines);
    }

    completeHvdcLinesInfos(equipmentsToIndex: MapHvdcLine[]) {
        if (equipmentsToIndex?.length > 0) {
            equipmentsToIndex.forEach((hvdcLine) => {
                this.hvdcLinesById?.set(hvdcLine.id, hvdcLine);
            });
        } else {
            this.hvdcLinesById = this.hvdcLines.reduce((map, hvdcLine) => elementIdIndexer(map, hvdcLine), new Map());
        }
    }

    removeBranchesOfVoltageLevel(branchesList: MapLine[], voltageLevelId: string) {
        const remainingLines: MapLine[] = [];
        branchesList.forEach((line) => {
            if (line.voltageLevelId1 !== voltageLevelId && line.voltageLevelId2 !== voltageLevelId) {
                remainingLines.push(line);
            } else {
                this.linesById.delete(line.id);
            }
        });

        return remainingLines;
    }

    removeEquipment(equipmentType: EQUIPMENT_TYPES, equipmentId: string) {
        switch (equipmentType) {
            case EQUIPMENT_TYPES.LINE: {
                this.lines = this.lines.filter((l) => l.id !== equipmentId);
                this.linesById.delete(equipmentId);
                break;
            }
            case EQUIPMENT_TYPES.VOLTAGE_LEVEL: {
                const substationId = this.voltageLevelsById.get(equipmentId)?.substationId;
                //@ts-expect-error TODO: manage nullable substationId
                let voltageLevelsOfSubstation = this.substationsById.get(substationId)?.voltageLevels;
                voltageLevelsOfSubstation = voltageLevelsOfSubstation?.filter((l) => l.id !== equipmentId);
                //@ts-expect-error TODO: manage nullable substationId
                const substation = this.substationsById.get(substationId);
                if (substation !== undefined) {
                    //@ts-expect-error TODO: manage nullable voltageLevelsOfSubstation
                    substation.voltageLevels = voltageLevelsOfSubstation;
                }

                this.removeBranchesOfVoltageLevel(this.lines, equipmentId);
                //New reference on substations to trigger reload of NetworkExplorer and NetworkMap
                this.substations = [...this.substations];
                break;
            }
            case EQUIPMENT_TYPES.SUBSTATION: {
                this.substations = this.substations.filter((l) => l.id !== equipmentId);

                const substation = this.substationsById.get(equipmentId);
                substation?.voltageLevels.forEach((vl) => this.removeEquipment(EQUIPMENT_TYPES.VOLTAGE_LEVEL, vl.id));
                //@ts-expect-error TODO: manage nullable substation
                this.completeSubstationsInfos([substation]);
                break;
            }
            default:
        }
    }

    getVoltageLevels() {
        return this.voltageLevels;
    }

    getVoltageLevel(id: string) {
        return this.voltageLevelsById.get(id);
    }

    getSubstations() {
        return this.substations;
    }

    getSubstation(id: string) {
        return this.substationsById.get(id);
    }

    getNominalVoltages() {
        return this.nominalVoltages;
    }

    getLines() {
        return this.lines;
    }

    getLine(id: string) {
        return this.linesById.get(id);
    }

    getHvdcLines() {
        return this.hvdcLines;
    }

    getHvdcLine(id: string) {
        return this.hvdcLinesById.get(id);
    }

    getTieLines() {
        return this.tieLines;
    }

    getTieLine(id: string) {
        return this.tieLinesById.get(id);
    }
}
