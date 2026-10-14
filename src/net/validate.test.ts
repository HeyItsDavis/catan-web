import { describe, expect, it } from 'vitest';
import { cleanChat, isCommand, parseClientMessage } from './validate';

describe('parseClientMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage({ t: 'hello', protocol: 1, playerId: 'p1', name: 'Ann', secret: 's' })).not.toBeNull();
    expect(parseClientMessage({ t: 'lobby:ready', ready: true })).not.toBeNull();
    expect(parseClientMessage({ t: 'lobby:start' })).not.toBeNull();
    expect(parseClientMessage({ t: 'ping', at: 5 })).not.toBeNull();
    expect(parseClientMessage({ t: 'game:command', clientSeq: 1, command: { type: 'rollDice' } })).not.toBeNull();
    expect(parseClientMessage({ t: 'lobby:mods', mods: [] })).not.toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage('hello')).toBeNull();
    expect(parseClientMessage({ t: 'nope' })).toBeNull();
    expect(parseClientMessage({ t: 'hello', protocol: 1, playerId: '', name: 'x' })).toBeNull();
    expect(parseClientMessage({ t: 'hello', protocol: '1', playerId: 'p', name: 'x' })).toBeNull();
    expect(parseClientMessage({ t: 'lobby:ready', ready: 'yes' })).toBeNull();
    expect(parseClientMessage({ t: 'lobby:settings', settings: [] })).toBeNull();
    expect(parseClientMessage({ t: 'game:command', clientSeq: 1, command: { type: 'hack' } })).toBeNull();
    expect(parseClientMessage({ t: 'chat', text: 'x'.repeat(5000) })).toBeNull();
  });
});

describe('isCommand', () => {
  it('validates command payloads', () => {
    expect(isCommand({ type: 'build', piece: 'road' })).toBe(true);
    expect(isCommand({ type: 'build' })).toBe(false);
    expect(isCommand({ type: 'respond', promptId: 'p', answer: ['a', 'b'] })).toBe(true);
    expect(isCommand({ type: 'respond', promptId: 'p', answer: { wood: 1 } })).toBe(true);
    expect(isCommand({ type: 'respond', promptId: 'p', answer: { wood: 'x' } })).toBe(false);
    expect(isCommand({ type: 'bankTrade', give: { wood: 4 }, get: { ore: 1 } })).toBe(true);
    expect(isCommand({ type: 'offerTrade', to: null, give: {}, get: {} })).toBe(true);
    expect(isCommand({ type: 'offerTrade', to: 'p2', give: {}, get: {} })).toBe(false);
    expect(isCommand({ type: 'respondTrade', tradeId: 't', accept: 1 })).toBe(false);
  });
});

describe('cleanChat', () => {
  it('trims, strips control chars and bounds length', () => {
    expect(cleanChat('  hi\u0000 ')).toBe('hi');
    expect(cleanChat('   ')).toBe('');
    expect(cleanChat('a'.repeat(1000))).toHaveLength(300);
  });
});
