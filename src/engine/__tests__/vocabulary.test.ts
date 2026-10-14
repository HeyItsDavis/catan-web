/**
 * Unit tests for the generic building blocks added for the expansions: piece ids, piece state
 * exprs, PieceQuery state/where/region, chooseMany, downgrade, ranged movePiece, cargo,
 * isNetworkEnd, hasToken.near, regions, playerProduction, award modes, mixed-network routes.
 */
import { describe, expect, it } from 'vitest';
import { topology, validateMod, type Effect, type GameDefinition, type GameState, type MapDef, type ModDef, type PieceDef } from '../index';
import { baseMod } from '../../content/base';
import { act, answer, cur, edit, give, newGame, place, withMods } from './helpers';

const wagon: PieceDef = {
  id: 'wagon', name: 'Wagon', supply: 4, tags: ['wagon'],
  placement: { on: 'vertex', where: { not: { occupied: { at: 'at' } } } },
};
const knight: PieceDef = {
  id: 'knight', name: 'Knight', supply: 6, tags: ['knight'], initialState: { active: 0, strength: 1 },
  placement: { on: 'vertex', where: { not: { occupied: { at: 'at' } } } },
};

const mod = (actions: Record<string, Effect[]>, extra: Partial<ModDef> = {}): ModDef => ({
  meta: { id: 'v', name: 'v', version: '1', extends: ['base'] },
  setup: [],
  pieces: [wagon, knight, ...(extra.pieces ?? [])],
  actions: Object.entries(actions).map(([id, effect]) => ({ id, name: id, available: true, effect })),
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'pieces')),
});

function game(actions: Record<string, Effect[]>, extra: Partial<ModDef> = {}, over = {}): { def: GameDefinition; s: GameState } {
  const def = withMods(mod(actions, extra));
  const s = edit(newGame(5, 3, def, over), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; });
  return { def, s };
}

const run = (def: GameDefinition, s: GameState, id = 't') => act(def, s, cur(s), { type: 'doAction', action: id });
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const respond = (def: GameDefinition, s: GameState, a: string | null) =>
  act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });

const C = topology.hexCorners({ q: 0, r: 0 });
const E = topology.hexEdges({ q: 0, r: 0 });

describe('piece ids, piece state and piece queries', () => {
  it('place asId + setPieceState/pieceState by id', () => {
    const { def, s } = game({ t: [
      { op: 'place', piece: 'knight', free: true, asId: 'k', as: 'spot' },
      { op: 'setPieceState', at: 'k', key: 'strength', value: 3 },
      { op: 'setStat', key: 'read', value: { pieceState: { piece: 'k', key: 'strength' } } },
      { op: 'setStat', key: 'readLoc', value: { pieceState: { piece: 'spot', key: 'strength' } } },
    ] });
    let s2 = run(def, s);
    s2 = answer(def, s2);
    expect(P(s2, 'p1').stats).toMatchObject({ read: 3, readLoc: 3 });
    expect(s2.pieces[0].state.strength).toBe(3);
  });

  it('sumPieceState over a query with state filter', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'setStat', key: 'str', value: { sumPieceState: { query: { tag: 'knight', owner: 'self', state: { active: 1 } }, key: 'strength' } } },
    ] });
    let s = place(def, s0, 'knight', 'p1', C[0]);
    s = place(def, s, 'knight', 'p1', C[2]);
    s = place(def, s, 'knight', 'p1', C[4]);
    s = place(def, s, 'knight', 'p2', C[1]);
    s = edit(s, (c) => {
      c.pieces[0].state = { active: 1, strength: 2 };
      c.pieces[1].state = { active: 1, strength: 3 };
      c.pieces[3].state = { active: 1, strength: 3 };
    });
    expect(P(run(def, s), 'p1').stats.str).toBe(5);
  });

  it('PieceQuery.where sees candidate / candidateId (friendly-robber style owner test)', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'setStat', key: 'n', value: { pieceCount: { tag: 'knight', where: { cmp: [{ vp: { ownerOf: 'candidateId' } }, '>', 2] } } } },
    ] });
    let s = place(def, s0, 'knight', 'p1', C[0]);
    s = place(def, s, 'knight', 'p2', C[2]);
    s = place(def, s, 'knight', 'p2', C[4]);
    s = edit(s, (c) => { P(c, 'p2').tokenVP = 3; });
    expect(P(run(def, s), 'p1').stats.n).toBe(2);
  });

  it('forEachPiece asId iterates piece instances (even two on one spot)', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'forEachPiece', query: { piece: 'wagon', owner: 'self' }, as: 'loc', asId: 'wid', do: [{ op: 'addCargo', piece: 'wid', key: 'x', amount: 1 }] },
    ] });
    let s = place(def, s0, 'wagon', 'p1', C[0]);
    s = place(def, s, 'wagon', 'p1', C[0]);
    const s2 = run(def, s);
    expect(s2.pieces.map((p) => p.cargo)).toEqual([{ x: 1 }, { x: 1 }]);
  });
});

