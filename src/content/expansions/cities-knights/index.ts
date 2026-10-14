/**
 * Cities & Knights, written as a mod on top of the base game. Pure data: every rule below is built
 * from the generic vocabulary in engine/schema.ts (see docs/MODDING.md).
 *
 * Conventions used by this mod (handy when extending it):
 *  - Dice: number die 0 is the yellow die, number die 1 is the RED die; the event die has id 'event'
 *    (faces: barbarianShip x3, trade, politics, science).
 *  - Player stats `tradeLevel`, `politicsLevel`, `scienceLevel` = city improvement levels (0-5).
 *  - Globals `barbarians` (ship position, 0..barbarianSteps) and `barbarianAttacks` (attacks so far).
 *  - Knights are three piece types (knight1/2/3 = basic/strong/mighty) tagged 'knight', with state
 *    `active` (0/1), `strength` (1-3), `fresh` (activated this turn) and `promoted` (promoted this turn).
 *  - Cities and the three metropolis pieces are tagged 'city'.
 */
import type { ActionDef, CardDef, Condition, Effect, Expr, ModDef, PieceDef, PlayerRef, TriggerDef } from '../../../engine/schema';

/* ------------------------------- helpers -------------------------------- */

const self = 'self' as const;
const v = (name: string): PlayerRef => ({ var: name });
const cmp = (a: Expr, op: '==' | '!=' | '<' | '<=' | '>' | '>=', b: Expr): Condition => ({ cmp: [a, op, b] });
const notSelf = (name: string): Condition => ({ not: { samePlayer: [v(name), self] } });
const myTurnMain: Condition = { all: [{ isTurnOf: self }, { phase: 'main' }] };
const notOcc: Condition = { not: { occupied: { at: 'at' } } };
const onLand: Condition = { not: { isWater: { at: 'at' } } };

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
const COMMODITIES = ['paper', 'cloth', 'coin'] as const;
const NAMES: Record<string, string> = {
  brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore', paper: 'Paper', cloth: 'Cloth', coin: 'Coin',
};
const KNIGHTS = ['knight1', 'knight2', 'knight3'];
const METROS = ['metropolis-trade', 'metropolis-politics', 'metropolis-science'];
const CITY_TYPES = ['city', ...METROS];
/** Terrain -> resource, for the merchant's 2:1 rate. */
const TERRAIN_RESOURCE: [string, string][] = [['hills', 'brick'], ['forest', 'lumber'], ['pasture', 'wool'], ['fields', 'grain'], ['mountains', 'ore']];

/** Total strength of a player's ACTIVE knights. */
const strength = (who: PlayerRef): Expr => ({ sumPieceState: { query: { tag: 'knight', owner: who, state: { active: 1 } }, key: 'strength' } });
/** Plain cities (metropolises cannot be pillaged by the barbarians). */
const plainCities = (who: PlayerRef): Expr => ({ pieceCount: { owner: who, piece: 'city' } });
const pieceState = (piece: string, key: string): Expr => ({ pieceState: { piece, key } });
const level = (track: string, who?: PlayerRef): Expr => ({ stat: { ...(who ? { player: who } : {}), key: `${track}Level` } });
const owned = (piece: string): Expr => ({ pieceCount: { owner: self, piece } });
const robberActive: Condition = cmp({ global: 'barbarianAttacks' }, '>=', 1);

interface Track { id: 'trade' | 'politics' | 'science'; name: string; commodity: string; deck: string; color: string; metro: string; ability: string }
const TRACKS: Track[] = [
  { id: 'trade', name: 'Trade', commodity: 'cloth', deck: 'trade', color: '#e0b000', metro: 'metropolis-trade',
    ability: 'Level 3 (Trading House): trade commodities 2:1 with the bank.' },
  { id: 'politics', name: 'Politics', commodity: 'coin', deck: 'politics', color: '#2f6fd0', metro: 'metropolis-politics',
    ability: 'Level 3 (Fortress): you may promote strong knights to mighty knights.' },
  { id: 'science', name: 'Science', commodity: 'paper', deck: 'science', color: '#2e9a4a', metro: 'metropolis-science',
    ability: 'Level 3 (Aqueduct): whenever a production roll (not a 7) gives you nothing, take 1 resource of your choice.' },
];

/** Choose a number 1-6 into var `name`. */
function chooseDie(name: string, label: string): Effect {
  return { op: 'chooseOption', label, options: [1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n), do: [{ op: 'setVar', name, value: n } as Effect] })) };
}

/** Promote the knight in var `at` from `from` to `to`, keeping its active / activated-this-turn status. */
function promoteFx(at: string, from: string, to: string): Effect[] {
  return [
    { op: 'setVar', name: 'wasActive', value: pieceState(at, 'active') },
    { op: 'setVar', name: 'wasFresh', value: pieceState(at, 'fresh') },
    { op: 'upgrade', from, to, free: true, location: { at }, asId: 'promotedKnight' },
    { op: 'if', cond: { varSet: 'promotedKnight' }, then: [
      { op: 'setPieceState', at: 'promotedKnight', key: 'active', value: { var: 'wasActive' } },
      { op: 'setPieceState', at: 'promotedKnight', key: 'fresh', value: { var: 'wasFresh' } },
      { op: 'setPieceState', at: 'promotedKnight', key: 'promoted', value: 1 },
    ] },
  ];
}

/** The displaced / intrigued knight in var `knightId`: its owner moves it to a free spot on their roads, or loses it. */
function relocateKnightFx(knightId: string): Effect[] {
  return [
    { op: 'movePiece', query: { tag: 'knight' }, from: { at: knightId }, player: { ownerOf: knightId }, as: 'fled',
      to: { label: 'Your knight was displaced: move it to a free spot on your roads' } },
    { op: 'if', cond: { not: { varSet: 'fled' } }, then: [{ op: 'remove', query: { tag: 'knight' }, location: { at: knightId } }] },
  ];
}

/** Knights travel along their owner's roads and may not pass through an opponent's piece. */
const knightPath: Condition = { all: [
  { occupied: { at: 'via', piece: 'road', owner: self } },
  { not: { occupied: { at: 'prev', owner: 'others' } } },
] };

