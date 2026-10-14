/**
 * Awards (Longest Road, Largest Army, ...) and the builtin longest-network metric.
 */
import { type Ctx, emit, log, playerName } from './context';
import { evalExpr } from './exprs';
import { vertexBlocks } from './conditions';
import { edgeVertices } from './board/topology';

/**
 * Longest simple trail (each edge used once) through the player's pieces that have a
 * `network`, computed per network id; maximum over networks. Opposing network-breaking
 * pieces on a vertex stop the trail there.
 */
export function longestRoadFor(ctx: Ctx, pid: string): number {
  const byNet = new Map<string, string[]>();
  for (const p of ctx.s.pieces) {
    if (p.owner !== pid || !p.at.startsWith('e:')) continue;
    const net = ctx.L.pieces.get(p.type)?.network;
    if (!net) continue;
    const arr = byNet.get(net);
    if (arr) arr.push(p.at); else byNet.set(net, [p.at]);
  }
  let best = 0;
  for (const edges of byNet.values()) best = Math.max(best, longestTrail(ctx, pid, edges));
  return best;
}

function longestTrail(ctx: Ctx, pid: string, edges: string[]): number {
  const adj = new Map<string, { e: number; to: string }[]>();
  edges.forEach((e, i) => {
    const [a, b] = edgeVertices(e);
    for (const [x, y] of [[a, b], [b, a]]) {
      const l = adj.get(x);
      if (l) l.push({ e: i, to: y }); else adj.set(x, [{ e: i, to: y }]);
    }
  });
  const blocked = new Map<string, boolean>();
  const isBlocked = (v: string) => {
    let b = blocked.get(v);
    if (b === undefined) { b = vertexBlocks(ctx, v, pid); blocked.set(v, b); }
    return b;
  };
  const used = new Array(edges.length).fill(false);
  let best = 0;
  const dfs = (v: string, len: number) => {
    if (len > best) best = len;
    if (len > 0 && isBlocked(v)) return;
    for (const { e, to } of adj.get(v) ?? []) {
      if (used[e]) continue;
      used[e] = true;
      dfs(to, len + 1);
      used[e] = false;
    }
  };
  for (const v of adj.keys()) dfs(v, 0);
  return best;
}

/** Recompute every award holder; emits awardChanged for changes. Returns true if anything changed. */
export function recomputeAwards(ctx: Ctx): boolean {
  let changed = false;
  for (const a of ctx.def.awards) {
    const scores = new Map<string, number>();
    for (const p of ctx.s.players) scores.set(p.id, evalExpr(ctx, { self: p.id, vars: {} }, a.metric));
    const holder = ctx.s.awards[a.id] ?? null;
    const best = Math.max(...scores.values());
    let next: string | null = null;
    if (best >= a.min) {
      const top = [...scores.entries()].filter(([, v]) => v === best).map(([k]) => k);
      if (holder && a.holderKeepsOnTie && top.includes(holder)) next = holder;
      else if (top.length === 1) next = top[0];
      else next = null;
    }
    if (next !== holder) {
      ctx.s.awards[a.id] = next;
      changed = true;
      log(ctx, next ? `${playerName(ctx, next)} takes ${a.name}` : `${a.name} is unclaimed`, next ?? undefined);
      emit(ctx, 'awardChanged', { award: a.id, player: next, previous: holder }, next ?? undefined);
    }
  }
  return changed;
}