describe('chooseMany', () => {
  it('picks distinct players, may stop after min, runs do per pick, binds countAs', () => {
    const { def, s } = game({ t: [
      { op: 'chooseMany', of: 'player', count: 2, min: 1, as: 'pick', countAs: 'n',
        do: [{ op: 'addStat', player: { var: 'pick' }, key: 'picked', amount: 1 }] },
      { op: 'setStat', key: 'n', value: { var: 'n' } },
    ] });
    let s2 = run(def, s);
    expect(s2.prompts[0]).toMatchObject({ kind: 'player', options: ['p2', 'p3'] });
    expect(s2.prompts[0].optional).toBeUndefined();
    s2 = respond(def, s2, 'p3');
    expect(s2.prompts[0]).toMatchObject({ options: ['p2'], optional: true });
    s2 = respond(def, s2, null);
    expect(P(s2, 'p3').stats.picked).toBe(1);
    expect(P(s2, 'p2').stats.picked).toBeUndefined();
    expect(P(s2, 'p1').stats.n).toBe(1);
    expect(s2.stack).toEqual([]);
  });

  it('picks distinct resource types', () => {
    const { def, s } = game({ t: [
      { op: 'chooseMany', of: 'resource', count: 2, as: 'r', options: ['ore', 'wool', 'grain'],
        do: [{ op: 'transfer', from: 'bank', to: 'self', resource: { var: 'r' }, amount: 1 }] },
    ] });
    let s2 = run(def, s);
    s2 = respond(def, s2, 'ore');
    expect(s2.prompts[0].options).toEqual(['wool', 'grain']);
    s2 = respond(def, s2, 'wool');
    expect(P(s2, 'p1').resources).toMatchObject({ ore: 1, wool: 1, grain: 0 });
  });

  it('picks pieces (binds their location) and locations with a filter', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'chooseMany', of: 'piece', count: 5, as: 'w', query: { piece: 'wagon' },
        do: [{ op: 'remove', query: { piece: 'wagon' }, location: { at: 'w' } }] },
    ] });
    let s = place(def, s0, 'wagon', 'p2', C[0]);
    s = place(def, s, 'wagon', 'p3', C[3]);
    let s2 = run(def, s);
    expect(s2.prompts[0].kind).toBe('piece');
    s2 = respond(def, s2, C[3]);
    s2 = respond(def, s2, C[0]);
    expect(s2.pieces).toEqual([]);
  });
});

describe('downgrade', () => {
  it('replaces a city with a settlement (owner chooses) and fires pieceDowngraded', () => {
    const { def, s: s0 } = game({ t: [{ op: 'downgrade', from: 'city', to: 'settlement', player: { var: 'victim' } }] }, {
      actions: [{ id: 't', name: 't', available: true, effect: [
        { op: 'choosePlayer', as: 'victim', filter: { samePlayer: [{ var: 'victim' }, { var: 'victim' }] } },
        { op: 'downgrade', from: 'city', to: 'settlement', player: { var: 'victim' }, asId: 'd' },
        { op: 'setStat', key: 'state', value: { pieceState: { piece: 'd', key: 'missing' } } },
      ] }],
      triggers: [{ id: 'dg', on: 'pieceDowngraded', as: 'eventPlayer', do: [{ op: 'addStat', key: 'downgraded', amount: 1 }] }],
    });
    const s = place(def, s0, 'city', 'p2', C[0]);
    let s2 = run(def, s);
    s2 = respond(def, s2, 'p2');
    expect(s2.prompts[0]).toMatchObject({ player: 'p2', kind: 'piece', options: [C[0]] });
    s2 = respond(def, s2, C[0]);
    expect(s2.pieces).toEqual([expect.objectContaining({ type: 'settlement', owner: 'p2', at: C[0] })]);
    expect(P(s2, 'p2').stats.downgraded).toBe(1);
  });

  it('removes the piece when the lesser piece is out of supply', () => {
    const { def, s: s0 } = game({ t: [{ op: 'downgrade', from: 'city', to: 'settlement', location: { at: 'spot' } }] }, {
      actions: [{ id: 't', name: 't', available: true, effect: [
        { op: 'choosePiece', as: 'spot', query: { piece: 'city', owner: 'self' } },
        { op: 'downgrade', from: 'city', to: 'settlement', location: { at: 'spot' } },
      ] }],
    });
    let s = place(def, s0, 'city', 'p1', C[0]);
    for (const v of topology.hexCorners({ q: 1, r: 0 }).slice(0, 5)) s = place(def, s, 'settlement', 'p1', v);
    let s2 = run(def, s);
    s2 = respond(def, s2, C[0]);
    expect(s2.pieces.filter((p) => p.at === C[0])).toEqual([]);
  });
});

