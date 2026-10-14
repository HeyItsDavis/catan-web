import { describe, expect, it } from 'vitest';
import type { ModDef } from '../engine/schema';
import { renameReferences } from './rename';

const mod: ModDef = {
  meta: { id: 'm', name: 'M', version: '1', extends: ['base'] },
  resources: [{ id: 'spice', name: 'Spice', color: '#f00', icon: 'spice', kind: 'resource', bankSupply: 19 }],
  terrains: [{ id: 'grove', name: 'Grove', color: '#0f0', produces: { spice: 1 }, numbered: true }],
  pieces: [{
    id: 'bazaar', name: 'Bazaar', supply: 2, cost: { spice: 2, wool: 1 },
    placement: { on: 'vertex', where: { terrainIs: { at: 'at', terrain: 'grove' } } },
  }],
  actions: [{
    id: 'brew', name: 'Brew', available: true, cost: { spice: 1 },
    effect: [
      { op: 'chooseResource', as: 'spice', options: ['spice', 'ore'] },
      { op: 'gain', resources: { spice: { var: 'spice' } } },
      { op: 'transfer', from: 'self', to: 'bank', resource: 'spice', amount: 1 },
    ],
  }],
  maps: [{ id: 'mp', name: 'Map', minPlayers: 2, maxPlayers: 4, hexes: [{ q: 0, r: 0, terrain: 'grove' }], terrainBags: { land: ['grove', 'hills'] } }],
  remove: { resources: ['spice'] },
};

describe('renameReferences', () => {
  it('renames resource refs in maps, values and option lists, but not vars/icons/names', () => {
    const out = renameReferences(mod, 'resources', 'spice', 'saffron');
    expect(out.terrains![0].produces).toEqual({ saffron: 1 });
    expect(out.pieces![0].cost).toEqual({ saffron: 2, wool: 1 });
    const fx = out.actions![0].effect;
    expect(fx[0]).toEqual({ op: 'chooseResource', as: 'spice', options: ['saffron', 'ore'] });
    expect(fx[1]).toEqual({ op: 'gain', resources: { saffron: { var: 'spice' } } });
    expect(fx[2]).toMatchObject({ resource: 'saffron' });
    expect(out.actions![0].cost).toEqual({ saffron: 1 });
    // untouched: the item's own id (renamed by the caller), its icon, the remove list
    expect(out.resources![0]).toMatchObject({ id: 'spice', icon: 'spice' });
    expect(out.remove).toEqual({ resources: ['spice'] });
  });

  it('renames terrain refs incl. bags and map hexes', () => {
    const out = renameReferences(mod, 'terrains', 'grove', 'orchard');
    expect(out.maps![0].hexes[0].terrain).toBe('orchard');
    expect(out.maps![0].terrainBags).toEqual({ land: ['orchard', 'hills'] });
    expect(out.pieces![0].placement.where).toEqual({ terrainIs: { at: 'at', terrain: 'orchard' } });
    // resource maps are not terrain refs
    expect(out.terrains![0].produces).toEqual({ spice: 1 });
  });
});
