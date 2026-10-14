import { describe, expect, it } from 'vitest';
import { getAvailableMoves, topology } from '../../../engine';
import { act, edit, give, newGame, place } from '../../../engine/__tests__/helpers';
import { mod } from '../tb-rivers';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);
const P = (s: ReturnType<typeof newGame>, id: string) => s.players.find((p) => p.id === id)!;
const respond = (s: ReturnType<typeof newGame>, a: string) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });

function main() {
  return edit(newGame(1, 3, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1; });
}

/** The side shared by two neighbouring hexes. */
function sideBetween(a: { q: number; r: number }, b: { q: number; r: number }): string {
  const ea = new Set(topology.hexEdges(a));
  return topology.hexEdges(b).find((e) => ea.has(e))!;
}

describe('T&B Rivers of Catan', () => {
  it('validates', () => { expectValid(mod); });

  it('roads by the river pay gold; the river itself takes a bridge (3 gold)', () => {
    let s = main();
    const crossing = sideBetween({ q: -1, r: 1 }, { q: 0, r: 1 });
    const [v] = topology.edgeVertices(crossing);
    s = place(def, s, 'settlement', 'p1', v);
    s = give(s, 'p1', { brick: 4, lumber: 3 });
    s = act(def, s, 'p1', { type: 'build', piece: 'road' });
    expect(s.prompts[0].options).not.toContain(crossing);
    const bank = s.prompts[0].options[0]; // every edge at v touches a river hex
    s = respond(s, bank);
    expect(P(s, 'p1').stats.gold).toBe(1);
    s = act(def, s, 'p1', { type: 'build', piece: 'bridge' });
    expect(s.prompts[0].options).toContain(crossing);
    s = respond(s, crossing);
    expect(P(s, 'p1').stats.gold).toBe(4);
    expect(s.awards.wealthiestSettler).toBe('p1');
    expect(s.awards.poorestSettler).toBeNull(); // p2 and p3 tie at 0
    // 2 gold -> 1 resource
    s = act(def, s, 'p1', { type: 'doAction', action: 'goldForResource' });
    s = respond(s, 'ore');
    expect(P(s, 'p1').resources.ore).toBe(1);
    expect(P(s, 'p1').stats.gold).toBe(2);
  });

  it('the poorest settler loses 2 VP', () => {
    let s = edit(main(), (c) => { P(c, 'p1').stats.gold = 3; P(c, 'p2').stats.gold = 1; });
    s = place(def, s, 'settlement', 'p3', topology.hexCorners({ q: 1, r: 1 })[0]);
    s = act(def, s, 'p1', { type: 'doAction', action: 'goldForResource' });
    s = respond(s, 'ore');
    expect(s.awards.poorestSettler).toBe('p3');
    expect(getAvailableMoves(def, s, 'p3').actions.find((a) => a.action.id === 'goldForResource')?.enabled).toBe(false);
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3]);
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
    expect(games.some((g) => g.players.some((p) => (p.stats.gold ?? 0) > 0))).toBe(true);
  }, 120_000);
});
