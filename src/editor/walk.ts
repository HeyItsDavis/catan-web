/** Catalog-driven traversal of Effect / Condition / Expr trees, with paths and var scope. */
import type { Condition, Effect, Expr } from '../engine/schema';
import {
  conditionSpec, effectSpec, exprSpec, paramPathSegments, readParams, type BlockSpec, type ParamSpec,
} from './catalog';
import type { Path } from './paths';
import { atScope, innerScope, mergeScope, scopeAt, type VarInfo } from './vars';

export type Family = 'effect' | 'condition' | 'expr';

export interface WalkVisitor {
  block?(family: Family, spec: BlockSpec<unknown>, node: unknown, path: Path, scope: VarInfo[]): void;
  param?(p: ParamSpec, value: unknown, path: Path, scope: VarInfo[], owner: BlockSpec<unknown>): void;
  unknown?(family: Family, value: unknown, path: Path): void;
}

export function walkEffects(list: unknown, path: Path, scope: VarInfo[], v: WalkVisitor): void {
  if (!Array.isArray(list)) {
    if (list !== undefined) v.unknown?.('effect', list, path);
    return;
  }
  list.forEach((e, i) => {
    const p = [...path, i];
    const spec = effectSpec(e as Effect);
    if (!spec) { v.unknown?.('effect', e, p); return; }
    const s = scopeAt(list as Effect[], i, scope);
    v.block?.('effect', spec as BlockSpec<unknown>, e, p, s);
    walkParams(spec as BlockSpec<unknown>, e, p, s, v, e as Effect);
  });
}

export function walkCondition(c: unknown, path: Path, scope: VarInfo[], v: WalkVisitor): void {
  if (c === undefined) return;
  const spec = conditionSpec(c as Condition);
  if (!spec) { v.unknown?.('condition', c, path); return; }
  v.block?.('condition', spec as BlockSpec<unknown>, c, path, scope);
  walkParams(spec as BlockSpec<unknown>, c, path, scope, v);
}

export function walkExpr(e: unknown, path: Path, scope: VarInfo[], v: WalkVisitor): void {
  if (e === undefined || e === null) return;
  const spec = exprSpec(e as Expr);
  if (!spec) { v.unknown?.('expr', e, path); return; }
  v.block?.('expr', spec as BlockSpec<unknown>, e, path, scope);
  walkParams(spec as BlockSpec<unknown>, e, path, scope, v);
}

function walkParams(spec: BlockSpec<unknown>, node: unknown, path: Path, scope: VarInfo[], v: WalkVisitor, effect?: Effect): void {
  const values = readParams(spec, node);
  for (const p of spec.params) {
    const value = values[p.name];
    const pp = [...path, ...paramPathSegments(spec, p.name)];
    const s = effect ? innerScope(effect, p.name, scope) : scope;
    v.param?.(p, value, pp, s, spec);
    if (value === undefined) continue;
    switch (p.kind) {
      case 'expr': walkExpr(value, pp, s, v); break;
      case 'condition': walkCondition(value, pp, s, v); break;
      case 'effects': walkEffects(value, pp, s, v); break;
      case 'exprList': if (Array.isArray(value)) value.forEach((x, i) => walkExpr(x, [...pp, i], s, v)); break;
      case 'conditionList': if (Array.isArray(value)) value.forEach((x, i) => walkCondition(x, [...pp, i], s, v)); break;
      case 'exprMap': case 'resourceMap':
        if (value && typeof value === 'object') for (const [k, x] of Object.entries(value)) walkExpr(x, [...pp, k], s, v);
        break;
      case 'options':
        if (Array.isArray(value)) value.forEach((o: { cond?: Condition; do?: Effect[] }, i) => {
          walkCondition(o?.cond, [...pp, i, 'cond'], s, v);
          walkEffects(o?.do ?? [], [...pp, i, 'do'], s, v);
        });
        break;
      case 'locationChoice': {
        const where = (value as { where?: Condition }).where;
        walkCondition(where, [...pp, 'where'], mergeScope(s, atScope()), v);
        break;
      }
    }
  }
}
