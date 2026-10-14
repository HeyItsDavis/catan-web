/**
 * Hand-built definition + mid-game state for developing the game UI without the
 * engine. Not used in production code paths.
 */
import type { AvailableMoves } from '../../../engine';
import type {
  CardInstance, GameDefinition, GameState, HexState, PieceInstance, PlayerState, PortInstance, Prompt, ResourceMap,
} from '../../../engine/schema';
import {
  edgeIdOf, hexCorners, hexEdges, hexId, SIDE_DIRECTIONS, vertexEdges, vertexHexes, vertexNeighbors,
} from '../../../engine/board/topology';

const T = true;

export function makeFixtureDef(): GameDefinition {
  return {
    mods: [{ id: 'base', name: 'Base (fixture)', version: '0.0.0' }],
    resources: [
      { id: 'wood', name: 'Lumber', color: '#3f8f3a', icon: 'wood', kind: 'resource', bankSupply: 19 },
      { id: 'brick', name: 'Brick', color: '#c4562f', icon: 'brick', kind: 'resource', bankSupply: 19 },
      { id: 'sheep', name: 'Wool', color: '#9ccf4f', icon: 'sheep', kind: 'resource', bankSupply: 19 },
      { id: 'wheat', name: 'Grain', color: '#e8c33c', icon: 'wheat', kind: 'resource', bankSupply: 19 },
      { id: 'ore', name: 'Ore', color: '#8b93a3', icon: 'ore', kind: 'resource', bankSupply: 19 },
      { id: 'spice', name: 'Spice', color: '#b04fc4', icon: '🌶️', kind: 'commodity', bankSupply: 12 },
    ],
    terrains: [
      { id: 'forest', name: 'Forest', color: '#2f7a35', icon: 'tree', produces: { wood: 1 }, numbered: T },
      { id: 'hills', name: 'Hills', color: '#c8693c', icon: 'hills', produces: { brick: 1 }, numbered: T },
      { id: 'pasture', name: 'Pasture', color: '#8cc152', icon: 'sheep', produces: { sheep: 1 }, numbered: T },
      { id: 'fields', name: 'Fields', color: '#e6bf3b', icon: 'wheat', produces: { wheat: 1 }, numbered: T },
      { id: 'mountains', name: 'Mountains', color: '#7d8695', icon: 'mountain', produces: { ore: 1 }, numbered: T },
      { id: 'desert', name: 'Desert', color: '#d9c48f', icon: 'sun' },
      { id: 'sea', name: 'Sea', color: '#2f6f9f', icon: 'wave', water: T },
      { id: 'fog', name: 'Fog', color: '#555', hidden: T },
    ],
    pieces: [
      {
        id: 'road', name: 'Road', supply: 15, network: 'roads',
        placement: { on: 'edge', where: true }, cost: { wood: 1, brick: 1 },
      },
      {
        id: 'settlement', name: 'Settlement', icon: 'settlement', supply: 5, vp: 1, productionMultiplier: 1,
        placement: { on: 'vertex', where: true }, cost: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
      },
      {
        id: 'city', name: 'City', icon: 'city', supply: 4, vp: 2, productionMultiplier: 2, upgradesFrom: ['settlement'],
        placement: { on: 'vertex', where: true }, cost: { wheat: 2, ore: 3 },
      },
      {
        id: 'ship', name: 'Ship', icon: 'ship', supply: 15, network: 'roads',
        placement: { on: 'edge', where: true }, cost: { wood: 1, sheep: 1 },
      },
      {
        id: 'knight', name: 'Knight', icon: 'knight', supply: 6, tags: ['knight'],
        placement: { on: 'vertex', where: true }, cost: { sheep: 1, ore: 1 }, initialState: { strength: 1, active: 0 },
      },
    ],
    cards: [
      { id: 'soldier', name: 'Knight', description: 'Move the robber and steal a card.', icon: 'knight', play: { timing: 'ownTurn' }, effect: [], countsAs: 'knightsPlayed', afterPlay: 'keepFaceUp' },
      { id: 'roadBuilding', name: 'Road Building', description: 'Place 2 free roads.', icon: 'road', play: { timing: 'ownTurn' }, effect: [] },
      { id: 'yearOfPlenty', name: 'Year of Plenty', description: 'Take any 2 resources from the bank.', icon: 'wheat', play: { timing: 'ownTurn' }, effect: [] },
      { id: 'monopoly', name: 'Monopoly', description: 'Name a resource; everyone gives you theirs.', icon: 'coin', play: { timing: 'ownTurn' }, effect: [] },
      { id: 'victoryPoint', name: 'Victory Point', description: 'Worth 1 VP.', icon: 'star', play: { timing: 'never' }, effect: [], vp: 1 },
    ],
    decks: [
      {
        id: 'dev', name: 'Development', color: '#6a55b0', cost: { sheep: 1, wheat: 1, ore: 1 },
        cards: [
          { card: 'soldier', count: 14 }, { card: 'roadBuilding', count: 2 }, { card: 'yearOfPlenty', count: 2 },
          { card: 'monopoly', count: 2 }, { card: 'victoryPoint', count: 5 },
        ],
      },
    ],
    actions: [
      { id: 'feast', name: 'Hold a Feast', description: 'Spend food to gain 1 VP (mod recipe).', icon: '🍗', cost: { wheat: 2, sheep: 2 }, available: true, effect: [], group: 'special', limitPerTurn: 1 },
      { id: 'smelt', name: 'Smelt Spice', description: 'Turn ore into spice.', icon: 'coin', cost: { ore: 2 }, available: true, effect: [], group: 'crafting' },
      { id: 'activate', name: 'Activate', description: 'Activate a knight.', icon: 'knight', cost: { wheat: 1 }, available: true, effect: [], group: 'knights' },
    ],
    tokens: [
      { id: 'robber', name: 'Robber', icon: 'robber', on: 'hex', where: true, blocksProduction: T, start: 'firstOfTerrain', startTerrain: 'desert' },
      { id: 'pirate', name: 'Pirate', icon: 'pirate', on: 'hex', where: true, start: 'none' },
    ],
    awards: [
      { id: 'longestRoad', name: 'Longest Road', vp: 2, metric: { longestRoad: 'self' }, min: 5, holderKeepsOnTie: T },
      { id: 'largestArmy', name: 'Largest Army', vp: 2, metric: { stat: { key: 'knightsPlayed' } }, min: 3, holderKeepsOnTie: T },
    ],
    ports: [
      { id: 'generic', resource: 'any', ratio: 3 },
      { id: 'wood2', resource: 'wood', ratio: 2 },
      { id: 'brick2', resource: 'brick', ratio: 2 },
      { id: 'sheep2', resource: 'sheep', ratio: 2 },
      { id: 'wheat2', resource: 'wheat', ratio: 2 },
      { id: 'ore2', resource: 'ore', ratio: 2 },
    ],
    maps: [],
    triggers: [],
    settings: [],
    dice: { numeric: [{ sides: 6 }, { sides: 6 }], eventDice: [{ id: 'event', faces: ['ship', 'ship', 'ship', 'blue', 'green', 'yellow'] }] },
    setup: [],
    trade: { bankRates: { resource: 4, commodity: 4 }, playerTrading: true, onlyCurrentPlayer: true },
    victoryPoints: 10,
    discardLimit: 7,
  };
}

