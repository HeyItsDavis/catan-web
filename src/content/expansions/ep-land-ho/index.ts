/**
 * Explorers & Pirates: Land Ho!
 *
 * How it works (all data):
 *  - You start on a small home island surrounded by open sea. Beyond it lies the fog: unexplored
 *    hexes (shown face down) hiding islands and more sea.
 *  - There are no roads and no cities. Ships connect everything; settlements are founded by
 *    settlers that ships carry. A settlement can be upgraded to a harbor settlement (2 VP, produces
 *    double); ships are built next to your harbor settlements.
 *  - Ships sail up to 4 steps per turn (piece state "moved" counts the steps used), along sides of
 *    hexes that touch open, explored sea.
 *  - When a ship stops, every unexplored hex touching either end of its side is revealed. Finding
 *    land gives you 1 card of what it produces.
 *  - A ship docked at your harbor settlement can take a settler aboard (brick, lumber, wool, grain);
 *    it holds 2 passengers or goods. A ship with a settler can found a settlement on a corner of
 *    its side (normal distance rule).
 *  - Play to 8 victory points.
 *
 * This file also exports `buildLandHo`, which the mission scenarios (Fish for Catan, Spices for
 * Catan) use to start from the same rules.
 */
import type { Condition, Effect, Expr, MapDef, ModDef, PieceDef, TerrainDef, TriggerDef } from '../../../engine/schema';
import { baseMod } from '../../base';

/* ------------------------------- terrains -------------------------------- */

/** Every unexplored terrain and what it turns into when revealed (+ the card you get for finding it). */
export const FOG: { fog: string; real: string; reward?: string }[] = [
  { fog: 'fogForest', real: 'forest', reward: 'lumber' },
  { fog: 'fogPasture', real: 'pasture', reward: 'wool' },
  { fog: 'fogFields', real: 'fields', reward: 'grain' },
  { fog: 'fogHills', real: 'hills', reward: 'brick' },
  { fog: 'fogMountains', real: 'mountains', reward: 'ore' },
  { fog: 'fogGold', real: 'goldField' },
  { fog: 'fogSea', real: 'sea' },
];

const fogTerrain = (id: string, numbered: boolean, water = false): TerrainDef =>
  ({ id, name: 'Unexplored', color: '#47505e', icon: 'fog', hidden: true, numbered, ...(water ? { water: true } : {}) });

/* -------------------------------- options -------------------------------- */

export interface LandHoOptions {
  id: string;
  name: string;
  description: string;
  victoryPoints: number;
  /** Extra fog draws (added to the fog bag, replacing the same number of unexplored sea hexes). */
  extraFog?: { fog: string; real: string; reward?: string; count: number; water?: boolean }[];
  /** Fixed hexes placed over the generated board (e.g. the Council of Catan). */
  extraHexes?: MapDef['hexes'];
  /** Terrains a ship can sail beside (default: sea). */
  openWater?: string[];
  /** How far a ship sails per turn (default 4). */
  shipSpeed?: Expr;
  /** More ship actions (ids of actions in `extra.actions`). */
  shipActions?: string[];
  /** Ship states reset at the start of your turn (besides "moved"). */
  shipTurnStates?: string[];
  /** Additional content merged into the mod. */
  extra?: Pick<ModDef, 'terrains' | 'actions' | 'triggers'>;
}

const dist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

function landHoMap(o: LandHoOptions): MapDef {
  const fixed = new Map((o.extraHexes ?? []).map((h) => [`${h.q},${h.r}`, h]));
  const hexes: MapDef['hexes'] = [];
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const d = dist(q, r);
      if (d > 4) continue;
      const f = fixed.get(`${q},${r}`);
      if (f) hexes.push({ ...f });
      else if (d <= 1) hexes.push({ q, r, terrain: '@home' });
      else if (d === 2) hexes.push({ q, r, terrain: 'sea' });
      else hexes.push({ q, r, terrain: '@fog' });
    }
  }
  const extra = (o.extraFog ?? []).flatMap((x) => Array.from({ length: x.count }, () => x.fog));
  const fogLand = ['fogForest', 'fogPasture', 'fogFields', 'fogHills', 'fogMountains'].flatMap((t) => [t, t, t]);
  const fogSea = Array.from({ length: 42 - fogLand.length - 1 - extra.length }, () => 'fogSea');
  return {
    id: o.id, name: `${o.name} (3-4 players)`, minPlayers: 2, maxPlayers: 4,
    hexes,
    terrainBags: {
      home: ['forest', 'pasture', 'fields', 'hills', 'mountains', 'forest', 'pasture'],
      fog: [...fogLand, 'fogGold', ...extra, ...fogSea],
    },
    numberBag: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 3, 4, 5, 6, 8, 9, 10, 11],
    noAdjacentRedNumbers: true,
  };
}

/* --------------------------------- mod ---------------------------------- */

