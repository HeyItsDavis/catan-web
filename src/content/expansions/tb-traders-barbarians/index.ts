/**
 * Traders & Barbarians: the Traders & Barbarians scenario (wagons, goods and barbarian bands).
 *
 * This is the showcase for CARGO and MOVEMENT. How it works (all data):
 *
 *  Board
 *  - The castle stands in the middle of the island. A quarry (marble) and a glassworks (glass) sit
 *    on opposite coasts. None of the three produce resources.
 *
 *  Wagons
 *  - After setup, every player puts a wagon on one of their roads. You can build up to 2 more
 *    (1 lumber, 1 wool, 1 grain) on your own roads.
 *  - A wagon drives along roads (anyone's): each road it moves onto costs 1 movement point. Each
 *    wagon has 4 points per turn (piece state "moved" counts what it used; "extra" adds more).
 *    "Feed the horses" (1 grain) gives a wagon 2 more points this turn.
 *  - A wagon carries up to 2 things. At the quarry it can load marble, at the glassworks glass
 *    (these are goods, not resource cards). Anywhere, it can load resource cards from your hand
 *    to sell at the castle market.
 *  - When a wagon reaches the castle it delivers everything: each marble or glass earns 1 victory
 *    point and 2 gold; each resource card is sold for 1 gold (the card goes back to the bank).
 *
 *  Gold
 *  - Gold coins are the player stat "gold". 2 gold buy 1 resource of your choice (twice per turn).
 *
 *  Barbarians
 *  - Three barbarian bands (tokens) roam the roads. A wagon can't drive onto a road with a band.
 *  - When a 7 is rolled (after the robber), the roller moves one band. A band raids wagons next to
 *    where it stops: they lose all their cargo.
 *  - For 1 ore + 1 wool you can hire mercenaries to move a band yourself (once per turn).
 *
 *  Play to 13 victory points.
 */
import type { Condition, Effect, MapDef, ModDef, TokenDef } from '../../../engine/schema';
import { baseMod } from '../../base';

/* --------------------------------- map ---------------------------------- */

const SPECIAL: Record<string, string> = { '0,0': 'castle', '-2,2': 'quarry', '2,-2': 'glassworks' };

function tradersMap(): MapDef {
  const std = baseMod.maps![0];
  const land = [...std.terrainBags!.land];
  for (const t of ['desert', 'forest', 'pasture']) land.splice(land.indexOf(t), 1); // 19 - 3 special hexes
  return {
    ...std,
    id: 'tb-traders-barbarians',
    name: 'Traders & Barbarians (3-4 players)',
    hexes: std.hexes.map((h) => {
      const t = SPECIAL[`${h.q},${h.r}`];
      return t ? { q: h.q, r: h.r, terrain: t } : { ...h };
    }),
    terrainBags: { land },
  };
}

/* ------------------------------- helpers -------------------------------- */

const myTurn: Condition[] = [{ isTurnOf: 'self' }, { phase: 'main' }];
const BANDS = ['barbarianA', 'barbarianB', 'barbarianC'];
const CAPACITY = 2;

const state = (key: string) => ({ pieceState: { piece: 'pieceId', key } });
/** Movement points this wagon has left this turn. */
const movesLeft = { sub: [{ add: [4, state('extra')] }, state('moved')] };
const cargo = (key?: string) => ({ cargoCount: key ? { piece: 'pieceId', key } : { piece: 'pieceId' } });
const hasRoom: Condition = { cmp: [cargo(), '<', CAPACITY] };
const at = (terrain: string): Condition => ({ terrainIs: { at: 'piece', terrain } });

/** A wagon may drive onto an edge that has a road and no barbarian band. */
const roadWithoutBarbarians: Condition = {
  all: [{ occupied: { at: 'at', piece: 'road' } }, ...BANDS.map((b): Condition => ({ not: { hasToken: { at: 'at', token: b } } }))],
};

