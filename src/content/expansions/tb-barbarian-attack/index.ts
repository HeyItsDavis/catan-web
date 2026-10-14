/**
 * Traders & Barbarians: Barbarian Attack (simplified).
 *
 * How it works (all data):
 *  - A castle stands in the middle of the island. There is no robber.
 *  - When a 7 is rolled, players discard as usual, then a barbarian lands: a pair of dice is
 *    rolled and a barbarian lands on every coastal hex with that number. Barbarians on a hex are one
 *    "barbarian camp" piece whose state "count" says how many there are.
 *  - With 3 or more barbarians a hex is conquered: its number token is taken away (it produces
 *    nothing) until the barbarians are driven off. The camp remembers the number in its "number" state.
 *  - Knights (1 wool, 1 ore) stand on corners of your road network. Once per turn a knight
 *    may move up to 3 steps along your roads, or attack a camp on a hex it touches: if the knights
 *    of all players around that hex are at least as many as the barbarians, the camp is destroyed, the hex gets
 *    its number back and the attacker takes the barbarians prisoner. Otherwise the attacking knight
 *    is lost. Every 2 prisoners are worth 1 victory point.
 *  - The Knight development card places a knight for free (it still counts for Largest Army).
 */
import type { Condition, Effect, MapDef, ModDef } from '../../../engine/schema';
import { baseMod } from '../../base';

/* --------------------------------- map ---------------------------------- */

function barbarianMap(): MapDef {
  const std = baseMod.maps![0];
  return {
    ...std,
    id: 'tb-barbarian-attack',
    name: 'Barbarian Attack (3-4 players)',
    hexes: std.hexes.map((h) => (h.q === 0 && h.r === 0 ? { q: 0, r: 0, terrain: 'castle' } : { ...h })),
    terrainBags: { land: std.terrainBags!.land.filter((t) => t !== 'desert') },
  };
}

/* ------------------------------ barbarians ------------------------------- */

const campSize = (at: string) => ({ pieceState: { piece: at, key: 'count' } });

/** One barbarian lands on each coastal hex numbered `landing`. */
const landOneBarbarian: Effect[] = [
  { op: 'setVar', name: 'landing', value: { add: [{ random: [1, 6] }, { random: [1, 6] }] } },
  {
    op: 'forEachLocation', kind: 'hex', as: 'beach',
    filter: { all: [{ isCoastal: { at: 'beach' } }, { not: { terrainIs: { at: 'beach', terrain: 'castle' } } }, { cmp: [{ hexNumber: 'beach' }, '==', { var: 'landing' }] }] },
    do: [
      {
        op: 'if', cond: { occupied: { at: 'beach', piece: 'barbarian' } },
        then: [{ op: 'setPieceState', at: 'beach', key: 'count', value: { add: [campSize('beach'), 1] } }],
        else: [{ op: 'place', piece: 'barbarian', free: true, location: { at: 'beach' } }],
      },
      { op: 'log', text: 'A barbarian lands on a beach numbered {landing}' },
      {
        // 3 barbarians conquer the hex: it loses its number (and stops producing)
        op: 'if', cond: { all: [{ cmp: [campSize('beach'), '>=', 3] }, { cmp: [{ pieceState: { piece: 'beach', key: 'number' } }, '==', 0] }] },
        then: [
          { op: 'setPieceState', at: 'beach', key: 'number', value: { hexNumber: 'beach' } },
          { op: 'setHexNumber', at: 'beach', number: null },
          { op: 'log', text: 'The barbarians conquer a hex! It produces nothing until they are driven off.' },
        ],
      },
    ],
  },
];

const sevenRolled: Effect[] = [
  {
    op: 'forEachPlayer', as: 'p', order: 'simultaneous',
    filter: { cmp: [{ resourceCount: { player: { var: 'p' } } }, '>', { param: 'discardLimit' }] },
    do: [{ op: 'discard', player: { var: 'p' }, amount: { div: [{ resourceCount: { player: { var: 'p' } } }, 2] } }],
  },
  ...landOneBarbarian,
];

/* -------------------------------- knights -------------------------------- */

const ready: Condition = { cmp: [{ pieceState: { piece: 'pieceId', key: 'tired' } }, '==', 0] };
const myTurn: Condition[] = [{ isTurnOf: 'self' }, { phase: 'main' }];

