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

/**
 * The room's mod list after adding `mod`: any mods it `extends` that aren't in the room yet are
 * added first, looked up in `catalog` (built-ins by default). 'base' is always implied.
 * A mod already in the room is replaced in place.
 */
export function addWithDependencies(current: ModDef[], mod: ModDef, catalog: ModDef[] = builtinMods): ModDef[] {
  const out = [...current];
  const visiting = new Set<string>();
  const add = (m: ModDef) => {
    if (visiting.has(m.meta.id)) return;
    visiting.add(m.meta.id);
    for (const dep of m.meta.extends ?? []) {
      if (dep === 'base' || out.some((x) => x.meta.id === dep)) continue;
      const d = catalog.find((x) => x.meta.id === dep);
      if (d) add(d);
    }
    const i = out.findIndex((x) => x.meta.id === m.meta.id);
    if (i >= 0) out[i] = m; else out.push(m);
  };
  add(mod);
  return out;
}

/** The room's mod list after removing mod `id` and every mod that (directly or not) extends it. */
export function removeWithDependents(current: ModDef[], id: string): ModDef[] {
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of current) {
      if (!gone.has(m.meta.id) && (m.meta.extends ?? []).some((d) => gone.has(d))) { gone.add(m.meta.id); grew = true; }
    }
  }
  return current.filter((m) => !gone.has(m.meta.id));
}