/** Unload a wagon (`pieceId`) at the castle. Used on arrival and by the "Deliver" button. */
const deliverAtCastle: Effect[] = [
  { op: 'setVar', name: 'goods', value: { add: [cargo('marble'), cargo('glass')] } },
  {
    op: 'if', cond: { cmp: [{ var: 'goods' }, '>', 0] },
    then: [
      { op: 'addVP', amount: { var: 'goods' }, reason: 'goods delivered to the castle' },
      { op: 'addStat', key: 'gold', amount: { mul: [{ var: 'goods' }, 2] } },
      { op: 'addCargo', piece: 'pieceId', key: 'marble', amount: { sub: [0, cargo('marble')] } },
      { op: 'addCargo', piece: 'pieceId', key: 'glass', amount: { sub: [0, cargo('glass')] } },
      { op: 'log', text: '{self} delivers {goods} goods to the castle' },
    ],
  },
  // whatever is left are resource cards: the castle market buys them for 1 gold each
  { op: 'setVar', name: 'wares', value: cargo() },
  {
    op: 'if', cond: { cmp: [{ var: 'wares' }, '>', 0] },
    then: [
      { op: 'unloadCargo', piece: 'pieceId', to: 'bank' },
      { op: 'addStat', key: 'gold', amount: { var: 'wares' } },
      { op: 'log', text: '{self} sells {wares} card(s) at the castle market' },
    ],
  },
];

/** A barbarian band: on any land edge without a wagon or another band. Raids wagons next to it. */
const band = (id: string, name: string): TokenDef => ({
  id, name, icon: 'sword', on: 'edge', start: 'none',
  where: {
    all: [
      { not: { isWater: { at: 'at' } } },
      { not: { occupied: { at: 'at', piece: 'wagon' } } },
      ...BANDS.filter((b) => b !== id).map((b): Condition => ({ not: { hasToken: { at: 'at', token: b } } })),
    ],
  },
  onMove: [{
    op: 'forEachPiece', query: { piece: 'wagon', near: 'at' }, as: 'raided', asId: 'raidedId',
    do: [{
      op: 'if', cond: { cmp: [{ cargoCount: { piece: 'raidedId' } }, '>', 0] },
      then: [
        { op: 'addCargo', piece: 'raidedId', key: 'marble', amount: -99 },
        { op: 'addCargo', piece: 'raidedId', key: 'glass', amount: -99 },
        { op: 'unloadCargo', piece: 'raidedId', to: 'bank' },
        { op: 'log', text: 'Barbarians raid a wagon and take its cargo!' },
      ],
    }],
  }],
});

const moveABand: Effect = {
  op: 'chooseOption', label: 'Which barbarian band moves?',
  options: BANDS.map((b, i) => ({ label: `Band ${'ABC'[i]}`, do: [{ op: 'moveToken', token: b } as Effect] })),
};

/* --------------------------------- mod ---------------------------------- */

