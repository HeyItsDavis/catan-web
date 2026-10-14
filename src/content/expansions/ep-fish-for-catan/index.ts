/**
 * Explorers & Pirates mission: Fish for Catan.
 *
 * Land Ho! rules (see ../ep-land-ho), plus:
 *  - The Council of Catan sits off the south coast of the home island.
 *  - Fish shoals are hidden in the fog. A ship beside a shoal can catch 1 fish per turn
 *    (it still holds at most 2 settlers/goods in total).
 *  - A ship that arrives at the Council of Catan delivers its fish: 1 victory point each.
 *  - Play to 10 victory points.
 */
import type { ModDef } from '../../../engine/schema';
import { COUNCIL_HEX, COUNCIL_TERRAIN, buildLandHo, deliverToCouncil } from '../ep-land-ho';

export const mod: ModDef = buildLandHo({
  id: 'ep-fish-for-catan',
  name: 'E&P: Fish for Catan',
  description: 'Land Ho! plus a mission: find the fish shoals in the fog, catch fish and bring them to the Council of Catan for victory points. Play to 10.',
  victoryPoints: 10,
  extraHexes: [COUNCIL_HEX],
  extraFog: [{ fog: 'fogShoal', real: 'shoal', count: 4, water: true }],
  openWater: ['sea', 'shoal'],
  shipActions: ['catchFish'],
  shipTurnStates: ['fished'],
  extra: {
    terrains: [COUNCIL_TERRAIN, { id: 'shoal', name: 'Fish shoal', color: '#2f7fb8', water: true, icon: 'fish' }],
    actions: [{
      id: 'catchFish', name: 'Catch fish', group: 'Ship', icon: 'fish',
      description: 'Beside a fish shoal: catch 1 fish (once per turn per ship). Bring it to the Council of Catan for 1 VP.',
      available: {
        all: [
          { isTurnOf: 'self' }, { phase: 'main' },
          { terrainIs: { at: 'piece', terrain: 'shoal' } },
          { cmp: [{ cargoCount: { piece: 'pieceId' } }, '<', 2] },
          { cmp: [{ pieceState: { piece: 'pieceId', key: 'fished' } }, '==', 0] },
        ],
      },
      effect: [
        { op: 'addCargo', piece: 'pieceId', key: 'fish', amount: 1 },
        { op: 'setPieceState', at: 'pieceId', key: 'fished', value: 1 },
        { op: 'log', text: '{self} catches a fish' },
      ],
    }],
    triggers: [deliverToCouncil('fish')],
  },
});

export default mod;
