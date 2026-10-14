import { describe, expect, it } from 'vitest';
import { computeVP } from '../../../engine';
import { act, edit, give, newGame, place } from '../../../engine/__tests__/helpers';
import { mod } from '../tb-harbormaster';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);

describe('T&B Harbormaster', () => {
  it('validates', () => { expectValid(mod); });

  it('3 harbor points (a settlement and a city on harbors) make you Harbormaster', () => {
    let s = edit(newGame(1, 3, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; });
    s = place(def, s, 'settlement', 'p1', s.ports[0].vertices[0]);
    s = place(def, s, 'settlement', 'p1', s.ports[3].vertices[0]);
    s = give(s, 'p1', { grain: 2, ore: 3 });
    s = act(def, s, 'p1', { type: 'build', piece: 'city' });
    expect(s.awards.harbormaster).toBeNull(); // 2 points so far
    s = act(def, s, 'p1', { type: 'respond', promptId: s.prompts[0].id, answer: s.ports[3].vertices[0] });
    expect(s.awards.harbormaster).toBe('p1');
    expect(computeVP(def, s, 'p1', false)).toBe(1 + 2 + 2);
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3]);
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
  }, 120_000);
});
