/**
 * Headless games of Cities & Knights: bots that also improve cities, build / activate / promote
 * knights, build walls and play progress cards. Games must run without engine errors.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, buildDefinition, getAvailableMoves, type Command, type GameDefinition, type GameState } from '../../../engine';
import { baseMod } from '../../base';
import { botMove, cur, mulberry, newGame, type Rand } from '../../../engine/__tests__/helpers';
import { mod } from './index';

export const ckDef = buildDefinition([baseMod, mod]);

const pick = <T,>(rnd: Rand, xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

/** A C&K-aware bot move: mostly the base bot, plus improvements, knights, walls and progress cards. */
export function ckBotMove(def: GameDefinition, s: GameState, rnd: Rand): [string, Command] {
  if (s.prompts.length || s.phase !== 'main') {
    if (!s.prompts.length && s.phase === 'preRoll') {
      const m = getAvailableMoves(def, s, cur(s));
      const alch = m.playableCards.find((c) => c.card.id === 'alchemist');
      if (alch && rnd() < 0.5) return [cur(s), { type: 'playCard', cardInstance: alch.cardInstance }];
    }
    return botMove(def, s, rnd);
  }
  const pid = cur(s);
  const m = getAvailableMoves(def, s, pid);
  const enabled = (prefix: string) => m.actions.filter((a) => a.enabled && a.action.id.startsWith(prefix));
  const tryAction = (prefix: string, p: number): [string, Command] | null => {
    const xs = enabled(prefix);
    if (!xs.length || rnd() >= p) return null;
    const a = pick(rnd, xs);
    return [pid, { type: 'doAction', action: a.action.id, ...(a.pieceId ? { pieceId: a.pieceId } : {}) }];
  };
  const build = (piece: string, p: number): [string, Command] | null =>
    m.builds.some((b) => b.piece.id === piece && b.affordable && b.hasSpot) && rnd() < p ? [pid, { type: 'build', piece }] : null;
  return tryAction('improve-', 0.8)
    ?? build('city', 0.9)
    ?? tryAction('activateKnight', 0.6)
    ?? tryAction('displaceKnight', 0.4)
    ?? tryAction('chaseRobber', 0.4)
    ?? tryAction('promote', 0.4)
    ?? build('knight1', 0.4)
    ?? build('wall', 0.3)
    ?? tryAction('moveKnight', 0.05)
    ?? (m.playableCards.length && rnd() < 0.5 ? [pid, { type: 'playCard', cardInstance: pick(rnd, m.playableCards).cardInstance }] : null)
    ?? botMove(def, s, rnd);
}

/** Play until someone wins (or maxTurns). Rejected bot commands (e.g. a card with no target) fall back to roll / end turn. */
export function ckSimulate(def: GameDefinition, s: GameState, seed: number, maxTurns = 600): { state: GameState; commands: number; rejected: number } {
  const rnd = mulberry(seed);
  let n = 0;
  let rejected = 0;
  while (!s.winner && s.turn <= maxTurns) {
    const [pid, cmd] = ckBotMove(def, s, rnd);
    let r = applyCommand(def, s, pid, cmd);
    if (!r.ok) {
      if (r.error.startsWith('Internal')) throw new Error(`${r.error} on ${JSON.stringify(cmd)}`);
      if (s.prompts.length) throw new Error(`prompt answer rejected: ${r.error} (${JSON.stringify(cmd)})`);
      rejected++;
      const fallback: Command = getAvailableMoves(def, s, pid).canRoll ? { type: 'rollDice' } : { type: 'endTurn' };
      r = applyCommand(def, s, pid, fallback);
      if (!r.ok) throw new Error(`fallback ${fallback.type} failed: ${r.error}`);
    }
    s = r.state;
    if (++n > 200_000) throw new Error('too many commands');
  }
  return { state: s, commands: n, rejected };
}

function conserved(def: GameDefinition, s: GameState) {
  for (const r of def.resources) {
    const cargo = s.pieces.reduce((a, p) => a + (p.cargo?.[r.id] ?? 0), 0);
    const total = s.bank[r.id] + s.players.reduce((a, p) => a + (p.resources[r.id] ?? 0), 0) + cargo;
    expect(total, `resource ${r.id} conserved`).toBe(r.bankSupply);
  }
  for (const d of def.decks) {
    const held = s.players.reduce((a, p) => a + [...p.hand, ...p.played].filter((c) => c.deck === d.id).length, 0);
    expect(s.decks[d.id].draw.length + s.decks[d.id].discard.length + held, `deck ${d.id} conserved`).toBe(18);
  }
}

describe('Cities & Knights: headless bot games', () => {
  for (const [seed, n] of [[1, 3], [2, 4], [3, 3], [4, 4], [5, 2], [6, 3]] as const) {
    it(`seed ${seed}: ${n} bots play to a winner`, { timeout: 60_000 }, () => {
      const { state } = ckSimulate(ckDef, newGame(seed, n, ckDef, { victoryPoints: 13 }), seed * 7919, 800);
      expect(state.winner, `no winner after ${state.turn} turns`).toBeTruthy();
      conserved(ckDef, state);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      for (const p of state.players) expect(p.hand.length).toBeLessThanOrEqual(4);
    });
  }
});
