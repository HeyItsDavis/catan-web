import { describe, expect, it } from 'vitest';
import {
  buildDefinition, getAvailableMoves, topology, validateMod,
  type Command, type GameDefinition, type GameState,
} from '../../engine';
import { baseMod } from '../base';
import { mod as seafarers } from '../expansions/seafarers';
import { mod as fogMod } from '../expansions/seafarers-fog-islands';
import { mod as fiveSix } from '../expansions/five-six';
import { addWithDependencies, builtinMods, removeWithDependents } from '../builtins';
import {
  act, botMove, botTradeRound, cur, edit, give, mulberry, newGame, place, type Rand,
} from '../../engine/__tests__/helpers';

const def = buildDefinition([baseMod, seafarers]);
const fogDef = buildDefinition([baseMod, seafarers, fogMod]);

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const respond = (d: GameDefinition, s: GameState, a: string | null) =>
  act(d, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const hexesOfEdge = (e: string) => topology.edgeHexes(e).map(topology.hexId);

/** A main-phase board for unit tests: setup skipped, nothing placed. */
function board(d: GameDefinition, mapId: string, seed = 3): GameState {
  return edit(newGame(seed, 2, d, { mapId }), (c) => {
    c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; c.setupProgress = undefined;
    delete c.setupProgress; c.turn = 2; c.currentPlayerIndex = 0;
  });
}

/** A coastal corner of a land hex: touches the hex, and the given sea neighbour. */
function coastCorner(land: string, sea: string): string {
  const c = topology.hexCorners(topology.parseHexId(land));
  return c.find((v) => topology.vertexHexes(v).map(topology.hexId).includes(sea))!;
}

function firstCoastalLand(s: GameState, tag?: string) {
  for (const h of Object.values(s.hexes)) {
    if (h.terrain === 'sea' || !h.revealed) continue;
    if (tag !== undefined && !(h.tags ?? []).includes(tag)) continue;
    if (tag === undefined && h.tags?.length) continue;
    const sea = topology.hexNeighbors(h.coord).map(topology.hexId).find((n) => s.hexes[n]?.terrain === 'sea');
    if (sea) return { land: h.id, sea };
  }
  throw new Error('no coastal land');
}

/* ------------------------------------------------------------------------ */

describe('Seafarers: content', () => {
  it('validates with no errors (and the Fog Islands scenario on top of it)', () => {
    expect(validateMod(seafarers, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
    expect(validateMod(fogMod, [baseMod, seafarers]).filter((p) => p.severity === 'error')).toEqual([]);
    expect(() => buildDefinition([baseMod, fiveSix, seafarers])).not.toThrow();
    expect(() => buildDefinition([baseMod, seafarers, fiveSix, fogMod])).not.toThrow();
    expect(builtinMods.map((m) => m.meta.id)).toEqual(expect.arrayContaining(['seafarers', 'seafarers-fog-islands', 'five-six']));
  });

  it('adding a scenario brings Seafarers along; removing Seafarers drops the scenario', () => {
    const list = addWithDependencies([fiveSix], fogMod);
    expect(list.map((m) => m.meta.id)).toEqual(['five-six', 'seafarers', 'seafarers-fog-islands']);
    expect(addWithDependencies(list, fogMod).map((m) => m.meta.id)).toEqual(['five-six', 'seafarers', 'seafarers-fog-islands']);
    expect(removeWithDependents(list, 'seafarers').map((m) => m.meta.id)).toEqual(['five-six']);
    expect(fogDef.victoryPoints).toBe(12);
    expect(fogDef.maps.map((m) => m.id)).toEqual(['seafarers-fog-islands']);
    expect(fogDef.triggers.some((t) => t.id === 'new-island-bonus')).toBe(false);
  });

  it('maps: Heading for New Shores has a home island, foreign islands and a gold field', () => {
    const s = newGame(1, 4, def, { mapId: 'seafarers-new-shores' });
    const land = Object.values(s.hexes).filter((h) => h.terrain !== 'sea');
    expect(land.filter((h) => !h.tags)).toHaveLength(19);
    expect(land.filter((h) => h.tags?.includes('foreign'))).toHaveLength(10);
    expect(land.filter((h) => h.terrain === 'gold').length).toBeGreaterThanOrEqual(2);
    expect(s.ports).toHaveLength(9);
    expect(s.tokens.robber).toBeTruthy();
    expect(s.tokens.pirate).toBeNull();
    const four = newGame(1, 4, def, { mapId: 'seafarers-four-islands' });
    expect(Object.values(four.hexes).filter((h) => h.terrain !== 'sea')).toHaveLength(28);
    const big = newGame(1, 6, def, { mapId: 'seafarers-new-shores-56', maxPlayers: 6 });
    expect(Object.values(big.hexes).filter((h) => h.terrain !== 'sea' && !h.tags)).toHaveLength(30);
    const fog = newGame(1, 3, fogDef, { mapId: 'seafarers-fog-islands' });
    expect(Object.values(fog.hexes).filter((h) => !h.revealed)).toHaveLength(24);
  });
});

describe('Seafarers: rules', () => {
  it('setup: no start on foreign islands; each settlement comes with a road or a ship', () => {
    let s = newGame(4, 3, def, { mapId: 'seafarers-new-shores' });
    const opts = s.prompts[0].options;
    const touchesForeign = (v: string) => topology.vertexHexes(v).map(topology.hexId).some((h) => s.hexes[h]?.tags?.includes('foreign'));
    expect(opts.some(touchesForeign)).toBe(false);
    // pick a coastal corner so the ship option is offered
    const coastal = opts.find((v) => topology.vertexHexes(v).map(topology.hexId).some((h) => !s.hexes[h] || s.hexes[h].terrain === 'sea'))!;
    s = respond(def, s, coastal);
    expect(s.prompts[0]).toMatchObject({ kind: 'option', optionLabels: ['Place a road', 'Place a ship'] });
    s = respond(def, s, '1');
    expect(s.prompts[0].piece).toBe('ship');
    expect(s.prompts[0].options.every((e) => topology.edgeVertices(e).includes(coastal))).toBe(true);
    s = respond(def, s, s.prompts[0].options[0]);
    expect(s.pieces.filter((p) => p.type === 'ship')).toHaveLength(1);
    expect(s.setupProgress?.playerIndex).toBe(1);
    // an inland settlement only offers the road
    const inland = s.prompts[0].options.find((v) => topology.vertexHexes(v).map(topology.hexId).every((h) => s.hexes[h] && s.hexes[h].terrain !== 'sea'))!;
    s = respond(def, s, inland);
    expect(s.prompts[0].optionLabels).toEqual(['Place a road']);
    s = respond(def, s, '0');
    expect(s.prompts[0].piece).toBe('road');
  });

  it('ships: built from a coastal settlement, chain from ships, roads never continue from a ship', () => {
    let s = board(def, 'seafarers-new-shores');
    const { land, sea } = firstCoastalLand(s);
    const v = coastCorner(land, sea);
    s = place(def, s, 'settlement', 'p1', v);
    s = give(s, 'p1', { lumber: 3, wool: 2, brick: 1 });
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    const e1 = s.prompts[0].options.find((e) => hexesOfEdge(e).includes(sea))!;
    s = respond(def, s, e1);
    const x = topology.edgeVertices(e1).find((w) => w !== v)!;
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    expect(s.prompts[0].options.some((e) => topology.edgeVertices(e).includes(x))).toBe(true);
    s = respond(def, s, s.prompts[0].options.find((e) => e !== e1 && topology.edgeVertices(e).includes(x))!);
    s = act(def, s, 'p1', { type: 'build', piece: 'road' });
    expect(s.prompts[0].options.some((e) => topology.edgeVertices(e).includes(x))).toBe(false);
  });

  it('moving a ship: open end only, not the turn it was built, once per turn, not next to the pirate', () => {
    let s = board(def, 'seafarers-new-shores');
    const { land, sea } = firstCoastalLand(s);
    const v = coastCorner(land, sea);
    s = place(def, s, 'settlement', 'p1', v);
    s = give(s, 'p1', { lumber: 2, wool: 2 });
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    const e1 = s.prompts[0].options.find((e) => hexesOfEdge(e).includes(sea))!;
    s = respond(def, s, e1);
    const x = topology.edgeVertices(e1).find((w) => w !== v)!;
    s = act(def, s, 'p1', { type: 'build', piece: 'ship' });
    const e2 = s.prompts[0].options.find((e) => e !== e1 && topology.edgeVertices(e).includes(x))!;
    s = respond(def, s, e2);
    const ship2 = s.pieces.find((p) => p.at === e2)!;
    const moveOf = (st: GameState, id: string) => getAvailableMoves(def, st, 'p1').actions.find((a) => a.action.id === 'moveShip' && a.pieceId === id);
    expect(moveOf(s, ship2.id)?.enabled).toBe(false); // built this turn
    s = edit(s, (c) => { for (const p of c.pieces) p.state.fresh = 0; });
    const ship1 = s.pieces.find((p) => p.at === e1)!;
    expect(moveOf(s, ship1.id)?.enabled).toBe(false); // not an open end
    expect(moveOf(s, ship2.id)?.enabled).toBe(true);
    const pirateHex = hexesOfEdge(e2).find((h) => s.hexes[h]?.terrain === 'sea')!;
    expect(moveOf(edit(s, (c) => { c.tokens.pirate = pirateHex; }), ship2.id)?.enabled).toBe(false);
    s = act(def, s, 'p1', { type: 'doAction', action: 'moveShip', pieceId: ship2.id });
    expect(s.prompts[0].options).not.toContain(e2);
    s = respond(def, s, s.prompts[0].options[0]);
    expect(s.pieces.find((p) => p.id === ship2.id)!.at).not.toBe(e2);
    expect(moveOf(s, ship2.id)?.enabled).toBe(false); // once per turn
  });

  it('on a 7 the roller chooses robber or pirate; the pirate robs a player with a ship next to it', () => {
    let s = board(def, 'seafarers-new-shores');
    const { land, sea } = firstCoastalLand(s);
    const v = coastCorner(land, sea);
    s = place(def, s, 'settlement', 'p2', v);
    const edge = topology.vertexEdges(v).find((e) => hexesOfEdge(e).includes(sea))!;
    s = place(def, s, 'ship', 'p2', edge);
    s = give(s, 'p2', { ore: 1 });
    s = edit(s, (c) => { c.phase = 'preRoll'; c.hasRolled = false; });
    // force a 7 by retrying seeds of the rng state
    let rolled: GameState | null = null;
    for (let k = 0; k < 200 && !rolled; k++) {
      const t = act(def, edit(s, (c) => { c.rngState = 1000 + k; }), 'p1', { type: 'rollDice' });
      if (t.lastRoll?.total === 7) rolled = t;
    }
    s = rolled!;
    expect(s.prompts[0]).toMatchObject({ player: 'p1', kind: 'option', optionLabels: ['Move the robber', 'Move the pirate'] });
    s = respond(def, s, '1');
    expect(s.prompts[0].options.every((h) => s.hexes[h].terrain === 'sea')).toBe(true);
    s = respond(def, s, sea);
    expect(s.tokens.pirate).toBe(sea);
    expect(s.prompts[0]).toMatchObject({ player: 'p1', options: ['p2'] });
    s = respond(def, s, 'p2');
    expect(P(s, 'p1').resources.ore).toBe(1);
    // ships can't be built next to the pirate
    s = give(s, 'p2', { lumber: 1, wool: 1 });
    const blocked = new Set(topology.hexEdges(topology.parseHexId(sea)));
    s = edit(s, (c) => { c.currentPlayerIndex = 1; });
    const m = getAvailableMoves(def, s, 'p2');
    if (m.builds.find((b) => b.piece.id === 'ship')?.hasSpot) {
      s = act(def, s, 'p2', { type: 'build', piece: 'ship' });
      expect(s.prompts[0].options.some((e) => blocked.has(e))).toBe(false);
    }
  });

  it('gold field: the owner picks a resource', () => {
    let s = board(def, 'seafarers-new-shores');
    const gold = Object.values(s.hexes).find((h) => h.terrain === 'gold')!;
    s = edit(s, (c) => { c.hexes[gold.id].number = 4; for (const h of Object.values(c.hexes)) if (h.id !== gold.id && h.number === 4) h.number = null; });
    s = place(def, s, 'settlement', 'p2', topology.hexCorners(gold.coord)[0]);
    s = edit(s, (c) => { c.phase = 'preRoll'; c.hasRolled = false; });
    let rolled: GameState | null = null;
    for (let k = 0; k < 300 && !rolled; k++) {
      const t = act(def, edit(s, (c) => { c.rngState = 5000 + k; }), 'p1', { type: 'rollDice' });
      if (t.lastRoll?.total === 4) rolled = t;
    }
    s = rolled!;
    expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'resource' });
    s = respond(def, s, 'ore');
    expect(P(s, 'p2').resources.ore).toBe(1);
  });

  it('new island: the first settlement on an island without your buildings scores the bonus', () => {
    let s = board(def, 'seafarers-new-shores');
    const home = firstCoastalLand(s);
    s = place(def, s, 'settlement', 'p1', coastCorner(home.land, home.sea));
    const away = firstCoastalLand(s, 'foreign');
    const v = coastCorner(away.land, away.sea);
    const e = topology.vertexEdges(v).find((x) => hexesOfEdge(x).includes(away.sea))!;
    s = place(def, s, 'ship', 'p1', e);
    s = give(s, 'p1', { brick: 2, lumber: 2, wool: 2, grain: 2 });
    s = act(def, s, 'p1', { type: 'build', piece: 'settlement' });
    expect(s.prompts[0].options).toContain(v);
    s = respond(def, s, v);
    expect(P(s, 'p1').tokenVP).toBe(2);
  });

  it('fog: building next to a face-down hex turns it over; land pays a resource', () => {
    let s = board(fogDef, 'seafarers-fog-islands');
    // make every fog hex land (forest) so the discovery always pays
    s = edit(s, (c) => { for (const h of Object.values(c.hexes)) if (!h.revealed) h.terrain = 'forest'; });
    // a face-down hex beside open sea; a ship one step away from the edge between them
    const hidden = Object.values(s.hexes).find((h) => !h.revealed)!;
    const seaN = topology.hexNeighbors(hidden.coord).map(topology.hexId).find((n) => s.hexes[n]?.revealed && s.hexes[n].terrain === 'sea')!;
    const shared = topology.hexEdges(hidden.coord).find((e) => hexesOfEdge(e).includes(seaN))!;
    const [a] = topology.edgeVertices(shared);
    const feeder = topology.vertexEdges(a).find((e) => e !== shared && hexesOfEdge(e).every((h) => s.hexes[h]?.revealed !== false))!;
    expect(feeder).toBeTruthy();
    s = place(fogDef, s, 'ship', 'p1', feeder);
    expect(s.hexes[hidden.id].revealed).toBe(false);
    s = give(s, 'p1', { lumber: 1, wool: 1 });
    const before = P(s, 'p1').resources.lumber;
    s = act(fogDef, s, 'p1', { type: 'build', piece: 'ship' });
    expect(s.prompts[0].options).toContain(shared);
    s = respond(fogDef, s, shared);
    expect(s.hexes[hidden.id].revealed).toBe(true);
    expect(P(s, 'p1').resources.lumber).toBe(before); // paid 1 for the ship, found 1 in the forest
    expect(s.log.some((l) => l.text.includes('discovers land'))).toBe(true);
  });

  it('Longest Trade Route: roads and ships count together only through your own settlement', () => {
    let s = board(def, 'seafarers-new-shores');
    const { land, sea } = firstCoastalLand(s);
    const v = coastCorner(land, sea);
    const isLand = (h: string) => !!s.hexes[h] && s.hexes[h].terrain !== 'sea';
    const roadOk = (e: string) => hexesOfEdge(e).some(isLand);
    const shipOk = (e: string) => hexesOfEdge(e).filter((h) => s.hexes[h]).length < 2 || hexesOfEdge(e).some((h) => s.hexes[h]?.terrain === 'sea');
    const used = new Set<string>();
    const seen = new Set<string>([v]);
    const grow = (n: number, ok: (e: string) => boolean, prefer: (e: string) => boolean): string[] => {
      const out: string[] = [];
      let at = v;
      for (let i = 0; i < n; i++) {
        const free = topology.vertexEdges(at).filter((x) => !used.has(x) && ok(x) && !seen.has(topology.edgeVertices(x).find((w) => w !== at)!));
        const e = free.find(prefer) ?? free[0];
        used.add(e); out.push(e);
        at = topology.edgeVertices(e).find((w) => w !== at)!;
        seen.add(at);
      }
      return out;
    };
    const ships = grow(3, shipOk, (e) => !roadOk(e));
    const roads = grow(2, roadOk, (e) => !shipOk(e));
    for (const e of ships) s = place(def, s, 'ship', 'p1', e);
    for (const e of roads) s = place(def, s, 'road', 'p1', e);
    const award = (st: GameState) => {
      st = give(st, 'p1', { brick: 1, lumber: 1 });
      st = act(def, st, 'p1', { type: 'build', piece: 'road' });
      return respond(def, st, null).awards.longestRoad;
    };
    expect(award(s)).toBeNull(); // 3 ships and 2 roads meet at an empty corner: they don't join
    expect(award(place(def, s, 'settlement', 'p1', v))).toBe('p1'); // joined by a settlement: 5
  });
});

/* ------------------------------ simulations ------------------------------ */

/** Rough board position of a location (average of the hexes it touches). */
function spotXY(loc: string): [number, number] {
  const hs = loc.startsWith('v:') ? topology.vertexHexes(loc) : topology.edgeHexes(loc);
  const q = hs.reduce((a, h) => a + h.q, 0) / hs.length;
  const r = hs.reduce((a, h) => a + h.r, 0) / hs.length;
  return [q + r / 2, r * 0.866];
}

/** Island number of every land hex (hexes joined by sides). */
function islands(s: GameState): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const h of Object.values(s.hexes)) {
    if (h.terrain === 'sea' || out.has(h.id)) continue;
    const stack = [h.id];
    out.set(h.id, ++n);
    while (stack.length) {
      for (const nb of topology.hexNeighbors(topology.parseHexId(stack.pop()!)).map(topology.hexId)) {
        if (!s.hexes[nb] || s.hexes[nb].terrain === 'sea' || out.has(nb)) continue;
        out.set(nb, n);
        stack.push(nb);
      }
    }
  }
  return out;
}