/** Grant the merchant's 2:1 rate (this turn) for the resource of the hex in var `hex`. */
function merchantRateFx(hex: string): Effect[] {
  return TERRAIN_RESOURCE.map(([terrain, res]): Effect => ({
    op: 'if', cond: { terrainIs: { at: hex, terrain } },
    then: [{ op: 'grantTradeRate', resource: res, ratio: 2, until: 'endOfTurn' }],
  }));
}

/** chooseOption over resource types the player in `holder` actually has; `do(r)` runs for the pick. */
function pickHeld(chooser: PlayerRef, holder: PlayerRef, ids: readonly string[], label: string, fx: (r: string) => Effect[]): Effect {
  return {
    op: 'chooseOption', player: chooser, label,
    options: ids.map((r) => ({ label: NAMES[r], cond: cmp({ resourceCount: { player: holder, resource: r } }, '>', 0), do: fx(r) })),
  };
}

/** Bind var `out` to the number token on hex var `hex` (one of the swappable numbers). */
const SWAPPABLE = [3, 4, 5, 9, 10, 11];
function readNumberFx(hex: string, out: string): Effect[] {
  return SWAPPABLE.map((n): Effect => ({ op: 'if', cond: { hexNumberIn: { at: hex, numbers: [n] } }, then: [{ op: 'setVar', name: out, value: n }] }));
}

/* -------------------------------- cards --------------------------------- */

type ProgressCard = Omit<CardDef, 'play' | 'afterPlay'> & { play?: Partial<CardDef['play']>; count: number; deck: Track['id'] };

/** Normal progress card: play any number on your turn after rolling, even the turn you got it. */
const afterRoll = (cond?: Condition): CardDef['play'] => ({ timing: 'ownTurnAfterRoll', notOnAcquiredTurn: false, ...(cond ? { cond } : {}) });