export const mod: ModDef = {
  meta: {
    id: 'tb-traders-barbarians',
    name: 'T&B: Traders & Barbarians',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description: 'Drive wagons along the roads, haul marble and glass to the castle for points and gold, and dodge the barbarian bands.',
  },
  terrains: [
    { id: 'castle', name: 'Castle', color: '#b0a28a', icon: 'castle' },
    { id: 'quarry', name: 'Quarry', color: '#a3a3a3', icon: 'ore' },
    { id: 'glassworks', name: 'Glassworks', color: '#9fd8e0', icon: 'building' },
  ],
  maps: [tradersMap()],
  remove: { maps: ['base-standard'] },
  pieces: [{
    id: 'wagon', name: 'Wagon', icon: 'merchant', supply: 3, tags: ['wagon'],
    cost: { lumber: 1, wool: 1, grain: 1 },
    initialState: { moved: 0, extra: 0, fed: 0 },
    pieceActions: ['driveWagon', 'feedHorses', 'loadMarble', 'loadGlass', 'loadWares', 'deliverGoods'],
    // a new wagon starts on one of your own roads
    placement: { on: 'edge', where: { all: [{ occupied: { at: 'at', piece: 'road', owner: 'self' } }, { not: { occupied: { at: 'at', piece: 'wagon' } } }] } },
  }],
  tokens: [
    { ...baseMod.tokens!.find((t) => t.id === 'robber')!, startTerrain: 'castle' },
    band('barbarianA', 'Barbarian band A'), band('barbarianB', 'Barbarian band B'), band('barbarianC', 'Barbarian band C'),
  ],
  actions: [
    {
      id: 'driveWagon', name: 'Drive', group: 'Wagon', icon: 'merchant',
      description: 'Drive this wagon along roads (anyone\'s). Each road costs 1 of its movement points (4 per turn). Bands of barbarians block the way.',
      available: { all: [...myTurn, { cmp: [movesLeft, '>', 0] }] },
      effect: [
        {
          op: 'movePiece', query: { piece: 'wagon', owner: 'self' }, from: { at: 'pieceId' }, anywhere: true,
          maxSteps: movesLeft, path: roadWithoutBarbarians, stepsAs: 'steps', as: 'arrived',
          to: { where: { not: { occupied: { at: 'at', piece: 'wagon' } } }, label: 'Drive to' },
        },
        { op: 'abortIf', cond: { not: { varSet: 'arrived' } }, message: 'The wagon cannot move' },
        { op: 'setPieceState', at: 'pieceId', key: 'moved', value: { add: [state('moved'), { var: 'steps' }] } },
      ],
    },
    {
      id: 'feedHorses', name: 'Feed the horses', group: 'Wagon', icon: 'wheat', cost: { grain: 1 },
      description: 'Pay 1 grain: this wagon gets 2 more movement points this turn (once per turn).',
      available: { all: [...myTurn, { cmp: [state('fed'), '==', 0] }] },
      effect: [
        { op: 'setPieceState', at: 'pieceId', key: 'extra', value: { add: [state('extra'), 2] } },
        { op: 'setPieceState', at: 'pieceId', key: 'fed', value: 1 },
      ],
    },
    {
      id: 'loadMarble', name: 'Load marble', group: 'Wagon', icon: 'ore',
      description: 'At the quarry: load 1 marble onto this wagon (it carries 2 things at most).',
      available: { all: [...myTurn, at('quarry'), hasRoom] },
      effect: [{ op: 'addCargo', piece: 'pieceId', key: 'marble', amount: 1 }],
    },
    {
      id: 'loadGlass', name: 'Load glass', group: 'Wagon', icon: 'building',
      description: 'At the glassworks: load 1 glass onto this wagon (it carries 2 things at most).',
      available: { all: [...myTurn, at('glassworks'), hasRoom] },
      effect: [{ op: 'addCargo', piece: 'pieceId', key: 'glass', amount: 1 }],
    },
    {
      id: 'loadWares', name: 'Load a resource card', group: 'Wagon', icon: 'card',
      description: 'Put 1 resource card from your hand on this wagon, to sell at the castle market for 1 gold.',
      available: { all: [...myTurn, hasRoom, { cmp: [{ resourceCount: {} }, '>', 0] }] },
      effect: [{ op: 'loadCargo', piece: 'pieceId', resource: 'choice', amount: 1 }],
    },
    {
      id: 'deliverGoods', name: 'Deliver', group: 'Wagon', icon: 'castle',
      description: 'At the castle: deliver everything this wagon carries (also happens automatically when it arrives).',
      available: { all: [...myTurn, at('castle'), { cmp: [cargo(), '>', 0] }] },
      effect: deliverAtCastle,
    },
    {
      id: 'goldForResource', name: 'Buy a resource (2 gold)', group: 'Gold', icon: 'gold', limitPerTurn: 2,
      description: 'Pay 2 gold coins: take 1 resource of your choice from the bank. Twice per turn.',
      available: { all: [...myTurn, { cmp: [{ stat: { key: 'gold' } }, '>=', 2] }] },
      effect: [{ op: 'addStat', key: 'gold', amount: -2 }, { op: 'chooseAndGain', amount: 1, kind: 'resource' }],
    },
    {
      id: 'hireMercenaries', name: 'Hire mercenaries', group: 'Barbarians', icon: 'sword', cost: { ore: 1, wool: 1 }, limitPerTurn: 1,
      description: 'Pay 1 ore + 1 wool: move a barbarian band to another road.',
      available: { all: myTurn },
      effect: [moveABand],
    },
  ],
  triggers: [
    {
      id: 'placeFirstWagons', on: 'setupComplete',
      do: [{ op: 'forEachPlayer', as: 'p', filter: true, do: [{ op: 'place', piece: 'wagon', player: { var: 'p' }, free: true, location: { label: 'Put your wagon on one of your roads' } }] }],
    },
    {
      id: 'wagonsRest', on: 'turnStart',
      do: [{
        op: 'forEachPiece', query: { piece: 'wagon', owner: 'self' }, as: 'w', asId: 'wid',
        do: ['moved', 'extra', 'fed'].map((key): Effect => ({ op: 'setPieceState', at: 'wid', key, value: 0 })),
      }],
    },
    {
      id: 'arriveAtCastle', on: 'pieceMoved', as: 'eventPlayer',
      when: { all: [{ varIs: { var: 'piece', value: 'wagon' } }, { terrainIs: { at: 'at', terrain: 'castle' } }] },
      do: deliverAtCastle,
    },
    { id: 'barbariansOnSeven', on: 'diceRolled', when: { cmp: [{ var: 'total' }, '==', 7] }, do: [moveABand] },
  ],
  victoryPoints: 13,
};

export default mod;
