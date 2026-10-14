/**
 * Seafarers, as a mod on top of the base game. Everything here is plain data:
 *
 *  - Ships: built for lumber + wool on sea edges or the coast. A ship must touch one of your
 *    ships or buildings; a road must touch one of your roads or buildings. So a road and a ship
 *    only join at a settlement or city, and the Longest Trade Route counts the same way.
 *  - Moving a ship: once per turn, a ship at the open end of a shipping line that wasn't built
 *    this turn may move to any other spot where a ship could be built.
 *  - The pirate sits on a sea hex. Ships can't be built or moved next to it. Whoever moves it
 *    may rob a player with a ship next to its new hex. On a 7 (and with a Knight) you choose:
 *    move the robber or the pirate.
 *  - Gold fields: pick any resource when the number is rolled.
 *  - Fog: face-down hexes flip when a road or ship is built next to them. Finding land pays
 *    one card of what it produces.
 *  - New islands: your first settlement on each island where you had no building is worth
 *    extra victory points (lobby setting, 2 by default). Nobody may start on islands the map
 *    marks as foreign.
 *  - Setup: each starting settlement comes with a free road or a free ship.
 */
import type { Condition, Effect, ModDef, PieceDef, TriggerDef } from '../../../engine/schema';
import { baseMod } from '../../base';
import { fogIslands, fourIslands, headingForNewShores, headingForNewShoresLarge } from './maps';

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/* ------------------------------ placement checks ------------------------------ */

const notOccupied: Condition = { not: { occupied: { at: 'at' } } };
const touchesLand: Condition = { not: { isWater: { at: 'at' } } };
/** A sea edge or a coast edge. */
const seaOrCoast: Condition = { any: [{ isWater: { at: 'at' } }, { isCoastal: { at: 'at' } }] };
const pirateNotNext = (spot: string): Condition => ({ not: { hasToken: { at: spot, token: 'pirate', near: true } } });
const notForeign: Condition = { not: { hexTag: { at: 'at', tag: 'foreign' } } };

const basePiece = (id: string): PieceDef => structuredClone(baseMod.pieces!.find((p) => p.id === id)!);

const road: PieceDef = {
  ...basePiece('road'),
  network: 'route',
  networkSwitchAt: 'ownPiece',
  placement: {
    on: 'edge',
    // Roads grow from your roads or buildings, never straight off a ship.
    where: { all: [{ connectedTo: { at: 'at', owner: 'self', via: ['road'] } }, notOccupied, touchesLand] },
  },
};

const ship: PieceDef = {
  id: 'ship', name: 'Ship', icon: 'ship', supply: 15,
  cost: { lumber: 1, wool: 1 },
  network: 'route',
  networkSwitchAt: 'ownPiece',
  tags: ['ship'],
  // `fresh` = built this turn (cleared at the start of every turn); fresh ships can't move.
  initialState: { fresh: 1 },
  pieceActions: ['moveShip'],
  placement: {
    on: 'edge',
    // (the connection test comes first: it rules out most of the board fastest)
    where: { all: [{ connectedTo: { at: 'at', owner: 'self', via: ['ship'] } }, notOccupied, seaOrCoast, pirateNotNext('at')] },
  },
};

const settlementBase = basePiece('settlement');
const settlement: PieceDef = {
  ...settlementBase,
  placement: {
    on: 'vertex',
    where: { all: [{ connectedTo: { at: 'at', owner: 'self' } }, notOccupied, touchesLand, { distanceRule: { at: 'at' } }] },
    setupWhere: { all: [notOccupied, touchesLand, { distanceRule: { at: 'at' } }, notForeign] },
  },
};

/* ---------------------------------- robbing ---------------------------------- */

const victimFilter = (near: Condition): Condition => ({
  all: [
    { not: { samePlayer: [{ var: 'victim' }, 'self'] } },
    near,
    { cmp: [{ resourceCount: { player: { var: 'victim' } } }, '>', 0] },
    { any: [{ not: { setting: 'friendlyRobber' } }, { cmp: [{ vp: { var: 'victim' } }, '>', 2] }] },
  ],
});

