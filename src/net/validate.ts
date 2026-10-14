/**
 * Structural validation of untrusted messages arriving over the wire.
 * Deep checks (settings ranges, mod content, command legality) happen later
 * in the lobby reducer and the engine.
 */
import type { Command } from '../engine/schema';
import type { ClientMessage, ServerMessage } from './protocol';

const MAX_CHAT = 300;
const MAX_ID = 128;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_ID): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isAmountMap = (v: unknown): v is Record<string, number> =>
  isObj(v) && Object.entries(v).every(([k, n]) => k.length <= MAX_ID && isNum(n));
const isPlayerList = (v: unknown): v is string[] | null =>
  v === null || (Array.isArray(v) && v.length <= 16 && v.every((x) => isStr(x)));

export function isCommand(c: unknown): c is Command {
  if (!isObj(c) || typeof c.type !== 'string') return false;
  switch (c.type) {
    case 'rollDice':
    case 'endTurn':
      return true;
    case 'build': return isStr(c.piece);
    case 'buyCard': return isStr(c.deck);
    case 'playCard': return isStr(c.cardInstance);
    case 'doAction': return isStr(c.action) && (c.pieceId === undefined || isStr(c.pieceId));
    case 'respond': {
      const a = c.answer;
      const answerOk = a === null || isStr(a, 4096)
        || (Array.isArray(a) && a.length <= 256 && a.every((x) => isStr(x)))
        || isAmountMap(a);
      return isStr(c.promptId) && answerOk;
    }
    case 'bankTrade': return isAmountMap(c.give) && isAmountMap(c.get);
    case 'offerTrade': return isPlayerList(c.to) && isAmountMap(c.give) && isAmountMap(c.get);
    case 'respondTrade': return isStr(c.tradeId) && typeof c.accept === 'boolean';
    case 'confirmTrade': return isStr(c.tradeId) && isStr(c.withPlayer);
    case 'cancelTrade': return isStr(c.tradeId);
    default: return false;
  }
}

/** Returns the message if structurally valid, otherwise null. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  const m = raw;
  switch (m.t) {
    case 'hello':
      return isNum(m.protocol) && isStr(m.playerId) && m.playerId.length > 0 && isStr(m.name, 200)
        && (m.secret === undefined || isStr(m.secret))
        ? (m as ClientMessage) : null;
    case 'lobby:setName': return isStr(m.name, 200) ? (m as ClientMessage) : null;
    case 'lobby:setColor': return isStr(m.color, 32) ? (m as ClientMessage) : null;
    case 'lobby:ready': return typeof m.ready === 'boolean' ? (m as ClientMessage) : null;
    case 'lobby:settings': return isObj(m.settings) ? (m as ClientMessage) : null;
    case 'lobby:mods': return Array.isArray(m.mods) ? (m as ClientMessage) : null;
    case 'lobby:kick': return isStr(m.playerId) ? (m as ClientMessage) : null;
    case 'lobby:start': return m as ClientMessage;
    case 'game:command':
      return isNum(m.clientSeq) && isCommand(m.command) ? (m as ClientMessage) : null;
    case 'chat': return isStr(m.text, MAX_CHAT * 4) ? (m as ClientMessage) : null;
    case 'ping': return isNum(m.at) ? (m as ClientMessage) : null;
    default: return null;
  }
}

/** Light check on messages from the host (trusted, but guard against garbage). */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'welcome': case 'error': case 'lobby': case 'game:state': case 'game:rejected':
    case 'chat': case 'pong': case 'kicked': case 'timer':
      return raw as ServerMessage;
    default: return null;
  }
}

/** Trim and bound chat text; empty result means "don't send". */
export function cleanChat(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT);
}
