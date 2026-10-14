import { describe, expect, it } from 'vitest';
import { buildDefinition, validateMod } from '../../engine';
import { baseMod } from '../base';
import { mod as fiveSix } from '../expansions/five-six';
import { builtinMods } from '../builtins';
import { act, botMove, cur, mulberry, newGame, simulate } from '../../engine/__tests__/helpers';

const def = buildDefinition([baseMod, fiveSix]);

describe('5–6 Player Extension', () => {
  it('validates with no errors and is registered as a built-in', () => {
    expect(validateMod(fiveSix, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
    expect(builtinMods.map((m) => m.meta.id)).toContain('five-six');
  });

  it('has the 30-hex board, 34 development cards and 24 of each resource', () => {
    const s = newGame(1, 6, def, { mapId: 'five-six-standard', maxPlayers: 6 });
    const land = Object.values(s.hexes).filter((h) => h.terrain !== 'sea');
    expect(land).toHaveLength(30);
    expect(land.filter((h) => h.terrain === 'desert')).toHaveLength(2);
    expect(land.filter((h) => h.number !== null)).toHaveLength(28);
    expect(s.ports).toHaveLength(11);
    expect(s.decks.dev.draw).toHaveLength(34);
    for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore']) expect(s.bank[r]).toBe(24);
  });

  it('special building phase: after a turn, each other player may build in turn order', () => {
    let s = newGame(2, 5, def, { mapId: 'five-six-standard', maxPlayers: 6 });
    while (s.phase === 'setup') s = act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: s.prompts[0].options[0] });
    const first = cur(s);
    s = act(def, s, first, { type: 'rollDice' });
    const rnd = mulberry(5);
    while (s.prompts.length) { const [pid, cmd] = botMove(def, s, rnd); s = act(def, s, pid, cmd); }
    s = act(def, s, first, { type: 'endTurn' });
    const builders: string[] = [];
    while (s.phase === 'specialBuild') {
      builders.push(cur(s));
      s = act(def, s, cur(s), { type: 'endTurn' });
    }
    const i = s.turnOrder.indexOf(first);
    expect(builders).toEqual([1, 2, 3, 4].map((k) => s.turnOrder[(i + k) % 5]));
    expect(cur(s)).toBe(s.turnOrder[(i + 1) % 5]);
  });

  for (const [seed, n] of [[1, 5], [2, 6], [3, 4]] as const) {
    it(`seed ${seed}: ${n} bots play a full game on the large island`, () => {
      const start = newGame(seed, n, def, { mapId: 'five-six-standard', maxPlayers: 6 });
      const { state } = simulate(def, start, seed * 31, 800);
      expect(state.winner, `no winner after ${state.turn} turns`).toBeTruthy();
      for (const r of def.resources) {
        const total = state.bank[r.id] + state.players.reduce((a, p) => a + (p.resources[r.id] ?? 0), 0);
        expect(total).toBe(24);
      }
    }, 60_000);
  }
});
