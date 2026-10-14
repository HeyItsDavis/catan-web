import { describe, expect, it } from 'vitest';
import schemaSource from '../engine/schema.ts?raw';
import {
  CONDITIONS, EFFECTS, EXPRS, conditionKind, effectSpec, exprKind, readParams, writeParams, type BlockSpec,
} from './catalog';
import type { Condition, Effect, Expr } from '../engine/schema';
import { describeCondition, describeEffect, describeExpr } from './describe';

/** Text of `export type <name> = ... ;` (up to the first line ending in `;` at top level). */
function typeBlock(name: string): string {
  const start = schemaSource.indexOf(`export type ${name} =`);
  expect(start, `type ${name} in schema.ts`).toBeGreaterThanOrEqual(0);
  const end = schemaSource.indexOf(';\n\n', start);
  return schemaSource.slice(start, end);
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('block catalog covers schema.ts', () => {
  it('has an entry for every Effect op', () => {
    const ops = [...stripComments(typeBlock('Effect')).matchAll(/op:\s*'(\w+)'/g)].map(m => m[1]);
    expect(ops.length).toBeGreaterThan(30);
    for (const op of ops) expect(EFFECTS, `effect op ${op}`).toHaveProperty(op);
    expect(Object.keys(EFFECTS).sort()).toEqual([...new Set(ops)].sort());
  });

  it('has an entry for every Condition variant', () => {
    const block = stripComments(typeBlock('Condition'));
    const keys = [...block.matchAll(/\|\s*\{\s*(\w+)\s*:/g)].map(m => m[1]);
    const all = ['true', 'false', ...keys];
    expect(keys.length).toBeGreaterThan(15);
    for (const k of all) expect(CONDITIONS, `condition ${k}`).toHaveProperty(k);
    expect(Object.keys(CONDITIONS).sort()).toEqual([...new Set(all)].sort());
  });

  it('has an entry for every Expr variant', () => {
    const block = stripComments(typeBlock('Expr'));
    const keys = [...block.matchAll(/\|\s*\{\s*(\w+)\s*:/g)].map(m => m[1]);
    const all = ['number', ...keys];
    expect(keys.length).toBeGreaterThan(15);
    for (const k of all) expect(EXPRS, `expr ${k}`).toHaveProperty(k);
    expect(Object.keys(EXPRS).sort()).toEqual([...new Set(all)].sort());
  });
});

function check<T>(rec: Record<string, BlockSpec<T>>, kindOf: (n: T) => string | undefined) {
  for (const [key, spec] of Object.entries(rec)) {
    expect(spec.key).toBe(key);
    expect(spec.label.length).toBeGreaterThan(0);
    expect(spec.description.length).toBeGreaterThan(5);
    const node = spec.make();
    expect(kindOf(node), `make() of ${key}`).toBe(key);
    // read/write roundtrip is lossless for the default instance
    const values = readParams(spec as BlockSpec<unknown>, node);
    expect(writeParams(spec, values, node)).toEqual(node);
    const names = spec.params.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of spec.params) if (p.kind === 'enum') expect(p.options?.length).toBeGreaterThan(0);
  }
}

describe('catalog entries are well-formed', () => {
  it('effects', () => {
    check(EFFECTS as unknown as Record<string, BlockSpec<Effect>>, e => effectSpec(e)?.key);
    for (const spec of Object.values(EFFECTS)) {
      expect(['Control flow', 'Choices', 'Resources', 'Board', 'Cards', 'Scoring', 'Turn']).toContain(spec.category);
      expect(spec.shape).toBe('flat');
    }
  });
  it('conditions', () => check(CONDITIONS as Record<string, BlockSpec<Condition>>, c => conditionKind(c)));
  it('exprs', () => check(EXPRS as Record<string, BlockSpec<Expr>>, e => exprKind(e)));

  it('every default instance can be described', () => {
    for (const s of Object.values(EFFECTS)) expect(describeEffect(s.make() as Effect)).not.toMatch(/unknown/);
    for (const s of Object.values(CONDITIONS)) expect(describeCondition(s.make())).not.toMatch(/unknown/);
    for (const s of Object.values(EXPRS)) expect(describeExpr(s.make())).not.toMatch(/unknown/);
  });
});

describe('kind detection', () => {
  it('uses the discriminating key, not secondary keys', () => {
    expect(conditionKind({ flag: 'x', player: 'self' })).toBe('flag');
    expect(conditionKind(true)).toBe('true');
    expect(exprKind(3)).toBe('number');
    expect(exprKind({ playerCount: true })).toBe('playerCount');
  });
});
