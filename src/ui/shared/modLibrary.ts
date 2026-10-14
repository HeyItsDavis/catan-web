/**
 * Local mod library: user-made mods stored in localStorage under `catanweb:mods`
 * as a JSON `ModDef[]`. Shared by the editor and the lobby (mod picker).
 */
import type { ModDef } from '../../engine/schema';

const KEY = 'catanweb:mods';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readAll(): ModDef[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isModLike) : [];
  } catch {
    return [];
  }
}

function writeAll(mods: ModDef[]): void {
  storage()?.setItem(KEY, JSON.stringify(mods));
}

function isModLike(m: unknown): m is ModDef {
  return !!m && typeof m === 'object' && !!(m as ModDef).meta && typeof (m as ModDef).meta.id === 'string';
}

/** All mods in the library, in stored order. */
export function listMods(): ModDef[] {
  return readAll();
}

/** One mod by meta.id. */
export function getMod(id: string): ModDef | undefined {
  return readAll().find(m => m.meta.id === id);
}

/** Insert or replace (by meta.id). */
export function saveMod(mod: ModDef): void {
  const all = readAll();
  const i = all.findIndex(m => m.meta.id === mod.meta.id);
  if (i >= 0) all[i] = mod;
  else all.push(mod);
  writeAll(all);
}

export function deleteMod(id: string): void {
  writeAll(readAll().filter(m => m.meta.id !== id));
}
