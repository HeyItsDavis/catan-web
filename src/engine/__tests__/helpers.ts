import { expect } from 'vitest';
import {
  applyCommand, buildDefinition, createGame, getAvailableMoves,
  type Command, type GameDefinition, type GameState, type LobbySettings, type ModDef, type NewPlayer,
} from '../index';
import { baseMod } from '../../content/base';
import { makeCtx } from '../context';
import { addPiece } from '../interpreter';

export const baseDef = buildDefinition([baseMod]);

export function settings(over: Partial<LobbySettings> = {}): LobbySettings {
  return {
    mapId: 'base-standard', maxPlayers: 4, victoryPoints: 10, discardLimit: 7, diceMode: 'random',
    friendlyRobber: false, hideBankCards: false, turnTimerSeconds: 0, randomizeTurnOrder: false, mods: [], modSettings: {},
    ...over,
  };
}

export function players(n: number): NewPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, color: `#${i}${i}${i}` }));
}

export function newGame(seed = 1, n = 3, def: GameDefinition = baseDef, over: Partial<LobbySettings> = {}): GameState {
  return createGame(def, settings(over), players(n), seed);
}

/** Apply and assert success. */
export function act(def: GameDefinition, s: GameState, pid: string, cmd: Command): GameState {
  const r = applyCommand(def, s, pid, cmd);
  if (!r.ok) throw new Error(`Command ${JSON.stringify(cmd)} by ${pid} failed: ${r.error}`);
  return r.state;
}

export function tryAct(def: GameDefinition, s: GameState, pid: string, cmd: Command) {
  return applyCommand(def, s, pid, cmd);
}

/** Answer the first prompt with `pick(options)` (default: first option). */
export function answer(def: GameDefinition, s: GameState, pick: (opts: string[]) => string | null = (o) => o[0]): GameState {
  const p = s.prompts[0];
  expect(p).toBeTruthy();
  return act(def, s, p.player, { type: 'respond', promptId: p.id, answer: pick(p.options) });
}

/** Play setup by always choosing the first legal option. */
export function finishSetup(def: GameDefinition, s: GameState): GameState {
  let guard = 0;
  while (s.phase === 'setup') {
    s = answer(def, s);
    if (++guard > 200) throw new Error('setup did not finish');
  }
  return s;
}

/** Directly edit a state (test-only), returning a new state. */
export function edit(s: GameState, f: (s: GameState) => void): GameState {
  const c = structuredClone(s);
  f(c);
  return c;
}

export function give(s: GameState, pid: string, res: Record<string, number>): GameState {
  return edit(s, (c) => {
    const p = c.players.find((x) => x.id === pid)!;
    for (const [r, n] of Object.entries(res)) {
      p.resources[r] = (p.resources[r] ?? 0) + n;
      if (c.bank[r] >= 0) c.bank[r] -= n;
    }
  });
}

export function place(def: GameDefinition, s: GameState, type: string, owner: string, at: string): GameState {
  const ctx = makeCtx(def, structuredClone(s));
  addPiece(ctx, type, owner, at);
  return ctx.s;
}

export function cur(s: GameState): string {
  return s.turnOrder[s.currentPlayerIndex];
}

export function moves(def: GameDefinition, s: GameState, pid: string) {
  return getAvailableMoves(def, s, pid);
}

export function withMods(...mods: ModDef[]): GameDefinition {
  return buildDefinition([baseMod, ...mods]);
}

/* ---------------------------------- bots --------------------------------- */

export type Rand = () => number;

