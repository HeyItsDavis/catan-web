import { describe, expect, it } from 'vitest';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, peerIdForRoom, ROOM_CODE_ALPHABET } from './roomCode';

describe('room codes', () => {
  it('generates 6 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(6);
      expect(isValidRoomCode(c)).toBe(true);
      expect(c).not.toMatch(/[IL0O1]/);
    }
  });

  it('is deterministic for a given random source and covers the alphabet edges', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAAA');
    expect(generateRoomCode(() => 0.999999)).toBe(ROOM_CODE_ALPHABET.at(-1)!.repeat(6));
  });

  it('normalizes user input and pasted links', () => {
    expect(normalizeRoomCode('abc234')).toBe('ABC234');
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeRoomCode('https://x.github.io/catan/#/room/XYZ789')).toBe('XYZ789');
    expect(normalizeRoomCode('ABC23')).toBeNull();
    expect(normalizeRoomCode('ABC10O')).toBeNull();
  });

  it('namespaces the peer id', () => {
    expect(peerIdForRoom('ABC234')).toBe('catanweb-ABC234');
  });
});
