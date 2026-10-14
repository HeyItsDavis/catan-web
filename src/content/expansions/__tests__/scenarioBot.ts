/**
 * Test-only bot for expansion scenarios: the base bot (helpers.botMove) plus, now and then,
 * a random enabled mod action (piece actions included) or a build of any affordable piece.
 * Commands that the engine refuses (e.g. an action cancelled by abortIf) are simply skipped.
 */
import { expect } from 'vitest';
import {
  applyCommand, buildDefinition, getAvailableMoves, validateMod,
  type Command, type GameDefinition, type GameState, type ModDef,
} from '../../../engine';
import { baseMod } from '../../base';
import { botMove, botTradeRound, cur, mulberry, newGame, type Rand } from '../../../engine/__tests__/helpers';

export function defOf(...mods: ModDef[]): GameDefinition {
  return buildDefinition([baseMod, ...mods]);
}

export function expectValid(mod: ModDef, also: ModDef[] = []) {
  const problems = validateMod(mod, [baseMod, ...also]);
  expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
  return problems;
}

const pick = <T,>(rnd: Rand, xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

/** Relative chance of picking an action (by action id); default 1. */
export type ActionWeights = Record<string, number>;

function weighted<T>(rnd: Rand, xs: T[], w: (x: T) => number): T | null {
  const total = xs.reduce((a, x) => a + w(x), 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const x of xs) { r -= w(x); if (r < 0) return x; }
  return xs[xs.length - 1];
}

function extraMove(def: GameDefinition, s: GameState, rnd: Rand, weights: ActionWeights): [string, Command] | null {
  if (s.prompts.length || s.stack.length || s.phase !== 'main') return null;
  const pid = cur(s);
  const m = getAvailableMoves(def, s, pid);
  const builds = m.builds.filter((b) => b.affordable && b.hasSpot && !['road', 'settlement', 'city'].includes(b.piece.id));
  if (builds.length && rnd() < 0.5) return [pid, { type: 'build', piece: pick(rnd, builds).piece.id }];
  const acts = m.actions.filter((a) => a.enabled);
  if (acts.length && rnd() < 0.7) {
    const a = weighted(rnd, acts, (x) => weights[x.action.id] ?? 1);
    if (!a) return null;
    return [pid, { type: 'doAction', action: a.action.id, ...(a.pieceId ? { pieceId: a.pieceId } : {}) }];
  }
  return null;
}

/**
 * Movement prompts (a piece being moved): look one step ahead and prefer destinations from which
 * the moved piece has a valuable action available (by `weights`), e.g. a wagon heading for the
 * quarry or a ship returning to its harbor to pick up a settler.
 */
function lookAhead(def: GameDefinition, s: GameState, rnd: Rand, weights: ActionWeights, movingId: string | null): [string, Command] | null {
  const pr = s.prompts[0];
  const moving = movingId ? s.pieces.find((p) => p.id === movingId) : undefined;
  if (!pr || pr.kind !== 'location' || !moving || pr.piece !== moving.type || s.prompts.length > 1 || !Object.keys(weights).length) return null;
  let best: string[] = [];
  let bestScore = 0;
  for (const opt of pr.options) {
    // cheap preview: the piece standing on `opt`, nothing pending
    const preview: GameState = { ...s, prompts: [], stack: [], pieces: s.pieces.map((p) => (p.id === moving.id ? { ...p, at: opt } : p)) };
    const score = getAvailableMoves(def, preview, pr.player).actions
      .filter((a) => a.enabled && a.pieceId === moving.id)
      .reduce((acc, a) => acc + (weights[a.action.id] ?? 0), 0);
    if (score > bestScore) { bestScore = score; best = [opt]; } else if (score === bestScore && score > 0) best.push(opt);
  }
  if (!best.length || rnd() < 0.2) return null;
  return [pr.player, { type: 'respond', promptId: pr.id, answer: pick(rnd, best) }];
}

/** Play until someone wins or `maxTurns` pass. At most `perTurn` extra moves per turn. */
export function simulateScenario(def: GameDefinition, s: GameState, seed: number, maxTurns = 400, perTurn = 6, weights: ActionWeights = {}): GameState {
  const rnd = mulberry(seed);
  let n = 0;
  let extraTurn = -1;
  let extras = 0;
  let movingId: string | null = null; // piece of the last piece action (for lookAhead)
  while (!s.winner && s.turn <= maxTurns) {
    if (++n > 200_000) throw new Error('too many commands');
    if (s.phase === 'main' && !s.prompts.length && !s.stack.length && def.trade.playerTrading && rnd() < 0.03) {
      s = botTradeRound(def, s, rnd);
    }
    if (s.turn !== extraTurn) { extraTurn = s.turn; extras = 0; }
    const extra = extras < perTurn ? extraMove(def, s, rnd, weights) : null;
    if (extra) {
      extras++;
      const r = applyCommand(def, s, extra[0], extra[1]);
      if (r.ok) { s = r.state; movingId = extra[1].type === 'doAction' ? extra[1].pieceId ?? null : null; continue; }
    }
    const [pid, cmd] = lookAhead(def, s, rnd, weights, movingId) ?? botMove(def, s, rnd);
    const r = applyCommand(def, s, pid, cmd);
    if (!r.ok) throw new Error(`bot command ${JSON.stringify(cmd)} failed: ${r.error}`);
    s = r.state;
  }
  return s;
}

export interface PlayOptions { players?: number; mapId?: string; maxTurns?: number; weights?: ActionWeights }

/** Bot games with the mod's own victory point target. */
export function playGames(def: GameDefinition, seeds: number[], opts: PlayOptions = {}): GameState[] {
  return seeds.map((seed) => {
    const start = newGame(seed, opts.players ?? 3, def, { victoryPoints: def.victoryPoints, ...(opts.mapId ? { mapId: opts.mapId } : {}) });
    const end = simulateScenario(def, start, seed * 7919, opts.maxTurns ?? 400, 6, opts.weights);
    expect(JSON.parse(JSON.stringify(end))).toEqual(end);
    return end;
  });
}
