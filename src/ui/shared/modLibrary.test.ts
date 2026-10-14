import { describe, expect, it } from 'vitest';
import { MemoryStorage, mod } from '../../net/testFixtures';
import { deleteMod, listMods, loadMod, MOD_LIBRARY_KEY, parseModJson, saveMod } from './modLibrary';

describe('mod library', () => {
  it('saves, lists, loads and deletes by id', () => {
    const s = new MemoryStorage();
    saveMod(mod('a'), s);
    saveMod(mod('b'), s);
    saveMod({ ...mod('a'), meta: { ...mod('a').meta, version: '2.0.0' } }, s);
    expect(listMods(s).map((e) => e.mod.meta.id).sort()).toEqual(['a', 'b']);
    expect(loadMod('a', s)?.meta.version).toBe('2.0.0');
    deleteMod('a', s);
    expect(loadMod('a', s)).toBeNull();
    expect(JSON.parse(s.getItem(MOD_LIBRARY_KEY)!)).toHaveLength(1);
  });

  it('survives corrupt storage', () => {
    const s = new MemoryStorage();
    s.setItem(MOD_LIBRARY_KEY, '{nope');
    expect(listMods(s)).toEqual([]);
  });

  it('parses uploaded files', () => {
    expect(parseModJson(JSON.stringify(mod('x'))).ok).toBe(true);
    expect(parseModJson('nope').ok).toBe(false);
    expect(parseModJson('{"meta":{}}').ok).toBe(false);
  });
});