export function mulberry(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = <T,>(rnd: Rand, xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

/** Pick a legal command for whoever has to act. Returns [player, command]. */
export function botMove(def: GameDefinition, s: GameState, rnd: Rand): [string, Command] {
  if (s.prompts.length) {
    const pr = pickOne(rnd, s.prompts);
    if (pr.kind === 'discard') {
      const p = s.players.find((x) => x.id === pr.player)!;
      const pool: string[] = [];
      for (const r of pr.options) for (let i = 0; i < (p.resources[r] ?? 0); i++) pool.push(r);
      const ans: Record<string, number> = {};
      for (let i = 0; i < (pr.amount ?? 0); i++) {
        const k = Math.floor(rnd() * pool.length);
        const r = pool.splice(k, 1)[0];
        ans[r] = (ans[r] ?? 0) + 1;
      }
      return [pr.player, { type: 'respond', promptId: pr.id, answer: ans }];
    }
    return [pr.player, { type: 'respond', promptId: pr.id, answer: pickOne(rnd, pr.options) }];
  }
  const pid = cur(s);
  const m = getAvailableMoves(def, s, pid);
  const me = s.players.find((x) => x.id === pid)!;
  if (m.canRoll) {
    const knight = m.playableCards.find((c) => c.card.id === 'knight');
    if (knight && rnd() < 0.3) return [pid, { type: 'playCard', cardInstance: knight.cardInstance }];
    return [pid, { type: 'rollDice' }];
  }
  const b = (id: string) => m.builds.find((x) => x.piece.id === id && x.affordable && x.hasSpot);
  if (b('city')) return [pid, { type: 'build', piece: 'city' }];
  if (b('settlement')) return [pid, { type: 'build', piece: 'settlement' }];
  const card = m.playableCards[0];
  if (card && rnd() < 0.5) return [pid, { type: 'playCard', cardInstance: card.cardInstance }];
  if (m.buyableDecks.some((d) => d.affordable) && rnd() < 0.6) return [pid, { type: 'buyCard', deck: 'dev' }];
  const settlementSpot = m.builds.find((x) => x.piece.id === 'settlement')?.hasSpot;
  if (b('road') && rnd() < (settlementSpot ? 0.2 : 0.8)) return [pid, { type: 'build', piece: 'road' }];
  // bank trade toward what we lack
  if (s.phase === 'main' && rnd() < 0.8) {
    const want = ['ore', 'grain', 'wool', 'brick', 'lumber'].filter((r) => (me.resources[r] ?? 0) === 0 && (s.bank[r] ?? 0) > 0);
    const giveR = Object.keys(m.bankRates).find((r) => (me.resources[r] ?? 0) >= m.bankRates[r] + 1 && !want.includes(r));
    if (want.length && giveR) {
      return [pid, { type: 'bankTrade', give: { [giveR]: m.bankRates[giveR] }, get: { [pickOne(rnd, want)]: 1 } }];
    }
  }
  return [pid, { type: 'endTurn' }];
}

/** Occasionally run a full player-to-player trade round (offer -> responses -> confirm/cancel). */
export function botTradeRound(def: GameDefinition, s: GameState, rnd: Rand): GameState {
  const pid = cur(s);
  const me = s.players.find((x) => x.id === pid)!;
  const has = Object.keys(me.resources).filter((r) => me.resources[r] > 0);
  const lacks = Object.keys(me.resources).filter((r) => me.resources[r] === 0);
  if (!has.length || !lacks.length) return s;
  const giveR = pickOne(rnd, has);
  const getR = pickOne(rnd, lacks);
  s = act(def, s, pid, { type: 'offerTrade', to: null, give: { [giveR]: 1 }, get: { [getR]: 1 } });
  const offer = s.trades[s.trades.length - 1];
  for (const other of Object.keys(offer.responses)) {
    const op = s.players.find((x) => x.id === other)!;
    const accept = (op.resources[getR] ?? 0) > 0 && rnd() < 0.5;
    s = act(def, s, other, { type: 'respondTrade', tradeId: offer.id, accept });
  }
  const acc = Object.entries(s.trades.find((t) => t.id === offer.id)!.responses).find(([, v]) => v === 'accept');
  if (acc) return act(def, s, pid, { type: 'confirmTrade', tradeId: offer.id, withPlayer: acc[0] });
  return act(def, s, pid, { type: 'cancelTrade', tradeId: offer.id });
}

export function simulate(def: GameDefinition, s: GameState, seed: number, maxTurns = 500): { state: GameState; commands: number } {
  const rnd = mulberry(seed);
  let n = 0;
  while (!s.winner && s.turn <= maxTurns) {
    if (s.phase === 'main' && !s.prompts.length && !s.stack.length && def.trade.playerTrading && rnd() < 0.05) {
      s = botTradeRound(def, s, rnd);
    }
    const [pid, cmd] = botMove(def, s, rnd);
    s = act(def, s, pid, cmd);
    n++;
    if (n > 100_000) throw new Error('too many commands');
  }
  return { state: s, commands: n };
}