/* ------------------------------- board ----------------------------------- */

const LAND: [string, number | null][] = [
  ['mountains', 10], ['pasture', 2], ['forest', 9],
  ['fields', 12], ['hills', 6], ['pasture', 4], ['hills', 10],
  ['fields', 9], ['forest', 11], ['desert', null], ['forest', 3], ['mountains', 8],
  ['forest', 8], ['mountains', 3], ['fields', 4], ['pasture', 5],
  ['hills', 5], ['fields', 6], ['pasture', 11],
];

function dist(q: number, r: number) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
}

function buildHexes(): Record<string, HexState> {
  const hexes: Record<string, HexState> = {};
  let i = 0;
  for (let r = -3; r <= 3; r++) {
    for (let q = -3; q <= 3; q++) {
      const d = dist(q, r);
      if (d > 3) continue;
      const id = hexId({ q, r });
      if (d <= 2) {
        const [terrain, number] = LAND[i++];
        hexes[id] = { id, coord: { q, r }, terrain, number, revealed: true };
      } else {
        hexes[id] = { id, coord: { q, r }, terrain: 'sea', number: null, revealed: true };
      }
    }
  }
  // A couple of fog hexes beyond the coast to exercise hidden rendering.
  for (const c of [{ q: 4, r: -2 }, { q: 4, r: -1 }]) {
    const id = hexId(c);
    hexes[id] = { id, coord: c, terrain: 'fog', number: null, revealed: false };
  }
  return hexes;
}