const pirateRob: Effect[] = [
  {
    op: 'choosePlayer', as: 'victim', label: 'Choose a player to rob',
    filter: victimFilter({ cmp: [{ pieceCount: { owner: { var: 'victim' }, piece: 'ship', near: 'at' } }, '>', 0] }),
  },
  { op: 'if', cond: { varSet: 'victim' }, then: [{ op: 'steal', from: { var: 'victim' } }] },
];

const robberOrPirate: Effect = {
  op: 'chooseOption', label: 'Move the robber or the pirate?',
  options: [
    { label: 'Move the robber', do: [{ op: 'moveToken', token: 'robber', to: { label: 'Move the robber to a land hex' } }] },
    { label: 'Move the pirate', do: [{ op: 'moveToken', token: 'pirate', to: { label: 'Move the pirate to a sea hex' } }] },
  ],
};

const baseCard = (id: string) => structuredClone(baseMod.cards!.find((c) => c.id === id)!);

/* --------------------------------- triggers ---------------------------------- */

const isPiece = (...ids: string[]): Condition => ({ any: ids.map((id) => ({ varIs: { var: 'piece', value: id } })) });

const terrainReward: Effect[] = [
  ...([['forest', 'lumber'], ['hills', 'brick'], ['pasture', 'wool'], ['fields', 'grain'], ['mountains', 'ore']] as const).map(
    ([terrain, res]): Effect => ({ op: 'if', cond: { terrainIs: { at: 'at', terrain } }, then: [{ op: 'gain', resources: { [res]: 1 } }] }),
  ),
  { op: 'if', cond: { terrainIs: { at: 'at', terrain: 'gold' } }, then: [{ op: 'chooseAndGain', amount: 1, options: RESOURCES }] },
];

const triggers: TriggerDef[] = [
  {
    // Same as the base game, but after discarding the roller moves the robber OR the pirate.
    id: 'robber-on-seven', on: 'diceRolled',
    when: { cmp: [{ var: 'total' }, '==', 7] },
    do: [
      {
        op: 'forEachPlayer', as: 'p', order: 'simultaneous',
        filter: { cmp: [{ resourceCount: { player: { var: 'p' } } }, '>', { param: 'discardLimit' }] },
        do: [{ op: 'discard', player: { var: 'p' }, amount: { div: [{ resourceCount: { player: { var: 'p' } } }, 2] } }],
      },
      robberOrPirate,
    ],
  },
  {
    // Setup: right after each starting settlement, place a free road or a free ship next to it.
    id: 'setup-road-or-ship', on: 'piecePlaced', as: 'eventPlayer',
    when: { all: [{ phase: 'setup' }, { varIs: { var: 'piece', value: 'settlement' } }] },
    do: [{
      op: 'chooseOption', label: 'Start with a road or a ship?',
      options: [
        { label: 'Place a road', do: [{ op: 'place', piece: 'road', free: true, location: { where: { isAdjacent: ['at', 'pieceId'] }, label: 'Place a road next to your settlement' } }] },
        {
          label: 'Place a ship', cond: { isCoastal: { at: 'at' } },
          do: [{ op: 'place', piece: 'ship', free: true, location: { where: { isAdjacent: ['at', 'pieceId'] }, label: 'Place a ship next to your settlement' } }],
        },
      ],
    }],
  },
  {
    // Ships built last turn may move again.
    id: 'ships-settle-in', on: 'turnStart',
    do: [{ op: 'forEachPiece', query: { piece: 'ship', state: { fresh: 1 } }, as: 'shipSpot', asId: 'shipId',
      do: [{ op: 'setPieceState', at: 'shipId', key: 'fresh', value: 0 }] }],
  },
  {
    id: 'new-island-bonus', on: 'piecePlaced', as: 'eventPlayer',
    when: { all: [
      { not: { phase: 'setup' } },
      { varIs: { var: 'piece', value: 'settlement' } },
      { cmp: [{ param: 'islandBonusVP' }, '>', 0] },
      // the settlement just placed is your only building on this island
      { cmp: [{ pieceCount: { owner: 'self', tag: 'building', region: 'at' } }, '==', 1] },
    ] },
    do: [{ op: 'addVP', amount: { param: 'islandBonusVP' }, reason: 'first settlement on a new island' }],
  },
  {
    // Fog: building a road or ship next to a face-down hex turns it over.
    id: 'explore-fog', on: 'piecePlaced', as: 'eventPlayer',
    when: isPiece('road', 'ship'),
    do: [{ op: 'forEachLocation', kind: 'hex', as: 'fogHex', filter: { isAdjacent: ['fogHex', 'at'] },
      do: [{ op: 'revealHex', at: 'fogHex' }] }],
  },
  {
    // Discovering land pays one card of what it produces (gold: your choice).
    id: 'discovery-reward', on: 'hexRevealed', as: 'eventPlayer',
    when: { not: { isWater: { at: 'at' } } },
    do: [{ op: 'log', text: '{player} discovers land' }, ...terrainReward],
  },
];

