/**
 * Proof that the key mechanics of Seafarers, Cities & Knights, Traders & Barbarians and
 * Explorers & Pirates are expressible PURELY AS DATA with the generic vocabulary. Each section
 * is a tiny inline mod (not the real expansion), exercised end to end through applyCommand.
 */
import { describe, expect, it } from 'vitest';
import {
  getAvailableMoves, topology, validateMod,
  type Condition, type Expr, type GameDefinition, type GameState, type MapDef, type ModDef, type PieceDef, type TriggerDef,
} from '../index';
import { baseMod } from '../../content/base';
import { act, edit, give, newGame, place, simulate, withMods } from './helpers';

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const respond = (def: GameDefinition, s: GameState, a: string | null) =>
  act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const doAction = (def: GameDefinition, s: GameState, action: string, pieceId?: string, pid = 'p1') =>
  act(def, s, pid, { type: 'doAction', action, ...(pieceId ? { pieceId } : {}) });
const pieceAt = (s: GameState, type: string, at: string) => s.pieces.find((p) => p.type === type && p.at === at);
const vp = (def: GameDefinition, s: GameState, pid: string) => {
  // visible VP (tokens + pieces + awards)
  const p = P(s, pid);
  return p.tokenVP + s.pieces.filter((x) => x.owner === pid).reduce((a, x) => a + (def.pieces.find((d) => d.id === x.type)?.vp ?? 0), 0);
};

function start(def: GameDefinition, mapId?: string, n = 2): GameState {
  return edit(newGame(3, n, def, mapId ? { mapId } : {}), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.tokens.robber = null; });
}

const notOcc: Condition = { not: { occupied: { at: 'at' } } };
const wet: Condition = { any: [{ isWater: { at: 'at' } }, { isCoastal: { at: 'at' } }] };
const C = topology.hexCorners({ q: 0, r: 0 });
const E = topology.hexEdges({ q: 0, r: 0 });

/* ======================================================================== */
/*  Seafarers                                                               */
/* ======================================================================== */

/** Radius-2 board: island A (3 hexes) in the middle-east, island B (3 hexes) in the south-west. */
const archipelago: MapDef = {
  id: 'archipelago', name: 'Archipelago', minPlayers: 2, maxPlayers: 4,
  hexes: (() => {
    const land: Record<string, [string, number]> = {
      '0,0': ['forest', 6], '1,-1': ['hills', 5], '1,0': ['fields', 8],
      '-2,1': ['pasture', 9], '-2,2': ['mountains', 10], '-1,2': ['forest', 4],
    };
    const out: MapDef['hexes'] = [];
    for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 2) continue;
      const l = land[`${q},${r}`];
      out.push(l ? { q, r, terrain: l[0], number: l[1] } : { q, r, terrain: 'sea' });
    }
    return out;
  })(),
};

/** Seafarers-style "first settlement on a new island" bonus. */
const islandBonus: TriggerDef = {
  id: 'newIsland', on: 'piecePlaced', as: 'eventPlayer',
  when: { all: [
    { not: { phase: 'setup' } },
    { varIs: { var: 'piece', value: 'settlement' } },
    { cmp: [{ pieceCount: { owner: 'self', tag: 'building', region: 'at' } }, '==', 1] },
  ] },
  do: [{ op: 'addVP', amount: 2, reason: 'first settlement on a new island' }],
};

