/**
 * Integration smoke test: the game screen renders real expansion games (every builtin mod) with
 * the real engine, from every player's redacted view, at many points of a bot-played game.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, buildDefinition, getAvailableMoves, redactFor, type Command, type GameDefinition, type GameState } from '../../engine';
import { botMove, cur, mulberry, newGame, type Rand } from '../../engine/__tests__/helpers';
import { baseMod } from '../../content/base';
import { addWithDependencies, builtinMods } from '../../content/builtins';
import { GameScreen } from './GameScreen';

/** Base bot + a taste of the expansion: enabled custom / piece actions and every buildable piece. */
function bot(def: GameDefinition, s: GameState, rnd: Rand): [string, Command] {
  if (!s.prompts.length && s.phase === 'main' && rnd() < 0.5) {
    const pid = cur(s);
    const m = getAvailableMoves(def, s, pid);
    const acts = m.actions.filter((a) => a.enabled);
    if (acts.length && rnd() < 0.5) {
      const a = acts[Math.floor(rnd() * acts.length)];
      return [pid, { type: 'doAction', action: a.action.id, ...(a.pieceId ? { pieceId: a.pieceId } : {}) }];
    }
    const b = m.builds.filter((x) => x.affordable && x.hasSpot);
    if (b.length) return [pid, { type: 'build', piece: b[Math.floor(rnd() * b.length)].piece.id }];
  }
  return botMove(def, s, rnd);
}

function renderAll(def: GameDefinition, s: GameState): string {
  let last = '';
  for (const viewer of [...s.players.map((p) => p.id), null]) {
    const view = redactFor(def, s, viewer);
    last = renderToString(
      <GameScreen def={def} state={view} playerId={viewer ?? 'spectator'} send={() => {}} chat={[]} sendChat={() => {}} />,
    );
  }
  return last;
}

describe.each(builtinMods.map((m) => [m.meta.id, m] as const))('game screen renders %s', (_id, mod) => {
  it('through a bot game, for every viewer', { timeout: 60_000 }, () => {
    const def = buildDefinition([baseMod, ...addWithDependencies([], mod)]);
    const rnd = mulberry(17);
    let s = newGame(3, 3, def);
    let renders = 0;
    for (let n = 0; n < 1500 && !s.winner; n++) {
      const [pid, cmd] = bot(def, s, rnd);
      let r = applyCommand(def, s, pid, cmd);
      if (!r.ok) {
        const m = getAvailableMoves(def, s, pid);
        if (s.prompts.length || (!m.canRoll && !m.canEndTurn)) break;
        r = applyCommand(def, s, pid, m.canRoll ? { type: 'rollDice' } : { type: 'endTurn' });
        if (!r.ok) break;
      }
      s = r.state;
      if (n % 60 === 0 || s.prompts.length && n % 7 === 0) {
        expect(renderAll(def, s)).toContain('g-board-svg');
        renders++;
      }
    }
    expect(renders).toBeGreaterThan(5);
  });
});
