/**
 * Variable scoping for the block editor: which vars are visible at a given
 * point of an Effect[] (bound by earlier `as` fields, loop vars, trigger
 * payloads, the implicit `at` of placement rules and location filters).
 */
import type { Effect } from '../engine/schema';
import { EFFECTS, EVENTS, effectSpec, type BlockSpec, type VarType } from './catalog';

export interface VarInfo {
  name: string;
  type: VarType;
  /** Where it comes from, for the picker tooltip. */
  source: string;
}

/** Vars an effect makes available to the steps AFTER it (not loop vars). Includes nested binds. */
export function effectBinds(e: Effect): VarInfo[] {
  const spec = effectSpec(e);
  if (!spec) return [];
  const out: VarInfo[] = [];
  const rec = e as unknown as Record<string, unknown>;
  for (const p of spec.params) {
    const v = rec[p.name];
    if (p.kind === 'varName' && !p.loopVar && typeof v === 'string' && v) {
      out.push({ name: v, type: p.binds ?? 'any', source: spec.label });
    }
    if (p.kind === 'effects' && Array.isArray(v)) for (const c of v as Effect[]) out.push(...effectBinds(c));
    if (p.kind === 'options' && Array.isArray(v)) {
      for (const o of v as { do?: Effect[] }[]) for (const c of o.do ?? []) out.push(...effectBinds(c));
    }
  }
  return out;
}

export function mergeScope(...lists: VarInfo[][]): VarInfo[] {
  const map = new Map<string, VarInfo>();
  for (const l of lists) for (const v of l) map.set(v.name, v);
  return [...map.values()];
}

/** Scope visible to `list[index]`. */
export function scopeAt(list: Effect[], index: number, scope: VarInfo[]): VarInfo[] {
  const extra: VarInfo[] = [];
  for (let i = 0; i < index && i < list.length; i++) extra.push(...effectBinds(list[i]));
  return mergeScope(scope, extra);
}

const AT_LOCATION: VarInfo = { name: 'at', type: 'location', source: 'Candidate location' };

/** What type the candidate of a choose-style filter has (the engine binds it under the op's own `as`). */
const FILTER_CANDIDATE: Partial<Record<Effect['op'], VarInfo['type']>> = {
  chooseLocation: 'location',
  choosePiece: 'location',
  choosePlayer: 'player',
};

/**
 * Scope inside a param of an effect. Mirrors the engine's binding rules (engine/schema.ts):
 *  - loop vars (forEachPlayer / forEachPiece / repeat `as`) are visible to the block's children;
 *  - choose filters see the CANDIDATE under the op's own `as` name (`at` is not rebound);
 *  - LocationChoice.where sees the candidate as `at`.
 */
export function innerScope(e: Effect, paramName: string, scope: VarInfo[]): VarInfo[] {
  const spec = EFFECTS[e.op];
  if (!spec) return scope;
  const rec = e as unknown as Record<string, unknown>;
  const extra: VarInfo[] = [];
  for (const p of spec.params) {
    if (p.kind === 'varName' && p.loopVar && typeof rec[p.name] === 'string' && rec[p.name]) {
      extra.push({ name: rec[p.name] as string, type: p.binds ?? 'any', source: `${spec.label} loop` });
    }
  }
  const cand = e.op === 'chooseMany'
    ? ({ player: 'player', location: 'location', piece: 'location', resource: 'resource' } as const)[rec.of as 'player' | 'location' | 'piece' | 'resource']
    : FILTER_CANDIDATE[e.op];
  if (cand && paramName === 'filter' && typeof rec.as === 'string' && rec.as) {
    extra.push({ name: rec.as, type: cand, source: 'The candidate being tested' });
  }
  if (e.op === 'movePiece' && paramName === 'path') {
    extra.push(
      { name: 'at', type: 'location', source: 'Next step' },
      { name: 'prev', type: 'location', source: 'Previous step' },
      { name: 'via', type: 'location', source: 'What connects the two steps' },
    );
  }
  const target = spec.params.find(p => p.name === paramName);
  if (target?.kind === 'locationChoice') extra.push(AT_LOCATION);
  return mergeScope(scope, extra);
}

/** Placement rules (`where`), token `where`/`onMove`: the candidate / token location is `at`. */
export function atScope(): VarInfo[] {
  return [AT_LOCATION];
}

/** PlacementRule.setupWhere: `at` plus `lastPlaced` (the previous piece placed this setup turn). */
export function setupScope(): VarInfo[] {
  return [AT_LOCATION, { name: 'lastPlaced', type: 'location', source: 'Previous piece placed this setup turn' }];
}

/** ActionDef.available / cost / effect. `piece` & `pieceId` are only set for piece actions. */
export function actionScope(): VarInfo[] {
  return [
    { name: 'piece', type: 'location', source: 'Piece actions: where the piece stands' },
    { name: 'pieceId', type: 'any', source: 'Piece actions: the piece instance id' },
  ];
}

/** CardDef.effect: `card` = the card id being played. */
export function cardScope(): VarInfo[] {
  return [{ name: 'card', type: 'any', source: 'The card being played' }];
}

/** Loop vars declared by a condition / expr block (e.g. countPlayers `as`), visible to its own params. */
export function loopVarsOf(spec: BlockSpec<unknown>, values: Record<string, unknown>): VarInfo[] {
  return spec.params
    .filter(p => p.kind === 'varName' && p.loopVar && typeof values[p.name] === 'string' && values[p.name])
    .map(p => ({ name: values[p.name] as string, type: p.binds ?? 'any', source: spec.label }));
}

/** Vars visible inside a PieceQuery `where`: the candidate piece. */
export function candidateScope(): VarInfo[] {
  return [
    { name: 'candidate', type: 'location', source: 'Candidate piece location' },
    { name: 'candidateId', type: 'piece', source: 'Candidate piece' },
  ];
}

export function eventScope(event: string): VarInfo[] {
  const spec = (EVENTS as Record<string, { label: string; vars: { name: string; type: VarType }[] }>)[event];
  if (!spec) {
    // Custom event (fired by `emit`): payload keys are unknown here, but `player` and `event` are always set.
    return [
      { name: 'player', type: 'player', source: 'Player who emitted the event' },
      { name: 'event', type: 'any', source: 'The event name' },
    ];
  }
  return spec.vars.map(v => ({ name: v.name, type: v.type, source: `${spec.label} event` }));
}

/** Filter a scope for a picker. 'any' matches everything. */
export function varsOfType(scope: VarInfo[], type: VarType | VarType[] | undefined): VarInfo[] {
  if (!type || type === 'any') return scope;
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('any')) return scope;
  return scope.filter(v => v.type === 'any' || types.includes(v.type));
}
