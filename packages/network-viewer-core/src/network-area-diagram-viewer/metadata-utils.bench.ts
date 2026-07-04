/**
 * Copyright (c) 2026, RTE (http://www.rte-france.com)
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * SPDX-License-Identifier: MPL-2.0
 */

import { bench, describe } from 'vitest';
import * as MetadataUtils from './metadata-utils';
import {
    type BusNodeMetadata,
    type DiagramMetadata,
    type EdgeMetadata,
    type NodeMetadata,
    type TextNodeMetadata,
} from './diagram-metadata';

// Confirms the improvement of the metadata lookups used per edge / per node on
// every mousemove during a drag or a hover. The optimized version indexes the
// metadata once (lazily, cached on the metadata object via a WeakMap); the
// pre-change version did a linear Array.find / Array.filter for each lookup.
//
// Each benchmark performs one lookup per node, simulating a single redraw pass
// that touches every voltage level node (as a drag frame does on a dense graph).

function makeMetadata(nodeCount: number): DiagramMetadata {
    const nodes: NodeMetadata[] = [];
    const busNodes: BusNodeMetadata[] = [];
    const textNodes: TextNodeMetadata[] = [];
    const edges: EdgeMetadata[] = [];
    for (let i = 0; i < nodeCount; i++) {
        const svgId = 'vl-' + i;
        nodes.push({ svgId, equipmentId: 'VL' + i, x: i, y: i });
        busNodes.push({ svgId: 'bus-' + i, equipmentId: 'BUS' + i, nbNeighbours: 1, index: 0, vlNode: svgId });
        textNodes.push({
            svgId: 'text-' + i,
            equipmentId: 'VL' + i,
            vlNode: svgId,
            shiftX: 0,
            shiftY: 0,
            connectionShiftX: 0,
            connectionShiftY: 0,
        });
    }
    // a connected chain of edges: each node (but the ends) has degree 2
    for (let i = 0; i < nodeCount - 1; i++) {
        edges.push({
            svgId: 'edge-' + i,
            equipmentId: 'E' + i,
            node1: 'vl-' + i,
            node2: 'vl-' + (i + 1),
            busNode1: 'bus-' + i,
            busNode2: 'bus-' + (i + 1),
            type: 'LineEdge',
        });
    }
    return { nodes, busNodes, textNodes, edges } as unknown as DiagramMetadata;
}

for (const size of [500, 2000]) {
    const metadata = makeMetadata(size);
    const nodeIds = metadata.nodes.map((node) => node.svgId);

    describe(`node metadata lookup, one per node over ${size} nodes`, () => {
        bench('optimized (indexed getNodeMetadata)', () => {
            for (const id of nodeIds) {
                MetadataUtils.getNodeMetadata(id, metadata);
            }
        });

        bench('baseline (linear Array.find)', () => {
            for (const id of nodeIds) {
                metadata.nodes.find((node) => node.svgId == id);
            }
        });
    });

    describe(`connected-edges lookup, one per node over ${size} nodes`, () => {
        bench('optimized (indexed getConnectedEdges)', () => {
            for (const id of nodeIds) {
                MetadataUtils.getConnectedEdges(id, metadata);
            }
        });

        bench('baseline (linear Array.filter)', () => {
            for (const id of nodeIds) {
                metadata.edges.filter((edge) => edge.node1 == id || edge.node2 == id);
            }
        });
    });
}