/** Explorer instinct: spots touching an island where the player has no building yet, else far away. */
function farthest(s: GameState, pid: string, options: string[]): string {
  const mine = s.pieces.filter((p) => p.owner === pid && p.at.startsWith('v:'));
  if (!mine.length) return options[0];
  const isl = islands(s);
  const hexesAt = (loc: string) => (loc.startsWith('v:') ? topology.vertexHexes(loc) : topology.edgeHexes(loc)).map(topology.hexId);
  const settled = new Set<number | undefined>(mine.flatMap((p) => hexesAt(p.at)).map((h) => isl.get(h)).filter((x) => x !== undefined));
  const isTarget = (h: string) => (isl.has(h) && !settled.has(isl.get(h))) || s.hexes[h]?.revealed === false;
  const targets = Object.keys(s.hexes).filter(isTarget).map((h) => spotXY(`v:${h.slice(2)},N`));
  const home = mine.map((p) => spotXY(p.at));
  const d2 = ([x, y]: [number, number], pts: [number, number][]) => Math.min(...pts.map(([a, b]) => (a - x) ** 2 + (b - y) ** 2));
  const score = (o: string) => {
    if (hexesAt(o).some(isTarget)) return 1000;
    return targets.length ? -d2(spotXY(o), targets) : d2(spotXY(o), home);
  };
  return options.reduce((best, o) => (score(o) > score(best) ? o : best), options[0]);
}

