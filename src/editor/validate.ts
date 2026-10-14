/**
 * Lightweight structural checks run by the editor (in addition to the
 * engine's `validateMod`). They catch the mistakes designers actually make:
 * missing ids, duplicate ids, dangling references, unset variables, empty
 * required fields. Paths use `formatPath` syntax and drive click-to-navigate.
 */
import type { CollectionKey, Condition, Effect, GameDefinition, ModDef, PieceQuery } from '../engine/schema';
import type { ParamKind, ParamSpec } from './catalog';
import { COLLECTION_KEYS, engineApi, fullDefinition, parentDefinition } from './merge';
import { formatPath, type Path } from './paths';
import { atScope, eventScope, type VarInfo } from './vars';
import { walkCondition, walkEffects, walkExpr, type WalkVisitor } from './walk';

export interface Issue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  source: 'editor' | 'engine';
}

type RefCollection = 'resources' | 'terrains' | 'pieces' | 'cards' | 'decks' | 'tokens' | 'settings' | 'actions';

const REF_KINDS: Partial<Record<ParamKind, RefCollection>> = {
  pieceId: 'pieces', pieceIds: 'pieces', cardId: 'cards', deckId: 'decks', tokenId: 'tokens',
  terrainId: 'terrains', terrainIds: 'terrains', settingId: 'settings', resourceIds: 'resources',
};

const SINGULAR: Record<RefCollection, string> = {
  resources: 'resource', terrains: 'terrain', pieces: 'piece', cards: 'card', decks: 'deck',
  tokens: 'token', settings: 'setting', actions: 'action',
};

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

class Checker {
  issues: Issue[] = [];
  ids: Record<RefCollection, Set<string>>;
  def: GameDefinition;
  constructor(def: GameDefinition) {
    this.def = def;
    const set = (k: RefCollection) => new Set(((def[k] ?? []) as { id: string }[]).map(x => x.id));
    this.ids = {
      resources: set('resources'), terrains: set('terrains'), pieces: set('pieces'), cards: set('cards'),
      decks: set('decks'), tokens: set('tokens'), settings: set('settings'), actions: set('actions'),
    };
  }

  add(path: Path, message: string, severity: 'error' | 'warning' = 'error') {
    this.issues.push({ path: formatPath(path), message, severity, source: 'editor' });
  }

  ref(coll: RefCollection, id: unknown, path: Path, required = true) {
    if (id === undefined || id === null) {
      if (required) this.add(path, `Pick a ${SINGULAR[coll]}.`);
      return;
    }
    if (typeof id !== 'string') { this.add(path, `Expected a ${SINGULAR[coll]} id.`); return; }
    if (id === '') { if (required) this.add(path, `Pick a ${SINGULAR[coll]}.`); return; }
    if (!this.ids[coll].has(id)) this.add(path, `Unknown ${SINGULAR[coll]} “${id}”.`);
  }

  refs(coll: RefCollection, ids: unknown, path: Path, required = true) {
    if (Array.isArray(ids)) {
      if (required && ids.length === 0) this.add(path, `Pick at least one ${SINGULAR[coll]}.`);
      ids.forEach((id, i) => this.ref(coll, id, [...path, i]));
    } else this.ref(coll, ids, path, required);
  }

  resourceMap(m: unknown, path: Path) {
    if (m === undefined) return;
    if (!m || typeof m !== 'object' || Array.isArray(m)) { this.add(path, 'Expected a list of resource amounts.'); return; }
    for (const k of Object.keys(m)) if (!this.ids.resources.has(k)) this.add([...path, k], `Unknown resource “${k}”.`);
  }

  varRef(name: unknown, path: Path, scope: VarInfo[], what = 'Variable') {
    if (typeof name !== 'string' || !name) { this.add(path, `Pick a ${what.toLowerCase()}.`); return; }
    if (!scope.some(v => v.name === name)) {
      this.add(path, `${what} “${name}” isn’t set before this point.`, 'warning');
    }
  }

  playerRef(p: unknown, path: Path, scope: VarInfo[]) {
    if (p === undefined || typeof p === 'string') return;
    if (p && typeof p === 'object') {
      if ('var' in p) this.varRef((p as { var: string }).var, [...path, 'var'], scope, 'Player variable');
      else if ('ownerOf' in p) this.varRef((p as { ownerOf: string }).ownerOf, [...path, 'ownerOf'], scope, 'Variable');
      else this.add(path, 'Unknown player reference.');
    }
  }

