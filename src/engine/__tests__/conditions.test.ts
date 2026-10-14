import { describe, expect, it } from 'vitest';
import type { Condition, Expr, GameState } from '../index';
import { topology } from '../index';
import { makeCtx } from '../context';
import { evalCond } from '../conditions';
import { evalExpr } from '../exprs';
import { baseDef, edit, finishSetup, give, newGame, place } from './helpers';

function board(): GameState {
  let s = finishSetup(baseDef, newGame(21, 3));
  s = edit(s, (c) => {
    c.pieces = [];
    c.phase = 'main';
    c.hasRolled = true;
    for (const p of c.players) for (const r of Object.keys(p.resources)) { c.bank[r] += p.resources[r]; p.resources[r] = 0; }
  });
  return s;
}

const centre = { q: 0, r: 0 };
const corners = topology.hexCorners(centre);
const edges = topology.hexEdges(centre);

function C(s: GameState, c: Condition, vars: Record<string, string | number> = {}, self = 'p1') {
  return evalCond(makeCtx(baseDef, s, true), { self, vars }, c);
}
function E(s: GameState, e: Expr, vars: Record<string, string | number> = {}, self = 'p1') {
  return evalExpr(makeCtx(baseDef, s, true), { self, vars }, e);
}

describe('conditions', () => {
  it('logic, cmp, phase, hasRolled, isTurnOf, samePlayer, varSet, setting', () => {
    const s = board();
    expect(C(s, { all: [true, { not: false }, { any: [false, true] }] })).toBe(true);
    expect(C(s, { cmp: [3, '>=', 3] })).toBe(true);
    expect(C(s, { cmp: [{ var: 'x' }, '!=', 1] }, { x: 1 })).toBe(false);
    expect(C(s, { phase: ['preRoll', 'main'] })).toBe(true);
    expect(C(s, { hasRolled: true })).toBe(true);
    expect(C(s, { isTurnOf: 'self' }, {}, s.turnOrder[s.currentPlayerIndex])).toBe(true);
    expect(C(s, { samePlayer: [{ var: 'a' }, 'self'] }, { a: 'p1' })).toBe(true);
    expect(C(s, { varSet: 'a' }, { a: 'p1' })).toBe(true);
    expect(C(s, { varSet: 'b' })).toBe(false);
    expect(C(s, { setting: 'friendlyRobber' })).toBe(false);
    expect(C(edit(s, (c) => { c.settings.friendlyRobber = true; }), { setting: 'friendlyRobber' })).toBe(true);
  });

  it('canAfford and flags', () => {
    let s = give(board(), 'p1', { ore: 2 });
    expect(C(s, { canAfford: { cost: { ore: 2 } } })).toBe(true);
    expect(C(s, { canAfford: { cost: { ore: { add: [1, 2] } } } })).toBe(false);
    s = edit(s, (c) => { c.players[0].flags.f = { value: true, until: 'forever' }; });
    expect(C(s, { flag: 'f' })).toBe(true);
    expect(C(s, { flag: 'f', player: { var: 'o' } }, { o: 'p2' })).toBe(false);
  });

  it('location tests: water, coastal, terrain, number, token, occupied, adjacency, distance, connection', () => {
    let s = board();
    const sea = Object.values(s.hexes).find((h) => h.terrain === 'sea')!;
    const seaCorner = topology.hexCorners(sea.coord).find((v) => topology.vertexHexes(v).every((h) => s.hexes[topology.hexId(h)]?.terrain !== 'hills' && (!s.hexes[topology.hexId(h)] || s.hexes[topology.hexId(h)].terrain === 'sea')))!;
    expect(C(s, { isWater: { at: 'at' } }, { at: sea.id })).toBe(true);
    expect(C(s, { isWater: { at: 'at' } }, { at: corners[0] })).toBe(false);
    if (seaCorner) expect(C(s, { isWater: { at: 'at' } }, { at: seaCorner })).toBe(true);
    expect(C(s, { isCoastal: { at: 'at' } }, { at: corners[0] })).toBe(false);
    const centreHex = s.hexes['h:0,0'];
    expect(C(s, { terrainIs: { at: 'at', terrain: centreHex.terrain } }, { at: corners[1] })).toBe(true);
    if (centreHex.number) expect(C(s, { hexNumberIn: { at: 'at', numbers: [centreHex.number] } }, { at: 'h:0,0' })).toBe(true);
    s = edit(s, (c) => { c.tokens.robber = 'h:0,0'; });
    expect(C(s, { hasToken: { at: 'at', token: 'robber' } }, { at: 'h:0,0' })).toBe(true);

    s = place(baseDef, s, 'settlement', 'p1', corners[0]);
    expect(C(s, { occupied: { at: 'at', piece: 'settlement', owner: 'self' } }, { at: corners[0] })).toBe(true);
    expect(C(s, { occupied: { at: 'at', owner: 'others' } }, { at: corners[0] })).toBe(false);
    expect(C(s, { adjacentTo: { at: 'at', tag: 'building' } }, { at: corners[1] })).toBe(true);
    expect(C(s, { distanceRule: { at: 'at' } }, { at: corners[1] })).toBe(false);
    expect(C(s, { distanceRule: { at: 'at' } }, { at: corners[2] })).toBe(true);
    expect(C(s, { distanceRule: { at: 'at', minDistance: 3 } }, { at: corners[2] })).toBe(false);
    // edge 0 touches corner 0 (own settlement) -> connected; edge 1 is not (yet)
    expect(C(s, { connectedTo: { at: 'at', owner: 'self' } }, { at: edges[0] })).toBe(true);
    expect(C(s, { connectedTo: { at: 'at', owner: 'self' } }, { at: edges[1] })).toBe(false);
    s = place(baseDef, s, 'road', 'p1', edges[0]);
    expect(C(s, { connectedTo: { at: 'at', owner: 'self' } }, { at: edges[1] })).toBe(true);
    // an opponent settlement on corner 1 cuts the connection through it
    s = place(baseDef, s, 'settlement', 'p2', corners[1]);
    expect(C(s, { connectedTo: { at: 'at', owner: 'self' } }, { at: edges[1] })).toBe(false);
    expect(C(s, { isAdjacent: ['a', 'b'] }, { a: edges[0], b: corners[0] })).toBe(true);
    expect(C(s, { isAdjacent: ['a', 'b'] }, { a: edges[0], b: corners[3] })).toBe(false);
  });
});

