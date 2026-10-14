/**
 * Built-in mods shipped with the site (expansions, variants).
 * Drop a folder in src/content/expansions/<name>/index.ts that exports
 * `mod: ModDef` and it is picked up automatically: no registry edits needed.
 */
import type { ModDef } from '../engine/schema';

const modules = import.meta.glob<{ mod: ModDef }>('./expansions/*/index.ts', { eager: true });

export const builtinMods: ModDef[] = Object.values(modules)
  .map((m) => m.mod)
  .filter((m): m is ModDef => !!m?.meta?.id)
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name));

export function getBuiltinMod(id: string): ModDef | undefined {
  return builtinMods.find((m) => m.meta.id === id);
}
