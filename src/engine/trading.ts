/**
 * Bank trades (rates from def.trade.bankRates by resource kind, ports touched by the
 * player's buildings, and grantTradeRate modifiers) and player-to-player offers.
 */
import type { Id, TradeOffer } from './schema';
import { type Ctx, CommandError, currentPlayerId, emit, getPlayer, isBuilding, log, nextId, piecesAt, playerName } from './context';
import { bankHas, moveResource } from './resources';

export function bankRates(ctx: Ctx, pid: string): Record<Id, number> {
  const p = ctx.s.players.find((x) => x.id === pid);
  const out: Record<Id, number> = {};
  const portIds: Id[] = [];
  for (const pi of ctx.s.ports) {
    if (pi.vertices.some((v) => piecesAt(ctx, v).some((pc) => pc.owner === pid && isBuilding(ctx.L.pieces.get(pc.type))))) {
      portIds.push(pi.port);
    }
  }
  for (const r of ctx.def.resources) {
    let rate = ctx.def.trade.bankRates[r.kind] ?? ctx.def.trade.bankRates.resource ?? 4;
    for (const id of portIds) {
      const pd = ctx.L.ports.get(id);
      if (pd && (pd.resource === 'any' || pd.resource === r.id)) rate = Math.min(rate, pd.ratio);
    }
    for (const tr of p?.tradeRates ?? []) if (tr.resource === 'any' || tr.resource === r.id) rate = Math.min(rate, tr.ratio);
    out[r.id] = rate;
  }
  return out;
}

function cleanMap(ctx: Ctx, m: Record<Id, number>, what: string): Record<Id, number> {
  if (!m || typeof m !== 'object') throw new CommandError(`Invalid ${what}`);
  const out: Record<Id, number> = {};
  for (const [r, n] of Object.entries(m)) {
    if (!ctx.L.resources.has(r)) throw new CommandError(`Unknown resource ${r}`);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new CommandError(`Invalid amount for ${r}`);
    if (n > 0) out[r] = n;
  }
  return out;
}

function has(ctx: Ctx, pid: string, m: Record<Id, number>): boolean {
  const p = getPlayer(ctx, pid);
  return Object.entries(m).every(([r, n]) => (p.resources[r] ?? 0) >= n);
}

function requireTradeWindow(ctx: Ctx, pid: string): void {
  const s = ctx.s;
  if (s.phase !== 'main') throw new CommandError('You can only trade during the main phase');
  if (currentPlayerId(s) !== pid) throw new CommandError('Not your turn');
  if (s.stack.length || s.prompts.length) throw new CommandError('Finish the current action first');
}

export function bankTrade(ctx: Ctx, pid: string, giveIn: Record<Id, number>, getIn: Record<Id, number>): void {
  requireTradeWindow(ctx, pid);
  const give = cleanMap(ctx, giveIn, 'give');
  const get = cleanMap(ctx, getIn, 'get');
  if (!Object.keys(give).length || !Object.keys(get).length) throw new CommandError('Trade must give and get something');
  if (Object.keys(give).some((r) => r in get)) throw new CommandError('Cannot trade a resource for itself');
  if (!has(ctx, pid, give)) throw new CommandError('You do not have those resources');
  const rates = bankRates(ctx, pid);
  let credits = 0;
  for (const [r, n] of Object.entries(give)) {
    if (n % rates[r] !== 0) throw new CommandError(`${r} trades at ${rates[r]}:1`);
    credits += n / rates[r];
  }
  const want = Object.values(get).reduce((a, b) => a + b, 0);
  if (credits !== want) throw new CommandError(`That trade gives ${credits} card(s), not ${want}`);
  for (const [r, n] of Object.entries(get)) if (bankHas(ctx, r) < n) throw new CommandError(`The bank has no ${r} left`);
  for (const [r, n] of Object.entries(give)) moveResource(ctx, pid, 'bank', r, n);
  for (const [r, n] of Object.entries(get)) moveResource(ctx, 'bank', pid, r, n);
  log(ctx, `${playerName(ctx, pid)} trades with the bank`, pid);
  emit(ctx, 'tradeCompleted', { player: pid, with: 'bank' }, pid);
}

