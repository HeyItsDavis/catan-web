/**
 * The base game, expressed purely as a mod. Nothing here is special to the engine:
 * a content mod can replace or remove any of it by id.
 */
import type { Condition, Effect, MapDef, ModDef } from '../../engine/schema';
import { SIDE_DIRECTIONS } from '../../engine/board/topology';

const RESOURCE_IDS = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;

/* ------------------------------- the map -------------------------------- */

const dist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

function ring(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  let h = { q: -radius, r: 0 }; // start west, walk NE, E, SE, SW, W, NW
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push(h);
      h = { q: h.q + SIDE_DIRECTIONS[i].q, r: h.r + SIDE_DIRECTIONS[i].r };
    }
  }
  return out;
}

function standardMap(): MapDef {
  const hexes: MapDef['hexes'] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) if (dist(q, r) <= 2) hexes.push({ q, r, terrain: '@land' });
  }
  ring(3).forEach((h, i) => {
    const entry: MapDef['hexes'][number] = { q: h.q, r: h.r, terrain: 'sea' };
    if (i % 2 === 0) {
      // face the port toward a land neighbour (prefer the one that keeps ports spread out)
      const sides = SIDE_DIRECTIONS.map((d, s) => ({ s, land: dist(h.q + d.q, h.r + d.r) <= 2 })).filter((x) => x.land);
      entry.port = { port: '@', side: sides[sides.length - 1].s };
    }
    hexes.push(entry);
  });
  return {
    id: 'base-standard',
    name: 'Standard (3-4 players)',
    minPlayers: 2,
    maxPlayers: 4,
    hexes,
    terrainBags: {
      land: [
        'forest', 'forest', 'forest', 'forest',
        'pasture', 'pasture', 'pasture', 'pasture',
        'fields', 'fields', 'fields', 'fields',
        'hills', 'hills', 'hills',
        'mountains', 'mountains', 'mountains',
        'desert',
      ],
    },
    numberBag: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    portBag: ['port-any', 'port-any', 'port-any', 'port-any', 'port-brick', 'port-lumber', 'port-wool', 'port-grain', 'port-ore'],
    noAdjacentRedNumbers: true,
  };
}

/* ----------------------------- placement rules -------------------------- */

const notOccupied: Condition = { not: { occupied: { at: 'at' } } };
const onLand: Condition = { not: { isWater: { at: 'at' } } };

/* --------------------------------- robber -------------------------------- */

const robVictim: Effect[] = [
  {
    op: 'choosePlayer', as: 'victim', label: 'Choose a player to rob',
    filter: {
      all: [
        { not: { samePlayer: [{ var: 'victim' }, 'self'] } },
        { cmp: [{ pieceCount: { owner: { var: 'victim' }, near: 'at', tag: 'building' } }, '>', 0] },
        { cmp: [{ resourceCount: { player: { var: 'victim' } } }, '>', 0] },
        // Friendly robber (lobby setting): players with <= 2 visible VP can't be robbed.
        { any: [{ not: { setting: 'friendlyRobber' } }, { cmp: [{ vp: { var: 'victim' } }, '>', 2] }] },
      ],
    },
  },
  { op: 'if', cond: { varSet: 'victim' }, then: [{ op: 'steal', from: { var: 'victim' } }] },
];

/* ---------------------------------- mod ---------------------------------- */