const seafarers: ModDef = {
  meta: { id: 'sea-proof', name: 'Seafarers primitives', version: '0', extends: ['base'] },
  setup: [],
  maps: [archipelago],
  pieces: [
    {
      ...baseMod.pieces![0], // road: same as base, but only links to roads (or own buildings)
      network: 'route', networkSwitchAt: 'ownPiece',
      placement: { on: 'edge', where: { all: [notOcc, { not: { isWater: { at: 'at' } } }, { connectedTo: { at: 'at', owner: 'self', via: ['road'] } }] } },
    },
    {
      id: 'ship', name: 'Ship', supply: 15, cost: { lumber: 1, wool: 1 }, network: 'route', networkSwitchAt: 'ownPiece',
      tags: ['ship'], pieceActions: ['moveShip'],
      placement: { on: 'edge', where: { all: [
        notOcc, wet,
        { connectedTo: { at: 'at', owner: 'self', via: ['ship'] } },
        { not: { hasToken: { at: 'at', token: 'pirate', near: true } } },
      ] } },
    },
  ],
  tokens: [{
    id: 'pirate', name: 'Pirate', on: 'hex', where: { isWater: { at: 'at' } },
    onMove: [
      { op: 'choosePlayer', as: 'victim', filter: { all: [
        { not: { samePlayer: [{ var: 'victim' }, 'self'] } },
        { cmp: [{ pieceCount: { owner: { var: 'victim' }, piece: 'ship', near: 'at' } }, '>', 0] },
      ] } },
      { op: 'if', cond: { varSet: 'victim' }, then: [{ op: 'steal', from: { var: 'victim' } }] },
    ],
  }],
  actions: [
    {
      id: 'moveShip', name: 'Move ship', group: 'build',
      available: { all: [{ isTurnOf: 'self' }, { phase: 'main' }, { not: { flag: 'shipMoved' } }, { isNetworkEnd: { at: 'pieceId', via: ['ship'] } }] },
      effect: [
        { op: 'movePiece', query: { piece: 'ship', owner: 'self' }, from: { at: 'pieceId' }, as: 'movedTo' },
        { op: 'if', cond: { varSet: 'movedTo' }, then: [{ op: 'setFlag', flag: 'shipMoved', value: true, until: 'endOfTurn' }] },
      ],
    },
    { id: 'pirate', name: 'Move pirate (test)', available: true, effect: [{ op: 'moveToken', token: 'pirate' }] },
  ],
  triggers: [
    islandBonus,
    // "the first time a player builds a ship": a forever flag
    { id: 'firstShip', on: 'piecePlaced', as: 'eventPlayer', when: { all: [{ varIs: { var: 'piece', value: 'ship' } }, { not: { flag: 'sailor' } }] },
      do: [{ op: 'setFlag', flag: 'sailor', value: true }, { op: 'addStat', key: 'firstShips', amount: 1 }] },
  ],
};