  pieceQuery(q: unknown, path: Path, scope: VarInfo[]) {
    if (q === undefined) return;
    if (!q || typeof q !== 'object') { this.add(path, 'Expected a piece query.'); return; }
    const qq = q as PieceQuery;
    if (qq.piece !== undefined) this.refs('pieces', qq.piece, [...path, 'piece'], false);
    if (qq.onTerrain) this.refs('terrains', qq.onTerrain, [...path, 'onTerrain'], false);
    if (qq.owner !== undefined && qq.owner !== 'any' && qq.owner !== 'others') this.playerRef(qq.owner, [...path, 'owner'], scope);
    if (qq.near) this.varRef(qq.near, [...path, 'near'], scope);
  }

  visitor(): WalkVisitor {
    return {
      unknown: (family, value, path) => {
        const what = family === 'effect' ? `step “${(value as { op?: string })?.op ?? JSON.stringify(value)}”` : `${family} ${JSON.stringify(value)}`;
        this.add(path, `Unknown ${what}.`);
      },
      param: (p, value, path, scope) => this.param(p, value, path, scope),
    };
  }

  param(p: ParamSpec, value: unknown, path: Path, scope: VarInfo[]) {
    if (value === undefined) {
      if (!p.optional && !['effects', 'exprList', 'conditionList'].includes(p.kind)) this.add(path, `“${p.label}” is required.`);
      return;
    }
    const coll = REF_KINDS[p.kind];
    if (coll) {
      if (p.kind === 'pieceIds' || p.kind === 'terrainIds' || p.kind === 'resourceIds') this.refs(coll, value, path, !p.optional);
      else this.ref(coll, value, path, !p.optional);
      return;
    }
    switch (p.kind) {
      case 'resourceMap': this.resourceMap(value, path); break;
      case 'resourceRef':
        if (typeof value === 'string') { if (!p.extra?.includes(value)) this.ref('resources', value, path); }
        else if (value && typeof value === 'object' && 'var' in value) this.varRef((value as { var: string }).var, [...path, 'var'], scope, 'Resource variable');
        break;
      case 'playerRef': case 'playerFilter': this.playerRef(value, path, scope); break;
      case 'pieceQuery': this.pieceQuery(value, path, scope); break;
      case 'varRef': case 'locationVar': this.varRef(value, path, scope); break;
      case 'varName':
        if (typeof value !== 'string' || !VAR_NAME.test(value)) this.add(path, 'Names must start with a letter and use only letters, digits and _.', 'warning');
        break;
      case 'numbers':
        if (!Array.isArray(value) || value.some(n => typeof n !== 'number')) this.add(path, 'Expected a list of numbers.');
        break;
      case 'effects':
        if (!Array.isArray(value)) this.add(path, 'Expected a list of steps.');
        break;
      case 'options':
        if (!Array.isArray(value) || value.length === 0) this.add(path, 'Add at least one option.');
        break;
      case 'enum':
        if (p.options && !p.options.includes(value as string)) this.add(path, `Must be one of: ${p.options.join(', ')}.`);
        break;
    }
  }

  effects(list: unknown, path: Path, scope: VarInfo[] = []) { walkEffects(list, path, scope, this.visitor()); }
  condition(c: unknown, path: Path, scope: VarInfo[] = []) { walkCondition(c, path, scope, this.visitor()); }
  expr(e: unknown, path: Path, scope: VarInfo[] = []) { walkExpr(e, path, scope, this.visitor()); }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** Structural checks for one mod given the mods it may extend. */
export function checkMod(mod: ModDef, available: ModDef[]): Issue[] {
  let def: GameDefinition;
  let parent: GameDefinition;
  try {
    def = fullDefinition(mod, available);
    parent = parentDefinition(mod, available);
  } catch (e) {
    return [{ path: '', message: `Could not merge mod: ${(e as Error).message}`, severity: 'error', source: 'editor' }];
  }
  const c = new Checker(def);
  const m = mod as unknown as Record<string, unknown>;

  /* meta */
  if (!isObj(mod.meta)) { c.add(['meta'], 'Missing meta section.'); return c.issues; }
  if (!mod.meta.id) c.add(['meta', 'id'], 'The mod needs an id.');
  else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(mod.meta.id)) c.add(['meta', 'id'], 'Ids should use only letters, digits, - and _.', 'warning');
  if (mod.meta.id === 'base') c.add(['meta', 'id'], '“base” is reserved for the base game.');
  if (!mod.meta.name) c.add(['meta', 'name'], 'Give the mod a name.', 'warning');
  if (!mod.meta.version) c.add(['meta', 'version'], 'Give the mod a version (e.g. 0.1.0).', 'warning');
  const known = new Set(available.map(a => a.meta.id));
  (mod.meta.extends ?? []).forEach((id, i) => {
    if (id === mod.meta.id) c.add(['meta', 'extends', i], 'A mod cannot extend itself.');
    else if (!known.has(id)) c.add(['meta', 'extends', i], `Extends unknown mod “${id}”.`);
  });