export function buildLandHo(o: LandHoOptions): ModDef {
  const allFog = [...FOG, ...(o.extraFog ?? [])];
  const fogIds = allFog.map((f) => f.fog);
  const openWater = o.openWater ?? ['sea'];
  const speed = o.shipSpeed ?? 4;

  const notOccupied: Condition = { not: { occupied: { at: 'at' } } };
  const onLand: Condition = { not: { isWater: { at: 'at' } } };
  const explored: Condition = { not: { terrainIs: { at: 'at', terrain: fogIds } } };
  /** A side of a hex that touches open, explored water. */
  const besideOpenWater: Condition = { terrainIs: { at: 'at', terrain: openWater } };
  const myTurn: Condition[] = [{ isTurnOf: 'self' }, { phase: 'main' }];
  const shipState = (key: string): Expr => ({ pieceState: { piece: 'pieceId', key } });

  const settlementSpot: Condition = { all: [notOccupied, onLand, explored, { distanceRule: { at: 'at' } }] };
  const pieces: PieceDef[] = [
    {
      id: 'settlement', name: 'Settlement', icon: 'settlement', supply: 5, vp: 1, productionMultiplier: 1, tags: ['building'],
      // no cost: settlements are founded by settlers that ships carry
      placement: { on: 'vertex', where: settlementSpot, setupWhere: settlementSpot },
    },
    {
      id: 'harborSettlement', name: 'Harbor settlement', icon: 'city', supply: 4, vp: 2, productionMultiplier: 2, tags: ['building'],
      cost: { grain: 2, ore: 2 },
      upgradesFrom: ['settlement'],
      placement: {
        on: 'vertex',
        where: { all: [{ occupied: { at: 'at', piece: 'settlement', owner: 'self' } }, { isCoastal: { at: 'at' } }] },
        setupWhere: { all: [settlementSpot, { isCoastal: { at: 'at' } }] },
      },
    },
    {
      id: 'ship', name: 'Ship', icon: 'ship', supply: 3, tags: ['ship'],
      cost: { lumber: 1, wool: 1 },
      initialState: { moved: 0, ...Object.fromEntries((o.shipTurnStates ?? []).map((k) => [k, 0])) },
      pieceActions: ['sail', 'takeSettler', 'foundSettlement', ...(o.shipActions ?? [])],
      placement: {
        on: 'edge',
        // built beside one of your harbor settlements
        where: { all: [notOccupied, besideOpenWater, { adjacentTo: { at: 'at', owner: 'self', piece: 'harborSettlement' } }] },
        setupWhere: { all: [notOccupied, besideOpenWater, { isAdjacent: ['at', 'lastPlaced'] }] },
      },
    },
  ];

  const revealAroundShip: Effect = {
    op: 'forEachLocation', kind: 'vertex', as: 'shipEnd', filter: { isAdjacent: ['shipEnd', 'at'] },
    do: [{
      op: 'forEachLocation', kind: 'hex', as: 'unknown',
      filter: { all: [{ isAdjacent: ['unknown', 'shipEnd'] }, { terrainIs: { at: 'unknown', terrain: fogIds } }] },
      do: [{ op: 'revealHex', at: 'unknown' }],
    }],
  };

  const triggers: TriggerDef[] = [
    {
      id: 'explore', on: 'pieceMoved', as: 'eventPlayer',
      when: { varIs: { var: 'piece', value: 'ship' } },
      do: [revealAroundShip],
    },
    {
      // turn the face-down hex into what it really is; land discoveries pay 1 card
      id: 'discover', on: 'hexRevealed', as: 'eventPlayer',
      do: allFog.map((f): Effect => ({
        op: 'if', cond: { varIs: { var: 'terrain', value: f.fog } },
        then: [
          { op: 'setTerrain', at: 'at', terrain: f.real },
          ...(f.reward ? [{ op: 'gain', resources: { [f.reward]: 1 } } as Effect, { op: 'log', text: '{self} discovers new land!' } as Effect] : []),
        ],
      })),
    },
    {
      id: 'shipsRest', on: 'turnStart',
      do: [{
        op: 'forEachPiece', query: { piece: 'ship', owner: 'self' }, as: 'ship', asId: 'shipId',
        do: ['moved', ...(o.shipTurnStates ?? [])].map((key): Effect => ({ op: 'setPieceState', at: 'shipId', key, value: 0 })),
      }],
    },
    ...(o.extra?.triggers ?? []),
  ];

  const sailMoves: Expr = { sub: [speed, shipState('moved')] };

  return {
    meta: { id: o.id, name: o.name, version: '1.0.0', author: 'catan-web', extends: ['base'], description: o.description },
    terrains: [
      { id: 'goldField', name: 'Gold field', color: '#e2b93b', icon: 'gold', numbered: true, producesChoice: { amount: 1 } },
      ...FOG.map((f) => fogTerrain(f.fog, f.real !== 'sea', f.real === 'sea')),
      ...(o.extraFog ?? []).map((f) => fogTerrain(f.fog, false, f.water)),
      ...(o.extra?.terrains ?? []),
    ],
    maps: [landHoMap(o)],
    // no roads, cities or development cards in Explorers & Pirates
    remove: {
      maps: ['base-standard'],
      pieces: ['road', 'city'],
      decks: ['dev'],
      cards: ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'],
      awards: ['longestRoad', 'largestArmy'],
    },
    pieces,
    tokens: [{
      ...baseMod.tokens!.find((t) => t.id === 'robber')!,
      where: { all: [onLand, explored, { not: { hasToken: { at: 'at', token: 'robber' } } }] },
    }],
    setup: [
      { place: [{ piece: 'settlement', free: true }], order: 'forward' },
      { place: [{ piece: 'harborSettlement', free: true }, { piece: 'ship', free: true }], order: 'reverse', grantStartingResources: true },
    ],
    actions: [
      {
        id: 'sail', name: 'Sail', group: 'Ship', icon: 'ship',
        description: `Sail this ship along sides of hexes that touch open sea, up to its speed per turn. Unexplored hexes next to where it stops are revealed.`,
        available: { all: [...myTurn, { cmp: [sailMoves, '>', 0] }] },
        effect: [
          {
            op: 'movePiece', query: { piece: 'ship', owner: 'self' }, from: { at: 'pieceId' }, anywhere: true,
            maxSteps: sailMoves, path: besideOpenWater, stepsAs: 'steps', as: 'arrived',
            to: { where: { all: [notOccupied, besideOpenWater] }, label: 'Sail to' },
          },
          { op: 'abortIf', cond: { not: { varSet: 'arrived' } }, message: 'The ship cannot sail anywhere' },
          { op: 'setPieceState', at: 'pieceId', key: 'moved', value: { add: [shipState('moved'), { var: 'steps' }] } },
        ],
      },
      {
        id: 'takeSettler', name: 'Take a settler aboard', group: 'Ship', icon: 'settlement',
        cost: { brick: 1, lumber: 1, wool: 1, grain: 1 },
        description: 'At one of your harbor settlements: a settler boards this ship. A ship holds 2 settlers or goods.',
        available: { all: [...myTurn, { cmp: [{ cargoCount: { piece: 'pieceId' } }, '<', 2] }, { adjacentTo: { at: 'piece', owner: 'self', piece: 'harborSettlement' } }] },
        effect: [{ op: 'addCargo', piece: 'pieceId', key: 'settler', amount: 1 }],
      },
      {
        id: 'foundSettlement', name: 'Found a settlement', group: 'Ship', icon: 'settlement',
        description: 'A settler from this ship goes ashore and founds a settlement on a corner of the ship\'s side.',
        // only next to explored land
        available: { all: [...myTurn, { cmp: [{ cargoCount: { piece: 'pieceId', key: 'settler' } }, '>', 0] }, { not: { isWater: { at: 'piece' } } }, { not: { terrainIs: { at: 'piece', terrain: fogIds } } }] },
        effect: [
          { op: 'place', piece: 'settlement', free: true, ignoreConnection: true, as: 'founded', location: { where: { isAdjacent: ['at', 'pieceId'] }, label: 'Where does the settler go ashore?' } },
          { op: 'abortIf', cond: { not: { varSet: 'founded' } }, message: 'There is no room for a settlement here' },
          { op: 'addCargo', piece: 'pieceId', key: 'settler', amount: -1 },
        ],
      },
      ...(o.extra?.actions ?? []),
    ],
    triggers,
    victoryPoints: o.victoryPoints,
  };
}

