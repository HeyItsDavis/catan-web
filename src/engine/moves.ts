/**
 * Legality checks shared by applyCommand and getAvailableMoves.
 */
import type { ActionDef, CardInstance, Id } from './schema';
import { type Ctx, currentPlayerId, findPlayer, supplyLeft } from './context';
import { evalCond } from './conditions';
import { evalResourceMap } from './exprs';
import { canPay } from './resources';
import { legalPlacements } from './placement';
import { bankRates } from './trading';
import type { AvailableMoves } from './index';

export function idle(ctx: Ctx): boolean {
  return ctx.s.stack.length === 0 && ctx.s.prompts.length === 0 && ctx.s.phase !== 'gameOver';
}

/** Building / buying window: own turn (or own special-build slot), main phase. */
export function inBuildWindow(ctx: Ctx, pid: string): boolean {
  const s = ctx.s;
  return idle(ctx) && currentPlayerId(s) === pid && (s.phase === 'main' || s.phase === 'specialBuild');
}

export function canRoll(ctx: Ctx, pid: string): boolean {
  return idle(ctx) && currentPlayerId(ctx.s) === pid && ctx.s.phase === 'preRoll' && ctx.def.dice.numeric.length > 0;
}

export function canEndTurn(ctx: Ctx, pid: string): boolean {
  const s = ctx.s;
  return idle(ctx) && currentPlayerId(s) === pid && (s.phase === 'main' || s.phase === 'specialBuild');
}

export function buildStatus(ctx: Ctx, pid: string, piece: Id): { affordable: boolean; hasSpot: boolean } {
  const def = ctx.L.pieces.get(piece);
  if (!def?.cost) return { affordable: false, hasSpot: false };
  const env = { self: pid, vars: {} };
  const affordable = canPay(ctx, pid, evalResourceMap(ctx, env, def.cost));
  const hasSpot = inBuildWindow(ctx, pid) && supplyLeft(ctx, pid, piece) > 0 && legalPlacements(ctx, env, piece, pid).length > 0;
  return { affordable, hasSpot };
}

export function deckBuyable(ctx: Ctx, pid: string, deck: Id): string | null {
  const d = ctx.L.decks.get(deck);
  if (!d?.cost) return 'That deck cannot be bought from';
  if (!inBuildWindow(ctx, pid)) return 'You cannot buy cards now';
  const st = ctx.s.decks[deck];
  if (!st || (!st.draw.length && !(d.reshuffleDiscards && st.discard.length))) return 'The deck is empty';
  if (!canPay(ctx, pid, evalResourceMap(ctx, { self: pid, vars: {} }, d.cost))) return 'You cannot afford a card';
  return null;
}

/** null = playable, else the reason. */
export function cardPlayError(ctx: Ctx, pid: string, inst: CardInstance): string | null {
  const s = ctx.s;
  const cdef = ctx.L.cards.get(inst.card);
  if (!cdef) return 'Unknown card';
  if (!idle(ctx)) return 'Finish the current action first';
  const isTurn = currentPlayerId(s) === pid;
  const t = cdef.play.timing;
  let ok = false;
  if (t === 'ownTurn') ok = isTurn && (s.phase === 'preRoll' || s.phase === 'main');
  else if (t === 'ownTurnBeforeRoll') ok = isTurn && s.phase === 'preRoll';
  else if (t === 'ownTurnAfterRoll') ok = isTurn && s.phase === 'main';
  else if (t === 'anyTime') ok = s.phase === 'preRoll' || s.phase === 'main' || s.phase === 'specialBuild';
  if (!ok) return t === 'never' || t === 'immediate' ? 'This card cannot be played' : 'You cannot play this card now';
  const naq = cdef.play.notOnAcquiredTurn ?? t.startsWith('ownTurn');
  if (naq && inst.acquiredTurn === s.turn) return 'You cannot play a card on the turn you got it';
  const p = findPlayer(ctx, pid)!;
  if (cdef.play.limitGroup && (p.cardPlaysThisTurn[cdef.play.limitGroup] ?? 0) >= 1) return 'You already played a card of this kind this turn';
  if (!evalCond(ctx, { self: pid, vars: { card: inst.card } }, cdef.play.cond)) return 'Conditions to play this card are not met';
  return null;
}

export function actionError(ctx: Ctx, pid: string, a: ActionDef, pieceId?: string): string | null {
  if (!idle(ctx)) return 'Finish the current action first';
  const p = findPlayer(ctx, pid);
  if (!p) return 'Unknown player';
  const vars: Record<string, string> = {};
  if (pieceId) {
    const pc = ctx.s.pieces.find((x) => x.id === pieceId);
    if (!pc || pc.owner !== pid) return 'That is not your piece';
    if (!(ctx.L.pieces.get(pc.type)?.pieceActions ?? []).includes(a.id)) return 'That piece cannot do this';
    vars.piece = pc.at;
    vars.pieceId = pc.id;
  } else if (ctx.L.pieceActionIds.has(a.id)) return 'This action needs a piece';
  if (a.limitPerTurn !== undefined && (p.actionUses[a.id] ?? 0) >= a.limitPerTurn) return 'Already used this turn';
  const env = { self: pid, vars };
  if (!evalCond(ctx, env, a.available)) return 'Not available now';
  if (a.cost && !canPay(ctx, pid, evalResourceMap(ctx, env, a.cost))) return 'You cannot afford this';
  return null;
}

export function availableMoves(ctx: Ctx, pid: string): AvailableMoves {
  const s = ctx.s;
  const p = findPlayer(ctx, pid);
  const prompt = s.prompts.find((x) => x.player === pid) ?? null;
  if (!p) {
    return { canRoll: false, canEndTurn: false, builds: [], buyableDecks: [], playableCards: [], actions: [], bankRates: {}, prompt: null };
  }
  const builds = ctx.def.pieces.filter((d) => d.cost).map((piece) => ({ piece, ...buildStatus(ctx, pid, piece.id) }));
  const buyableDecks = ctx.def.decks.filter((d) => d.cost).map((d) => ({ deck: d.id, affordable: deckBuyable(ctx, pid, d.id) === null }));
  const playableCards = p.hand.filter((c) => cardPlayError(ctx, pid, c) === null)
    .map((c) => ({ cardInstance: c.id, card: ctx.L.cards.get(c.card)! }));
  const actions: AvailableMoves['actions'] = [];
  for (const a of ctx.def.actions) {
    if (ctx.L.pieceActionIds.has(a.id)) {
      for (const pc of s.pieces) {
        if (pc.owner !== pid || !(ctx.L.pieces.get(pc.type)?.pieceActions ?? []).includes(a.id)) continue;
        actions.push({ action: a, enabled: actionError(ctx, pid, a, pc.id) === null, pieceId: pc.id });
      }
    } else actions.push({ action: a, enabled: actionError(ctx, pid, a) === null });
  }
  return {
    canRoll: canRoll(ctx, pid),
    canEndTurn: canEndTurn(ctx, pid),
    builds, buyableDecks, playableCards, actions,
    bankRates: bankRates(ctx, pid),
    prompt,
  };
}