const PROGRESS: ProgressCard[] = [
  /* ------------------------------ science (green) ------------------------------ */
  {
    id: 'alchemist', deck: 'science', count: 2, name: 'Alchemist', icon: 'dice',
    description: 'Play before you roll: choose the results of the yellow and red dice. The event die is rolled as normal.',
    play: { timing: 'ownTurnBeforeRoll', notOnAcquiredTurn: false },
    effect: [
      chooseDie('yellowDie', 'Alchemist: choose the yellow die'),
      chooseDie('redDie', 'Alchemist: choose the red die'),
      { op: 'rollDice', values: [{ var: 'yellowDie' }, { var: 'redDie' }] },
    ],
  },
  {
    id: 'crane', deck: 'science', count: 2, name: 'Crane', icon: 'tower',
    description: 'Your next city improvement this turn costs 1 commodity less.',
    effect: [{ op: 'setFlag', flag: 'crane', value: true, until: 'endOfTurn' }],
  },
  {
    id: 'engineer', deck: 'science', count: 1, name: 'Engineer', icon: 'wall',
    description: 'Build a city wall under one of your cities for free.',
    play: afterRoll(cmp(owned('wall'), '<', 3)),
    effect: [
      { op: 'place', piece: 'wall', free: true, as: 'builtWall', location: { label: 'Engineer: place a free city wall' } },
      { op: 'abortIf', cond: { not: { varSet: 'builtWall' } }, message: 'You have no city without a wall' },
    ],
  },
  {
    id: 'inventor', deck: 'science', count: 2, name: 'Inventor', icon: 'question',
    description: 'Swap two number tokens on the board. You may not move a 2, 12, 6 or 8.',
    effect: [
      { op: 'chooseLocation', kind: 'hex', as: 'hexA', label: 'Inventor: first number to swap', filter: { hexNumberIn: { at: 'hexA', numbers: SWAPPABLE } } },
      { op: 'abortIf', cond: { not: { varSet: 'hexA' } }, message: 'No number can be swapped' },
      ...readNumberFx('hexA', 'numberA'),
      { op: 'chooseLocation', kind: 'hex', as: 'hexB', label: 'Inventor: swap it with',
        filter: { any: SWAPPABLE.map((n): Condition => ({ all: [{ hexNumberIn: { at: 'hexB', numbers: [n] } }, cmp({ var: 'numberA' }, '!=', n)] })) } },
      { op: 'abortIf', cond: { not: { varSet: 'hexB' } }, message: 'No other number to swap with' },
      ...readNumberFx('hexB', 'numberB'),
      { op: 'setHexNumber', at: 'hexA', number: { var: 'numberB' } },
      { op: 'setHexNumber', at: 'hexB', number: { var: 'numberA' } },
      { op: 'log', text: '{self} swaps a {numberA} and a {numberB}' },
    ],
  },
  {
    id: 'irrigation', deck: 'science', count: 2, name: 'Irrigation', icon: 'wheat',
    description: 'Take 2 grain for every fields hex next to at least one of your settlements or cities.',
    effect: [{ op: 'forEachLocation', kind: 'hex', as: 'field',
      filter: { all: [{ terrainIs: { at: 'field', terrain: 'fields' } }, cmp({ pieceCount: { near: 'field', owner: self, tag: 'building' } }, '>', 0)] },
      do: [{ op: 'gain', resources: { grain: 2 } }] }],
  },
  {
    id: 'medicine', deck: 'science', count: 2, name: 'Medicine', icon: 'city',
    description: 'Upgrade one of your settlements to a city for only 2 ore and 1 grain.',
    play: afterRoll({ all: [{ canAfford: { cost: { ore: 2, grain: 1 } } }, cmp(owned('settlement'), '>', 0), cmp(owned('city'), '<', 4)] }),
    effect: [
      { op: 'pay', resources: { ore: 2, grain: 1 } },
      { op: 'upgrade', from: 'settlement', to: 'city', free: true, as: 'healed', location: { label: 'Medicine: choose a settlement to upgrade' } },
      { op: 'abortIf', cond: { not: { varSet: 'healed' } }, message: 'No settlement can become a city' },
    ],
  },
  {
    id: 'mining', deck: 'science', count: 2, name: 'Mining', icon: 'ore',
    description: 'Take 2 ore for every mountains hex next to at least one of your settlements or cities.',
    effect: [{ op: 'forEachLocation', kind: 'hex', as: 'mine',
      filter: { all: [{ terrainIs: { at: 'mine', terrain: 'mountains' } }, cmp({ pieceCount: { near: 'mine', owner: self, tag: 'building' } }, '>', 0)] },
      do: [{ op: 'gain', resources: { ore: 2 } }] }],
  },
  {
    id: 'printer', deck: 'science', count: 1, name: 'Printer', icon: 'vp',
    description: '1 victory point. Revealed as soon as you draw it and kept face up.',
    play: { timing: 'immediate' }, effect: [{ op: 'log', text: '{self} reveals the Printer (1 VP)' }], vp: 1,
  },
  {
    id: 'roadBuilding', deck: 'science', count: 2, name: 'Road Building', icon: 'road',
    description: 'Build 2 roads for free.',
    effect: [{ op: 'repeat', times: 2, do: [{ op: 'place', piece: 'road', free: true }] }],
  },
  {
    id: 'smith', deck: 'science', count: 2, name: 'Smith', icon: 'sword',
    description: 'Promote up to 2 of your knights for free (one level each). Mighty knights still need the Fortress.',
    effect: [{ op: 'repeat', times: 2, do: [
      { op: 'choosePiece', as: 'smithKnight', asId: 'smithKnightId', optional: true, label: 'Smith: choose a knight to promote',
        query: { owner: self, piece: ['knight1', 'knight2'] },
        filter: { all: [
          cmp(pieceState('smithKnight', 'promoted'), '==', 0),
          { any: [
            { all: [{ occupied: { at: 'smithKnight', piece: 'knight1' } }, cmp(owned('knight2'), '<', 2)] },
            { all: [{ occupied: { at: 'smithKnight', piece: 'knight2' } }, cmp(level('politics'), '>=', 3), cmp(owned('knight3'), '<', 2)] },
          ] },
        ] } },
      { op: 'if', cond: { varSet: 'smithKnightId' }, then: [
        { op: 'if', cond: { occupied: { at: 'smithKnightId', piece: 'knight1' } },
          then: promoteFx('smithKnightId', 'knight1', 'knight2'),
          else: promoteFx('smithKnightId', 'knight2', 'knight3') },
      ] },
    ] }],
  },

  /* ----------------------------- politics (blue) ----------------------------- */
  {
    id: 'bishop', deck: 'politics', count: 2, name: 'Bishop', icon: 'robber',
    description: 'Move the robber, then take 1 random card from each player with a settlement or city next to its new hex. (Not before the first barbarian attack.)',
    play: afterRoll(robberActive),
    effect: [
      { op: 'setFlag', flag: 'bishop', value: true, until: 'endOfTurn' },
      { op: 'moveToken', token: 'robber', to: { label: 'Bishop: move the robber' } },
      { op: 'setFlag', flag: 'bishop', value: false },
    ],
  },
  {
    id: 'constitution', deck: 'politics', count: 1, name: 'Constitution', icon: 'vp',
    description: '1 victory point. Revealed as soon as you draw it and kept face up.',
    play: { timing: 'immediate' }, effect: [{ op: 'log', text: '{self} reveals the Constitution (1 VP)' }], vp: 1,
  },
  {
    id: 'deserter', deck: 'politics', count: 2, name: 'Deserter', icon: 'knight',
    description: 'Choose an opponent: they remove one of their knights (their choice). You then place one of your own knights of the same strength for free, with the same active status (a weaker one if you have none of that strength left, or no Fortress for a mighty knight).',
    play: afterRoll(cmp({ countPlayers: { as: 'q', filter: { all: [notSelf('q'), cmp({ pieceCount: { owner: v('q'), tag: 'knight' } }, '>', 0)] } } }, '>', 0)),
    effect: [
      { op: 'choosePlayer', as: 'victim', label: 'Deserter: whose knight deserts?',
        filter: { all: [notSelf('victim'), cmp({ pieceCount: { owner: v('victim'), tag: 'knight' } }, '>', 0)] } },
      { op: 'abortIf', cond: { not: { varSet: 'victim' } }, message: 'No opponent has a knight' },
      { op: 'choosePiece', player: v('victim'), as: 'deserterAt', asId: 'deserterId', label: 'Deserter: remove one of your knights',
        query: { tag: 'knight', owner: v('victim') } },
      { op: 'setVar', name: 'deserterStrength', value: pieceState('deserterId', 'strength') },
      { op: 'setVar', name: 'deserterActive', value: pieceState('deserterId', 'active') },
      { op: 'remove', query: { tag: 'knight' }, location: { at: 'deserterId' } },
      { op: 'if', cond: { all: [cmp({ var: 'deserterStrength' }, '>=', 3), cmp(level('politics'), '>=', 3), cmp(owned('knight3'), '<', 2)] },
        then: [{ op: 'place', piece: 'knight3', free: true, asId: 'newKnight', location: { label: 'Deserter: place your mighty knight' } }] },
      { op: 'if', cond: { all: [{ not: { varSet: 'newKnight' } }, cmp({ var: 'deserterStrength' }, '>=', 2), cmp(owned('knight2'), '<', 2)] },
        then: [{ op: 'place', piece: 'knight2', free: true, asId: 'newKnight', location: { label: 'Deserter: place your strong knight' } }] },
      { op: 'if', cond: { all: [{ not: { varSet: 'newKnight' } }, cmp(owned('knight1'), '<', 2)] },
        then: [{ op: 'place', piece: 'knight1', free: true, asId: 'newKnight', location: { label: 'Deserter: place your basic knight' } }] },
      { op: 'if', cond: { varSet: 'newKnight' }, then: [{ op: 'setPieceState', at: 'newKnight', key: 'active', value: { var: 'deserterActive' } }] },
    ],
  },
  {
    id: 'diplomat', deck: 'politics', count: 2, name: 'Diplomat', icon: 'road',
    description: 'Remove an open road (one with nothing of its owner at one end). If it is your own road, you may rebuild it elsewhere for free.',
    effect: [
      { op: 'choosePiece', as: 'openRoad', query: { piece: 'road' }, filter: { isNetworkEnd: { at: 'openRoad' } }, label: 'Diplomat: choose an open road to remove' },
      { op: 'abortIf', cond: { not: { varSet: 'openRoad' } }, message: 'There is no open road' },
      { op: 'if', cond: { samePlayer: [{ ownerOf: 'openRoad' }, self] },
        then: [
          { op: 'remove', query: { piece: 'road' }, location: { at: 'openRoad' } },
          { op: 'chooseOption', label: 'Diplomat: rebuild your road?', options: [
            { label: 'Rebuild it elsewhere for free', do: [{ op: 'place', piece: 'road', free: true }] },
            { label: 'Keep it in my supply', do: [] },
          ] },
        ],
        else: [{ op: 'remove', query: { piece: 'road' }, location: { at: 'openRoad' } }] },
    ],
  },
  {
    id: 'intrigue', deck: 'politics', count: 2, name: 'Intrigue', icon: 'knight',
    description: 'Displace an opponent’s knight that stands next to one of your roads (you need no knight of your own). Its owner moves it to a free spot on their roads, or loses it.',
    effect: [
      { op: 'choosePiece', as: 'intrigueAt', asId: 'intrigueId', label: 'Intrigue: choose a knight to displace',
        query: { tag: 'knight', owner: 'others' }, filter: { adjacentTo: { at: 'intrigueAt', piece: 'road', owner: self } } },
      { op: 'abortIf', cond: { not: { varSet: 'intrigueAt' } }, message: 'No opposing knight is next to your roads' },
      ...relocateKnightFx('intrigueId'),
    ],
  },
  {
    id: 'saboteur', deck: 'politics', count: 2, name: 'Saboteur', icon: 'sword',
    description: 'Every player with as many or more victory points than you discards half of their cards (rounded down).',
    effect: [{ op: 'forEachPlayer', as: 'p', order: 'simultaneous',
      filter: { all: [notSelf('p'), cmp({ vp: v('p') }, '>=', { vp: self })] },
      do: [{ op: 'discard', player: v('p'), amount: { div: [{ resourceCount: { player: v('p') } }, 2] } }] }],
  },
  {
    id: 'spy', deck: 'politics', count: 3, name: 'Spy', icon: 'card',
    description: 'Look at another player’s progress cards and take one of them.',
    play: afterRoll(cmp({ countPlayers: { as: 'q', filter: { all: [notSelf('q'), cmp({ cardCount: { player: v('q') } }, '>', 0)] } } }, '>', 0)),
    effect: [
      { op: 'choosePlayer', as: 'target', label: 'Spy: whose progress cards do you look at?',
        filter: { all: [notSelf('target'), cmp({ cardCount: { player: v('target') } }, '>', 0)] } },
      { op: 'abortIf', cond: { not: { varSet: 'target' } }, message: 'Nobody holds progress cards' },
      { op: 'takeCard', from: v('target'), choose: true },
    ],
  },
  {
    id: 'warlord', deck: 'politics', count: 2, name: 'Warlord', icon: 'shield',
    description: 'Activate all of your knights for free.',
    effect: [{ op: 'forEachPiece', query: { tag: 'knight', owner: self, state: { active: 0 } }, as: 'wk', asId: 'wkId', do: [
      { op: 'setPieceState', at: 'wkId', key: 'active', value: 1 },
      { op: 'setPieceState', at: 'wkId', key: 'fresh', value: 1 },
    ] }],
  },
  {
    id: 'wedding', deck: 'politics', count: 2, name: 'Wedding', icon: 'star',
    description: 'Every player with more victory points than you gives you 2 cards of their choice (resources or commodities).',
    effect: [{ op: 'forEachPlayer', as: 'p', filter: { all: [notSelf('p'), cmp({ vp: v('p') }, '>', { vp: self })] }, do: [
      { op: 'repeat', times: 2, do: [{ op: 'transfer', from: v('p'), to: self, resource: 'choice', amount: 1 }] },
    ] }],
  },

  /* ------------------------------ trade (yellow) ------------------------------ */
  {
    id: 'commercialHarbor', deck: 'trade', count: 2, name: 'Commercial Harbor', icon: 'anchor',
    description: 'Make each opponent trade with you: you offer them 1 resource from your hand and they must give you 1 commodity of their choice (if they have any).',
    effect: [{ op: 'forEachPlayer', as: 'p', filter: { all: [notSelf('p'), cmp({ resourceCount: { player: v('p'), kind: 'commodity' } }, '>', 0)] }, do: [
      { op: 'setVar', name: 'offered', value: 0 },
      pickHeld(self, self, RESOURCES, 'Commercial Harbor: which resource do you offer?', (r) => [
        { op: 'transfer', from: self, to: v('p'), resource: r, amount: 1 },
        { op: 'setVar', name: 'offered', value: 1 },
      ]),
      { op: 'if', cond: cmp({ var: 'offered' }, '==', 1), then: [
        pickHeld(v('p'), v('p'), COMMODITIES, 'Commercial Harbor: which commodity do you give back?', (c) => [
          { op: 'transfer', from: v('p'), to: self, resource: c, amount: 1 },
        ]),
      ] },
    ] }],
  },
  {
    id: 'masterMerchant', deck: 'trade', count: 2, name: 'Master Merchant', icon: 'coins',
    description: 'Look at the hand of a player with more victory points than you and take 2 resource or commodity cards of your choice.',
    play: afterRoll(cmp({ countPlayers: { as: 'q', filter: { all: [notSelf('q'), cmp({ vp: v('q') }, '>', { vp: self }), cmp({ resourceCount: { player: v('q') } }, '>', 0)] } } }, '>', 0)),
    effect: [
      { op: 'choosePlayer', as: 'target', label: 'Master Merchant: choose a player with more points',
        filter: { all: [notSelf('target'), cmp({ vp: v('target') }, '>', { vp: self }), cmp({ resourceCount: { player: v('target') } }, '>', 0)] } },
      { op: 'abortIf', cond: { not: { varSet: 'target' } }, message: 'Nobody with more points has cards' },
      { op: 'repeat', times: 2, do: [
        pickHeld(self, v('target'), [...RESOURCES, ...COMMODITIES], 'Master Merchant: take a card', (r) => [
          { op: 'transfer', from: v('target'), to: self, resource: r, amount: 1 },
        ]),
      ] },
    ],
  },
  {
    id: 'merchant', deck: 'trade', count: 6, name: 'Merchant', icon: 'merchant',
    description: 'Place the merchant on a land hex next to one of your settlements or cities. While you control it you trade that hex’s resource 2:1 with the bank, and it is worth 1 victory point.',
    effect: [
      { op: 'moveToken', token: 'merchant', as: 'merchantHex', to: { label: 'Merchant: place the merchant next to one of your settlements or cities' } },
      { op: 'abortIf', cond: { not: { varSet: 'merchantHex' } }, message: 'No hex next to your buildings' },
      { op: 'forEachPlayer', as: 'p', do: [{ op: 'setFlag', player: v('p'), flag: 'hasMerchant', value: false }] },
      { op: 'setFlag', flag: 'hasMerchant', value: true },
      ...merchantRateFx('merchantHex'),
    ],
  },
  {
    id: 'merchantFleet', deck: 'trade', count: 2, name: 'Merchant Fleet', icon: 'boat',
    description: 'Choose a resource or commodity: for the rest of this turn you may trade it with the bank at 2:1.',
    effect: [
      { op: 'chooseResource', as: 'fleetRes', label: 'Merchant Fleet: which card do you trade 2:1 this turn?' },
      { op: 'grantTradeRate', resource: { var: 'fleetRes' }, ratio: 2, until: 'endOfTurn' },
    ],
  },
  {
    id: 'resourceMonopoly', deck: 'trade', count: 4, name: 'Resource Monopoly', icon: 'trophy',
    description: 'Name a resource. Every other player gives you 2 of it (or all they have, if fewer).',
    effect: [
      { op: 'chooseResource', as: 'monoRes', kind: 'resource', label: 'Resource Monopoly: name a resource' },
      { op: 'forEachPlayer', as: 'p', filter: notSelf('p'), do: [{ op: 'transfer', from: v('p'), to: self, resource: { var: 'monoRes' },
        amount: { min: [2, { resourceCount: { player: v('p'), resource: { var: 'monoRes' } } }] } }] },
    ],
  },
  {
    id: 'tradeMonopoly', deck: 'trade', count: 2, name: 'Trade Monopoly', icon: 'coins',
    description: 'Name a commodity. Every other player gives you 1 of it (if they have one).',
    effect: [
      { op: 'chooseResource', as: 'monoCom', kind: 'commodity', label: 'Trade Monopoly: name a commodity' },
      { op: 'forEachPlayer', as: 'p', filter: notSelf('p'), do: [{ op: 'transfer', from: v('p'), to: self, resource: { var: 'monoCom' },
        amount: { min: [1, { resourceCount: { player: v('p'), resource: { var: 'monoCom' } } }] } }] },
    ],
  },
];