/* -------------------------- shared by the missions ------------------------ */

/** The Council of Catan: a small land hex off the south coast of the home island, where missions deliver. */
export const COUNCIL_HEX = { q: 0, r: 2, terrain: 'council' };
export const COUNCIL_TERRAIN: TerrainDef = { id: 'council', name: 'Council of Catan', color: '#d9c38c', icon: 'castle' };

/**
 * "When a ship arrives at the Council of Catan carrying `goods`, deliver them": each one is worth
 * 1 victory point; `alsoDo` runs afterwards with the number delivered in the variable `delivered`.
 */
export function deliverToCouncil(goods: string, alsoDo: Effect[] = []): TriggerDef {
  const carried: Expr = { cargoCount: { piece: 'pieceId', key: goods } };
  return {
    id: `deliver-${goods}`, on: 'pieceMoved', as: 'eventPlayer',
    when: { all: [{ varIs: { var: 'piece', value: 'ship' } }, { terrainIs: { at: 'at', terrain: 'council' } }, { cmp: [carried, '>', 0] }] },
    do: [
      { op: 'setVar', name: 'delivered', value: carried },
      { op: 'addVP', amount: { var: 'delivered' }, reason: `${goods} delivered to the Council of Catan` },
      { op: 'addStat', key: `${goods}Delivered`, amount: { var: 'delivered' } },
      { op: 'addCargo', piece: 'pieceId', key: goods, amount: { sub: [0, { var: 'delivered' }] } },
      { op: 'log', text: `{self} delivers {delivered} ${goods} to the Council of Catan` },
      ...alsoDo,
    ],
  };
}

export const mod: ModDef = buildLandHo({
  id: 'ep-land-ho',
  name: 'E&P: Land Ho!',
  description: 'Sail out of your home island into the fog, discover new islands and settle them with settlers carried by your ships. No roads, no cities: harbor settlements and ships. Play to 8.',
  victoryPoints: 8,
});

export default mod;
