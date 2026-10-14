/**
 * Traders & Barbarians: The Fishermen of Catan.
 *
 * How it works (all data, no engine code):
 *  - Six fishing grounds sit in the sea around the island, each with a number (4, 5, 6, 8, 9, 10).
 *    The desert is replaced by a lake that "rolls" on 2, 3, 11 and 12.
 *  - When a fishing ground's (or the lake's) number is rolled, every settlement next to it draws
 *    1 fish token and every city 2. Fish tokens are a small deck of "immediate" cards worth
 *    1, 2 or 3 fish (or the old boot). The fish are counted in the player stat "fish".
 *  - Fish are spent on the actions in the "Fish" group (2: shoo the robber, 3: steal,
 *    4: take a resource, 5: free road, 7: development card).
 *  - Old boot: its holder needs 1 more victory point to win (an award worth -1 VP). It can be
 *    passed on to a player with at least as many victory points.
 */
import type { Condition, Effect, MapDef, ModDef } from '../../../engine/schema';
import { baseMod } from '../../base';

/* --------------------------------- map ---------------------------------- */

/** Sea hexes of the standard frame (by position in the outer ring) that become fishing grounds. */
const FISHING_GROUNDS: Record<number, number> = { 1: 4, 5: 9, 7: 6, 11: 8, 13: 5, 17: 10 };

function fishermenMap(): MapDef {
  const std = baseMod.maps![0];
  const hexes = std.hexes.map((h, i) => {
    const ring = i - 19; // the first 19 hexes are the island, then the outer sea ring
    const num = FISHING_GROUNDS[ring];
    return num !== undefined ? { q: h.q, r: h.r, terrain: 'fishingGround', number: num } : { ...h };
  });
  return {
    ...std,
    id: 'tb-fishermen',
    name: 'Fishermen of Catan (3-4 players)',
    hexes,
    terrainBags: { land: std.terrainBags!.land.map((t) => (t === 'desert' ? 'lake' : t)) },
  };
}

/* ------------------------------ fish tokens ------------------------------ */

const gainFish = (n: number): Effect[] => [
  { op: 'addStat', key: 'fish', amount: n },
  { op: 'log', text: `{self} catches ${n} fish` },
];

/** "you have at least n fish" */
const hasFish = (n: number): Condition => ({ cmp: [{ stat: { key: 'fish' } }, '>=', n] });
const spendFish = (n: number): Effect => ({ op: 'addStat', key: 'fish', amount: -n });
const myMainPhase: Condition[] = [{ isTurnOf: 'self' }, { phase: 'main' }];

/* --------------------------------- mod ---------------------------------- */

