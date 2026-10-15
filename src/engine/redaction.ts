/**
 * Redaction: the copy of GameState that may be sent to one player.
 *
 * NOTE FOR THE UI (what changes in a redacted state):
 *  - Other players' `resources` become a single entry `{ '?': <total cards> }`.
 *    The viewer's own resources are untouched. (Spectators see every player as '?'.)
 *  - Other players' `hand` cards keep `id`, `deck` and `acquiredTurn` but `card` is the
 *    string 'hidden' (unless the deck is `public`). Use the length for the card count.
 *  - `decks[id].draw` keeps its length but every entry is 'hidden'. Discard piles are public.
 *  - `seed` and `rngState` are 0; `diceDeck` entries are -1 (length kept).
 *  - `stack` keeps its length but each entry is `{ redacted: true }` (interpreter internals,
 *    including action snapshots, are private). Use `prompts` to know who must act.
 *  - Prompts addressed to other players keep kind/label/amount but have `options: []`.
 *  - With lobby `hideBankCards`, `bank` becomes `{}`.
 *  - Unrevealed (fog) hexes show terrain 'hidden' and number null.
 *  - Log entries' `hidden` resource flows (random steals) show `res: { '?': n }` unless the
 *    viewer is the giver or the receiver.
 */
import type { GameDefinition, GameState } from './schema';

export function redactState(def: GameDefinition, state: GameState, viewer: string | null): GameState {
  const s = structuredClone(state);
  s.seed = 0;
  s.rngState = 0;
  if (s.diceDeck) s.diceDeck = s.diceDeck.map(() => -1);
  s.stack = s.stack.map(() => ({ redacted: true }));
  const publicDecks = new Set(def.decks.filter((d) => d.public).map((d) => d.id));
  for (const d of Object.values(s.decks)) d.draw = d.draw.map(() => 'hidden');
  for (const p of s.players) {
    if (p.id === viewer) continue;
    const total = Object.values(p.resources).reduce((a, b) => a + b, 0);
    p.resources = { '?': total };
    p.hand = p.hand.map((c) => (publicDecks.has(c.deck) ? c : { ...c, card: 'hidden' }));
  }
  s.prompts = s.prompts.map((pr) => (pr.player === viewer ? pr : { ...pr, options: [], optionLabels: undefined }))
    .map((pr) => { if (pr.optionLabels === undefined) delete pr.optionLabels; return pr; });
  if (s.settings.hideBankCards) s.bank = {};
  for (const e of s.log) {
    for (const f of e.flows ?? []) {
      if (!f.hidden || f.from === viewer || f.to === viewer) continue;
      f.res = { '?': Object.values(f.res).reduce((a, b) => a + b, 0) };
    }
  }
  for (const h of Object.values(s.hexes)) {
    if (!h.revealed) { h.terrain = 'hidden'; h.number = null; }
  }
  return s;
}