describe('movePiece: range, path, chooser, anywhere', () => {
  const along: Effect = {
    op: 'movePiece', query: { piece: 'wagon', owner: 'self' }, maxSteps: { var: 'range' }, stepsAs: 'st', as: 'to',
    path: { occupied: { at: 'via', piece: 'road', owner: 'self' } },
  };
  const setup = (range: number) => {
    const { def, s: s0 } = game({ t: [{ op: 'setVar', name: 'range', value: range }, along, { op: 'setStat', key: 'st', value: { var: 'st' } }] });
    let s = place(def, s0, 'wagon', 'p1', C[0]);
    s = place(def, s, 'road', 'p1', E[0]);
    s = place(def, s, 'road', 'p1', E[1]);
    s = place(def, s, 'road', 'p2', E[2]);
    return { def, s };
  };

  it('offers only spots reachable along own roads within range and binds steps', () => {
    const { def, s } = setup(2);
    let s2 = run(def, s);
    s2 = respond(def, s2, C[0]);
    expect([...s2.prompts[0].options].sort()).toEqual([C[1], C[2]].sort());
    s2 = respond(def, s2, C[2]);
    expect(s2.pieces.find((p) => p.type === 'wagon')!.at).toBe(C[2]);
    expect(P(s2, 'p1').stats.st).toBe(2);
    const { def: d1, s: t1 } = setup(1);
    expect(respond(d1, run(d1, t1), C[0]).prompts[0].options).toEqual([C[1]]);
  });

  it('player picks for someone else; anywhere skips placement rules', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'choosePiece', as: 'w', query: { piece: 'wagon', owner: 'others' } },
      { op: 'movePiece', query: { piece: 'wagon' }, from: { at: 'w' }, player: { ownerOf: 'w' }, anywhere: true, maxSteps: 1, as: 'to' },
    ] });
    let s = place(def, s0, 'wagon', 'p2', C[0]);
    s = place(def, s, 'knight', 'p3', C[1]); // occupied, but `anywhere` ignores the wagon's placement rule
    let s2 = run(def, s);
    s2 = respond(def, s2, C[0]);
    expect(s2.prompts[0].player).toBe('p2');
    expect(s2.prompts[0].options).toContain(C[1]);
    expect(s2.prompts[0].options).toHaveLength(3);
  });
});

