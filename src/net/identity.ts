/** Stable per-browser identity, kept in localStorage. */

const ID_KEY = 'catanweb:playerId';
const SECRET_KEY = 'catanweb:playerSecret';
const NAME_KEY = 'catanweb:name';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function getOrCreate(key: string): string {
  try {
    let v = localStorage.getItem(key);
    if (!v) { v = randomId(); localStorage.setItem(key, v); }
    return v;
  } catch {
    // Storage blocked (private mode): fall back to a per-tab id.
    const w = globalThis as unknown as Record<string, string>;
    w[`__${key}`] ??= randomId();
    return w[`__${key}`];
  }
}

export function getPlayerId(): string { return getOrCreate(ID_KEY); }
export function getPlayerSecret(): string { return getOrCreate(SECRET_KEY); }

export function getSavedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export function saveName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}