const attack: Effect[] = [
  { op: 'choosePiece', as: 'camp', label: 'Attack which barbarians?', query: { piece: 'barbarian', near: 'piece' } },
  { op: 'abortIf', cond: { not: { varSet: 'camp' } }, message: 'No barbarians next to this knight' },
  { op: 'setPieceState', at: 'pieceId', key: 'tired', value: 1 },
  {
    op: 'if',
    // every knight around the hex fights, whoever owns it
    cond: { cmp: [{ pieceCount: { piece: 'knight', near: 'camp' } }, '>=', campSize('camp')] },
    then: [
      { op: 'addStat', key: 'prisoners', amount: campSize('camp') },
      { op: 'if', cond: { cmp: [{ pieceState: { piece: 'camp', key: 'number' } }, '>', 0] }, then: [{ op: 'setHexNumber', at: 'camp', number: { pieceState: { piece: 'camp', key: 'number' } } }] },
      { op: 'remove', query: { piece: 'barbarian' }, location: { at: 'camp' } },
      { op: 'log', text: '{self} drives off the barbarians!' },
      // every 2 prisoners = 1 VP (prisonerPoints = points already given)
      { op: 'setVar', name: 'earned', value: { sub: [{ div: [{ stat: { key: 'prisoners' } }, 2] }, { stat: { key: 'prisonerPoints' } }] } },
      {
        op: 'if', cond: { cmp: [{ var: 'earned' }, '>', 0] },
        then: [{ op: 'addVP', amount: { var: 'earned' }, reason: 'prisoners' }, { op: 'addStat', key: 'prisonerPoints', amount: { var: 'earned' } }],
      },
    ],
    else: [
      { op: 'log', text: 'The barbarians are too strong: {self} loses a knight' },
      { op: 'remove', query: { piece: 'knight', owner: 'self' }, location: { at: 'pieceId' } },
    ],
  },
];

/* --------------------------------- mod ---------------------------------- */

export const mod: ModDef = {
  meta: {
    id: 'tb-barbarian-attack',
    name: 'T&B: Barbarian Attack',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description: 'No robber: on a 7, barbarians land on the coast and conquer hexes. Build knights, march them along your roads and drive the barbarians off for prisoners and points.',
  },
  terrains: [{ id: 'castle', name: 'Castle', color: '#b0a28a', icon: 'castle' }],
  maps: [barbarianMap()],
  remove: { maps: ['base-standard'], tokens: ['robber'], triggers: ['robber-on-seven'] },
  pieces: [
    {
      id: 'barbarian', name: 'Barbarian camp', icon: 'sword', supply: -1, tags: ['barbarian'],
      initialState: { count: 1, number: 0 },
      placement: { on: 'hex', where: { isCoastal: { at: 'at' } } },
    },
    {
      id: 'knight', name: 'Knight', icon: 'knight', supply: 6, tags: ['knight'],
      cost: { wool: 1, ore: 1 },
      initialState: { tired: 0 },
      pieceActions: ['moveKnight', 'attackBarbarians'],
      placement: {
        on: 'vertex',
        where: { all: [{ not: { occupied: { at: 'at' } } }, { not: { isWater: { at: 'at' } } }, { connectedTo: { at: 'at', owner: 'self', via: ['road'] } }] },
      },
    },
  ],
  cards: [{
    ...baseMod.cards!.find((c) => c.id === 'knight')!,
    description: 'Place a knight on your road network for free. Counts for Largest Army.',
    effect: [{ op: 'place', piece: 'knight', free: true }],
  }],
  actions: [
    {
      id: 'moveKnight', name: 'March knight', group: 'Knights', icon: 'knight',
      description: 'Move this knight up to 3 steps along your roads to a free corner of your network. Uses its action this turn.',
      available: { all: [...myTurn, ready] },
      effect: [
        { op: 'movePiece', query: { piece: 'knight', owner: 'self' }, from: { at: 'pieceId' }, maxSteps: 3, path: { occupied: { at: 'via', piece: 'road', owner: 'self' } }, as: 'marched' },
        { op: 'abortIf', cond: { not: { varSet: 'marched' } }, message: 'This knight has nowhere to go' },
        { op: 'setPieceState', at: 'pieceId', key: 'tired', value: 1 },
      ],
    },
    {
      id: 'attackBarbarians', name: 'Attack barbarians', group: 'Knights', icon: 'sword',
      description: 'Attack a barbarian camp on a hex this knight touches. All knights around the hex fight; if there are at least as many knights as barbarians, you take them prisoner. If not, this knight is lost.',
      available: { all: [...myTurn, ready, { cmp: [{ pieceCount: { piece: 'barbarian', near: 'piece' } }, '>', 0] }] },
      effect: attack,
    },
  ],
  triggers: [
    { id: 'barbarianSeven', on: 'diceRolled', when: { cmp: [{ var: 'total' }, '==', 7] }, do: sevenRolled },
    {
      id: 'knightsRest', on: 'turnStart',
      do: [{ op: 'forEachPiece', query: { piece: 'knight', owner: 'self' }, as: 'k', asId: 'kid', do: [{ op: 'setPieceState', at: 'kid', key: 'tired', value: 0 }] }],
    },
  ],
};

export default mod;