const progressCards: CardDef[] = PROGRESS.map(({ count: _count, deck: _deck, play, ...c }) => ({
  ...c,
  play: { ...afterRoll(), ...(play ?? {}) },
  afterPlay: play?.timing === 'immediate' ? 'keepFaceUp' : 'returnToDeck',
}));

const defenderCard: CardDef = {
  id: 'defenderOfCatan', name: 'Defender of Catan', icon: 'shield',
  description: '1 victory point, given to the player who contributed the most knight strength when the barbarians are beaten.',
  play: { timing: 'immediate' }, effect: [], vp: 1, afterPlay: 'keepFaceUp',
};

/* -------------------------------- actions -------------------------------- */

function improveAction(t: Track): ActionDef {
  const lvl = level(t.id);
  return {
    id: `improve-${t.id}`, name: `Improve ${t.name}`, group: 'improve', icon: t.commodity,
    description: `Buy the next ${t.name} city improvement (levels 1-5). Level N costs N ${NAMES[t.commodity].toLowerCase()} (1 less with the Crane). `
      + `You need a city. ${t.ability} Level 4: the first player there gets the ${t.name} metropolis (+2 VP on one of their cities); `
      + 'reaching level 5 first takes it from a level-4 holder. Levels 4 and 5 need a city to hold the metropolis. '
      + `With level 1 or more, when the event die shows the ${t.name} gate you draw a ${t.name} progress card if the red die is at most your level + 1.`,
    cost: { [t.commodity]: { max: [0, { sub: [{ add: [lvl, 1] }, { if: [{ flag: 'crane' }, 1, 0] }] }] } },
    available: { all: [
      myTurnMain,
      cmp(lvl, '<', 5),
      cmp({ pieceCount: { owner: self, tag: 'city' } }, '>=', 1),
      { any: [cmp(lvl, '<', 3), cmp(plainCities(self), '>=', 1), cmp(owned(t.metro), '>=', 1)] },
    ] },
    effect: [
      { op: 'addStat', key: `${t.id}Level`, amount: 1 },
      { op: 'setFlag', flag: 'crane', value: false },
      { op: 'setVar', name: 'newLevel', value: lvl },
      { op: 'log', text: `{self} reaches ${t.name} level {newLevel}` },
      ...(t.id === 'trade'
        ? [{ op: 'if', cond: cmp(lvl, '==', 3), then: COMMODITIES.map((c): Effect => ({ op: 'grantTradeRate', resource: c, ratio: 2 })) } as Effect]
        : []),
    ],
  };
}

