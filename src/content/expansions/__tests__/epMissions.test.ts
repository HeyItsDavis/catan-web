import { describe, expect, it } from 'vitest';
import { topology } from '../../../engine';
import { act, edit, newGame, place } from '../../../engine/__tests__/helpers';
import { mod as fish } from '../ep-fish-for-catan';
import { mod as spices } from '../ep-spices';
import { defOf, expectValid, playGames } from './scenarioBot';

type S = ReturnType<typeof newGame>;

function sideBetween(a: { q: number; r: number }, b: { q: number; r: number }): string {
  const ea = new Set(topology.hexEdges(a));
  return topology.hexEdges(b).find((e) => ea.has(e))!;
}

describe('E&P Fish for Catan', () => {
  const def = defOf(fish);
  const respond = (s: S, a: string) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });

  it('validates', () => { expectValid(fish); });

  it('has the Council of Catan and fish shoals in the fog', () => {
    const s = newGame(1, 3, def);
    expect(s.hexes['h:0,2'].terrain).toBe('council');
    expect(Object.values(s.hexes).filter((h) => h.terrain === 'fogShoal')).toHaveLength(4);
  });

  it('a ship catches fish beside a shoal and delivers them to the council for VP', () => {
    let s = edit(newGame(1, 3, def), (c) => {
      c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1;
      c.hexes['h:1,1'].terrain = 'shoal';
    });
    s = place(def, s, 'ship', 'p1', sideBetween({ q: 1, r: 1 }, { q: 1, r: 0 }));
    const ship = s.pieces.find((p) => p.type === 'ship')!.id;
    s = act(def, s, 'p1', { type: 'doAction', action: 'catchFish', pieceId: ship });
    expect(s.pieces.find((p) => p.id === ship)!.cargo).toEqual({ fish: 1 });
    expect(() => act(def, s, 'p1', { type: 'doAction', action: 'catchFish', pieceId: ship })).toThrow(/Not available/); // once per turn
    s = act(def, s, 'p1', { type: 'doAction', action: 'sail', pieceId: ship });
    const council = sideBetween({ q: 1, r: 1 }, { q: 0, r: 2 });
    expect(s.prompts[0].options).toContain(council);
    s = respond(s, council);
    expect(s.players[0].tokenVP).toBe(1);
    expect(s.players[0].stats.fishDelivered).toBe(1);
    expect(s.pieces.find((p) => p.id === ship)!.cargo).toBeUndefined();
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2], { maxTurns: 500, weights: { foundSettlement: 20, takeSettler: 10, catchFish: 15, sail: 6 } });
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
    expect(games.every((g) => g.players.some((p) => (p.stats.fishDelivered ?? 0) > 0))).toBe(true);
  }, 120_000);
});

describe('E&P Spices for Catan', () => {
  const def = defOf(spices);
  it('validates', () => { expectValid(spices); });

  it('delivered spices make your ships faster', () => {
    let s = edit(newGame(1, 3, def), (c) => {
      c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1;
      for (const h of Object.values(c.hexes)) if (!h.revealed) { h.revealed = true; h.terrain = 'sea'; h.number = null; }
    });
    s = place(def, s, 'ship', 'p1', sideBetween({ q: 1, r: 1 }, { q: 1, r: 0 }));
    const ship = s.pieces.find((p) => p.type === 'ship')!.id;
    s = act(def, s, 'p1', { type: 'doAction', action: 'sail', pieceId: ship });
    const normal = s.prompts[0].options.length;
    s = edit(s, (c) => { c.prompts = []; c.stack = []; c.players[0].stats.spiceDelivered = 2; });
    s = act(def, s, 'p1', { type: 'doAction', action: 'sail', pieceId: ship });
    expect(s.prompts[0].options.length).toBeGreaterThan(normal);
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2], { maxTurns: 500, weights: { foundSettlement: 20, takeSettler: 10, buySpice: 15, sail: 6 } });
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
  }, 120_000);
});