function buildPorts(hexes: Record<string, HexState>): PortInstance[] {
  const ports: PortInstance[] = [];
  const kinds = ['generic', 'wood2', 'generic', 'brick2', 'sheep2', 'generic', 'wheat2', 'ore2', 'generic'];
  const water = Object.values(hexes).filter((h) => h.terrain === 'sea');
  // Pick every other water hex that touches land, facing its first land neighbour.
  let k = 0;
  water
    .sort((a, b) => Math.atan2(a.coord.r + a.coord.q / 2, a.coord.q) - Math.atan2(b.coord.r + b.coord.q / 2, b.coord.q))
    .forEach((h, idx) => {
      if (idx % 2 !== 0 || k >= kinds.length) return;
      for (let side = 0; side < 6; side++) {
        const d = SIDE_DIRECTIONS[side];
        if (dist(h.coord.q + d.q, h.coord.r + d.r) <= 2) {
          const c = hexCorners(h.coord);
          ports.push({ port: kinds[k++], vertices: [c[side], c[(side + 1) % 6]], hex: h.id, side });
          return;
        }
      }
    });
  return ports;
}

function landVertices(hexes: Record<string, HexState>): string[] {
  const out = new Set<string>();
  for (const h of Object.values(hexes)) if (h.terrain !== 'sea' && h.terrain !== 'fog') hexCorners(h.coord).forEach((v) => out.add(v));
  return [...out];
}

function landEdges(hexes: Record<string, HexState>): string[] {
  const out = new Set<string>();
  for (const h of Object.values(hexes)) if (h.terrain !== 'sea' && h.terrain !== 'fog') hexEdges(h.coord).forEach((e) => out.add(e));
  return [...out];
}

/** Distance-rule legal empty vertices. */
export function legalVertices(state: GameState): string[] {
  const occupied = new Set(state.pieces.filter((p) => p.at.startsWith('v:')).map((p) => p.at));
  return landVertices(state.hexes).filter((v) => !occupied.has(v) && !vertexNeighbors(v).some((n) => occupied.has(n)));
}

/** Empty edges adjacent to the player's network. */
export function legalEdges(state: GameState, owner: string): string[] {
  const taken = new Set(state.pieces.map((p) => p.at));
  const mine = state.pieces.filter((p) => p.owner === owner);
  const touch = new Set<string>();
  for (const p of mine) {
    if (p.at.startsWith('v:')) vertexEdges(p.at).forEach((e) => touch.add(e));
    if (p.at.startsWith('e:')) {
      const [a, b] = p.at.slice(2).split('|');
      [...vertexEdges(a), ...vertexEdges(b)].forEach((e) => touch.add(e));
    }
  }
  const land = new Set(landEdges(state.hexes));
  return [...touch].filter((e) => land.has(e) && !taken.has(e));
}

/* ------------------------------- players --------------------------------- */

let seq = 0;
const card = (c: string, deck = 'dev', acquiredTurn = 3): CardInstance => ({ id: `c${++seq}`, card: c, deck, acquiredTurn });

function player(id: string, name: string, color: string, resources: Record<string, number>, extra: Partial<PlayerState> = {}): PlayerState {
  return {
    id, name, color, resources,
    hand: [], played: [], stats: {}, flags: {}, tokenVP: 0, tradeRates: [], actionUses: {}, cardPlaysThisTurn: {},
    ...extra,
  };
}

export const ME = 'p1';

