/**
 * The browser's local mod library, shared by the lobby and the mod editor.
 * Stored in localStorage under `catanweb:mods` as a JSON array of LibraryEntry.
 */
import type { ModDef } from '../../engine/schema';
import { checkModShape } from '../../net/lobby';

export const MOD_LIBRARY_KEY = 'catanweb:mods';

export interface LibraryEntry {
  mod: ModDef;
  /** Epoch ms of the last save. */
  updatedAt: number;
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function storage(s?: KV | null): KV | null {
  if (s !== undefined) return s;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

const listeners = new Set<() => void>();
function notify(): void { for (const l of [...listeners]) l(); }

function readAll(s?: KV | null): LibraryEntry[] {
  const st = storage(s);
  if (!st) return [];
  try {
    const raw = st.getItem(MOD_LIBRARY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is LibraryEntry =>
      !!e && typeof e === 'object' && checkModShape((e as LibraryEntry).mod) === null);
  } catch {
    return [];
  }
}

function writeAll(entries: LibraryEntry[], s?: KV | null): void {
  const st = storage(s);
  if (!st) throw new Error('Browser storage is unavailable');
  st.setItem(MOD_LIBRARY_KEY, JSON.stringify(entries));
  notify();
}

/** All saved mods, most recently updated first. */
export function listMods(s?: KV | null): LibraryEntry[] {
  return readAll(s).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadMod(id: string, s?: KV | null): ModDef | null {
  return readAll(s).find((e) => e.mod.meta.id === id)?.mod ?? null;
}

/** Insert or replace (by meta.id). */
export function saveMod(mod: ModDef, s?: KV | null): void {
  const err = checkModShape(mod);
  if (err) throw new Error(err);
  const rest = readAll(s).filter((e) => e.mod.meta.id !== mod.meta.id);
  writeAll([...rest, { mod, updatedAt: Date.now() }], s);
}

export function deleteMod(id: string, s?: KV | null): void {
  writeAll(readAll(s).filter((e) => e.mod.meta.id !== id), s);
}

/** Parse an uploaded .json mod file. */
export function parseModJson(text: string): { ok: true; mod: ModDef } | { ok: false; error: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const err = checkModShape(data);
  return err ? { ok: false, error: err } : { ok: true, mod: data as ModDef };
}

/** Subscribe to library changes (this tab and other tabs). */
export function subscribeModLibrary(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === MOD_LIBRARY_KEY) cb(); };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