const knightReady: Condition = { all: [
  myTurnMain,
  cmp(pieceState('pieceId', 'active'), '==', 1),
  cmp(pieceState('pieceId', 'fresh'), '==', 0),
] };

const actions: ActionDef[] = [
  ...TRACKS.map(improveAction),
  {
    id: 'activateKnight', name: 'Activate knight', group: 'knights', icon: 'knight', cost: { grain: 1 },
    description: 'Feed this knight 1 grain to make it active. Only active knights defend against the barbarians and can act, and not on the turn they were activated.',
    available: { all: [myTurnMain, cmp(pieceState('pieceId', 'active'), '==', 0)] },
    effect: [
      { op: 'setPieceState', at: 'pieceId', key: 'active', value: 1 },
      { op: 'setPieceState', at: 'pieceId', key: 'fresh', value: 1 },
    ],
  },
  {
    id: 'promoteBasic', name: 'Promote to strong knight', group: 'knights', icon: 'knight', cost: { wool: 1, ore: 1 },
    description: 'Pay 1 wool and 1 ore to turn this basic knight into a strong knight (strength 2). It keeps its active status. Once per knight per turn.',
    available: { all: [myTurnMain, cmp(pieceState('pieceId', 'promoted'), '==', 0), cmp(owned('knight2'), '<', 2)] },
    effect: [...promoteFx('pieceId', 'knight1', 'knight2'), { op: 'abortIf', cond: { not: { varSet: 'promotedKnight' } }, message: 'No strong knight left' }],
  },
  {
    id: 'promoteStrong', name: 'Promote to mighty knight', group: 'knights', icon: 'knight', cost: { wool: 1, ore: 1 },
    description: 'Pay 1 wool and 1 ore to turn this strong knight into a mighty knight (strength 3). Needs the Fortress (Politics level 3). It keeps its active status. Once per knight per turn.',
    available: { all: [myTurnMain, cmp(pieceState('pieceId', 'promoted'), '==', 0), cmp(level('politics'), '>=', 3), cmp(owned('knight3'), '<', 2)] },
    effect: [...promoteFx('pieceId', 'knight2', 'knight3'), { op: 'abortIf', cond: { not: { varSet: 'promotedKnight' } }, message: 'No mighty knight left' }],
  },
  {
    id: 'moveKnight', name: 'Move knight', group: 'knights', icon: 'knight',
    description: 'Move this active knight along your roads to a free spot (it cannot pass other players’ pieces). The knight becomes inactive.',
    available: knightReady,
    effect: [
      { op: 'movePiece', query: { tag: 'knight', owner: self }, from: { at: 'pieceId' }, anywhere: true, maxSteps: 40, path: knightPath,
        to: { where: notOcc, label: 'Move the knight to' }, as: 'knightTo' },
      { op: 'abortIf', cond: { not: { varSet: 'knightTo' } }, message: 'There is no free spot along your roads' },
      { op: 'setPieceState', at: 'pieceId', key: 'active', value: 0 },
    ],
  },
  {
    id: 'displaceKnight', name: 'Displace a knight', group: 'knights', icon: 'sword',
    description: 'Move this active knight along your roads onto a weaker opposing knight. That knight’s owner must move it to a free spot on their roads (or lose it). Your knight becomes inactive.',
    available: knightReady,
    effect: [
      { op: 'setVar', name: 'myStrength', value: pieceState('pieceId', 'strength') },
      { op: 'movePiece', query: { tag: 'knight', owner: self }, from: { at: 'pieceId' }, anywhere: true, maxSteps: 40, path: knightPath, as: 'spot',
        to: { label: 'Displace which knight?', where: { all: [
          { occupied: { at: 'at', piece: KNIGHTS, owner: 'others' } },
          cmp(pieceState('at', 'strength'), '<', { var: 'myStrength' }),
        ] } } },
      { op: 'abortIf', cond: { not: { varSet: 'spot' } }, message: 'No weaker opposing knight within reach' },
      { op: 'forEachPiece', as: 'victimAt', asId: 'victim',
        query: { tag: 'knight', owner: 'others', where: { occupied: { at: 'candidate', owner: self, piece: KNIGHTS } } },
        do: relocateKnightFx('victim') },
      { op: 'setPieceState', at: 'pieceId', key: 'active', value: 0 },
    ],
  },
  {
    id: 'chaseRobber', name: 'Chase away the robber', group: 'knights', icon: 'robber',
    description: 'If the robber is on a hex next to this active knight, move it (and rob as usual). The knight becomes inactive. Not before the first barbarian attack.',
    available: { all: [knightReady, robberActive, { hasToken: { at: 'piece', token: 'robber', near: true } }] },
    effect: [
      { op: 'setPieceState', at: 'pieceId', key: 'active', value: 0 },
      { op: 'moveToken', token: 'robber', to: { label: 'Chase the robber to' } },
    ],
  },
];