describe('cargo', () => {
  it('load from hand (choice), add goods, read, unload, and return to bank on removal', () => {
    const { def, s: s0 } = game({
      t: [
        { op: 'choosePiece', as: 'w', asId: 'wid', query: { piece: 'wagon', owner: 'self' } },
        { op: 'loadCargo', piece: 'wid', resource: 'choice', amount: 2 },
        { op: 'loadCargo', piece: 'wid', resource: 'wool', amount: 5 },
        { op: 'addCargo', piece: 'wid', key: 'settler', amount: 1 },
        { op: 'setStat', key: 'all', value: { cargoCount: { piece: 'wid' } } },
        { op: 'setStat', key: 'ore', value: { cargoCount: { piece: 'w', key: 'ore' } } },
      ],
      u: [
        { op: 'choosePiece', as: 'w', query: { piece: 'wagon', owner: 'self' } },
        { op: 'unloadCargo', piece: 'w', resource: 'ore', amount: 1 },
        { op: 'unloadCargo', piece: 'w', to: 'bank' },
      ],
      r: [{ op: 'remove', query: { piece: 'wagon' } }],
    });
    let s = place(def, s0, 'wagon', 'p1', C[0]);
    s = give(s, 'p1', { ore: 3, wool: 1 });
    const bankOre = s.bank.ore;
    let s2 = run(def, s);
    s2 = respond(def, s2, C[0]);
    expect(s2.prompts[0]).toMatchObject({ kind: 'resource', options: ['wool', 'ore'] });
    s2 = respond(def, s2, 'ore');
    expect(P(s2, 'p1').stats).toMatchObject({ all: 4, ore: 2 });
    expect(P(s2, 'p1').resources).toMatchObject({ ore: 1, wool: 0 });
    expect(s2.pieces[0].cargo).toEqual({ ore: 2, wool: 1, settler: 1 });
    expect(s2.bank.ore).toBe(bankOre);

    let s3 = respond(def, run(def, s2, 'u'), C[0]);
    expect(P(s3, 'p1').resources.ore).toBe(2);
    expect(s3.pieces[0].cargo).toEqual({ settler: 1 });
    expect(s3.bank.ore).toBe(bankOre + 1);

    // removal returns resource cargo to the bank
    s3 = edit(s3, (c) => { c.pieces[0].cargo = { ore: 2 }; c.bank.ore -= 2; });
    const s4 = respond(def, run(def, s3, 'r'), C[0]);
    expect(s4.pieces).toEqual([]);
    expect(s4.bank.ore).toBe(bankOre + 1);
  });
});

describe('board conditions', () => {
  it('isNetworkEnd: only the loose ends of a route', () => {
    const { def, s: s0 } = game({ t: [{ op: 'chooseLocation', kind: 'edge', as: 'e', filter: { all: [{ occupied: { at: 'e' } }, { isNetworkEnd: { at: 'e' } }] } }] });
    let s = place(def, s0, 'road', 'p1', E[0]);
    s = place(def, s, 'road', 'p1', E[1]);
    s = place(def, s, 'road', 'p1', E[2]);
    expect([...run(def, s).prompts[0].options].sort()).toEqual([E[0], E[2]].sort());
    // an own building on the far end closes that end
    s = place(def, s, 'settlement', 'p1', C[0]);
    expect(run(def, s).prompts[0].options).toEqual([E[2]]);
  });

  it('hasToken near: the edges around the robber hex', () => {
    const { def, s: s0 } = game({ t: [{ op: 'chooseLocation', kind: 'edge', as: 'e', filter: { hasToken: { at: 'e', token: 'robber', near: true } } }] });
    const s = edit(s0, (c) => { c.tokens.robber = 'h:0,0'; });
    expect([...run(def, s).prompts[0].options].sort()).toEqual([...E].sort());
  });
});

describe('regions (islands)', () => {
  const isles: MapDef = {
    id: 'isles', name: 'Isles', minPlayers: 2, maxPlayers: 4,
    hexes: [
      { q: -2, r: 0, terrain: 'forest', number: 5 }, { q: -1, r: 0, terrain: 'hills', number: 6 },
      { q: 0, r: 0, terrain: 'sea' },
      { q: 1, r: 0, terrain: 'fields', number: 8 }, { q: 2, r: 0, terrain: 'pasture', number: 9 },
    ],
  };
  it('PieceQuery.region and sameRegion', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'chooseLocation', kind: 'hex', as: 'x', filter: { not: { isWater: { at: 'x' } } } },
      { op: 'setStat', key: 'n', value: { pieceCount: { owner: 'self', region: 'x' } } },
      { op: 'chooseLocation', kind: 'hex', as: 'y', filter: { sameRegion: ['y', 'x'] } },
    ] }, { maps: [isles] }, { mapId: 'isles' });
    let s = place(def, s0, 'settlement', 'p1', topology.hexCorners({ q: -2, r: 0 })[0]);
    s = place(def, s, 'settlement', 'p1', topology.hexCorners({ q: -1, r: 0 })[3]);
    s = place(def, s, 'settlement', 'p1', topology.hexCorners({ q: 2, r: 0 })[0]);
    let s2 = run(def, s);
    s2 = respond(def, s2, 'h:-2,0');
    expect(P(s2, 'p1').stats.n).toBe(2);
    expect([...s2.prompts[0].options].sort()).toEqual(['h:-1,0', 'h:-2,0']);
  });
});