/** The test bot, plus ships: sometimes builds a ship, sometimes moves one, and likes to explore. */
function seaBot(d: GameDefinition, s: GameState, rnd: Rand): [string, Command] {
  const pr = s.prompts[0];
  if (pr && s.phase !== 'setup' && pr.kind === 'location' && (pr.piece === 'ship' || pr.piece === 'settlement') && pr.options.length && rnd() < 0.8) {
    return [pr.player, { type: 'respond', promptId: pr.id, answer: farthest(s, pr.player, pr.options) }];
  }
  if (!s.prompts.length && (s.phase === 'main' || s.phase === 'specialBuild')) {
    const pid = cur(s);
    const m = getAvailableMoves(d, s, pid);
    const ok = (id: string) => m.builds.some((b) => b.piece.id === id && b.affordable && b.hasSpot);
    if (!ok('city') && !ok('settlement') && ok('ship') && rnd() < 0.6) return [pid, { type: 'build', piece: 'ship' }];
    const mv = m.actions.filter((a) => a.action.id === 'moveShip' && a.enabled);
    if (mv.length && rnd() < 0.15) return [pid, { type: 'doAction', action: 'moveShip', pieceId: mv[Math.floor(rnd() * mv.length)].pieceId }];
  }
  return botMove(d, s, rnd);
}

