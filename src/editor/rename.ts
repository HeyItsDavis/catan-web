/**
 * Rename an item id and every reference to it inside one mod, so that editing a
 * name (ids follow names until edited) doesn't leave dangling references.
 *
 * References are found by the field they live in, per collection (e.g. a resource
 * id appears as `resource`, in `options` lists, or as a key of cost/produce maps).
 * Var names, labels, icons etc. are never touched.
 */
import type { CollectionKey, ModDef } from '../engine/schema';

interface RefRule {
  /** Fields whose string value (or list of strings) is an id of this collection. */
  values: string[];
  /** Fields holding a map keyed by ids of this collection. */
  mapKeys?: string[];
  /** Fields holding a map whose values are lists of ids (terrain bags). */
  mapOfLists?: string[];
}

const RULES: Partial<Record<CollectionKey, RefRule>> = {
  resources: { values: ['resource', 'options'], mapKeys: ['cost', 'produces', 'resources', 'gives', 'give', 'get'] },
  terrains: { values: ['terrain', 'startTerrain', 'onTerrain'], mapOfLists: ['terrainBags'] },
  pieces: { values: ['piece', 'upgradesFrom', 'from', 'to'] },
  cards: { values: ['card'] },
  decks: { values: ['deck'] },
  tokens: { values: ['token'] },
  actions: { values: ['pieceActions'] },
  settings: { values: ['setting', 'param'] },
  ports: { values: ['port', 'portBag'] },
};

export function renameReferences(mod: ModDef, k: CollectionKey, oldId: string, newId: string): ModDef {
  const rule = RULES[k];
  if (!rule || !oldId || oldId === newId) return mod;
  const values = new Set(rule.values);
  const mapKeys = new Set(rule.mapKeys ?? []);
  const mapOfLists = new Set(rule.mapOfLists ?? []);
  const sub = (s: unknown) => (s === oldId ? newId : s);

  const walk = (node: unknown, key: string | null): unknown => {
    if (Array.isArray(node)) {
      if (key !== null && values.has(key)) return node.map((x) => (typeof x === 'string' ? sub(x) : walk(x, null)));
      return node.map((x) => walk(x, null));
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const isMap = key !== null && mapKeys.has(key);
      for (const [kk, v] of Object.entries(obj)) {
        const nk = isMap && kk === oldId ? newId : kk;
        if (key !== null && mapOfLists.has(key) && Array.isArray(v)) out[nk] = v.map(sub);
        else if (typeof v === 'string') out[nk] = values.has(kk) ? sub(v) : v;
        else out[nk] = walk(v, kk);
      }
      return out;
    }
    return node;
  };

  const out: Record<string, unknown> = { ...mod };
  for (const [kk, v] of Object.entries(mod)) {
    if (kk === 'meta') continue;
    if (kk === 'remove') continue; // removals refer to parent items, never to this mod's own ids
    out[kk] = walk(v, kk);
  }
  return out as unknown as ModDef;
}