export function makeFixtureState(): GameState {
  const hexes = buildHexes();
  const players: PlayerState[] = [
    player(ME, 'You', '#e53935', { wood: 3, brick: 2, sheep: 2, wheat: 3, ore: 3, spice: 1 }, {
      hand: [card('soldier'), card('yearOfPlenty'), card('victoryPoint')],
      played: [card('soldier', 'dev', 1)],
      stats: { knightsPlayed: 1 },
    }),
    player('p2', 'Alice', '#1e88e5', { wood: 1, brick: 0, sheep: 4, wheat: 1, ore: 0 }, {
      hand: [card('monopoly'), card('roadBuilding')],
      played: [card('soldier', 'dev', 1), card('soldier', 'dev', 2), card('soldier', 'dev', 3)],
      stats: { knightsPlayed: 3 },
    }),
    player('p3', 'Bob', '#fdd835', { wood: 2, brick: 3, sheep: 0, wheat: 2, ore: 1 }),
    player('p4', 'Carol', '#f5f5f5', { wood: 0, brick: 1, sheep: 1, wheat: 0, ore: 5 }, { hand: [card('victoryPoint')] }),
  ];

  // Pieces: each player gets a couple of settlements + roads.
  const pieces: PieceInstance[] = [];
  let pid = 0;
  const put = (type: string, owner: string, at: string, st: Record<string, number> = {}) =>
    pieces.push({ id: `pc${++pid}`, type, owner, at, state: st });
  const hv = (q: number, r: number, corner: number) => hexCorners({ q, r })[corner];
  const he = (q: number, r: number, side: number) => hexEdges({ q, r })[side];

  put('settlement', ME, hv(0, 0, 0)); put('road', ME, he(0, 0, 0)); put('road', ME, he(0, 0, 5));
  put('city', ME, hv(-1, 2, 3)); put('road', ME, he(-1, 2, 2));
  put('knight', ME, hv(1, 1, 2), { strength: 1, active: 1 });
  put('settlement', 'p2', hv(1, -1, 1)); put('road', 'p2', he(1, -1, 1)); put('road', 'p2', he(1, -1, 0));
  put('city', 'p2', hv(-2, 1, 4)); put('road', 'p2', he(-2, 1, 3)); put('road', 'p2', he(-2, 1, 4)); put('road', 'p2', he(-2, 1, 5));
  put('settlement', 'p3', hv(2, 0, 2)); put('road', 'p3', he(2, 0, 2)); put('ship', 'p3', edgeIdOf(hv(2, 0, 1), hv(2, 0, 2)));
  put('settlement', 'p4', hv(-1, -1, 5)); put('road', 'p4', he(-1, -1, 4)); put('settlement', 'p4', hv(0, 2, 3));

  const state: GameState = {
    version: 42,
    seed: 1,
    rngState: 1,
    settings: {
      mapId: 'fixture', maxPlayers: 4, victoryPoints: 10, discardLimit: 7, diceMode: 'random',
      friendlyRobber: false, hideBankCards: false, turnTimerSeconds: 90, randomizeTurnOrder: false, mods: [], modSettings: {},
    },
    players,
    turnOrder: players.map((p) => p.id),
    currentPlayerIndex: 0,
    turn: 9,
    phase: 'main',
    hasRolled: true,
    lastRoll: { dice: [4, 2], event: ['blue'], total: 6 },
    hexes,
    pieces,
    tokens: { robber: hexId({ q: 0, r: 0 }), pirate: hexId({ q: 3, r: -3 }) },
    ports: buildPorts(hexes),
    decks: { dev: { draw: Array.from({ length: 17 }, () => 'soldier'), discard: [] } },
    bank: { wood: 12, brick: 13, sheep: 11, wheat: 10, ore: 9, spice: 11 },
    globals: {},
    awards: { longestRoad: 'p2', largestArmy: 'p2' },
    prompts: [],
    stack: [],
    trades: [
      { id: 't1', from: 'p3', to: null, give: { brick: 1 }, get: { sheep: 1 }, responses: { p1: 'pending', p2: 'reject', p4: 'pending' } },
    ],
    log: [
      { turn: 8, player: 'p4', text: 'rolled 9' },
      { turn: 8, player: 'p4', text: 'built a Settlement' },
      { turn: 9, player: ME, text: 'rolled 6' },
      { turn: 9, text: 'Alice receives 1 Wool' },
      { turn: 9, player: ME, text: 'played Knight' },
    ],
    winner: null,
  };
  state.prompts = [
    { id: 'pr1', player: ME, kind: 'location', label: 'Place a settlement', options: legalVertices(state).slice(0, 14) },
  ];
  return state;
}

/* --------------------------- fake engine queries -------------------------- */

const afford = (res: Record<string, number>, cost: ResourceMap | undefined) =>
  !cost || Object.entries(cost).every(([k, v]) => (res[k] ?? 0) >= (typeof v === 'number' ? v : 0));