describe('expressions', () => {
  it('arithmetic, if, params, counts and dice', () => {
    let s = give(board(), 'p1', { ore: 3, wool: 2 });
    s = place(baseDef, s, 'settlement', 'p1', corners[0]);
    s = place(baseDef, s, 'city', 'p2', corners[3]);
    s = edit(s, (c) => { c.lastRoll = { dice: [2, 5], total: 7 }; c.globals.g = 4; c.players[0].stats.k = 2; });
    expect(E(s, { add: [1, { mul: [2, 3] }, { sub: [10, 4] }] })).toBe(13);
    expect(E(s, { div: [7, 2] })).toBe(3);
    expect(E(s, { div: [7, 0] })).toBe(0);
    expect(E(s, { min: [4, 2, 9] }) + E(s, { max: [4, 2, 9] })).toBe(11);
    expect(E(s, { if: [{ cmp: [1, '<', 2] }, 10, 20] })).toBe(10);
    expect(E(s, { param: 'discardLimit' })).toBe(7);
    expect(E(s, { param: 'victoryPoints' })).toBe(10);
    expect(E(s, { resourceCount: {} })).toBe(5);
    expect(E(s, { resourceCount: { resource: 'ore' } })).toBe(3);
    expect(E(s, { resourceCount: { player: { var: 'o' } } }, { o: 'p2' })).toBe(0);
    expect(E(s, { pieceCount: { owner: 'self' } })).toBe(1);
    expect(E(s, { pieceCount: { near: 'h', tag: 'building' } }, { h: 'h:0,0' })).toBe(2);
    expect(E(s, { pieceCount: { owner: 'others', piece: 'city' } })).toBe(1);
    expect(E(s, { stat: { key: 'k' } }) + E(s, { global: 'g' })).toBe(6);
    expect(E(s, { vp: { var: 'o' } }, { o: 'p2' })).toBe(2);
    expect(E(s, { dice: 'total' })).toBe(7);
    expect(E(s, { dice: 1 })).toBe(5);
    expect(E(s, { playerCount: true })).toBe(3);
    const r = E(s, { random: [1, 3] });
    expect(r >= 1 && r <= 3).toBe(true);
    expect(E(s, { cardCount: {} })).toBe(0);
  });
});
