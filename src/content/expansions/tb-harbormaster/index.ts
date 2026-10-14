/**
 * Traders & Barbarians variant: the Harbormaster.
 *
 * Harbor points: each of your settlements on a harbor is worth 1 harbor point, each city on a
 * harbor 2. The player with the most harbor points (at least 3) is the Harbormaster and gets
 * 2 victory points. Play to 11 victory points.
 *
 * Works on any map with harbors, so it can be combined with other mods.
 */
import type { Expr, ModDef } from '../../../engine/schema';

/** How many of your `piece`s stand on a harbor corner. */
const onHarbor = (piece: string): Expr => ({ pieceCount: { owner: 'self', piece, where: { atPort: { at: 'candidate' } } } });

export const mod: ModDef = {
  meta: {
    id: 'tb-harbormaster',
    name: 'T&B: Harbormaster',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description: 'Settlements on a harbor give 1 harbor point, cities 2. The most harbor points (at least 3) make you Harbormaster: +2 VP. Play to 11.',
  },
  awards: [{
    id: 'harbormaster', name: 'Harbormaster', vp: 2, min: 3, holderKeepsOnTie: true,
    metric: { add: [onHarbor('settlement'), { mul: [2, onHarbor('city')] }] },
  }],
  victoryPoints: 11,
};

export default mod;