export const baseMod: ModDef = {
  meta: {
    id: 'base',
    name: 'Base game',
    version: '1.0.0',
    description: 'The classic island: 19 hexes, 3-4 players, 10 victory points.',
  },
  resources: [
    { id: 'brick', name: 'Brick', color: '#c4572e', icon: 'brick', kind: 'resource', bankSupply: 19 },
    { id: 'lumber', name: 'Lumber', color: '#2e7d32', icon: 'lumber', kind: 'resource', bankSupply: 19 },
    { id: 'wool', name: 'Wool', color: '#9ccc65', icon: 'wool', kind: 'resource', bankSupply: 19 },
    { id: 'grain', name: 'Grain', color: '#f9c74f', icon: 'grain', kind: 'resource', bankSupply: 19 },
    { id: 'ore', name: 'Ore', color: '#78909c', icon: 'ore', kind: 'resource', bankSupply: 19 },
  ],
  terrains: [
    { id: 'hills', name: 'Hills', color: '#d4774a', produces: { brick: 1 }, numbered: true },
    { id: 'forest', name: 'Forest', color: '#3a7d44', produces: { lumber: 1 }, numbered: true },
    { id: 'pasture', name: 'Pasture', color: '#9fd36b', produces: { wool: 1 }, numbered: true },
    { id: 'fields', name: 'Fields', color: '#f2cf5b', produces: { grain: 1 }, numbered: true },
    { id: 'mountains', name: 'Mountains', color: '#8d99a6', produces: { ore: 1 }, numbered: true },
    { id: 'desert', name: 'Desert', color: '#e8d9a8' },
    { id: 'sea', name: 'Sea', color: '#3d8fd1', water: true },
  ],
  pieces: [
    {
      id: 'road', name: 'Road', icon: 'road', supply: 15,
      placement: {
        on: 'edge',
        where: { all: [notOccupied, onLand, { connectedTo: { at: 'at', owner: 'self' } }] },
        // During setup the road must touch the settlement just placed.
        setupWhere: { all: [notOccupied, onLand, { isAdjacent: ['at', 'lastPlaced'] }] },
      },
      cost: { brick: 1, lumber: 1 },
      network: 'roads',
      tags: ['road'],
    },
    {
      id: 'settlement', name: 'Settlement', icon: 'settlement', supply: 5,
      placement: {
        on: 'vertex',
        where: { all: [notOccupied, onLand, { distanceRule: { at: 'at' } }, { connectedTo: { at: 'at', owner: 'self' } }] },
        setupWhere: { all: [notOccupied, onLand, { distanceRule: { at: 'at' } }] },
      },
      cost: { brick: 1, lumber: 1, wool: 1, grain: 1 },
      vp: 1,
      productionMultiplier: 1,
      tags: ['building'],
    },
    {
      id: 'city', name: 'City', icon: 'city', supply: 4,
      placement: { on: 'vertex', where: { occupied: { at: 'at', piece: 'settlement', owner: 'self' } } },
      upgradesFrom: ['settlement'],
      cost: { grain: 2, ore: 3 },
      vp: 2,
      productionMultiplier: 2,
      tags: ['building'],
    },
  ],
  cards: [
    {
      id: 'knight', name: 'Knight', description: 'Move the robber and steal a resource from an adjacent player.',
      icon: 'knight',
      play: { timing: 'ownTurn', limitGroup: 'dev' },
      effect: [{ op: 'moveToken', token: 'robber', to: { label: 'Move the robber' } }],
      countsAs: 'knightsPlayed',
      afterPlay: 'keepFaceUp',
    },
    {
      id: 'roadBuilding', name: 'Road Building', description: 'Place 2 roads for free.', icon: 'road',
      play: { timing: 'ownTurn', limitGroup: 'dev' },
      effect: [{ op: 'repeat', times: 2, do: [{ op: 'place', piece: 'road', free: true }] }],
      afterPlay: 'keepFaceUp',
    },
    {
      id: 'yearOfPlenty', name: 'Year of Plenty', description: 'Take any 2 resources from the bank.', icon: 'plenty',
      play: { timing: 'ownTurn', limitGroup: 'dev' },
      effect: [{ op: 'chooseAndGain', amount: 2, kind: 'resource' }],
      afterPlay: 'keepFaceUp',
    },
    {
      id: 'monopoly', name: 'Monopoly', description: 'Name a resource. Every other player gives you all of it.',
      icon: 'monopoly',
      play: { timing: 'ownTurn', limitGroup: 'dev' },
      effect: [
        { op: 'chooseResource', as: 'res', kind: 'resource', label: 'Choose a resource to monopolize' },
        {
          op: 'forEachPlayer', as: 'p', filter: { not: { samePlayer: [{ var: 'p' }, 'self'] } },
          do: [{ op: 'transfer', from: { var: 'p' }, to: 'self', resource: { var: 'res' }, amount: { resourceCount: { player: { var: 'p' }, resource: { var: 'res' } } } }],
        },
      ],
      afterPlay: 'keepFaceUp',
    },
    {
      id: 'victoryPoint', name: 'Victory Point', description: '1 hidden victory point.', icon: 'vp',
      play: { timing: 'never' },
      effect: [],
      vp: 1,
    },
  ],
  decks: [
    {
      id: 'dev', name: 'Development', color: '#6a4c93',
      cards: [
        { card: 'knight', count: 14 },
        { card: 'roadBuilding', count: 2 },
        { card: 'yearOfPlenty', count: 2 },
        { card: 'monopoly', count: 2 },
        { card: 'victoryPoint', count: 5 },
      ],
      cost: { wool: 1, grain: 1, ore: 1 },
    },
  ],
  actions: [],
  tokens: [
    {
      id: 'robber', name: 'Robber', icon: 'robber', on: 'hex',
      where: { all: [onLand, { not: { hasToken: { at: 'at', token: 'robber' } } }] },
      blocksProduction: true,
      onMove: robVictim,
      start: 'firstOfTerrain',
      startTerrain: 'desert',
    },
  ],
  awards: [
    { id: 'longestRoad', name: 'Longest Road', vp: 2, metric: { longestRoad: 'self' }, min: 5, holderKeepsOnTie: true },
    { id: 'largestArmy', name: 'Largest Army', vp: 2, metric: { stat: { key: 'knightsPlayed' } }, min: 3, holderKeepsOnTie: true },
  ],
  ports: [
    { id: 'port-any', resource: 'any', ratio: 3 },
    ...RESOURCE_IDS.map((r) => ({ id: `port-${r}`, resource: r, ratio: 2 })),
  ],
  maps: [standardMap()],
  triggers: [
    {
      id: 'production', on: 'diceRolled',
      when: { cmp: [{ var: 'total' }, '!=', 7] },
      do: [{ op: 'produce' }],
    },
    {
      id: 'robber-on-seven', on: 'diceRolled',
      when: { cmp: [{ var: 'total' }, '==', 7] },
      do: [
        {
          op: 'forEachPlayer', as: 'p', order: 'simultaneous',
          filter: { cmp: [{ resourceCount: { player: { var: 'p' } } }, '>', { param: 'discardLimit' }] },
          do: [{ op: 'discard', player: { var: 'p' }, amount: { div: [{ resourceCount: { player: { var: 'p' } } }, 2] } }],
        },
        { op: 'moveToken', token: 'robber', to: { label: 'Move the robber' } },
      ],
    },
  ],
  settings: [],
  dice: { numeric: [{ sides: 6 }, { sides: 6 }] },
  setup: [
    { place: [{ piece: 'settlement', free: true }, { piece: 'road', free: true }], order: 'forward' },
    { place: [{ piece: 'settlement', free: true }, { piece: 'road', free: true }], order: 'reverse', grantStartingResources: true },
  ],
  trade: { bankRates: { resource: 4 }, playerTrading: true, onlyCurrentPlayer: true },
  victoryPoints: 10,
  discardLimit: 7,
};

export default baseMod;