export function fakeAvailableMoves(def: GameDefinition, state: GameState, playerId: string): AvailableMoves {
  const me = state.players.find((p) => p.id === playerId);
  const myTurn = state.turnOrder[state.currentPlayerIndex] === playerId;
  const prompt = state.prompts.find((p) => p.player === playerId) ?? null;
  const active = myTurn && !prompt && state.phase === 'main' && state.hasRolled;
  const res = me?.resources ?? {};
  const rates: Record<string, number> = {};
  for (const r of def.resources) rates[r.id] = def.trade.bankRates[r.kind] ?? 4;
  // Ports owned via settlements/cities.
  const myVerts = new Set(state.pieces.filter((p) => p.owner === playerId && p.at.startsWith('v:')).map((p) => p.at));
  for (const port of state.ports) {
    if (!port.vertices.some((v) => myVerts.has(v))) continue;
    const pd = def.ports.find((x) => x.id === port.port);
    if (!pd) continue;
    for (const r of def.resources) if (pd.resource === 'any' || pd.resource === r.id) rates[r.id] = Math.min(rates[r.id], pd.ratio);
  }
  return {
    canRoll: myTurn && !prompt && !state.hasRolled && state.phase !== 'setup',
    canEndTurn: active,
    builds: active
      ? def.pieces.filter((p) => p.cost).map((p) => ({
          piece: p,
          affordable: afford(res, p.cost),
          hasSpot: p.placement.on === 'vertex' ? legalVertices(state).length > 0 : legalEdges(state, playerId).length > 0,
        }))
      : [],
    buyableDecks: active ? def.decks.filter((d) => d.cost).map((d) => ({ deck: d.id, affordable: afford(res, d.cost) })) : [],
    playableCards: myTurn && !prompt && me
      ? me.hand
          .filter((c) => c.acquiredTurn < state.turn)
          .map((c) => ({ cardInstance: c.id, card: def.cards.find((x) => x.id === c.card)! }))
          .filter((x) => x.card && x.card.play.timing !== 'never')
      : [],
    actions: myTurn
      ? def.actions.flatMap((a) =>
          a.id === 'activate'
            ? state.pieces
                .filter((p) => p.owner === playerId && p.type === 'knight')
                .map((p) => ({ action: a, enabled: active && afford(res, a.cost), pieceId: p.id }))
            : [{ action: a, enabled: active && afford(res, a.cost) }],
        )
      : [],
    bankRates: rates,
    prompt,
  };
}

/** Simulated redactFor: hide others' resources & hands. */
export function fakeRedact(state: GameState, viewer: string): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id === viewer) return p;
      const total = Object.values(p.resources).reduce((a, b) => a + b, 0);
      return { ...p, resources: { '?': total }, hand: p.hand.map((c) => ({ ...c, id: 'hidden', card: 'hidden' })) };
    }),
  };
}

export function samplePrompt(kind: Prompt['kind'], state: GameState, def: GameDefinition, player = ME): Prompt {
  const id = `pr${Date.now()}`;
  switch (kind) {
    case 'discard':
      return { id, player, kind, label: 'Discard half your cards (rolled 7)', options: [], amount: 6 };
    case 'resource':
      return { id, player, kind, label: 'Monopoly: pick a resource', options: def.resources.map((r) => r.id) };
    case 'player':
      return { id, player, kind, label: 'Choose a player to rob', options: state.players.filter((p) => p.id !== player).map((p) => p.id), optional: true };
    case 'card': {
      const me = state.players.find((p) => p.id === player)!;
      return { id, player, kind, label: 'Choose a card to discard', options: me.hand.map((c) => c.id) };
    }
    case 'piece':
      return { id, player, kind, label: 'Choose a knight to move', options: state.pieces.filter((p) => p.type === 'knight' || p.type === 'road').slice(0, 4).map((p) => p.id), optional: true };
    case 'option':
      return Object.assign({ id, player, kind, label: 'Barbarians attack! Choose', options: ['0', '1', '2'] }, { optionLabels: ['Defend', 'Flee', 'Bribe'] });
    case 'location':
    default:
      return {
        id, player, kind: 'location', label: 'Move the robber',
        options: Object.values(state.hexes).filter((h) => h.terrain !== 'sea' && h.terrain !== 'fog' && state.tokens.robber !== h.id).map((h) => h.id),
      };
  }
}

export function vertexHexIds(v: string): string[] {
  return vertexHexes(v).map(hexId);
}
