import { describe, expect, it } from 'vitest';
import { getBuiltinMod } from '../../builtins';
import { expectValid } from './scenarioBot';

const IDS = [
  'tb-fishermen', 'tb-rivers', 'tb-caravans', 'tb-barbarian-attack', 'tb-traders-barbarians', 'tb-harbormaster',
  'ep-land-ho', 'ep-fish-for-catan', 'ep-spices',
];

describe('Traders & Barbarians / Explorers & Pirates mods are registered built-ins', () => {
  for (const id of IDS) {
    it(id, () => {
      const mod = getBuiltinMod(id);
      expect(mod, `${id} is picked up from src/content/expansions`).toBeTruthy();
      // rooms carry mods as JSON: they must survive a round trip unchanged
      expect(JSON.parse(JSON.stringify(mod))).toEqual(mod);
      expect(expectValid(mod!)).toEqual([]); // no errors and no warnings
      // every action explains itself to players
      for (const a of mod!.actions ?? []) expect(a.description, `${id}: action ${a.id}`).toBeTruthy();
      for (const c of mod!.cards ?? []) expect(c.description, `${id}: card ${c.id}`).toBeTruthy();
    });
  }
});
