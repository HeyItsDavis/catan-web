/**
 * Turn-timer expiry: the host plays a minimal legal move for whoever is holding up the game,
 * one command at a time (the host re-arms the timer after every change, so a turn that
 * needs several steps — roll, discard, move the robber, end turn — is resolved step by step).
 *
 *  - pending prompt: skip if optional; discard → the most plentiful cards; otherwise the
 *    first legal option (the engine precomputes every legal answer);
 *  - your turn, no prompt: roll if you haven't, otherwise end the turn.
 */
import * as engine from '../engine';
import type { Command, GameDefinition, GameState } from '../engine/schema';

export function timeoutCommand(def: GameDefinition, state: GameState, playerId: string): Command | null {
  if (state.phase === 'gameOver' || state.winner) return null;
  const prompt = state.prompts.find((p) => p.player === playerId);
  if (prompt) {
    if (prompt.optional) return { type: 'respond', promptId: prompt.id, answer: null };
    if (prompt.kind === 'discard') {
      const me = state.players.find((p) => p.id === playerId);
      const allowed = prompt.options.length ? prompt.options : Object.keys(me?.resources ?? {});
      const left: Record<string, number> = {};
      for (const r of allowed) left[r] = me?.resources[r] ?? 0;
      const pick: Record<string, number> = {};
      for (let i = 0; i < (prompt.amount ?? 0); i++) {
        const r = Object.keys(left).sort((a, b) => left[b] - left[a])[0];
        if (!r || left[r] <= 0) break;
        left[r]--;
        pick[r] = (pick[r] ?? 0) + 1;
      }
      return { type: 'respond', promptId: prompt.id, answer: pick };
    }
    if (prompt.options.length) return { type: 'respond', promptId: prompt.id, answer: prompt.options[0] };
    return null;
  }
  if (state.prompts.length) return null; // someone else must answer first
  if (state.turnOrder[state.currentPlayerIndex] !== playerId) return null;
  const moves = engine.getAvailableMoves(def, state, playerId);
  // Open trade offers would block nothing, but clean them up so the next player starts fresh.
  const myOffer = state.trades.find((t) => t.from === playerId);
  if (myOffer) return { type: 'cancelTrade', tradeId: myOffer.id };
  if (moves.canRoll) return { type: 'rollDice' };
  if (moves.canEndTurn) return { type: 'endTurn' };
  return null;
}