/* -------------------------------- triggers ------------------------------- */

const isTopDefender = (p: string): Condition => ({ all: [
  cmp(strength(v(p)), '>', 0),
  cmp({ countPlayers: { as: 'q', filter: cmp(strength(v('q')), '>', strength(v(p))) } }, '==', 0),
] });

const triggers: TriggerDef[] = [
  // Event die first (priority < 0), then production (base trigger, priority 0).
  {
    id: 'ck-barbarianShip', on: 'diceRolled', priority: -20,
    when: { varIs: { var: 'event0', value: 'barbarianShip' } },
    do: [
      { op: 'addGlobal', key: 'barbarians', amount: 1 },
      { op: 'setVar', name: 'barbarianPos', value: { global: 'barbarians' } },
      { op: 'log', text: 'The barbarian ship sails closer ({barbarianPos})' },
      { op: 'if', cond: cmp({ global: 'barbarians' }, '>=', { param: 'barbarianSteps' }), then: [{ op: 'emit', event: 'barbariansAttack' }] },
    ],
  },
  ...TRACKS.map((t): TriggerDef => ({
    id: `ck-gate-${t.id}`, on: 'diceRolled', priority: -10,
    when: { varIs: { var: 'event0', value: t.id } },
    do: [{ op: 'forEachPlayer', as: 'p',
      filter: { all: [cmp(level(t.id, v('p')), '>=', 1), cmp({ dice: 1 }, '<=', { add: [level(t.id, v('p')), 1] })] },
      do: [{ op: 'drawCard', deck: t.deck, player: v('p') }] }],
  })),
  {
    id: 'ck-barbariansAttack', on: 'barbariansAttack',
    do: [
      { op: 'setGlobal', key: 'barbarians', value: 0 },
      { op: 'addGlobal', key: 'barbarianAttacks', amount: 1 },
      { op: 'setVar', name: 'barbarianStrength', value: { pieceCount: { tag: 'city' } } },
      { op: 'setVar', name: 'knightStrength', value: { sumPieceState: { query: { tag: 'knight', state: { active: 1 } }, key: 'strength' } } },
      { op: 'log', text: 'The barbarians attack: {barbarianStrength} barbarians against {knightStrength} knights' },
      { op: 'if', cond: cmp({ var: 'knightStrength' }, '>=', { var: 'barbarianStrength' }),
        then: [
          { op: 'log', text: 'Catan is saved!' },
          { op: 'setVar', name: 'defenders', value: { countPlayers: { as: 'q', filter: isTopDefender('q') } } },
          { op: 'if', cond: cmp({ var: 'defenders' }, '==', 1),
            then: [{ op: 'forEachPlayer', as: 'p', filter: isTopDefender('p'), do: [{ op: 'giveCard', card: 'defenderOfCatan', player: v('p') }] }],
            else: [{ op: 'forEachPlayer', as: 'p', filter: isTopDefender('p'), do: [{
              op: 'chooseOption', player: v('p'), label: 'You helped defend Catan: draw a progress card from which deck?',
              options: TRACKS.map((t) => ({ label: t.name, do: [{ op: 'drawCard', deck: t.deck, player: v('p') } as Effect] })),
            }] }] },
        ],
        else: [
          { op: 'log', text: 'The barbarians pillage Catan!' },
          { op: 'forEachPlayer', as: 'p',
            filter: { all: [
              cmp(plainCities(v('p')), '>', 0),
              cmp({ countPlayers: { as: 'q', filter: { all: [cmp(plainCities(v('q')), '>', 0), cmp(strength(v('q')), '<', strength(v('p')))] } } }, '==', 0),
            ] },
            do: [{ op: 'downgrade', from: 'city', to: 'settlement', player: v('p'), location: { label: 'The barbarians pillage one of your cities' } }] },
        ] },
      { op: 'forEachPiece', query: { tag: 'knight', state: { active: 1 } }, as: 'k', asId: 'kId', do: [{ op: 'setPieceState', at: 'kId', key: 'active', value: 0 }] },
    ],
  },
  // 7: discard (hand limit + 2 per city wall); the robber only moves after the first barbarian attack.
  {
    id: 'robber-on-seven', on: 'diceRolled',
    when: cmp({ var: 'total' }, '==', 7),
    do: [
      { op: 'forEachPlayer', as: 'p', order: 'simultaneous',
        filter: cmp({ resourceCount: { player: v('p') } }, '>', { add: [{ param: 'discardLimit' }, { mul: [2, { pieceCount: { owner: v('p'), piece: 'wall' } }] }] }),
        do: [{ op: 'discard', player: v('p'), amount: { div: [{ resourceCount: { player: v('p') } }, 2] } }] },
      { op: 'if', cond: robberActive,
        then: [{ op: 'moveToken', token: 'robber', to: { label: 'Move the robber' } }],
        else: [{ op: 'log', text: 'The robber stays put until the barbarians first attack' }] },
    ],
  },
  {
    id: 'ck-knightsNewTurn', on: 'turnStart',
    do: [{ op: 'forEachPiece', query: { tag: 'knight' }, as: 'k', asId: 'kId', do: [
      { op: 'setPieceState', at: 'kId', key: 'fresh', value: 0 },
      { op: 'setPieceState', at: 'kId', key: 'promoted', value: 0 },
    ] }],
  },
  {
    id: 'ck-merchantRate', on: 'turnStart', when: { flag: 'hasMerchant' },
    do: [{ op: 'forEachLocation', kind: 'hex', as: 'merchantHex', filter: { hasToken: { at: 'merchantHex', token: 'merchant' } }, do: merchantRateFx('merchantHex') }],
  },
  {
    id: 'ck-progressHandLimit', on: 'cardDrawn', as: 'eventPlayer',
    when: cmp({ cardCount: {} }, '>', 4),
    do: [{ op: 'discardCard', player: self, choose: true }],
  },
  {
    id: 'ck-aqueduct', on: 'playerProduction', as: 'eventPlayer',
    when: { all: [cmp({ var: 'amount' }, '==', 0), cmp(level('science'), '>=', 3)] },
    do: [{ op: 'log', text: '{self} uses the Aqueduct' }, { op: 'chooseAndGain', amount: 1, kind: 'resource' }],
  },
  ...TRACKS.map((t): TriggerDef => ({
    id: `ck-metropolis-${t.id}`, on: 'awardChanged',
    when: { varIs: { var: 'award', value: t.metro } },
    do: [
      { op: 'if', cond: { varSet: 'previous' }, then: [{ op: 'downgrade', from: t.metro, to: 'city', player: v('previous') }] },
      { op: 'if', cond: { varSet: 'player' }, then: [{ op: 'upgrade', from: 'city', to: t.metro, player: v('player'), free: true,
        location: { label: `Choose a city for your ${t.name} metropolis` } }] },
    ],
  })),
  {
    id: 'ck-wallFalls', on: 'pieceDowngraded',
    when: { varIs: { var: 'from', value: 'city' } },
    do: [{ op: 'if', cond: { occupied: { at: 'at', piece: 'wall' } }, then: [{ op: 'remove', query: { piece: 'wall' }, location: { at: 'at' } }] }],
  },
];