  /* collections: ids */
  for (const k of COLLECTION_KEYS) {
    const list = m[k];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { c.add([k], 'Expected a list.'); continue; }
    const seen = new Map<string, number>();
    list.forEach((item: unknown, i: number) => {
      if (!isObj(item)) { c.add([k, i], 'Expected an object.'); return; }
      const id = item.id;
      if (typeof id !== 'string' || !id) c.add([k, i, 'id'], 'Missing id.');
      else if (seen.has(id)) c.add([k, i, 'id'], `Duplicate id “${id}” (also item #${seen.get(id)! + 1}).`);
      else seen.set(id, i);
      if (k !== 'ports' && k !== 'triggers' && 'name' in item === false) c.add([k, i, 'name'], 'Missing name.', 'warning');
    });
  }

  /* remove lists */
  if (mod.remove) {
    for (const [k, ids] of Object.entries(mod.remove) as [CollectionKey, string[]][]) {
      if (!COLLECTION_KEYS.includes(k)) { c.add(['remove', k], `Unknown collection “${k}”.`); continue; }
      const parentIds = new Set((parent[k] as { id: string }[]).map(x => x.id));
      (ids ?? []).forEach((id, i) => {
        if (!parentIds.has(id)) c.add(['remove', k, i], `Nothing called “${id}” to remove from ${k}.`, 'warning');
      });
    }
  }

