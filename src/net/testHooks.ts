/**
 * Test hooks for end-to-end tests (e2e/). Enabled in the Vite dev server, or in any
 * build when the page URL has `?testhooks` (e.g. `/?testhooks#/room/ABC234`).
 *
 * Exposes `window.__hexlands` in the HOST's browser:
 *   __hexlands.game()                  -> authoritative GameState of the hosted room (or null)
 *   __hexlands.lobby()                 -> LobbyState (players with `connected` flags, settings, mods)
 *   __hexlands.patchGame(fn)           -> fn(clone) returns the new state; broadcast to everyone
 *   __hexlands.forceNextRoll(total)    -> pick an RNG state so the next rollDice totals `total`
 *   __hexlands.giveResources(pid, map) -> add resources to a player (taken from the bank)
 *   __hexlands.stackDeck(deck, cards)  -> put these card ids on top of a deck's draw pile
 *
 * The host is authoritative, so these only "cheat" in rooms the caller hosts.
 */
import * as engine from '../engine';
import type { GameState, Id } from '../engine/schema';
import type { HostRoom } from './host';

export function testHooksEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try { return /[?&]testhooks\b/.test(window.location.search); } catch { return false; }
}

let currentHost: HostRoom | null = null;

export function registerHost(host: HostRoom | null): void {
  if (!testHooksEnabled()) return;
  currentHost = host;
  install();
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function need(): { host: HostRoom; game: GameState } {
  const host = currentHost;
  const game = host?.getGame();
  if (!host || !game) throw new Error('No hosted game in this tab');
  return { host, game };
}

function install(): void {
  const w = window as unknown as { __hexlands?: unknown };
  if (w.__hexlands) return;
  w.__hexlands = {
    game: () => currentHost?.getGame() ?? null,
    lobby: () => currentHost?.getLobby() ?? null,
    patchGame(fn: (g: GameState) => GameState | void) {
      const { host, game } = need();
      const draft = clone(game);
      const next = fn(draft) ?? draft;
      host.debugSetGame({ ...next, version: next.version + 1 });
    },
    forceNextRoll(total: number): boolean {
      const { host, game } = need();
      const def = host.getDefinition();
      if (!def) throw new Error('No definition');
      const roller = game.turnOrder[game.currentPlayerIndex];
      for (const resetDeck of [false, true]) {
        for (let seed = 1; seed < 20000; seed++) {
          const trial: GameState = { ...game, rngState: seed, ...(resetDeck ? { diceDeck: undefined } : {}) };
          const res = engine.applyCommand(def, trial, roller, { type: 'rollDice' });
          if (res.ok && res.state.lastRoll?.total === total) {
            host.debugSetGame({ ...trial, version: game.version + 1 });
            return true;
          }
        }
      }
      return false;
    },
    giveResources(playerId: string, res: Record<Id, number>) {
      const { host, game } = need();
      const g = clone(game);
      const p = g.players.find((x) => x.id === playerId);
      if (!p) throw new Error(`No player ${playerId}`);
      for (const [r, n] of Object.entries(res)) {
        p.resources[r] = (p.resources[r] ?? 0) + n;
        if (g.bank[r] !== undefined && g.bank[r] >= 0) g.bank[r] = Math.max(0, g.bank[r] - n);
      }
      host.debugSetGame({ ...g, version: g.version + 1 });
    },
    stackDeck(deck: Id, cards: Id[]) {
      const { host, game } = need();
      const g = clone(game);
      const d = g.decks[deck];
      if (!d) throw new Error(`No deck ${deck}`);
      // Remove one copy of each requested card, then put them where drawCard takes from.
      for (const c of cards) {
        const i = d.draw.indexOf(c);
        if (i >= 0) d.draw.splice(i, 1);
      }
      d.draw = [...cards, ...d.draw]; // the engine draws with draw.shift()
      host.debugSetGame({ ...g, version: g.version + 1 });
    },
  };
}