/* ---------------------------------- mod ---------------------------------- */

const cityBonus: NonNullable<PieceDef['productionBonus']> = [
  { terrain: 'hills', gives: { brick: 1 } },
  { terrain: 'fields', gives: { grain: 1 } },
  { terrain: 'forest', gives: { paper: 1 } },
  { terrain: 'pasture', gives: { cloth: 1 } },
  { terrain: 'mountains', gives: { coin: 1 } },
];

const knightPlacement: PieceDef['placement'] = {
  on: 'vertex',
  where: { all: [notOcc, onLand, { connectedTo: { at: 'at', owner: self, via: ['road'] } }] },
};

const knightPiece = (n: 1 | 2 | 3, name: string, actionsFor: string[], cost?: Record<string, number>): PieceDef => ({
  id: `knight${n}`, name, icon: 'knight', supply: 2, tags: ['knight'],
  initialState: { active: 0, strength: n, fresh: 0, promoted: 0 },
  placement: knightPlacement,
  pieceActions: actionsFor,
  display: {
    stateBadges: [
      { key: 'strength', label: 'Strength', style: 'pips', max: 3 },
      { key: 'active', label: 'Active', style: 'toggle' },
    ],
  },
  ...(cost ? { cost } : {}),
});

const KNIGHT_ACTIONS = ['activateKnight', 'moveKnight', 'displaceKnight', 'chaseRobber'];

