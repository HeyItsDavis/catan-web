/**
 * Explorers & Pirates mission: Spices for Catan.
 *
 * Land Ho! rules (see ../ep-land-ho), plus:
 *  - The Council of Catan sits off the south coast of the home island.
 *  - Spice villages are hidden on islands in the fog. A ship beside a village can buy 1 spice
 *    for 1 wool (it still holds at most 2 settlers/goods in total).
 *  - A ship that arrives at the Council of Catan delivers its spices: 1 victory point each, and
 *    all your ships sail 1 step farther per turn for each spice delivered (at most +2).
 *  - Play to 10 victory points.
 */
import type { Expr, ModDef } from '../../../engine/schema';
import { COUNCIL_HEX, COUNCIL_TERRAIN, buildLandHo, deliverToCouncil } from '../ep-land-ho';

/** 4 steps, +1 per spice you delivered, at most 6. */
const shipSpeed: Expr = { add: [4, { min: [{ stat: { key: 'spiceDelivered' } }, 2] }] };

export const mod: ModDef = buildLandHo({
  id: 'ep-spices',
  name: 'E&P: Spices for Catan',
  description: 'Land Ho! plus a mission: find the spice villages in the fog, trade wool for spices and bring them to the Council of Catan. Every spice is a point and makes your ships faster. Play to 10.',
  victoryPoints: 10,
  extraHexes: [COUNCIL_HEX],
  extraFog: [{ fog: 'fogVillage', real: 'spiceVillage', count: 3 }],
  shipSpeed,
  shipActions: ['buySpice'],
  extra: {
    terrains: [COUNCIL_TERRAIN, { id: 'spiceVillage', name: 'Spice village', color: '#c0703a', icon: 'settlement' }],
    actions: [{
      id: 'buySpice', name: 'Buy spice', group: 'Ship', icon: 'cloth', cost: { wool: 1 },
      description: 'Beside a spice village: trade 1 wool for 1 spice. Bring it to the Council of Catan for 1 VP and faster ships.',
      available: {
        all: [
          { isTurnOf: 'self' }, { phase: 'main' },
          { terrainIs: { at: 'piece', terrain: 'spiceVillage' } },
          { cmp: [{ cargoCount: { piece: 'pieceId' } }, '<', 2] },
        ],
      },
      effect: [{ op: 'addCargo', piece: 'pieceId', key: 'spice', amount: 1 }],
    }],
    // delivering counts the "spiceDelivered" stat, which the ship speed reads
    triggers: [deliverToCouncil('spice')],
  },
});

export default mod;