describe('events, awards and networks', () => {
  it('playerProduction reports the amount per player (aqueduct: nothing received)', () => {
    const { def, s: s0 } = game({ t: [{ op: 'produce', roll: 5 }] }, {
      triggers: [
        { id: 'aq', on: 'playerProduction', as: 'eventPlayer', when: { cmp: [{ var: 'amount' }, '==', 0] }, do: [{ op: 'addStat', key: 'nothing', amount: 1 }] },
        { id: 'got', on: 'playerProduction', as: 'eventPlayer', do: [{ op: 'addStat', key: 'got', amount: { var: 'amount' } }] },
      ],
    });
    let s = edit(s0, (c) => {
      for (const h of Object.values(c.hexes)) if (h.number === 5) h.number = null;
      c.hexes['h:0,0'].terrain = 'forest';
      c.hexes['h:0,0'].number = 5;
      c.tokens.robber = null;
    });
    s = place(def, s, 'city', 'p1', C[0]);
    const s2 = run(def, s);
    expect(P(s2, 'p1').stats).toMatchObject({ got: 2 });
    expect(P(s2, 'p1').stats.nothing).toBeUndefined();
    expect(P(s2, 'p2').stats).toMatchObject({ nothing: 1, got: 0 });
    expect(P(s2, 'p3').stats).toMatchObject({ nothing: 1 });
  });

  it("AwardDef mode 'keepUntilBeaten'", () => {
    const { def, s: s0 } = game({ t: [] }, {
      awards: [{ id: 'metro', name: 'Metropolis', vp: 2, metric: { stat: { key: 'level' } }, min: 4, mode: 'keepUntilBeaten' }],
    });
    const lv = (s: GameState, l: Record<string, number>) => run(def, edit(s, (c) => { for (const [p, v] of Object.entries(l)) P(c, p).stats.level = v; }));
    let s = lv(s0, { p1: 4 });
    expect(s.awards.metro).toBe('p1');
    s = lv(s, { p2: 4 });
    expect(s.awards.metro).toBe('p1');
    s = lv(s, { p1: 0 }); // p2 (4) now strictly exceeds the holder (0)
    expect(s.awards.metro).toBe('p2');
    s = lv(s, { p2: 1 }); // below min but nobody qualifies to beat them: kept
    expect(s.awards.metro).toBe('p2');
    s = lv(s, { p3: 5 });
    expect(s.awards.metro).toBe('p3');
  });

  it('networkSwitchAt ownPiece: mixed road/ship routes only join at own buildings', () => {
    const ship = (strict: boolean): PieceDef => ({
      id: 'ship', name: 'Ship', supply: 15, network: 'roads', ...(strict ? { networkSwitchAt: 'ownPiece' as const } : {}),
      placement: { on: 'edge', where: true },
    });
    for (const strict of [true, false]) {
      const { def, s: s0 } = game({ t: [{ op: 'setStat', key: 'len', value: { longestRoad: 'self' } }] }, { pieces: [ship(strict)] });
      let s = place(def, s0, 'road', 'p1', E[0]);
      s = place(def, s, 'road', 'p1', E[1]);
      s = place(def, s, 'ship', 'p1', E[2]);
      s = place(def, s, 'ship', 'p1', E[3]);
      expect(P(run(def, s), 'p1').stats.len).toBe(strict ? 2 : 4);
      s = place(def, s, 'settlement', 'p1', C[2]);
      expect(P(run(def, s), 'p1').stats.len).toBe(4);
    }
  });
});

describe('forEachLocation and edge producers', () => {
  it('forEachLocation visits filtered locations (reveal fog next to a piece)', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'choosePiece', as: 'w', query: { piece: 'wagon', owner: 'self' } },
      { op: 'forEachLocation', kind: 'hex', as: 'h', filter: { isAdjacent: ['h', 'w'] }, do: [{ op: 'revealHex', at: 'h' }, { op: 'addStat', key: 'n', amount: 1 }] },
    ] });
    let s = place(def, s0, 'wagon', 'p1', C[0]);
    s = edit(s, (c) => { for (const h of Object.values(c.hexes)) h.revealed = false; });
    s = respond(def, run(def, s), C[0]);
    expect(P(s, 'p1').stats.n).toBe(3);
    expect(Object.values(s.hexes).filter((h) => h.revealed).map((h) => h.id).sort())
      .toEqual(topology.vertexHexes(C[0]).map(topology.hexId).sort());
  });

  it('an edge piece with productionMultiplier produces from its 2 hexes', () => {
    const mill: PieceDef = { id: 'mill', name: 'Mill', supply: 2, productionMultiplier: 1, placement: { on: 'edge', where: true } };
    const { def, s: s0 } = game({ t: [{ op: 'produce', roll: 5 }] }, { pieces: [mill] });
    let s = edit(s0, (c) => {
      for (const h of Object.values(c.hexes)) if (h.number === 5) h.number = null;
      c.hexes['h:0,0'].terrain = 'forest'; c.hexes['h:0,0'].number = 5;
      c.hexes['h:1,0'].terrain = 'hills'; c.hexes['h:1,0'].number = 5;
    });
    const shared = topology.hexEdges({ q: 0, r: 0 })[1]; // E side: between (0,0) and (1,0)
    s = place(def, s, 'mill', 'p1', shared);
    expect(P(run(def, s), 'p1').resources).toMatchObject({ lumber: 1, brick: 1 });
  });
});

