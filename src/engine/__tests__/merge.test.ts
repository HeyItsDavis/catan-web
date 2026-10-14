import { describe, expect, it } from 'vitest';
import { buildDefinition, ModValidationError, validateMod, type ModDef } from '../index';
import { baseMod } from '../../content/base';

const mod = (id: string, body: Partial<ModDef>, ext: string[] = ['base']): ModDef => ({ meta: { id, name: id, version: '1', extends: ext }, ...body });

describe('buildDefinition', () => {
  it('base validates cleanly (no errors, no warnings)', () => {
    expect(validateMod(baseMod, [])).toEqual([]);
    const def = buildDefinition([baseMod]);
    expect(def.resources.map((r) => r.id)).toEqual(['brick', 'lumber', 'wool', 'grain', 'ore']);
    expect(def.decks[0].cards.reduce((a, c) => a + c.count, 0)).toBe(25);
    expect(def.victoryPoints).toBe(10);
  });

  it('merges by id: replace in place, add new, remove', () => {
    const m = mod('m', {
      pieces: [{ ...baseMod.pieces!.find((p) => p.id === 'city')!, cost: { ore: 2, grain: 2 } }],
      resources: [{ id: 'fish', name: 'Fish', color: '#0af', kind: 'resource', bankSupply: 10 }],
      awards: [],
      remove: { awards: ['largestArmy'] },
      trade: { bankRates: { commodity: 2 } },
      victoryPoints: 12,
    });
    const def = buildDefinition([baseMod, m]);
    expect(def.pieces.map((p) => p.id)).toEqual(['road', 'settlement', 'city']);
    expect(def.pieces[2].cost).toEqual({ ore: 2, grain: 2 });
    expect(def.resources.at(-1)?.id).toBe('fish');
    expect(def.awards.map((a) => a.id)).toEqual(['longestRoad']);
    expect(def.trade.bankRates).toEqual({ resource: 4, commodity: 2 });
    expect(def.trade.playerTrading).toBe(true);
    expect(def.victoryPoints).toBe(12);
    expect(def.mods.map((x) => x.id)).toEqual(['base', 'm']);
  });

  it('applies extends order regardless of input order', () => {
    const a = mod('a', { victoryPoints: 11 });
    const b = mod('b', { victoryPoints: 13 }, ['a']);
    expect(buildDefinition([b, a, baseMod]).mods.map((x) => x.id)).toEqual(['base', 'a', 'b']);
    expect(buildDefinition([b, a, baseMod]).victoryPoints).toBe(13);
    expect(() => buildDefinition([b, baseMod])).toThrow(ModValidationError);
  });

  it('throws ModValidationError with paths for dangling references', () => {
    const m = mod('m', { remove: { cards: ['monopoly'] } });
    try {
      buildDefinition([baseMod, m]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ModValidationError);
      expect((e as ModValidationError).problems).toEqual([
        { path: 'decks[0].cards[3].card', message: 'Unknown card "monopoly"', severity: 'error' },
      ]);
    }
  });
});

describe('validateMod', () => {
  it('reports unknown ids, ops, conditions, vars and settings with JSON paths', () => {
    const m = mod('bad', {
      actions: [{
        id: 'a', name: 'A', available: { phase: 'mian' as never },
        effect: [
          { op: 'place', piece: 'castle' },
          { op: 'explode' } as never,
          { op: 'repeat', times: 2, do: [{ op: 'gain', resources: { gold: 1, ore: { var: 'nope' } } }] },
          { op: 'if', cond: { frobnicate: 1 } as never, then: [] },
          { op: 'gain', resources: { ore: { param: 'mystery' } } },
        ],
      }],
      maps: [{ id: 'm', name: 'M', minPlayers: 2, maxPlayers: 4, hexes: [{ q: 0, r: 0, terrain: '@nobag', number: '@' }] }],
    });
    const probs = validateMod(m, [baseMod]);
    const find = (path: string) => probs.find((p) => p.path === path);
    expect(find('actions[0].available.phase')?.message).toMatch(/Unknown phase/);
    expect(find('actions[0].effect[0].piece')).toMatchObject({ message: 'Unknown piece "castle"', severity: 'error' });
    expect(find('actions[0].effect[1].op')).toMatchObject({ message: 'Unknown op "explode"', severity: 'error' });
    expect(find('actions[0].effect[2].do[0].resources.gold')?.severity).toBe('error');
    expect(find('actions[0].effect[2].do[0].resources.ore.var')).toMatchObject({ severity: 'warning' });
    expect(find('actions[0].effect[3].cond')?.message).toMatch(/Unknown condition/);
    expect(find('actions[0].effect[4].resources.ore.param')?.severity).toBe('warning');
    expect(find('maps[0].hexes[0].terrain')?.message).toMatch(/Unknown terrain bag/);
    expect(find('maps[0].numberBag')?.message).toMatch(/Needs at least 1/);
  });

  it('flags unknown extends, duplicates and unknown removals', () => {
    const m = mod('dup', {
      resources: [
        { id: 'x', name: 'X', color: '#000', kind: 'resource', bankSupply: 1 },
        { id: 'x', name: 'X', color: '#000', kind: 'resource', bankSupply: 1 },
      ],
      remove: { cards: ['ghost'] },
    }, ['base', 'nowhere']);
    const probs = validateMod(m, [baseMod]);
    expect(probs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'meta.extends[1]', severity: 'error' }),
      expect.objectContaining({ path: 'resources[1].id', message: 'Duplicate id "x"' }),
      expect.objectContaining({ path: 'remove.cards[0]', severity: 'warning' }),
    ]));
  });

  it('accepts bound vars from as/setVar/loop/builtin payloads', () => {
    const m = mod('ok', {
      triggers: [{ id: 't', on: 'piecePlaced', when: { cmp: [{ pieceCount: { near: 'at' } }, '>', 0] }, do: [
        { op: 'choosePlayer', as: 'who', filter: { not: { samePlayer: [{ var: 'who' }, 'self'] } } },
        { op: 'setVar', name: 'n', value: 2 },
        { op: 'transfer', from: { var: 'who' }, to: 'self', resource: 'random', amount: { var: 'n' } },
      ] }],
    });
    expect(validateMod(m, [baseMod])).toEqual([]);
  });
});
