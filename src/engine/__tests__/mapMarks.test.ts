/**
 * Map hex marks: `hidden` (starts face-down) and `tags` (tested by the `hexTag` condition).
 */
import { describe, expect, it } from 'vitest';
import { redactFor, topology, validateMod, type MapDef, type ModDef } from '../index';
import { baseMod } from '../../content/base';
import { act, newGame, withMods } from './helpers';

const map: MapDef = {
  id: 'marks', name: 'Marks', minPlayers: 2, maxPlayers: 4,
  hexes: [
    { q: 0, r: 0, terrain: 'forest', number: 6 },
    { q: 1, r: 0, terrain: 'hills', number: 8, tags: ['foreign'] },
    { q: 0, r: 1, terrain: 'fields', number: 5, hidden: true },
    { q: -1, r: 0, terrain: 'sea' },
  ],
};

const mod: ModDef = {
  meta: { id: 'marks', name: 'Marks', version: '0', extends: ['base'] },
  maps: [map],
  remove: { maps: ['base-standard'] },
  pieces: [{
    ...baseMod.pieces![1],
    placement: { ...baseMod.pieces![1].placement, setupWhere: { all: [{ not: { occupied: { at: 'at' } } }, { not: { hexTag: { at: 'at', tag: 'foreign' } } }] } },
  }],
};

describe('map hex marks', () => {
  const def = withMods(mod);

  it('validates (and rejects a hexTag without a tag)', () => {
    expect(validateMod(mod, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
    const bad: ModDef = { ...mod, actions: [{ id: 'a', name: 'A', available: { hexTag: { at: 'x', tag: '' } }, effect: [] }] };
    expect(validateMod(bad, [baseMod]).some((p) => p.severity === 'error' && p.message === 'Needs a tag name')).toBe(true);
  });

  it('hidden hexes start face-down (and are redacted); tags are copied to the board', () => {
    const s = newGame(1, 2, def, { mapId: 'marks' });
    expect(s.hexes['h:0,1'].revealed).toBe(false);
    expect(s.hexes['h:0,0'].revealed).toBe(true);
    expect(s.hexes['h:1,0'].tags).toEqual(['foreign']);
    expect(s.hexes['h:0,0'].tags).toBeUndefined();
    expect(redactFor(def, s, 'p1').hexes['h:0,1'].terrain).toBe('hidden');
  });

  it('hexTag: a corner tests every hex it touches', () => {
    const s = newGame(1, 2, def, { mapId: 'marks' });
    const opts = s.prompts[0].options;
    const foreignCorners = new Set(topology.hexCorners({ q: 1, r: 0 }));
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((v) => foreignCorners.has(v))).toBe(false);
    // a corner of the forest that is not shared with the tagged hills is still allowed
    expect(opts).toContain(topology.hexCorners({ q: 0, r: 0 })[5]);
    act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: opts[0] });
  });
});