describe('Seafarers primitives', () => {
  const def = withMods(seafarers);
  const c0 = C[0]; // N corner of the forest: touches forest, hills and sea => coastal

  it('validates', () => {
    expect(validateMod(seafarers, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('ship network: ships link to ships or own buildings, roads never continue from a ship end', () => {
    let s = place(def, start(def, 'archipelago'), 'settlement', 'p1', c0);
    s = give(s, 'p1', { lumber: 4, wool: 2, brick: 2 });
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    const first = s.prompts[0].options;
    expect(first.length).toBe(2); // two coastal edges at the settlement; the land edge is not for ships
    expect(first.every((e) => topology.edgeVertices(e).includes(c0))).toBe(true);
    const e1 = first.find((e) => topology.edgeHexes(e).some((h) => topology.hexId(h) === 'h:0,-1') && topology.edgeHexes(e).some((h) => topology.hexId(h) === 'h:0,0'))!;
    s = respond(def, s, e1);
    expect(P(s, 'p1').flags.sailor?.value).toBe(true);
    const x = topology.edgeVertices(e1).find((v) => v !== c0)!;
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    expect(s.prompts[0].options.some((e) => topology.edgeVertices(e).includes(x))).toBe(true);
    const e2 = s.prompts[0].options.find((e) => e !== e1 && topology.edgeVertices(e).includes(x))!;
    s = respond(def, s, e2);
    expect(P(s, 'p1').stats.firstShips).toBe(1);
    const y = topology.edgeVertices(e2).find((v) => v !== x)!;
    // roads cannot branch off the ship route
    s = act(def, s, 'p1', { type: 'build', piece: 'road' });
    expect(s.prompts[0].options.some((e) => topology.edgeVertices(e).some((v) => v === x || v === y))).toBe(false);
    s = respond(def, s, null);

    // moving: only the ship at the open end
    const ship1 = pieceAt(s, 'ship', e1)!;
    const ship2 = pieceAt(s, 'ship', e2)!;
    const mv = getAvailableMoves(def, s, 'p1').actions.filter((a) => a.action.id === 'moveShip');
    expect(mv.find((a) => a.pieceId === ship1.id)?.enabled).toBe(false);
    expect(mv.find((a) => a.pieceId === ship2.id)?.enabled).toBe(true);
    s = doAction(def, s, 'moveShip', ship2.id);
    const dests = s.prompts[0].options;
    expect(dests).not.toContain(e2);
    expect(dests.every((e) => topology.edgeVertices(e).some((v) => v === x || v === c0))).toBe(true);
    s = respond(def, s, dests[0]);
    expect(s.pieces.find((p) => p.id === ship2.id)!.at).toBe(dests[0]);
    expect(getAvailableMoves(def, s, 'p1').actions.find((a) => a.pieceId === ship2.id)?.enabled).toBe(false); // once per turn

  });

  it('pirate blocks ship placement on the edges of its hex and robs adjacent ships', () => {
    // settlement on the forest's NW corner: two sea hexes around it, (0,-1) and (-1,0)
    let s = place(def, start(def, 'archipelago'), 'settlement', 'p1', C[5]);
    s = give(s, 'p1', { lumber: 1, wool: 1 });
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    expect(s.prompts[0].options).toHaveLength(3);
    s = respond(def, s, null);
    s = edit(s, (c) => { c.tokens.pirate = 'h:-1,0'; });
    const blocked = new Set(topology.hexEdges({ q: -1, r: 0 }));
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    expect(s.prompts[0].options).toHaveLength(1);
    expect(s.prompts[0].options.some((e) => blocked.has(e))).toBe(false);
    s = respond(def, s, s.prompts[0].options[0]);
    // p2 moves the pirate next to p1's ship and steals
    const shipAt = s.pieces.find((p) => p.type === 'ship')!.at;
    const seaHex = topology.edgeHexes(shipAt).map(topology.hexId).find((h) => s.hexes[h]?.terrain === 'sea')!;
    s = give(edit(s, (c) => { c.tokens.pirate = null; }), 'p1', { ore: 1 });
    s = edit(s, (c) => { c.currentPlayerIndex = 1; });
    s = doAction(def, s, 'pirate', undefined, 'p2');
    s = respond(def, s, seaHex);
    expect(s.prompts[0]).toMatchObject({ player: 'p2', options: ['p1'] });
    s = respond(def, s, 'p1');
    expect(P(s, 'p2').resources.ore).toBe(1);
  });
});

/* ======================================================================== */
/*  Cities & Knights                                                        */
/* ======================================================================== */

const strength = (who: string): Expr => ({ sumPieceState: { query: { tag: 'knight', owner: { var: who }, state: { active: 1 } }, key: 'strength' } });
const cities = (who: string): Expr => ({ pieceCount: { owner: { var: who }, piece: ['city', 'metropolis'] } });

const citiesKnights: ModDef = {
  meta: { id: 'ck-proof', name: 'C&K primitives', version: '0', extends: ['base'] },
  setup: [],
  dice: { numeric: [{ sides: 6 }, { sides: 6 }], eventDice: [{ id: 'event', faces: ['barbarianShip', 'barbarianShip', 'barbarianShip', 'trade', 'politics', 'science'] }] },
  pieces: [
    {
      id: 'knight', name: 'Knight', supply: 6, tags: ['knight'], initialState: { active: 0, strength: 1 },
      pieceActions: ['activateKnight', 'displace'],
      placement: { on: 'vertex', where: notOcc },
    },
    {
      id: 'metropolis', name: 'Metropolis', supply: 3, vp: 4, productionMultiplier: 2, tags: ['building'],
      placement: { on: 'vertex', where: { occupied: { at: 'at', piece: 'city', owner: 'self' } } },
    },
  ],
  cards: [{ id: 'spy', name: 'Spy', description: 'x', play: { timing: 'ownTurn' }, effect: [] }],
  decks: [{ id: 'politicsDeck', name: 'Politics', cards: [{ card: 'spy', count: 5 }], handLimit: 4 }],
  awards: [{ id: 'metroPolitics', name: 'Politics metropolis', vp: 0, metric: { stat: { key: 'politics' } }, min: 4, mode: 'keepUntilBeaten' }],
  actions: [
    {
      id: 'activateKnight', name: 'Activate knight', cost: { grain: 1 },
      available: { all: [{ isTurnOf: 'self' }, { cmp: [{ pieceState: { piece: 'pieceId', key: 'active' } }, '==', 0] }] },
      effect: [{ op: 'setPieceState', at: 'pieceId', key: 'active', value: 1 }],
    },
    {
      id: 'displace', name: 'Displace a knight',
      available: { all: [{ isTurnOf: 'self' }, { cmp: [{ pieceState: { piece: 'pieceId', key: 'active' } }, '==', 1] }] },
      effect: [
        { op: 'choosePiece', as: 'spot', asId: 'victimKnight', label: 'Displace which knight?', query: { tag: 'knight', owner: 'others' },
          filter: { cmp: [{ pieceState: { piece: 'spot', key: 'strength' } }, '<', { pieceState: { piece: 'pieceId', key: 'strength' } }] } },
        { op: 'abortIf', cond: { not: { varSet: 'spot' } }, message: 'No weaker knight to displace' },
        // the displaced knight's OWNER relocates it (following its placement rules) ...
        { op: 'movePiece', query: { tag: 'knight' }, from: { at: 'victimKnight' }, player: { ownerOf: 'victimKnight' }, as: 'fled' },
        // ... or loses it if there is nowhere to go
        { op: 'if', cond: { not: { varSet: 'fled' } }, then: [{ op: 'remove', query: { tag: 'knight' }, location: { at: 'victimKnight' } }] },
        { op: 'movePiece', query: { piece: 'knight', owner: 'self' }, from: { at: 'pieceId' }, to: { at: 'spot' } },
        { op: 'setPieceState', at: 'pieceId', key: 'active', value: 0 },
      ],
    },
    { id: 'ship', name: 'Barbarian ship (test)', available: true, effect: [{ op: 'emit', event: 'barbarianShip' }] },
    { id: 'politics', name: 'Politics face (test)', available: true, effect: [{ op: 'emit', event: 'politics' }] },
    { id: 'improve', name: 'Improve politics', available: true, effect: [{ op: 'addStat', key: 'politics', amount: 1 }] },
    { id: 'noop', name: 'Nothing (test)', available: true, effect: [] },
    { id: 'produce', name: 'Produce (test)', available: true, effect: [{ op: 'produce', roll: 6 }] },
  ],
  triggers: [
    { id: 'barbAdvance', on: 'barbarianShip', do: [
      { op: 'addGlobal', key: 'barbarians', amount: 1 },
      { op: 'if', cond: { cmp: [{ global: 'barbarians' }, '>=', 7] }, then: [{ op: 'emit', event: 'barbariansArrive' }] },
    ] },
    { id: 'barbAttack', on: 'barbariansArrive', do: [
      { op: 'setGlobal', key: 'barbarians', value: 0 },
      { op: 'if',
        cond: { cmp: [{ sumPieceState: { query: { tag: 'knight', state: { active: 1 } }, key: 'strength' } }, '>=', { pieceCount: { piece: ['city', 'metropolis'] } }] },
        // defenders win: the uniquely strongest defender gets a VP
        then: [{ op: 'forEachPlayer', as: 'p', filter: { all: [
          { cmp: [strength('p'), '>', 0] },
          { cmp: [{ countPlayers: { as: 'q', filter: { all: [{ not: { samePlayer: [{ var: 'q' }, { var: 'p' }] } }, { cmp: [strength('q'), '>=', strength('p')] }] } } }, '==', 0] },
        ] }, do: [{ op: 'addVP', player: { var: 'p' }, amount: 1, reason: 'Defender of Catan' }] }],
        // barbarians win: the weakest players who own a city lose one (city -> settlement)
        else: [{ op: 'forEachPlayer', as: 'p', filter: { all: [
          { cmp: [{ pieceCount: { owner: { var: 'p' }, piece: 'city' } }, '>', 0] },
          { cmp: [{ countPlayers: { as: 'q', filter: { all: [{ cmp: [cities('q'), '>', 0] }, { cmp: [strength('q'), '<', strength('p')] }] } } }, '==', 0] },
        ] }, do: [{ op: 'downgrade', from: 'city', to: 'settlement', player: { var: 'p' } }] }],
      },
      { op: 'forEachPiece', query: { tag: 'knight' }, as: 'k', asId: 'kid', do: [{ op: 'setPieceState', at: 'kid', key: 'active', value: 0 }] },
    ] },
    // metropolis: the award holder upgrades a city; the previous holder's metropolis is reduced
    { id: 'metro', on: 'awardChanged', when: { varIs: { var: 'award', value: 'metroPolitics' } }, do: [
      { op: 'if', cond: { varSet: 'previous' }, then: [{ op: 'downgrade', from: 'metropolis', to: 'city', player: { var: 'previous' } }] },
      { op: 'if', cond: { varSet: 'player' }, then: [{ op: 'upgrade', from: 'city', to: 'metropolis', player: { var: 'player' }, free: true }] },
    ] },
    // event die "politics": draw if the red die (die 1) <= politics level + 1
    { id: 'politicsDraw', on: 'politics', do: [{ op: 'forEachPlayer', as: 'p',
      filter: { cmp: [{ dice: 1 }, '<=', { add: [{ stat: { player: { var: 'p' }, key: 'politics' } }, 1] }] },
      do: [{ op: 'drawCard', deck: 'politicsDeck', player: { var: 'p' } }] }] },
    // aqueduct: a player with the aqueduct who receives nothing picks 1 resource
    { id: 'aqueduct', on: 'playerProduction', as: 'eventPlayer',
      when: { all: [{ cmp: [{ var: 'amount' }, '==', 0] }, { flag: 'aqueduct' }] },
      do: [{ op: 'chooseAndGain', amount: 1, kind: 'resource' }] },
  ],
};

describe('Cities & Knights primitives', () => {
  const def = withMods(citiesKnights);
  const B = topology.hexCorners({ q: 1, r: 1 });

  it('validates', () => {
    expect(validateMod(citiesKnights, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  function board(): GameState {
    let s = start(def);
    s = place(def, s, 'city', 'p1', C[0]);
    s = place(def, s, 'city', 'p1', C[3]);
    s = place(def, s, 'city', 'p2', B[0]);
    s = place(def, s, 'knight', 'p1', C[1]);
    return s;
  }

  it('barbarians win: the weakest city owner has a city reduced; knights deactivate', () => {
    let s = edit(board(), (c) => { c.globals.barbarians = 6; c.pieces[3].state = { active: 1, strength: 1 }; });
    s = doAction(def, s, 'ship');
    expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'piece', options: [B[0]] });
    s = respond(def, s, B[0]);
    expect(pieceAt(s, 'settlement', B[0])?.owner).toBe('p2');
    expect(s.pieces.filter((p) => p.type === 'city' && p.owner === 'p1')).toHaveLength(2);
    expect(s.globals.barbarians).toBe(0);
    expect(s.pieces.find((p) => p.type === 'knight')!.state.active).toBe(0);
  });

  it('defenders win: strongest defender gets a VP', () => {
    let s = edit(board(), (c) => { c.globals.barbarians = 6; c.pieces[3].state = { active: 1, strength: 3 }; });
    s = doAction(def, s, 'ship');
    expect(s.prompts).toEqual([]);
    expect(P(s, 'p1').tokenVP).toBe(1);
  });

  it('activate (piece action with state cond) and displace a weaker knight; its owner relocates it', () => {
    let s = place(def, board(), 'knight', 'p2', B[3]);
    s = give(s, 'p1', { grain: 1 });
    const mine = s.pieces.find((p) => p.type === 'knight' && p.owner === 'p1')!;
    s = edit(s, (c) => { c.pieces.find((p) => p.id === mine.id)!.state.strength = 2; });
    s = doAction(def, s, 'activateKnight', mine.id);
    expect(s.pieces.find((p) => p.id === mine.id)!.state.active).toBe(1);
    expect(getAvailableMoves(def, s, 'p1').actions.find((a) => a.action.id === 'activateKnight' && a.pieceId === mine.id)?.enabled).toBe(false);
    s = doAction(def, s, 'displace', mine.id);
    expect(s.prompts[0]).toMatchObject({ player: 'p1', options: [B[3]] });
    s = respond(def, s, B[3]);
    expect(s.prompts[0].player).toBe('p2'); // displaced owner picks where to go
    const dest = s.prompts[0].options[0];
    s = respond(def, s, dest);
    expect(s.pieces.find((p) => p.id === mine.id)).toMatchObject({ at: B[3], state: { active: 0, strength: 2 } });
    expect(s.pieces.find((p) => p.type === 'knight' && p.owner === 'p2')!.at).toBe(dest);
  });

  it('metropolis: first to reach 4 keeps it until strictly exceeded; pieces follow the award', () => {
    let s = edit(board(), (c) => { P(c, 'p1').stats.politics = 3; });
    s = doAction(def, s, 'improve'); // p1 reaches 4 first
    expect(s.awards.metroPolitics).toBe('p1');
    expect(s.prompts[0]).toMatchObject({ player: 'p1', options: [C[0], C[3]] });
    s = respond(def, s, C[0]);
    expect(pieceAt(s, 'metropolis', C[0])?.owner).toBe('p1');
    expect(vp(def, s, 'p1')).toBe(6);
    s = edit(s, (c) => { P(c, 'p2').stats.politics = 4; });
    s = doAction(def, s, 'noop');
    expect(s.awards.metroPolitics).toBe('p1'); // reaching the same level is not enough
    s = edit(s, (c) => { P(c, 'p2').stats.politics = 5; });
    s = doAction(def, s, 'noop');
    expect(s.awards.metroPolitics).toBe('p2');
    expect(s.prompts[0].player).toBe('p1'); // reduce the old metropolis
    s = respond(def, s, C[0]);
    expect(s.prompts[0].player).toBe('p2');
    s = respond(def, s, B[0]);
    expect(pieceAt(s, 'city', C[0])?.owner).toBe('p1');
    expect(pieceAt(s, 'metropolis', B[0])?.owner).toBe('p2');
  });

  it('event-die draws gated on a stat (red die <= level + 1) and the aqueduct', () => {
    let s = edit(board(), (c) => {
      c.lastRoll = { dice: [3, 2], event: ['politics'], total: 5 };
      P(c, 'p1').stats.politics = 2;
    });
    s = doAction(def, s, 'politics');
    expect(P(s, 'p1').hand).toHaveLength(1);
    expect(P(s, 'p2').hand).toHaveLength(0);
    // aqueduct: p2 receives nothing on a 6 and picks a resource
    s = edit(s, (c) => {
      P(c, 'p2').flags.aqueduct = { value: true, until: 'forever' };
      for (const h of Object.values(c.hexes)) if (h.number === 6) h.number = null;
    });
    s = doAction(def, s, 'produce');
    expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'resource' });
    s = respond(def, s, 'ore');
    expect(P(s, 'p2').resources.ore).toBe(1);
  });
});

/* ======================================================================== */
/*  Traders & Barbarians: wagons                                            */
/* ======================================================================== */

const roadPath: Condition = { occupied: { at: 'via', piece: 'road' } };
const traders: ModDef = {
  meta: { id: 'tb-proof', name: 'T&B primitives', version: '0', extends: ['base'] },
  setup: [],
  terrains: [
    { id: 'quarry', name: 'Quarry', color: '#999' },
    { id: 'castle', name: 'Castle', color: '#a33' },
  ],
  pieces: [{
    id: 'wagon', name: 'Wagon', supply: 1, tags: ['wagon'], pieceActions: ['moveWagon', 'loadMarble'],
    placement: { on: 'vertex', where: true },
  }],
  actions: [
    {
      id: 'moveWagon', name: 'Drive wagon',
      available: { all: [{ isTurnOf: 'self' }, { phase: 'main' }, { cmp: [{ stat: { key: 'moved' } }, '<', 4] }] },
      effect: [
        // 4 movement points per turn, along roads (anyone's), one step = one road
        { op: 'movePiece', query: { piece: 'wagon', owner: 'self' }, from: { at: 'pieceId' }, anywhere: true,
          maxSteps: { sub: [4, { stat: { key: 'moved' } }] }, path: roadPath, stepsAs: 'st' },
        { op: 'addStat', key: 'moved', amount: { var: 'st' } },
      ],
    },
    {
      id: 'loadMarble', name: 'Load marble',
      available: { all: [{ terrainIs: { at: 'piece', terrain: 'quarry' } }, { cmp: [{ cargoCount: { piece: 'pieceId' } }, '==', 0] }] },
      effect: [
        { op: 'addCargo', piece: 'pieceId', key: 'marble', amount: 1 },
        { op: 'loadCargo', piece: 'pieceId', resource: 'choice', amount: 1 }, // trade goods from hand travel too
      ],
    },
  ],
  triggers: [
    { id: 'resetMoves', on: 'turnStart', do: [{ op: 'setStat', key: 'moved', value: 0 }] },
    { id: 'deliver', on: 'pieceMoved', as: 'eventPlayer',
      when: { all: [
        { varIs: { var: 'piece', value: 'wagon' } },
        { terrainIs: { at: 'at', terrain: 'castle' } },
        { cmp: [{ cargoCount: { piece: 'pieceId', key: 'marble' } }, '>', 0] },
      ] },
      do: [
        { op: 'addCargo', piece: 'pieceId', key: 'marble', amount: -1 },
        { op: 'addVP', amount: 1, reason: 'marble delivered to the castle' },
        { op: 'unloadCargo', piece: 'pieceId' },
      ] },
  ],
};

describe('Traders & Barbarians primitives: wagon with cargo and delivery', () => {
  const def = withMods(traders);
  it('validates', () => {
    expect(validateMod(traders, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('loads at the quarry, drives along roads within movement points, delivers to the castle', () => {
    let s = edit(start(def), (c) => { c.hexes['h:0,0'].terrain = 'quarry'; c.hexes['h:1,0'].terrain = 'castle'; });
    s = place(def, s, 'wagon', 'p1', C[4]);
    s = place(def, s, 'road', 'p2', E[3]); // C3-C4
    s = place(def, s, 'road', 'p1', E[2]); // C2-C3 ; C2 touches the castle
    s = give(s, 'p1', { ore: 1 });
    const w = s.pieces.find((p) => p.type === 'wagon')!;
    s = doAction(def, s, 'loadMarble', w.id);
    s = respond(def, s, 'ore');
    expect(s.pieces.find((p) => p.id === w.id)!.cargo).toEqual({ marble: 1, ore: 1 });
    s = doAction(def, s, 'moveWagon', w.id);
    expect([...s.prompts[0].options].sort()).toEqual([C[2], C[3]].sort());
    s = respond(def, s, C[2]);
    expect(P(s, 'p1').stats.moved).toBe(2);
    expect(P(s, 'p1').tokenVP).toBe(1);
    expect(P(s, 'p1').resources.ore).toBe(1);
    expect(s.pieces.find((p) => p.id === w.id)!.cargo).toBeUndefined();
    // 2 movement points left: back to C4 is exactly 2
    s = doAction(def, s, 'moveWagon', w.id);
    expect([...s.prompts[0].options].sort()).toEqual([C[3], C[4]].sort());
  });
});

/* ======================================================================== */
/*  Explorers & Pirates: a ship carrying a settler                          */
/* ======================================================================== */

const explorers: ModDef = {
  meta: { id: 'ep-proof', name: 'E&P primitives', version: '0', extends: ['base'] },
  setup: [],
  maps: [archipelago],
  pieces: [{
    id: 'ship', name: 'Ship', supply: 3, tags: ['ship'], pieceActions: ['loadSettler', 'sail', 'foundSettlement'],
    placement: { on: 'edge', where: { all: [notOcc, wet] } },
  }],
  actions: [
    {
      id: 'loadSettler', name: 'Load a settler', cost: { brick: 1, lumber: 1, wool: 1, grain: 1 },
      available: { all: [
        { cmp: [{ cargoCount: { piece: 'pieceId', key: 'settler' } }, '==', 0] },
        { cmp: [{ pieceCount: { owner: 'self', tag: 'building', near: 'piece' } }, '>', 0] }, // docked at own harbor
      ] },
      effect: [{ op: 'addCargo', piece: 'pieceId', key: 'settler', amount: 1 }],
    },
    {
      id: 'sail', name: 'Sail', limitPerTurn: 1, available: { isTurnOf: 'self' },
      effect: [{ op: 'movePiece', query: { piece: 'ship', owner: 'self' }, from: { at: 'pieceId' }, maxSteps: 12, path: { all: [notOcc, wet] } }],
    },
    {
      id: 'foundSettlement', name: 'Found a settlement',
      available: { cmp: [{ cargoCount: { piece: 'pieceId', key: 'settler' } }, '>', 0] },
      effect: [
        { op: 'place', piece: 'settlement', free: true, ignoreConnection: true, as: 'founded',
          location: { where: { isAdjacent: ['at', 'pieceId'] }, label: 'Where does the settler go ashore?' } },
        { op: 'abortIf', cond: { not: { varSet: 'founded' } }, message: 'No room to settle here' },
        { op: 'addCargo', piece: 'pieceId', key: 'settler', amount: -1 },
      ],
    },
  ],
  triggers: [islandBonus],
};

describe('Explorers & Pirates primitives: ship carrying a settler', () => {
  const def = withMods(explorers);
  it('validates', () => {
    expect(validateMod(explorers, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('loads a settler at home, sails to another island, settles there and earns the island bonus', () => {
    let s = place(def, start(def, 'archipelago'), 'settlement', 'p1', C[0]);
    const dock = topology.vertexEdges(C[0]).find((e) => topology.edgeHexes(e).some((h) => topology.hexId(h) === 'h:0,-1'))!;
    s = place(def, s, 'ship', 'p1', dock);
    s = give(s, 'p1', { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const ship = s.pieces.find((p) => p.type === 'ship')!;
    s = doAction(def, s, 'loadSettler', ship.id);
    expect(s.pieces.find((p) => p.id === ship.id)!.cargo).toEqual({ settler: 1 });
    expect(getAvailableMoves(def, s, 'p1').actions.find((a) => a.action.id === 'loadSettler')?.enabled).toBe(false);

    s = doAction(def, s, 'sail', ship.id);
    const target = s.prompts[0].options.find((e) => topology.edgeHexes(e).some((h) => topology.hexId(h) === 'h:-2,1'))!;
    expect(target).toBeTruthy();
    s = respond(def, s, target);
    expect(s.pieces.find((p) => p.id === ship.id)).toMatchObject({ at: target, cargo: { settler: 1 } });

    const before = vp(def, s, 'p1');
    s = doAction(def, s, 'foundSettlement', ship.id);
    expect(s.prompts[0].options.every((v) => topology.edgeVertices(target).includes(v))).toBe(true);
    s = respond(def, s, s.prompts[0].options[0]);
    expect(vp(def, s, 'p1')).toBe(before + 1 + 2); // settlement + new-island bonus
    expect(s.pieces.find((p) => p.id === ship.id)!.cargo).toBeUndefined();
  });
});

/* ======================================================================== */
/*  General: bots still finish games with the new vocabulary loaded         */
/* ======================================================================== */

describe('bots with expansion-style mods', () => {
  it('C&K-style triggers (event die, barbarians, metropolis, aqueduct) do not break full games', () => {
    const ck = withMods({ ...citiesKnights, setup: baseMod.setup, actions: [], pieces: citiesKnights.pieces!.map((p): PieceDef => ({ ...p, pieceActions: [] })) });
    const { state } = simulate(ck, newGame(21, 3, ck), 7, 300);
    expect(state.turn).toBeGreaterThan(5);
  });
});