export function offerTrade(ctx: Ctx, pid: string, to: string[] | null, giveIn: Record<Id, number>, getIn: Record<Id, number>): TradeOffer {
  const s = ctx.s;
  if (!ctx.def.trade.playerTrading) throw new CommandError('Player trading is disabled');
  if (s.phase !== 'main') throw new CommandError('You can only trade during the main phase');
  if (s.stack.length || s.prompts.length) throw new CommandError('Finish the current action first');
  const cur = currentPlayerId(s);
  if (ctx.def.trade.onlyCurrentPlayer && pid !== cur) throw new CommandError('Only the current player may propose trades');
  const give = cleanMap(ctx, giveIn, 'give');
  const get = cleanMap(ctx, getIn, 'get');
  if (!Object.keys(give).length || !Object.keys(get).length) throw new CommandError('Trade must give and get something');
  if (Object.keys(give).some((r) => r in get)) throw new CommandError('Cannot trade a resource for itself');
  if (!has(ctx, pid, give)) throw new CommandError('You do not have those resources');
  let targets = (to ?? s.players.map((p) => p.id)).filter((x) => x !== pid && s.players.some((p) => p.id === x));
  if (pid !== cur) targets = targets.filter((x) => x === cur);
  if (!targets.length) throw new CommandError('Nobody to trade with');
  const offer: TradeOffer = {
    id: nextId(ctx, 'tr'), from: pid, to: to ? targets : null, give, get,
    responses: Object.fromEntries(targets.map((t) => [t, 'pending'])),
  };
  s.trades.push(offer);
  log(ctx, `${playerName(ctx, pid)} proposes a trade`, pid);
  return offer;
}

function findTrade(ctx: Ctx, id: string): TradeOffer {
  const t = ctx.s.trades.find((x) => x.id === id);
  if (!t) throw new CommandError('No such trade');
  return t;
}

export function respondTrade(ctx: Ctx, pid: string, tradeId: string, accept: boolean): void {
  const t = findTrade(ctx, tradeId);
  if (!(pid in t.responses)) throw new CommandError('This trade was not offered to you');
  if (accept && !has(ctx, pid, t.get)) throw new CommandError('You do not have those resources');
  t.responses[pid] = accept ? 'accept' : 'reject';
}

export function confirmTrade(ctx: Ctx, pid: string, tradeId: string, withPlayer: string): void {
  const t = findTrade(ctx, tradeId);
  if (t.from !== pid) throw new CommandError('Only the proposer can confirm');
  if (t.responses[withPlayer] !== 'accept') throw new CommandError('That player has not accepted');
  if (ctx.s.stack.length || ctx.s.prompts.length) throw new CommandError('Finish the current action first');
  if (!has(ctx, pid, t.give)) throw new CommandError('You no longer have those resources');
  if (!has(ctx, withPlayer, t.get)) throw new CommandError(`${playerName(ctx, withPlayer)} no longer has those resources`);
  for (const [r, n] of Object.entries(t.give)) moveResource(ctx, pid, withPlayer, r, n);
  for (const [r, n] of Object.entries(t.get)) moveResource(ctx, withPlayer, pid, r, n);
  ctx.s.trades = ctx.s.trades.filter((x) => x.id !== tradeId);
  log(ctx, `${playerName(ctx, pid)} trades with ${playerName(ctx, withPlayer)}`, pid);
  emit(ctx, 'tradeCompleted', { player: pid, with: withPlayer }, pid);
}

export function cancelTrade(ctx: Ctx, pid: string, tradeId: string): void {
  const t = findTrade(ctx, tradeId);
  if (t.from !== pid) throw new CommandError('Only the proposer can cancel');
  ctx.s.trades = ctx.s.trades.filter((x) => x.id !== tradeId);
}