export const mod: ModDef = {
  meta: {
    id: 'cities-knights', name: 'Cities & Knights', version: '1.0.0', extends: ['base'],
    description: 'Commodities, city improvements, knights, the barbarian ship and three progress-card decks. First to 13 points.',
  },
  remove: {
    decks: ['dev'],
    cards: ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'],
    awards: ['largestArmy'],
  },
  resources: [
    { id: 'paper', name: 'Paper', color: '#e9dfc4', icon: 'paper', kind: 'commodity', bankSupply: 12 },
    { id: 'cloth', name: 'Cloth', color: '#c9a0dc', icon: 'cloth', kind: 'commodity', bankSupply: 12 },
    { id: 'coin', name: 'Coin', color: '#d4af37', icon: 'coin', kind: 'commodity', bankSupply: 12 },
  ],
  pieces: [
    {
      // Roads may not start from a knight alone: they must touch your building or another of your roads.
      id: 'road', name: 'Road', icon: 'road', supply: 15,
      placement: {
        on: 'edge',
        where: { all: [notOcc, onLand, { connectedTo: { at: 'at', owner: self } },
          { any: [{ adjacentTo: { at: 'at', tag: 'building', owner: self } }, { adjacentTo: { at: 'at', piece: 'road', owner: self } }] }] },
        setupWhere: { all: [notOcc, onLand, { isAdjacent: ['at', 'lastPlaced'] }] },
      },
      cost: { brick: 1, lumber: 1 }, network: 'roads', tags: ['road'],
    },
    {
      // A city produces 1 resource + 1 commodity on forest / pasture / mountains, 2 resources on hills / fields.
      id: 'city', name: 'City', icon: 'city', supply: 4,
      placement: {
        on: 'vertex',
        where: { occupied: { at: 'at', piece: 'settlement', owner: self } },
        setupWhere: { all: [notOcc, onLand, { distanceRule: { at: 'at' } }] },
      },
      upgradesFrom: ['settlement'], cost: { grain: 2, ore: 3 }, vp: 2,
      productionMultiplier: 1, productionBonus: cityBonus, tags: ['building', 'city'],
    },
    ...TRACKS.map((t) => ({
      id: t.metro, name: `${t.name} Metropolis`, icon: 'castle', supply: 1, vp: 4,
      placement: { on: 'vertex' as const, where: { occupied: { at: 'at', piece: 'city', owner: self } } },
      productionMultiplier: 1, productionBonus: cityBonus, tags: ['building', 'city', 'metropolis'],
    })),
    {
      id: 'wall', name: 'City Wall', icon: 'wall', supply: 3, cost: { brick: 2 }, tags: ['wall'], breaksNetworks: false,
      placement: { on: 'vertex', where: { all: [{ occupied: { at: 'at', piece: CITY_TYPES, owner: self } }, { not: { occupied: { at: 'at', piece: 'wall' } } }] } },
    },
    knightPiece(1, 'Basic Knight', [...KNIGHT_ACTIONS, 'promoteBasic'], { wool: 1, ore: 1 }),
    knightPiece(2, 'Strong Knight', [...KNIGHT_ACTIONS, 'promoteStrong']),
    knightPiece(3, 'Mighty Knight', KNIGHT_ACTIONS),
  ],
  cards: [...progressCards, defenderCard],
  decks: TRACKS.map((t) => ({
    id: t.deck, name: `${t.name} progress`, color: t.color, reshuffleDiscards: true,
    cards: PROGRESS.filter((c) => c.deck === t.id).map((c) => ({ card: c.id, count: c.count })),
  })),
  actions,
  tokens: [
    {
      id: 'robber', name: 'Robber', icon: 'robber', on: 'hex',
      where: { all: [onLand, { not: { hasToken: { at: 'at', token: 'robber' } } }] },
      blocksProduction: true, start: 'firstOfTerrain', startTerrain: 'desert',
      onMove: [{ op: 'if', cond: { flag: 'bishop' },
        // Bishop: rob every player next to the hex
        then: [{ op: 'forEachPlayer', as: 'p',
          filter: { all: [notSelf('p'), cmp({ pieceCount: { owner: v('p'), near: 'at', tag: 'building' } }, '>', 0)] },
          do: [{ op: 'steal', from: v('p') }] }],
        else: [
          { op: 'choosePlayer', as: 'victim', label: 'Choose a player to rob', filter: { all: [
            notSelf('victim'),
            cmp({ pieceCount: { owner: v('victim'), near: 'at', tag: 'building' } }, '>', 0),
            cmp({ resourceCount: { player: v('victim') } }, '>', 0),
            { any: [{ not: { setting: 'friendlyRobber' } }, cmp({ vp: v('victim') }, '>', 2)] },
          ] } },
          { op: 'if', cond: { varSet: 'victim' }, then: [{ op: 'steal', from: v('victim') }] },
        ] }],
    },
    {
      id: 'merchant', name: 'Merchant', icon: 'merchant', on: 'hex', start: 'none',
      where: { all: [
        { terrainIs: { at: 'at', terrain: TERRAIN_RESOURCE.map(([t]) => t) } },
        cmp({ pieceCount: { near: 'at', owner: self, tag: 'building' } }, '>', 0),
      ] },
    },
  ],
  awards: [
    ...TRACKS.map((t) => ({
      id: t.metro, name: `${t.name} Metropolis`, vp: 0, min: 4, mode: 'keepUntilBeaten' as const, metric: level(t.id),
    })),
    { id: 'merchant', name: 'Merchant', vp: 1, min: 1, metric: { if: [{ flag: 'hasMerchant' }, 1, 0] } },
  ],
  triggers,
  display: {
    globals: [
      { key: 'barbarians', label: 'Barbarian ship', max: 7, icon: 'pirate', color: '#8b2e2e' },
      { key: 'barbarianAttacks', label: 'Barbarian attacks' },
    ],
    stats: [
      { key: 'tradeLevel', label: 'Trade (cloth)', max: 5 },
      { key: 'politicsLevel', label: 'Politics (coin)', max: 5 },
      { key: 'scienceLevel', label: 'Science (paper)', max: 5 },
    ],
    eventFaces: [
      { face: 'barbarianShip', label: 'Barbarian ship', color: '#3a3a3a', icon: 'pirate' },
      { face: 'trade', label: 'Trade', color: '#d4a017' },
      { face: 'politics', label: 'Politics', color: '#2f6fbf' },
      { face: 'science', label: 'Science', color: '#2e8b57' },
    ],
  },
  settings: [
    { id: 'barbarianSteps', name: 'Barbarian ship: steps to Catan', type: 'number', default: 7, min: 3, max: 12 },
  ],
  dice: {
    numeric: [{ sides: 6 }, { sides: 6 }],
    eventDice: [{ id: 'event', faces: ['barbarianShip', 'barbarianShip', 'barbarianShip', 'trade', 'politics', 'science'] }],
  },
  setup: [
    { place: [{ piece: 'settlement', free: true }, { piece: 'road', free: true }], order: 'forward' },
    { place: [{ piece: 'city', free: true }, { piece: 'road', free: true }], order: 'reverse', grantStartingResources: true },
  ],
  trade: { bankRates: { resource: 4, commodity: 4 } },
  victoryPoints: 13,
};

export default mod;
