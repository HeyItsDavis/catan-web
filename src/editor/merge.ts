/**
 * Editor-side definition merging. Prefers the engine's `buildDefinition` (if
 * implemented) and falls back to a lenient local merge so reference dropdowns
 * keep working even while a mod is half-finished or the engine is a stub.
 */
import * as engine from '../engine/index';
import type { CollectionKey, GameDefinition, ModDef } from '../engine/schema';
import { mergeDisplay } from '../engine/merge';

export const COLLECTION_KEYS: CollectionKey[] = [
  'resources', 'terrains', 'pieces', 'cards', 'decks', 'actions',
  'tokens', 'awards', 'ports', 'maps', 'triggers', 'settings',
];

type EngineApi = {
  buildDefinition?: (mods: ModDef[]) => GameDefinition;
  validateMod?: (mod: ModDef, available: ModDef[]) => { path: string; message: string; severity: 'error' | 'warning' }[];
};

/** Engine functions, if implemented. Accessed dynamically: they may be `declare` stubs. */
export function engineApi(): EngineApi {
  const ns = engine as unknown as Record<string, unknown>;
  const out: EngineApi = {};
  const b = ns['buildDefinition'];
  const v = ns['validateMod'];
  if (typeof b === 'function') out.buildDefinition = b as EngineApi['buildDefinition'];
  if (typeof v === 'function') out.validateMod = v as EngineApi['validateMod'];
  return out;
}

export function emptyDefinition(): GameDefinition {
  return {
    mods: [], resources: [], terrains: [], pieces: [], cards: [], decks: [], actions: [], tokens: [],
    awards: [], ports: [], maps: [], triggers: [], settings: [],
    dice: { numeric: [{ sides: 6 }, { sides: 6 }] },
    setup: [],
    trade: { bankRates: { resource: 4, commodity: 4 }, playerTrading: true, onlyCurrentPlayer: true },
    victoryPoints: 10,
    discardLimit: 7,
  };
}

/** Lenient local merge (same id = replace, new id = add, `remove` deletes). Never throws. */
export function mergeMods(mods: ModDef[]): GameDefinition {
  const def = emptyDefinition();
  for (const mod of mods) {
    if (!mod || !mod.meta) continue;
    def.mods.push(mod.meta);
    for (const k of COLLECTION_KEYS) {
      const removed = new Set(mod.remove?.[k] ?? []);
      let list = (def[k] as { id: string }[]).filter(x => !removed.has(x.id));
      for (const item of (mod[k] ?? []) as { id: string }[]) {
        if (!item || typeof item !== 'object') continue;
        const i = list.findIndex(x => x.id === item.id);
        if (i >= 0) list = list.map((x, j) => (j === i ? item : x));
        else list = [...list, item];
      }
      (def as unknown as Record<string, unknown>)[k] = list;
    }
    if (mod.dice) def.dice = mod.dice;
    if (mod.setup) def.setup = mod.setup;
    if (mod.trade) def.trade = { ...def.trade, ...mod.trade, bankRates: { ...def.trade.bankRates, ...(mod.trade.bankRates ?? {}) } };
    if (typeof mod.victoryPoints === 'number') def.victoryPoints = mod.victoryPoints;
    if (typeof mod.discardLimit === 'number') def.discardLimit = mod.discardLimit;
    if (mod.display && typeof mod.display === 'object') {
      try { def.display = mergeDisplay(def.display, mod.display); } catch { /* malformed hints: ignore */ }
    }
  }
  return def;
}

/**
 * The mods `mod` depends on, in application order (deepest first), resolved
 * from `available` by meta.id. Unknown ids are skipped (and reported by validation).
 */
export function dependencyChain(mod: ModDef, available: ModDef[]): ModDef[] {
  const byId = new Map(available.map(m => [m.meta.id, m]));
  const out: ModDef[] = [];
  const seen = new Set<string>([mod.meta.id]);
  const visit = (m: ModDef) => {
    for (const dep of m.meta.extends ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const d = byId.get(dep);
      if (!d) continue;
      visit(d);
      out.push(d);
    }
  };
  visit(mod);
  return out;
}

function build(mods: ModDef[]): GameDefinition {
  const api = engineApi();
  if (api.buildDefinition) {
    try {
      return api.buildDefinition(mods);
    } catch {
      /* fall through to lenient merge */
    }
  }
  return mergeMods(mods);
}

/** Definition of everything `mod` extends (what "base" means for override detection). */
export function parentDefinition(mod: ModDef, available: ModDef[]): GameDefinition {
  return build(dependencyChain(mod, available));
}

/** Definition including this mod. */
export function fullDefinition(mod: ModDef, available: ModDef[]): GameDefinition {
  return build([...dependencyChain(mod, available), mod]);
}