/* ----------------------------------- mod ------------------------------------- */

export const mod: ModDef = {
  meta: {
    id: 'seafarers',
    name: 'Seafarers',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description:
      'Ships, the pirate, gold fields, fog and island bonuses. Scenarios: Heading for New Shores (3-4 and 5-6 players) and The Four Islands. Played to 14 VP (The Four Islands is officially 13).',
  },
  terrains: [
    { id: 'gold', name: 'Gold field', color: '#e0b030', icon: 'gold', numbered: true, producesChoice: { amount: 1, options: RESOURCES } },
  ],
  pieces: [road, settlement, ship],
  cards: [
    {
      ...baseCard('knight'),
      description: 'Move the robber or the pirate and rob a player next to it.',
      effect: [robberOrPirate],
    },
    {
      ...baseCard('roadBuilding'),
      description: 'Place 2 roads or ships for free, in any combination.',
      effect: [{
        op: 'repeat', times: 2, do: [{
          op: 'chooseOption', label: 'Build a free road or ship?',
          options: [
            { label: 'Free road', do: [{ op: 'place', piece: 'road', free: true }] },
            { label: 'Free ship', do: [{ op: 'place', piece: 'ship', free: true }] },
          ],
        }],
      }],
    },
  ],
  actions: [
    {
      id: 'moveShip', name: 'Move ship', group: 'build', icon: 'ship',
      description: 'Once per turn, move a ship from the open end of a shipping line to another spot where you could build a ship. Not a ship built this turn, and not next to the pirate.',
      available: { all: [
        { isTurnOf: 'self' }, { phase: 'main' },
        { not: { flag: 'shipMoved' } },
        { cmp: [{ pieceState: { piece: 'pieceId', key: 'fresh' } }, '==', 0] },
        { isNetworkEnd: { at: 'pieceId', via: ['ship'] } },
        pirateNotNext('pieceId'),
      ] },
      effect: [
        { op: 'movePiece', query: { piece: 'ship', owner: 'self' }, from: { at: 'pieceId' }, to: { label: 'Move the ship to' }, as: 'movedTo' },
        { op: 'if', cond: { varSet: 'movedTo' }, then: [{ op: 'setFlag', flag: 'shipMoved', value: true, until: 'endOfTurn' }] },
      ],
    },
  ],
  tokens: [
    {
      id: 'pirate', name: 'Pirate', icon: 'pirate', on: 'hex',
      where: { all: [{ isWater: { at: 'at' } }, { not: { hasToken: { at: 'at', token: 'pirate' } } }] },
      onMove: pirateRob,
      start: 'none',
    },
  ],
  awards: [
    { id: 'longestRoad', name: 'Longest Trade Route', vp: 2, metric: { longestRoad: 'self' }, min: 5, holderKeepsOnTie: true },
  ],
  maps: [headingForNewShores, fourIslands, headingForNewShoresLarge],
  triggers,
  settings: [
    { id: 'islandBonusVP', name: 'Victory points for the first settlement on each new island', type: 'number', default: 2, min: 0, max: 3 },
  ],
  setup: [
    { place: [{ piece: 'settlement', free: true }], order: 'forward' },
    { place: [{ piece: 'settlement', free: true }], order: 'reverse', grantStartingResources: true },
  ],
  victoryPoints: 14,
  remove: { maps: ['base-standard'] },
};

/** Exported for the Fog Islands scenario mod. */
export { fogIslands };

export default mod;