function simulateSea(d: GameDefinition, s: GameState, seed: number, maxTurns: number) {
  const rnd = mulberry(seed);
  let n = 0;
  while (!s.winner && s.turn <= maxTurns) {
    if (s.phase === 'main' && !s.prompts.length && !s.stack.length && rnd() < 0.05) s = botTradeRound(d, s, rnd);
    const [pid, cmd] = seaBot(d, s, rnd);
    s = act(d, s, pid, cmd);
    if (++n > 200_000) throw new Error('too many commands');
  }
  return s;
}

function conserved(d: GameDefinition, s: GameState) {
  for (const r of d.resources) {
    const total = s.bank[r.id] + s.players.reduce((a, p) => a + (p.resources[r.id] ?? 0), 0);
    expect(total, `resource ${r.id} conserved`).toBe(r.bankSupply);
  }
}

describe('Seafarers: bots play full games', () => {
  const big = buildDefinition([baseMod, fiveSix, seafarers]);
  const cases: [string, GameDefinition, string, number, number][] = [
    ['Heading for New Shores', def, 'seafarers-new-shores', 3, 1],
    ['Heading for New Shores', def, 'seafarers-new-shores', 4, 2],
    ['The Four Islands', def, 'seafarers-four-islands', 3, 3],
    ['The Four Islands', def, 'seafarers-four-islands', 4, 4],
    ['The Fog Islands', fogDef, 'seafarers-fog-islands', 3, 5],
    ['The Fog Islands', fogDef, 'seafarers-fog-islands', 4, 6],
    ['Heading for New Shores 5-6 (with the 5-6 extension)', big, 'seafarers-new-shores-56', 5, 7],
  ];
  for (const [name, d, mapId, n, seed] of cases) {
    it(`${name}: ${n} bots, seed ${seed}`, () => {
      // played to 10 VP to keep the suite fast; the scenario targets are 12-14
      const start = newGame(seed, n, d, { mapId, maxPlayers: Math.max(4, n), victoryPoints: 10 });
      const s = simulateSea(d, start, seed * 7919, 900);
      expect(s.winner, `no winner after ${s.turn} turns`).toBeTruthy();
      expect(s.pieces.some((p) => p.type === 'ship')).toBe(true);
      conserved(d, s);
      expect(s.log.some((l) => l.text.includes('moves the Pirate'))).toBe(true);
      if (mapId === 'seafarers-fog-islands') {
        expect(Object.values(s.hexes).filter((h) => !h.revealed).length).toBeLessThan(24);
        expect(s.log.some((l) => l.text.includes('discovers land'))).toBe(true);
      }
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }, 120_000);
  }
});