export const mod: ModDef = {
  meta: {
    id: 'tb-fishermen',
    name: 'T&B: Fishermen of Catan',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description: 'Fishing grounds and a lake give fish tokens. Spend fish to shoo the robber, steal, take resources, build roads or buy development cards. Beware the old boot!',
  },
  terrains: [
    { id: 'fishingGround', name: 'Fishing ground', color: '#2f7fb8', water: true, icon: 'fish' },
    { id: 'lake', name: 'Lake', color: '#5fb3d9', icon: 'fish' },
  ],
  maps: [fishermenMap()],
  remove: { maps: ['base-standard'] },

  cards: [
    { id: 'fish1', name: 'Fish token (1 fish)', description: 'Worth 1 fish.', icon: 'fish', play: { timing: 'immediate' }, effect: gainFish(1), afterPlay: 'discard' },
    { id: 'fish2', name: 'Fish token (2 fish)', description: 'Worth 2 fish.', icon: 'fish', play: { timing: 'immediate' }, effect: gainFish(2), afterPlay: 'discard' },
    { id: 'fish3', name: 'Fish token (3 fish)', description: 'Worth 3 fish.', icon: 'fish', play: { timing: 'immediate' }, effect: gainFish(3), afterPlay: 'discard' },
    {
      id: 'oldBoot', name: 'Old boot', icon: 'question',
      description: 'You fished out the old boot! Whoever holds it needs 1 more victory point to win. You can pass it on to a player with at least as many points as you.',
      play: { timing: 'immediate' },
      effect: [
        { op: 'forEachPlayer', as: 'p', filter: true, do: [{ op: 'setStat', player: { var: 'p' }, key: 'oldBoot', value: 0 }] },
        { op: 'setStat', key: 'oldBoot', value: 1 },
        { op: 'log', text: '{self} fishes out the old boot' },
      ],
      afterPlay: 'discard',
    },
  ],
  decks: [{
    id: 'fishTokens', name: 'Fish tokens', color: '#2f7fb8', reshuffleDiscards: true,
    cards: [{ card: 'fish1', count: 11 }, { card: 'fish2', count: 10 }, { card: 'fish3', count: 8 }, { card: 'oldBoot', count: 1 }],
  }],

  actions: [
    {
      id: 'fishShooRobber', name: 'Shoo the robber (2 fish)', group: 'Fish', icon: 'robber',
      description: 'Pay 2 fish: take the robber off the board. It comes back with the next 7 or Knight.',
      available: { all: [...myMainPhase, hasFish(2), { cmp: [{ global: 'robberOffBoard' }, '==', 0] }] },
      effect: [spendFish(2), { op: 'removeToken', token: 'robber' }],
    },
    {
      id: 'fishSteal', name: 'Steal a resource (3 fish)', group: 'Fish', icon: 'robber',
      description: 'Pay 3 fish: take a random resource card from a player of your choice.',
      available: { all: [...myMainPhase, hasFish(3)] },
      effect: [
        {
          op: 'choosePlayer', as: 'victim', label: 'Steal from whom?',
          filter: { all: [{ not: { samePlayer: [{ var: 'victim' }, 'self'] } }, { cmp: [{ resourceCount: { player: { var: 'victim' } } }, '>', 0] }] },
        },
        { op: 'abortIf', cond: { not: { varSet: 'victim' } }, message: 'Nobody has a card to steal' },
        spendFish(3),
        { op: 'steal', from: { var: 'victim' } },
      ],
    },
    {
      id: 'fishResource', name: 'Take a resource (4 fish)', group: 'Fish', icon: 'plenty',
      description: 'Pay 4 fish: take 1 resource of your choice from the bank.',
      available: { all: [...myMainPhase, hasFish(4)] },
      effect: [spendFish(4), { op: 'chooseAndGain', amount: 1, kind: 'resource' }],
    },
    {
      id: 'fishRoad', name: 'Build a road (5 fish)', group: 'Fish', icon: 'road',
      description: 'Pay 5 fish: build a road for free.',
      available: { all: [...myMainPhase, hasFish(5)] },
      effect: [
        { op: 'place', piece: 'road', free: true, as: 'built' },
        { op: 'abortIf', cond: { not: { varSet: 'built' } }, message: 'No place for a road' },
        spendFish(5),
      ],
    },
    {
      id: 'fishDevCard', name: 'Development card (7 fish)', group: 'Fish', icon: 'card',
      description: 'Pay 7 fish: draw a development card.',
      available: { all: [...myMainPhase, hasFish(7)] },
      effect: [spendFish(7), { op: 'drawCard', deck: 'dev' }],
    },
    {
      id: 'passOldBoot', name: 'Pass the old boot', group: 'Fish', icon: 'question',
      description: 'Give the old boot to a player who has at least as many victory points as you.',
      available: { all: [...myMainPhase, { cmp: [{ stat: { key: 'oldBoot' } }, '>=', 1] }] },
      effect: [
        {
          op: 'choosePlayer', as: 'unlucky', label: 'Who gets the old boot?',
          filter: { all: [{ not: { samePlayer: [{ var: 'unlucky' }, 'self'] } }, { cmp: [{ vp: { var: 'unlucky' } }, '>=', { vp: 'self' }] }] },
        },
        { op: 'abortIf', cond: { not: { varSet: 'unlucky' } }, message: 'Nobody has as many points as you' },
        { op: 'setStat', key: 'oldBoot', value: 0 },
        { op: 'setStat', player: { var: 'unlucky' }, key: 'oldBoot', value: 1 },
        { op: 'log', text: '{self} passes the old boot to {unlucky}' },
      ],
    },
  ],

  awards: [
    // An award worth -1 VP: holding the boot means you need one more point to win.
    { id: 'oldBoot', name: 'Old boot (needs 1 more VP)', vp: -1, metric: { stat: { key: 'oldBoot' } }, min: 1 },
  ],

  triggers: [
    {
      // The robber starts off the board (there is no desert); remember whether it is on the board.
      id: 'fishRobberStartsOff', on: 'gameStart',
      do: [{ op: 'setGlobal', key: 'robberOffBoard', value: 1 }],
    },
    {
      id: 'fishTrackRobber', on: 'tokenMoved', when: { varIs: { var: 'token', value: 'robber' } },
      do: [{ op: 'setGlobal', key: 'robberOffBoard', value: { if: [{ varSet: 'at' }, 0, 1] } }],
    },
    {
      // Fishing: fishing grounds with the rolled number, and the lake on 2, 3, 11 and 12.
      id: 'fishing', on: 'diceRolled',
      do: [{
        op: 'forEachLocation', kind: 'hex', as: 'water',
        filter: {
          all: [
            { not: { hasToken: { at: 'water', token: 'robber' } } },
            {
              any: [
                { all: [{ terrainIs: { at: 'water', terrain: 'fishingGround' } }, { cmp: [{ hexNumber: 'water' }, '==', { var: 'total' }] }] },
                { all: [{ terrainIs: { at: 'water', terrain: 'lake' } }, { any: [2, 3, 11, 12].map((n): Condition => ({ cmp: [{ var: 'total' }, '==', n] })) }] },
              ],
            },
          ],
        },
        do: [{
          // settlement: 1 fish token, city: 2
          op: 'forEachPiece', query: { tag: 'building', near: 'water' }, as: 'home', asId: 'homeId',
          do: [{ op: 'drawCard', deck: 'fishTokens', player: { ownerOf: 'homeId' }, count: { if: [{ occupied: { at: 'home', piece: 'city' } }, 2, 1] } }],
        }],
      }],
    },
  ],
};

export default mod;