  /* per-collection content */
  mod.resources?.forEach((r, i) => {
    if (!r.kind) c.add(['resources', i, 'kind'], 'Pick a kind (resource or commodity).', 'warning');
  });
  mod.terrains?.forEach((t, i) => {
    c.resourceMap(t.produces, ['terrains', i, 'produces']);
    if (t.producesChoice?.options) c.refs('resources', t.producesChoice.options, ['terrains', i, 'producesChoice', 'options'], false);
  });
  mod.pieces?.forEach((p, i) => {
    const base: Path = ['pieces', i];
    if (!isObj(p.placement)) c.add([...base, 'placement'], 'Placement rule is required.');
    else {
      c.condition(p.placement.where, [...base, 'placement', 'where'], atScope());
      c.condition(p.placement.setupWhere, [...base, 'placement', 'setupWhere'], atScope());
    }
    c.resourceMap(p.cost, [...base, 'cost']);
    if (p.upgradesFrom) c.refs('pieces', p.upgradesFrom, [...base, 'upgradesFrom'], false);
    p.productionBonus?.forEach((b, j) => {
      c.ref('terrains', b.terrain, [...base, 'productionBonus', j, 'terrain']);
      c.resourceMap(b.gives, [...base, 'productionBonus', j, 'gives']);
    });
    p.pieceActions?.forEach((a, j) => c.ref('actions', a, [...base, 'pieceActions', j]));
    p.triggers?.forEach((t, j) => checkTrigger(c, t, [...base, 'triggers', j]));
  });
  mod.cards?.forEach((card, i) => {
    if (!isObj(card.play)) c.add(['cards', i, 'play'], 'Play timing is required.');
    else c.condition(card.play.cond, ['cards', i, 'play', 'cond']);
    c.effects(card.effect, ['cards', i, 'effect']);
    const inDeck = def.decks.some(d => d.cards?.some(x => x.card === card.id));
    if (!inDeck && card.play?.timing !== 'never') c.add(['cards', i], `“${card.name || card.id}” isn’t in any deck yet, so nobody can draw it.`, 'warning');
  });
  mod.decks?.forEach((d, i) => {
    if (!Array.isArray(d.cards)) c.add(['decks', i, 'cards'], 'Expected a list of cards.');
    else d.cards.forEach((x, j) => {
      c.ref('cards', x.card, ['decks', i, 'cards', j, 'card']);
      if (!(x.count >= 1)) c.add(['decks', i, 'cards', j, 'count'], 'Count should be at least 1.', 'warning');
    });
    c.resourceMap(d.cost, ['decks', i, 'cost']);
  });
  mod.actions?.forEach((a, i) => {
    c.resourceMap(a.cost, ['actions', i, 'cost']);
    if (a.available === undefined) c.add(['actions', i, 'available'], 'Say when the action is available.');
    else c.condition(a.available, ['actions', i, 'available']);
    c.effects(a.effect, ['actions', i, 'effect']);
  });
  mod.tokens?.forEach((t, i) => {
    c.condition(t.where, ['tokens', i, 'where'], atScope());
    if (t.onMove) c.effects(t.onMove, ['tokens', i, 'onMove'], atScope());
    if (t.startTerrain) c.ref('terrains', t.startTerrain, ['tokens', i, 'startTerrain']);
  });
  mod.awards?.forEach((a, i) => c.expr(a.metric, ['awards', i, 'metric']));
  mod.ports?.forEach((p, i) => {
    if (p.resource !== 'any') c.ref('resources', p.resource, ['ports', i, 'resource']);
    if (!(p.ratio >= 1)) c.add(['ports', i, 'ratio'], 'Ratio should be at least 1.');
  });
  mod.triggers?.forEach((t, i) => checkTrigger(c, t, ['triggers', i]));
  mod.settings?.forEach((s, i) => {
    if (s.type === 'select' && !(s.options?.length)) c.add(['settings', i, 'options'], 'A select setting needs options.');
    if (s.type === 'number' && typeof s.default !== 'number') c.add(['settings', i, 'default'], 'Default should be a number.');
    if (s.type === 'boolean' && typeof s.default !== 'boolean') c.add(['settings', i, 'default'], 'Default should be on or off.');
  });
  mod.maps?.forEach((mp, i) => {
    if (mp.minPlayers > mp.maxPlayers) c.add(['maps', i, 'minPlayers'], 'Min players is more than max players.');
    const bags = mp.terrainBags ?? {};
    (mp.hexes ?? []).forEach((h, j) => {
      if (typeof h.terrain === 'string' && h.terrain.startsWith('@')) {
        if (!(h.terrain.slice(1) in bags)) c.add(['maps', i, 'hexes', j, 'terrain'], `Unknown terrain bag “${h.terrain.slice(1)}”.`);
      } else c.ref('terrains', h.terrain, ['maps', i, 'hexes', j, 'terrain']);
      if (h.port && h.port.port !== '@' && !def.ports.some(p => p.id === h.port!.port)) c.add(['maps', i, 'hexes', j, 'port'], `Unknown port “${h.port.port}”.`);
    });
    Object.entries(bags).forEach(([bag, ids]) => c.refs('terrains', ids, ['maps', i, 'terrainBags', bag], false));
    const randomNumbers = (mp.hexes ?? []).filter(h => h.number === '@').length;
    if (randomNumbers > (mp.numberBag?.length ?? 0)) c.add(['maps', i, 'numberBag'], `${randomNumbers} hexes draw a random number but the number bag has only ${mp.numberBag?.length ?? 0}.`, 'warning');
  });
  mod.setup?.forEach((r, i) => r.place?.forEach((p, j) => c.ref('pieces', p.piece, ['setup', i, 'place', j, 'piece'])));
  if (mod.victoryPoints !== undefined && !(mod.victoryPoints > 0)) c.add(['victoryPoints'], 'Victory points should be positive.');

  return c.issues;
}

function checkTrigger(c: Checker, t: { on: string; when?: Condition; do: Effect[] }, path: Path) {
  if (!t.on) c.add([...path, 'on'], 'Pick an event.');
  const scope = eventScope(t.on);
  c.condition(t.when, [...path, 'when'], scope);
  c.effects(t.do, [...path, 'do'], scope);
}

/** Engine validation (guarded: the engine may not be implemented yet) + editor checks. */
export function validateAll(mod: ModDef, available: ModDef[]): { issues: Issue[]; engineStatus: 'ok' | 'unavailable' | 'crashed'; engineError?: string } {
  const issues: Issue[] = checkMod(mod, available);
  const api = engineApi();
  if (!api.validateMod) return { issues, engineStatus: 'unavailable' };
  try {
    const res = api.validateMod(mod, available.filter(a => a.meta.id !== mod.meta.id)) ?? [];
    for (const r of res) issues.unshift({ path: r.path, message: r.message, severity: r.severity, source: 'engine' });
    return { issues, engineStatus: 'ok' };
  } catch (e) {
    return { issues, engineStatus: 'crashed', engineError: (e as Error)?.message ?? String(e) };
  }
}

