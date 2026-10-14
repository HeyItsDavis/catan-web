/**
 * Victory points: piece VP + permanent token VP (addVP) + held awards + face-up card VP
 * (+ hidden VP of cards in hand when includeHidden).
 */
import { type Ctx, findPlayer } from './context';

export function computeVPInternal(ctx: Ctx, pid: string, includeHidden: boolean): number {
  const p = findPlayer(ctx, pid);
  if (!p) return 0;
  let vp = p.tokenVP;
  for (const pc of ctx.s.pieces) if (pc.owner === pid) vp += ctx.L.pieces.get(pc.type)?.vp ?? 0;
  for (const [aid, holder] of Object.entries(ctx.s.awards)) if (holder === pid) vp += ctx.L.awards.get(aid)?.vp ?? 0;
  for (const c of p.played) vp += ctx.L.cards.get(c.card)?.vp ?? 0;
  if (includeHidden) for (const c of p.hand) vp += ctx.L.cards.get(c.card)?.vp ?? 0;
  return vp;
}
