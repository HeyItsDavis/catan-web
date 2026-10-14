/**
 * Traders & Barbarians: Rivers of Catan.
 *
 * How it works (all data):
 *  - Two rivers run from the middle of the island to the east and west coasts. Each river is a
 *    chain of "river" hexes (hills, mountains and pasture with a river); they produce as usual.
 *  - Gold coins are kept in the player stat "gold". You earn gold for building by the river:
 *    a road on a side of a river hex (1 gold), a settlement on a corner of a river hex (1 gold).
 *  - Where two river hexes meet, the side between them is the river itself: no road can be built
 *    there, only a bridge (2 brick + 1 lumber), which pays 3 gold and counts as a road.
 *  - 2 gold buy 1 resource of your choice (twice per turn).
 *  - The wealthiest settler (most gold) gets +1 VP; the poorest settler (least gold) gets -2 VP.
 *  - A swamp replaces the desert. It produces nothing; the robber starts there.
 */
import type { Condition, Effect, MapDef, ModDef, PieceDef, TriggerDef } from '../../../engine/schema';
import { baseMod } from '../../base';

const RIVER_TERRAINS = ['riverHills', 'riverMountains', 'riverPasture'];
/** Every terrain that is NOT a river hex. An edge touching none of these lies between two river hexes. */
const NON_RIVER = ['hills', 'forest', 'pasture', 'fields', 'mountains', 'desert', 'swamp', 'sea'];

/** The edge touches a river hex ("along the river bank"). */
const byTheRiver: Condition = { terrainIs: { at: 'at', terrain: RIVER_TERRAINS } };
/** The edge lies between two river hexes: that's the river itself. */
const crossesRiver: Condition = { not: { terrainIs: { at: 'at', terrain: NON_RIVER } } };

/* --------------------------------- map ---------------------------------- */

/** West river flows from (0,1) to the west coast, east river from (0,-1) to the east coast. */
const RIVER_HEXES: Record<string, string> = {
  '-2,1': 'riverPasture', '-1,1': 'riverHills', '0,1': 'riverMountains',
  '2,-1': 'riverPasture', '1,-1': 'riverHills', '0,-1': 'riverMountains',
};

function riversMap(): MapDef {
  const std = baseMod.maps![0];
  return {
    ...std,
    id: 'tb-rivers',
    name: 'Rivers of Catan (3-4 players)',
    hexes: std.hexes.map((h) => {
      const river = RIVER_HEXES[`${h.q},${h.r}`];
      return river ? { q: h.q, r: h.r, terrain: river } : { ...h };
    }),
    terrainBags: {
      // the standard bag minus the 6 river hexes; a swamp instead of the desert
      land: [
        'forest', 'forest', 'forest', 'forest',
        'pasture', 'pasture',
        'fields', 'fields', 'fields', 'fields',
        'hills', 'mountains', 'swamp',
      ],
    },
  };
}

/* -------------------------------- pieces -------------------------------- */

const baseRoad = baseMod.pieces!.find((p) => p.id === 'road')!;
const notOccupied: Condition = { not: { occupied: { at: 'at' } } };
const onLand: Condition = { not: { isWater: { at: 'at' } } };

const road: PieceDef = {
  ...baseRoad,
  placement: {
    on: 'edge',
    where: { all: [notOccupied, onLand, { not: crossesRiver }, { connectedTo: { at: 'at', owner: 'self' } }] },
    setupWhere: { all: [notOccupied, onLand, { not: crossesRiver }, { isAdjacent: ['at', 'lastPlaced'] }] },
  },
};

const bridge: PieceDef = {
  id: 'bridge', name: 'Bridge', icon: 'bridge', supply: 3,
  cost: { brick: 2, lumber: 1 },
  network: 'roads', // a bridge is part of your road for Longest Road
  tags: ['road', 'bridge'],
  placement: { on: 'edge', where: { all: [notOccupied, crossesRiver, { connectedTo: { at: 'at', owner: 'self' } }] } },
};

/* --------------------------------- gold --------------------------------- */

const gainGold = (n: number, why: string): Effect[] => [
  { op: 'addStat', key: 'gold', amount: n },
  { op: 'log', text: `{self} earns ${n} gold (${why})` },
];

const built = (piece: string, extra: Condition[] = []): TriggerDef['when'] => ({
  all: [{ not: { phase: 'setup' } }, { varIs: { var: 'piece', value: piece } }, ...extra],
});

/* --------------------------------- mod ---------------------------------- */

export const mod: ModDef = {
  meta: {
    id: 'tb-rivers',
    name: 'T&B: Rivers of Catan',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description: 'Two rivers cross the island. Build roads, settlements and bridges by the river to earn gold. The wealthiest settler gains a point, the poorest loses two.',
  },
  terrains: [
    { id: 'riverHills', name: 'Hills (river)', color: '#c9805a', produces: { brick: 1 }, numbered: true, icon: 'hills' },
    { id: 'riverMountains', name: 'Mountains (river)', color: '#8aa0b3', produces: { ore: 1 }, numbered: true, icon: 'mountain' },
    { id: 'riverPasture', name: 'Pasture (river)', color: '#8fd08a', produces: { wool: 1 }, numbered: true, icon: 'sheep' },
    { id: 'swamp', name: 'Swamp', color: '#6b7d4f', icon: 'wave' },
  ],
  maps: [riversMap()],
  remove: { maps: ['base-standard'] },
  pieces: [road, bridge],
  tokens: [{ ...baseMod.tokens!.find((t) => t.id === 'robber')!, startTerrain: 'swamp' }],
  actions: [{
    id: 'goldForResource', name: 'Buy a resource (2 gold)', group: 'Gold', icon: 'gold', limitPerTurn: 2,
    description: 'Pay 2 gold coins: take 1 resource of your choice from the bank. Twice per turn.',
    available: { all: [{ isTurnOf: 'self' }, { phase: 'main' }, { cmp: [{ stat: { key: 'gold' } }, '>=', 2] }] },
    effect: [{ op: 'addStat', key: 'gold', amount: -2 }, { op: 'chooseAndGain', amount: 1, kind: 'resource' }],
  }],
  awards: [
    { id: 'wealthiestSettler', name: 'Wealthiest settler', vp: 1, metric: { stat: { key: 'gold' } }, min: 1 },
    // The metric is "minus your gold", so the player with the least gold scores highest.
    // Ties (e.g. at the start, when everyone has 0) mean nobody is the poorest settler.
    { id: 'poorestSettler', name: 'Poorest settler', vp: -2, metric: { sub: [0, { stat: { key: 'gold' } }] }, min: -1000 },
  ],
  triggers: [
    { id: 'riverRoadGold', on: 'piecePlaced', as: 'eventPlayer', when: built('road', [byTheRiver]), do: gainGold(1, 'road by the river') },
    { id: 'riverSettlementGold', on: 'piecePlaced', as: 'eventPlayer', when: built('settlement', [byTheRiver]), do: gainGold(1, 'settlement by the river') },
    { id: 'bridgeGold', on: 'piecePlaced', as: 'eventPlayer', when: built('bridge'), do: gainGold(3, 'bridge') },
  ],
};

export default mod;