describe('countPlayers and varIs', () => {
  it('counts players passing a filter; compares a var with an id', () => {
    const { def, s: s0 } = game({ t: [
      { op: 'setStat', key: 'rich', value: { countPlayers: { as: 'q', filter: { cmp: [{ resourceCount: { player: { var: 'q' } } }, '>=', 2] } } } },
      { op: 'setStat', key: 'all', value: { countPlayers: { as: 'q' } } },
    ] }, {
      triggers: [{ id: 'onlyCity', on: 'piecePlaced', as: 'eventPlayer', when: { varIs: { var: 'piece', value: 'city' } }, do: [{ op: 'addStat', key: 'cities', amount: 1 }] }],
    });
    let s = give(s0, 'p2', { ore: 2 });
    s = give(s, 'p3', { ore: 3 });
    expect(P(run(def, s), 'p1').stats).toMatchObject({ rich: 2, all: 3 });
    const d2 = withMods(mod({ t: [{ op: 'place', piece: 'settlement', free: true, ignoreConnection: true }, { op: 'place', piece: 'city', free: true }] }, {
      triggers: [{ id: 'onlyCity', on: 'piecePlaced', as: 'eventPlayer', when: { varIs: { var: 'piece', value: 'city' } }, do: [{ op: 'addStat', key: 'cities', amount: 1 }] }],
    }));
    let s2 = run(d2, s0);
    s2 = answer(d2, s2);
    expect(P(s2, 'p1').stats.cities).toBeUndefined();
    s2 = answer(d2, s2);
    expect(P(s2, 'p1').stats.cities).toBe(1);
  });
});

describe('validation knows the new vocabulary', () => {
  it('a mod using every new block validates without errors', () => {
    const m = mod({
      t: [
        { op: 'chooseMany', of: 'player', count: 2, as: 'pick', countAs: 'n', do: [{ op: 'addStat', player: { var: 'pick' }, key: 'x', amount: { var: 'n' } }] },
        { op: 'place', piece: 'wagon', free: true, asId: 'w' },
        { op: 'loadCargo', piece: 'w', resource: 'choice' },
        { op: 'unloadCargo', piece: 'w', resource: 'all' },
        { op: 'addCargo', piece: 'w', key: 'settler', amount: 1 },
        { op: 'movePiece', query: { piece: 'wagon' }, from: { at: 'w' }, maxSteps: 2, path: { occupied: { at: 'via' } }, stepsAs: 'st', asId: 'w2' },
        { op: 'setStat', key: 's', value: { add: [{ var: 'st' }, { cargoCount: { piece: 'w2' } }, { pieceState: { piece: 'w', key: 'a' } },
          { sumPieceState: { query: { state: { a: 1 }, region: 'w', where: { cmp: [{ vp: { ownerOf: 'candidateId' } }, '>', 2] } }, key: 'a' } }] } },
        { op: 'downgrade', from: 'city', to: 'settlement', asId: 'd' },
        { op: 'abortIf', cond: { any: [{ isNetworkEnd: { at: 'w' } }, { sameRegion: ['w', 'd'] }, { hasToken: { at: 'w', token: 'robber', near: true } }] } },
      ],
    }, {
      awards: [{ id: 'm', name: 'M', vp: 2, metric: 0, min: 1, mode: 'keepUntilBeaten' }],
      triggers: [{ id: 'pp', on: 'playerProduction', when: { cmp: [{ var: 'amount' }, '==', 0] }, do: [] }],
    });
    const problems = validateMod(m, [baseMod]);
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(problems.filter((p) => /not bound/.test(p.message))).toEqual([]);
  });
});
