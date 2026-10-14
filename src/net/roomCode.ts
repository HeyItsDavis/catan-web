/** Room codes: 6 chars from an alphabet without look-alikes (no I, L, O, 0, 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** Namespace on the shared public PeerJS broker. */
export const PEER_PREFIX = 'catanweb-';

export function generateRoomCode(random: () => number = secureRandom): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length];
  }
  return s;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * Accepts user input: a bare code ("abc 234"), or a pasted invite link
 * (".../#/room/ABC234"). Returns the normalized code or null.
 */
export function normalizeRoomCode(input: string): string | null {
  const fromLink = /#\/room\/([^/?#\s]+)/i.exec(input);
  const code = (fromLink ? fromLink[1] : input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return isValidRoomCode(code) ? code : null;
}

export function peerIdForRoom(code: string): string {
  return PEER_PREFIX + code;
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}
