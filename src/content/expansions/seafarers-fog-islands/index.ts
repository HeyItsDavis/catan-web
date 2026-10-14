/**
 * Seafarers scenario "The Fog Islands": a small mod on top of Seafarers. It only swaps the
 * map and the goal; fog exploration and its discovery reward are Seafarers rules.
 */
import type { ModDef } from '../../../engine/schema';
import { fogIslands } from '../seafarers/maps';

export const mod: ModDef = {
  meta: {
    id: 'seafarers-fog-islands',
    name: 'Seafarers: The Fog Islands',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['seafarers'],
    description:
      'Seafarers scenario (needs Seafarers, added automatically): start on the home island and sail into the fog. Every land hex you discover pays a resource. 12 VP.',
  },
  maps: [fogIslands],
  victoryPoints: 12,
  remove: {
    maps: ['seafarers-new-shores', 'seafarers-four-islands', 'seafarers-new-shores-56'],
    // No special island points in this scenario: discovering land is its own reward.
    triggers: ['new-island-bonus'],
    settings: ['islandBonusVP'],
  },
};

export default mod;
