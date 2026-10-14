/**
 * Mod merging: mods are ordered so every mod comes after what it `extends`, then each
 * collection is merged by id (same id replaces in place, new id appends, `remove` deletes).
 * Scalar sections (dice, setup, victoryPoints, discardLimit) are replaced when present;
 * `trade` is merged field by field (bankRates merged by kind).
 */
import type { CollectionKey, GameDefinition, ModDef } from './schema';
import { validateDefinition, type Problem } from './validate';

export class ModValidationError extends Error {
  problems: Problem[];
  constructor(problems: Problem[]) {
    super(`Invalid mod content:\n${problems.map((p) => `  ${p.path}: ${p.message}`).join('\n')}`);
    this.name = 'ModValidationError';
    this.problems = problems;
  }
}

export const COLLECTIONS: CollectionKey[] = [
  'resources', 'terrains', 'pieces', 'cards', 'decks', 'actions', 'tokens', 'awards', 'ports', 'maps', 'triggers', 'settings',
];

/** Order mods so that each comes after the mods it extends (stable w.r.t. input order). */
export function sortMods(mods: ModDef[]): ModDef[] {
  const byId = new Map<string, ModDef>();
  for (const m of mods) {
    if (byId.has(m.meta.id)) throw new ModValidationError([{ path: `${m.meta.id}.meta.id`, message: `Duplicate mod id "${m.meta.id}"`, severity: 'error' }]);
    byId.set(m.meta.id, m);
  }
  const out: ModDef[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (m: ModDef) => {
    const st = state.get(m.meta.id);
    if (st === 'done') return;
    if (st === 'visiting') throw new ModValidationError([{ path: `${m.meta.id}.meta.extends`, message: 'Circular extends', severity: 'error' }]);
    state.set(m.meta.id, 'visiting');
    for (const dep of m.meta.extends ?? []) {
      const d = byId.get(dep);
      if (!d) throw new ModValidationError([{ path: `${m.meta.id}.meta.extends`, message: `Extends unknown mod "${dep}"`, severity: 'error' }]);
      visit(d);
    }
    state.set(m.meta.id, 'done');
    out.push(m);
  };
  mods.forEach(visit);
  return out;
}

export function emptyDefinition(): GameDefinition {
  return {
    mods: [], resources: [], terrains: [], pieces: [], cards: [], decks: [], actions: [], tokens: [], awards: [], ports: [],
    maps: [], triggers: [], settings: [],
    dice: { numeric: [{ sides: 6 }, { sides: 6 }] },
    setup: [],
    trade: { bankRates: { resource: 4, commodity: 4 }, playerTrading: true, onlyCurrentPlayer: true },
    victoryPoints: 10,
    discardLimit: 7,
  };
}

/** Merge already-sorted mods without validation. */
export function mergeMods(sorted: ModDef[]): GameDefinition {
  const def = emptyDefinition();
  for (const mod of sorted) {
    def.mods.push(structuredClone(mod.meta));
    for (const key of COLLECTIONS) {
      const list = def[key] as { id: string }[];
      const removed = new Set(mod.remove?.[key] ?? []);
      let next = list.filter((x) => !removed.has(x.id));
      for (const item of (mod[key] ?? []) as { id: string }[]) {
        const i = next.findIndex((x) => x.id === item.id);
        const copy = structuredClone(item);
        if (i >= 0) next = next.map((x, j) => (j === i ? copy : x));
        else next.push(copy);
      }
      (def as unknown as Record<string, unknown>)[key] = next;
    }
    if (mod.dice) def.dice = structuredClone(mod.dice);
    if (mod.setup) def.setup = structuredClone(mod.setup);
    if (mod.trade) {
      def.trade = {
        ...def.trade, ...structuredClone(mod.trade),
        bankRates: { ...def.trade.bankRates, ...(mod.trade.bankRates ?? {}) },
      };
    }
    if (mod.victoryPoints !== undefined) def.victoryPoints = mod.victoryPoints;
    if (mod.discardLimit !== undefined) def.discardLimit = mod.discardLimit;
  }
  return def;
}

export function buildDefinition(mods: ModDef[]): GameDefinition {
  const def = mergeMods(sortMods(mods));
  const errors = validateDefinition(def).filter((p) => p.severity === 'error');
  if (errors.length) throw new ModValidationError(errors);
  return def;
}
