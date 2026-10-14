/**
 * Traders & Barbarians: The Caravans.
 *
 * How it works (all data):
 *  - An oasis sits in the middle of the island (instead of the desert). Camels walk out from it
 *    along the sides of hexes, forming caravan routes.
 *  - Every time someone builds a settlement or a city, the players vote on who leads the next
 *    camel: in turn order, starting with the builder, each player may offer grain and/or wool
 *    (paid to the bank). The highest offer wins; ties go to the player earliest in that order
 *    (so if nobody offers anything, the builder places it). The winner places 1 camel on a side
 *    touching the oasis or continuing an existing caravan.
 *  - Each of your settlements and cities next to a camel is worth 1 extra victory point.
 *  - For Longest Road, each of your roads that runs beside a camel counts one extra.
 *  - Play to 12 victory points.
 */
import type { Condition, Effect, MapDef, ModDef, PieceDef } from '../../../engine/schema';
import { baseMod } from '../../base';

/* --------------------------------- map ---------------------------------- */

function caravansMap(): MapDef {
  const std = baseMod.maps![0];
  return {
    ...std,
    id: 'tb-caravans',
    name: 'The Caravans (3-4 players)',
    hexes: std.hexes.map((h) => (h.q === 0 && h.r === 0 ? { q: 0, r: 0, terrain: 'oasis' } : { ...h })),
    terrainBags: { land: std.terrainBags!.land.filter((t) => t !== 'desert') },
  };
}

/* -------------------------------- pieces -------------------------------- */

const baseRoad = baseMod.pieces!.find((p) => p.id === 'road')!;
const onLand: Condition = { not: { isWater: { at: 'at' } } };
// Roads may share a side with a camel, so a road is only blocked by another road.
const noRoadHere: Condition = { not: { occupied: { at: 'at', piece: 'road' } } };

const road: PieceDef = {
  ...baseRoad,
  placement: {
    on: 'edge',
    where: { all: [noRoadHere, onLand, { connectedTo: { at: 'at', owner: 'self' } }] },
    setupWhere: { all: [noRoadHere, onLand, { isAdjacent: ['at', 'lastPlaced'] }] },
  },
};

const camel: PieceDef = {
  id: 'camel', name: 'Camel', icon: 'merchant', supply: -1, tags: ['camel'],
  placement: {
    on: 'edge',
    where: {
      all: [
        { not: { occupied: { at: 'at', piece: 'camel' } } },
        onLand,
        // starts at the oasis, or continues a caravan route
        { any: [{ terrainIs: { at: 'at', terrain: 'oasis' } }, { adjacentTo: { at: 'at', piece: 'camel' } }] },
      ],
    },
  },
};

/* --------------------------------- vote --------------------------------- */

const bid = (who: string) => ({ stat: { player: { var: who }, key: 'camelBid' } });
const offer = (label: string, cards: Record<string, number>): { label: string; cond: Condition; do: Effect[] } => ({
  label,
  cond: { canAfford: { cost: cards, player: { var: 'voter' } } },
  do: [
    { op: 'pay', player: { var: 'voter' }, resources: cards },
    { op: 'setStat', player: { var: 'voter' }, key: 'camelBid', value: Object.values(cards).reduce((a, b) => a + b, 0) },
    { op: 'log', text: `{voter} offers ${label.replace('Offer ', '')}` },
  ],
});

const caravanVote: Effect[] = [
  {
    op: 'forEachPlayer', as: 'voter', filter: true,
    do: [{
      op: 'chooseOption', player: { var: 'voter' }, label: 'Caravan vote: what do you offer to lead the next camel?',
      options: [
        { label: 'Offer nothing', do: [] },
        offer('Offer 1 grain', { grain: 1 }),
        offer('Offer 1 wool', { wool: 1 }),
        offer('Offer 1 grain and 1 wool', { grain: 1, wool: 1 }),
      ],
    }],
  },
  {
    // the highest offer wins; the first such player (from the builder on) leads the camel
    op: 'forEachPlayer', as: 'leader',
    filter: { cmp: [{ countPlayers: { as: 'other', filter: { cmp: [bid('other'), '>', bid('leader')] } } }, '==', 0] },
    do: [{
      op: 'if', cond: { cmp: [{ global: 'camelPlaced' }, '==', 0] },
      then: [
        { op: 'setGlobal', key: 'camelPlaced', value: 1 },
        { op: 'log', text: '{leader} leads the caravan' },
        { op: 'place', piece: 'camel', player: { var: 'leader' }, free: true, location: { label: 'Place a camel' } },
      ],
    }],
  },
  { op: 'setGlobal', key: 'camelPlaced', value: 0 },
  { op: 'forEachPlayer', as: 'voter', filter: true, do: [{ op: 'setStat', player: { var: 'voter' }, key: 'camelBid', value: 0 }] },
];

/** Re-count everyone's "buildings next to a camel" and adjust their bonus points to match. */
const recountCaravanPoints: Effect[] = [{
  op: 'forEachPlayer', as: 'p', filter: true,
  do: [
    { op: 'setVar', name: 'nextToCamels', value: { pieceCount: { owner: { var: 'p' }, tag: 'building', where: { adjacentTo: { at: 'candidate', piece: 'camel' } } } } },
    {
      op: 'if', cond: { cmp: [{ var: 'nextToCamels' }, '!=', { stat: { player: { var: 'p' }, key: 'caravanPoints' } }] },
      then: [
        { op: 'addVP', player: { var: 'p' }, amount: { sub: [{ var: 'nextToCamels' }, { stat: { player: { var: 'p' }, key: 'caravanPoints' } }] }, reason: 'buildings next to the caravan' },
        { op: 'setStat', player: { var: 'p' }, key: 'caravanPoints', value: { var: 'nextToCamels' } },
      ],
    },
  ],
}];

/* --------------------------------- mod ---------------------------------- */

export const mod: ModDef = {
  meta: {
    id: 'tb-caravans',
    name: 'T&B: The Caravans',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description: 'Camels leave the oasis whenever someone builds. Vote with grain and wool to lead them; buildings next to the caravan score an extra point.',
  },
  terrains: [{ id: 'oasis', name: 'Oasis', color: '#e3c770', icon: 'sun' }],
  maps: [caravansMap()],
  remove: { maps: ['base-standard'] },
  pieces: [road, camel],
  tokens: [{ ...baseMod.tokens!.find((t) => t.id === 'robber')!, startTerrain: 'oasis' }],
  awards: [{
    id: 'longestRoad', name: 'Longest Road', vp: 2, min: 5, holderKeepsOnTie: true,
    // longest road + 1 for each of your roads beside a camel
    metric: { add: [{ longestRoad: 'self' }, { pieceCount: { owner: 'self', piece: 'road', where: { occupied: { at: 'candidate', piece: 'camel' } } } }] },
  }],
  triggers: [
    {
      id: 'caravanVote', on: 'piecePlaced', as: 'eventPlayer',
      when: { all: [{ not: { phase: 'setup' } }, { any: [{ varIs: { var: 'piece', value: 'settlement' } }, { varIs: { var: 'piece', value: 'city' } }] }] },
      do: caravanVote,
    },
    {
      id: 'caravanPoints', on: 'piecePlaced',
      when: { any: [{ varIs: { var: 'piece', value: 'camel' } }, { varIs: { var: 'piece', value: 'settlement' } }, { varIs: { var: 'piece', value: 'city' } }] },
      do: recountCaravanPoints,
    },
  ],
  victoryPoints: 12,
};

export default mod;
