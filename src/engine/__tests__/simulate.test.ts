import { describe, expect, it } from 'vitest';
import { computeVP, redactFor } from '../index';
import { baseDef, newGame, simulate } from './helpers';

function conserved(s: ReturnType<typeof newGame>) {
  for (const r of baseDef.resources) {
    const total = s.bank[r.id] + s.players.reduce((a, p) => a + (p.resources[r.id] ?? 0), 0);
    expect(total, `resource ${r.id} conserved`).toBe(r.bankSupply);
  }
  const devCards = s.decks.dev.draw.length + s.decks.dev.discard.length
    + s.players.reduce((a, p) => a + p.hand.length + p.played.length, 0);
  expect(devCards).toBe(25);
}

describe('headless simulation of the base game', () => {
  for (const [seed, n, mode] of [[1, 3, 'random'], [2, 4, 'random'], [3, 2, 'balanced'], [4, 4, 'balanced'], [5, 3, 'random']] as const) {
    it(`seed ${seed}: ${n} bots play to a winner (${mode} dice)`, () => {
      const start = newGame(seed, n, baseDef, { diceMode: mode });
      expect(start.phase).toBe('setup');
      const { state } = simulate(baseDef, start, seed * 7919, 600);
      expect(state.winner, `no winner after ${state.turn} turns`).toBeTruthy();
      expect(state.phase).toBe('gameOver');
      expect(computeVP(baseDef, state, state.winner!, true)).toBeGreaterThanOrEqual(10);
      conserved(state);
      // fully JSON-serializable
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      // redaction keeps counts
      const red = redactFor(baseDef, state, state.turnOrder[0]);
      expect(red.rngState).toBe(0);
    });
  }

  it('is deterministic for a given seed', () => {
    const a = simulate(baseDef, newGame(9, 3), 42, 60).state;
    const b = simulate(baseDef, newGame(9, 3), 42, 60).state;
    expect(a).toEqual(b);
  });
});
