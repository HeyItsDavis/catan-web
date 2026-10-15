/**
 * The effect interpreter.
 *
 * State model (all JSON, lives in GameState.stack as Thread[]):
 *  - A Thread is an independent line of execution with its own frame stack and scopes.
 *    Normally there is one; `forEachPlayer` with order 'simultaneous' spawns one child
 *    thread per player and the parent waits (`join`) until all children finish.
 *  - Frames: 'block' (list of effects + pc), 'repeat', 'each' (loop over ids).
 *  - Scopes hold `self` and variables. Blocks of the same action share a scope, so a var
 *    bound inside a loop body stays visible afterwards. Triggers get a fresh scope whose
 *    vars are the event payload (+ `event`).
 *  - When an effect needs input it raises a Prompt (legal options precomputed) and the
 *    thread records `pending`. `respond` applies the answer (bind var / discard / branch)
 *    and resumes. Many ops are two-stage: the prompt binds a temp var and then the same
 *    op is re-run with the location bound (`then`).
 *  - The root thread of a player action carries a snapshot of the state taken before the
 *    action started; `abortIf` (or a failed `pay`) restores it (= cancel + refund).
 *
 * Events emitted while executing an op are converted into trigger frames pushed on top of
 * the current thread, so triggers run immediately after the op that caused them.
 */
import type { CardInstance, Condition, Effect, GameState, Id, LocationId, PieceInstance, PieceQuery, Prompt } from './schema';
import { boardTopo, kindOf } from './board';
import {
  edgeIdOf, edgeVertices, hexEdges, hexId, hexNeighbors, parseHexId, vertexEdges, vertexNeighbors,
} from './board/topology';
import {
  type Ctx, type Env, type Val, CommandError, currentPlayerId, emit, findPlayer, getPlayer, invalidatePieces, log,
  nextId, piecesAt, playerName, playersFrom, rng, supplyLeft,
} from './context';
import { evalCond } from './conditions';
import { evalExpr, evalResourceMap } from './exprs';
import { locOf, pieceById, pieceOf, queryPieces, resolvePlayer, resolveResource } from './refs';
import { bankHas, moveResource, pay, randomResource } from './resources';
import { runProduction } from './production';
import { filterLocations, legalPlacements, legalTokenSpots, legalUpgrades, allLocations } from './placement';
import { randInt, shuffle } from './rng';
import { advanceSetup, advanceTurn, doRoll, startingResources, turnStart } from './turn';

/* --------------------------------- types -------------------------------- */

export type InternalEffect =
  | { op: '$setupStep'; step: number }
  | { op: '$setupNext' }
  | { op: '$startingResources' }
  | { op: '$turnStart' }
  | { op: '$advanceTurn' }
  | { op: '$afterCardPlay'; instance: CardInstance }
  /** chooseMany state machine: `picked` so far; `pickVar` holds the answer of the last prompt. */
  | { op: '$chooseMany'; base: ChooseManyEffect; n: number; m: number; picked: string[]; pickVar?: string }
  /** After a choosePiece prompt: bind the chosen piece's instance id. */
  | { op: '$bindPieceId'; from: string; to: string; query: PieceQuery };

type ChooseManyEffect = Extract<Effect, { op: 'chooseMany' }>;
type MovePieceEffect = Extract<Effect, { op: 'movePiece' }>;

/** Effects plus engine-internal ops and a few internal flags on public ops. */
export type IEffect = (Effect & { $cancelable?: boolean; $bankOnly?: boolean; $deck?: Id; $dist?: Record<string, number | null> }) | InternalEffect;

export interface Scope { self: string; vars: Record<string, Val> }

export type Frame =
  | { t: 'block'; sc: string; fx: IEffect[]; pc: number; own?: boolean }
  | { t: 'repeat'; sc: string; fx: IEffect[]; i: number; n: number; as?: string }
  | { t: 'each'; sc: string; fx: IEffect[]; items: string[]; i: number; as: string; locAs?: string };

export type Pending =
  /** `always`: run `then` even when the (optional) prompt was skipped. */
  | { k: 'bind'; prompt: string; sc: string; var: string; then?: IEffect[]; always?: boolean }
  | { k: 'option'; prompt: string; sc: string; branches: IEffect[][] }
  | { k: 'discard'; prompt: string; player: string; kind?: string }
  | { k: 'discardCard'; prompt: string; player: string }
  | { k: 'takeCard'; prompt: string; from: string; to: string };

export interface Thread {
  id: string;
  parent?: string;
  frames: Frame[];
  scopes: Record<string, Scope>;
  pending?: Pending;
  join?: string[];
  /** Root action threads: state before the action (restored by abortIf). */
  snapshot?: GameState;
}

const MAX_STEPS = 200_000;

/* ------------------------------ thread utils ---------------------------- */

export function threads(ctx: Ctx): Thread[] {
  return ctx.s.stack as Thread[];
}

function findThread(ctx: Ctx, id: string): Thread | undefined {
  return threads(ctx).find((t) => t.id === id);
}

export function newScope(ctx: Ctx, th: Thread, self: string, vars: Record<string, Val> = {}): string {
  const id = nextId(ctx, 's');
  th.scopes[id] = { self, vars };
  return id;
}

/** Push a block that runs in its own fresh scope. */
export function pushScoped(ctx: Ctx, th: Thread, self: string, fx: IEffect[], vars: Record<string, Val> = {}): void {
  const sc = newScope(ctx, th, self, vars);
  th.frames.push({ t: 'block', sc, fx, pc: 0, own: true });
}

function pushBlock(th: Thread, sc: string, fx: IEffect[]): void {
  if (fx.length) th.frames.push({ t: 'block', sc, fx, pc: 0 });
}

/** Start a new root thread. `txn` = snapshot the state for abort/refund. */
export function newThread(
  ctx: Ctx, self: string, fx: IEffect[], opts: { vars?: Record<string, Val>; txn?: boolean; parent?: string } = {},
): Thread {
  const th: Thread = { id: nextId(ctx, 't'), frames: [], scopes: {} };
  if (opts.parent) th.parent = opts.parent;
  if (opts.txn) th.snapshot = structuredClone(ctx.s);
  pushScoped(ctx, th, self, fx, opts.vars ?? {});
  threads(ctx).push(th);
  return th;
}

function finishThread(ctx: Ctx, th: Thread): void {
  const st = threads(ctx);
  const i = st.indexOf(th);
  if (i >= 0) st.splice(i, 1);
  if (th.parent) {
    const p = findThread(ctx, th.parent);
    if (p?.join) {
      p.join = p.join.filter((x) => x !== th.id);
      if (!p.join.length) delete p.join;
    }
  }
}

function killThread(ctx: Ctx, th: Thread): void {
  for (const child of threads(ctx).filter((t) => t.parent === th.id)) killThread(ctx, child);
  if (th.pending) ctx.s.prompts = ctx.s.prompts.filter((p) => p.id !== th.pending!.prompt);
  delete th.pending;
  th.frames = [];
  delete th.join;
  finishThread(ctx, th);
}

function rootOf(ctx: Ctx, th: Thread): Thread {
  let t = th;
  while (t.parent) {
    const p = findThread(ctx, t.parent);
    if (!p) break;
    t = p;
  }
  return t;
}

/** Cancel the current action: restore its snapshot (refund) or, if none, stop this thread. */
export function abort(ctx: Ctx, th: Thread, message: string): void {
  const root = rootOf(ctx, th);
  ctx.events = [];
  if (root.snapshot) {
    const snap = root.snapshot;
    const counter = ctx.s.idCounter;
    ctx.s = snap;
    ctx.flows = undefined; // the snapshot undoes those movements
    ctx.s.idCounter = Math.max(counter ?? 1, snap.idCounter ?? 1);
    invalidatePieces(ctx);
    ctx.regions = undefined;
    ctx.aborted = message;
    log(ctx, `Cancelled: ${message}`);
  } else {
    log(ctx, `Cancelled: ${message}`);
    killThread(ctx, th);
  }
}

/* ------------------------------- prompts -------------------------------- */

function raise(ctx: Ctx, th: Thread, p: Omit<Prompt, 'id'>, pending: DistributiveOmit<Pending, 'prompt'>): void {
  const id = nextId(ctx, 'p');
  const prompt: Prompt = { id, ...p };
  if (prompt.optionLabels === undefined) delete prompt.optionLabels;
  if (prompt.piece === undefined) delete prompt.piece;
  if (prompt.amount === undefined) delete prompt.amount;
  if (prompt.optional === undefined) delete prompt.optional;
  if (prompt.pieceId === undefined) delete prompt.pieceId;
  if (prompt.progress === undefined) delete prompt.progress;
  ctx.s.prompts.push(prompt);
  th.pending = { ...pending, prompt: id } as Pending;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function tmpVar(ctx: Ctx): string {
  return `$${nextId(ctx, 'v')}`;
}

/* ------------------------------ event flush ----------------------------- */

interface Invocation { self: string; vars: Record<string, Val>; fx: Effect[] }

function triggersFor(ctx: Ctx, ev: { name: string; payload: Record<string, Val>; player?: string }): Invocation[] {
  type Cand = { t: (typeof ctx.def.triggers)[number]; pieceAt?: string; pieceId?: string; owner?: string };
  const cands: Cand[] = [];
  for (const t of ctx.def.triggers) if (t.on === ev.name) cands.push({ t });
  for (const pd of ctx.def.pieces) {
    if (!pd.triggers?.length) continue;
    const ts = pd.triggers.filter((t) => t.on === ev.name);
    if (!ts.length) continue;
    for (const pc of ctx.s.pieces) {
      if (pc.type !== pd.id) continue;
      for (const t of ts) cands.push({ t, pieceAt: pc.at, pieceId: pc.id, owner: pc.owner });
    }
  }
  cands.sort((a, b) => (a.t.priority ?? 0) - (b.t.priority ?? 0));
  const out: Invocation[] = [];
  for (const c of cands) {
    const vars: Record<string, Val> = { ...ev.payload, event: ev.name };
    let selves: string[];
    if (c.owner) {
      vars.this = c.pieceAt!;
      vars.thisId = c.pieceId!;
      selves = [c.owner];
    } else if (c.t.as === 'eventPlayer') selves = [ev.player ?? currentPlayerId(ctx.s)];
    else if (c.t.as === 'eachPlayer') selves = playersFrom(ctx);
    else selves = [currentPlayerId(ctx.s)];
    for (const self of selves) {
      if (!self) continue;
      if (evalCond(ctx, { self, vars }, c.t.when)) out.push({ self, vars: { ...vars }, fx: c.t.do });
    }
  }
  return out;
}

export function flushEvents(ctx: Ctx, th: Thread | null): void {
  if (!ctx.events.length) return;
  const evs = ctx.events;
  ctx.events = [];
  const inv = evs.flatMap((e) => triggersFor(ctx, e));
  if (!inv.length) return;
  let target = th && threads(ctx).includes(th) ? th : null;
  if (!target) {
    target = { id: nextId(ctx, 't'), frames: [], scopes: {} };
    threads(ctx).push(target);
  }
  for (let i = inv.length - 1; i >= 0; i--) pushScoped(ctx, target, inv[i].self, inv[i].fx, inv[i].vars);
}

/* --------------------------------- run ---------------------------------- */

function runnable(t: Thread): boolean {
  return !t.pending && !(t.join && t.join.length);
}

/** Run until every thread is blocked on a prompt or finished. */
export function run(ctx: Ctx): void {
  let steps = 0;
  for (;;) {
    if (ctx.s.phase === 'gameOver') {
      ctx.s.stack = [];
      ctx.s.prompts = [];
      return;
    }
    const st = threads(ctx);
    let th: Thread | undefined;
    for (let i = st.length - 1; i >= 0; i--) if (runnable(st[i])) { th = st[i]; break; }
    if (!th) return;
    if (++steps > MAX_STEPS) throw new Error('Interpreter step limit exceeded (infinite trigger loop?)');
    step(ctx, th);
  }
}

function step(ctx: Ctx, th: Thread): void {
  const f = th.frames[th.frames.length - 1];
  if (!f) { finishThread(ctx, th); return; }
  const scope = th.scopes[f.sc];
  if (f.t === 'block') {
    if (f.pc >= f.fx.length) {
      th.frames.pop();
      if (f.own) delete th.scopes[f.sc];
      return;
    }
    const eff = f.fx[f.pc++];
    const before = ctx.s;
    exec(ctx, th, f.sc, eff);
    if (ctx.s === before) flushEvents(ctx, th);
    return;
  }
  if (f.t === 'repeat') {
    if (f.i >= f.n) { th.frames.pop(); return; }
    if (f.as) scope.vars[f.as] = f.i;
    f.i++;
    pushBlock(th, f.sc, f.fx);
    return;
  }
  if (f.i >= f.items.length) { th.frames.pop(); return; }
  scope.vars[f.as] = f.items[f.i];
  if (f.locAs) scope.vars[f.locAs] = pieceById(ctx, f.items[f.i])?.at ?? null;
  f.i++;
  pushBlock(th, f.sc, f.fx);
}

/* --------------------------------- exec --------------------------------- */

function interpolate(ctx: Ctx, env: Env, text: string): string {
  return text.replace(/\{(\w+|\$\w+)\}/g, (_, k: string) => {
    const v = k === 'self' ? env.self : env.vars[k];
    if (typeof v === 'string') {
      const p = findPlayer(ctx, v);
      if (p) return p.name;
      return ctx.L.resources.get(v)?.name ?? ctx.L.pieces.get(v)?.name ?? ctx.L.cards.get(v)?.name ?? v;
    }
    return v === undefined || v === null ? '' : String(v);
  });
}

function resName(ctx: Ctx, r: string): string {
  return ctx.L.resources.get(r)?.name ?? r;
}

function exec(ctx: Ctx, th: Thread, sc: string, eff: IEffect): void {
  const env: Env = th.scopes[sc];
  const s = ctx.s;
  const P = (ref: Parameters<typeof resolvePlayer>[2], dflt: Parameters<typeof resolvePlayer>[3] = 'self') =>
    resolvePlayer(ctx, env, ref, dflt);
  const bind = (name: string | undefined, v: Val) => { if (name) env.vars[name] = v; };

  switch (eff.op) {
    /* ---------------- control flow ---------------- */
    case 'sequence': pushBlock(th, sc, eff.do); return;
    case 'repeat': {
      const n = Math.max(0, Math.floor(evalExpr(ctx, env, eff.times)));
      th.frames.push({ t: 'repeat', sc, fx: eff.do, i: 0, n, as: eff.as });
      return;
    }
    case 'if': pushBlock(th, sc, evalCond(ctx, env, eff.cond) ? eff.then : eff.else ?? []); return;
    case 'forEachPlayer': {
      const vars = { ...env.vars };
      const e: Env = { self: env.self, vars };
      const items = playersFrom(ctx).filter((pid) => { vars[eff.as] = pid; return evalCond(ctx, e, eff.filter); });
      if (!items.length) return;
      if (eff.order === 'simultaneous') {
        const kids = items.map((pid) => newThread(ctx, env.self, eff.do, { vars: { ...env.vars, [eff.as]: pid }, parent: th.id }).id);
        th.join = kids;
      } else th.frames.push({ t: 'each', sc, fx: eff.do, items, i: 0, as: eff.as });
      return;
    }
    case 'forEachPiece': {
      if (eff.asId) {
        // one iteration per piece instance: asId = id, as = its location
        const ids = queryPieces(ctx, env, eff.query).map((p) => p.id);
        if (ids.length) th.frames.push({ t: 'each', sc, fx: eff.do, items: ids, i: 0, as: eff.asId, locAs: eff.as });
        return;
      }
      const items = [...new Set(queryPieces(ctx, env, eff.query).map((p) => p.at))];
      if (items.length) th.frames.push({ t: 'each', sc, fx: eff.do, items, i: 0, as: eff.as });
      return;
    }
    case 'forEachLocation': {
      const items = filterLocations(ctx, env, allLocations(ctx, eff.kind), [eff.filter], eff.as);
      if (items.length) th.frames.push({ t: 'each', sc, fx: eff.do, items, i: 0, as: eff.as });
      return;
    }
    case 'chooseOption': {
      const who = P(eff.player);
      if (!who || who === 'bank') return;
      const idx = eff.options.map((o, i) => (evalCond(ctx, env, o.cond) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return;
      raise(ctx, th, {
        player: who, kind: 'option', label: eff.label ?? 'Choose an option',
        options: idx.map(String), optionLabels: idx.map((i) => eff.options[i].label),
      }, { k: 'option', sc, branches: eff.options.map((o) => o.do) });
      return;
    }
    case 'setVar': env.vars[eff.name] = evalExpr(ctx, env, eff.value); return;
    case 'emit': {
      const payload: Record<string, Val> = {};
      for (const [k, x] of Object.entries(eff.payload ?? {})) payload[k] = evalExpr(ctx, env, x);
      payload.player = env.self;
      emit(ctx, eff.event, payload, env.self);
      return;
    }
    case 'log': log(ctx, interpolate(ctx, env, eff.text), env.self); return;
    case 'abortIf':
      if (evalCond(ctx, env, eff.cond)) abort(ctx, th, eff.message ?? 'Action not allowed');
      return;

    /* ---------------- choices ---------------- */
    case 'choosePlayer': {
      const who = P(eff.player);
      if (!who || who === 'bank') { bind(eff.as, null); return; }
      const vars = { ...env.vars };
      const e: Env = { self: env.self, vars };
      const opts = playersFrom(ctx).filter((pid) => {
        if (!eff.filter) return pid !== env.self;
        vars[eff.as] = pid;
        return evalCond(ctx, e, eff.filter);
      });
      if (!opts.length) { bind(eff.as, null); return; }
      raise(ctx, th, {
        player: who, kind: 'player', label: eff.label ?? 'Choose a player', options: opts,
        optionLabels: opts.map((p) => playerName(ctx, p)), optional: eff.optional,
      }, { k: 'bind', sc, var: eff.as });
      return;
    }
    case 'chooseResource': {
      const who = P(eff.player);
      if (!who || who === 'bank') { bind(eff.as, null); return; }
      let opts = eff.options ?? ctx.def.resources.filter((r) => !eff.kind || r.kind === eff.kind).map((r) => r.id);
      if (eff.$bankOnly) opts = opts.filter((r) => bankHas(ctx, r) > 0);
      if (!opts.length) { bind(eff.as, null); return; }
      raise(ctx, th, {
        player: who, kind: 'resource', label: eff.label ?? 'Choose a resource', options: opts,
        optionLabels: opts.map((r) => resName(ctx, r)),
      }, { k: 'bind', sc, var: eff.as });
      return;
    }
    case 'chooseLocation': {
      const who = P(eff.player);
      if (!who || who === 'bank') { bind(eff.as, null); return; }
      const opts = filterLocations(ctx, env, allLocations(ctx, eff.kind), [eff.filter], eff.as);
      if (!opts.length) { bind(eff.as, null); return; }
      raise(ctx, th, { player: who, kind: 'location', label: eff.label ?? 'Choose a location', options: opts, optional: eff.optional },
        { k: 'bind', sc, var: eff.as });
      return;
    }
    case 'choosePiece': {
      const who = P(eff.player);
      if (!who || who === 'bank') { bind(eff.as, null); return; }
      const locs = [...new Set(queryPieces(ctx, env, eff.query).map((p) => p.at))];
      const opts = filterLocations(ctx, env, locs, [eff.filter], eff.as);
      if (!opts.length) { bind(eff.as, null); bind(eff.asId, null); return; }
      raise(ctx, th, { player: who, kind: 'piece', label: eff.label ?? 'Choose a piece', options: opts, optional: eff.optional },
        eff.asId
          ? { k: 'bind', sc, var: eff.as, always: true, then: [{ op: '$bindPieceId', from: eff.as, to: eff.asId, query: eff.query }] }
          : { k: 'bind', sc, var: eff.as });
      return;
    }
    case 'chooseMany': {
      const n = Math.max(0, Math.floor(evalExpr(ctx, env, eff.count)));
      const m = eff.min === undefined ? n : Math.min(n, Math.max(0, Math.floor(evalExpr(ctx, env, eff.min))));
      pushBlock(th, sc, [{ op: '$chooseMany', base: eff, n, m, picked: [] }]);
      return;
    }

    /* ---------------- resources ---------------- */
    case 'gain': {
      const pid = P(eff.player);
      if (!pid || pid === 'bank') return;
      const got: string[] = [];
      for (const [r, n] of Object.entries(evalResourceMap(ctx, env, eff.resources))) {
        const m = moveResource(ctx, 'bank', pid, r, n);
        if (m) got.push(`${m} ${resName(ctx, r)}`);
      }
      if (got.length) log(ctx, `${playerName(ctx, pid)} receives ${got.join(', ')}`, pid, { kind: 'gain' });
      return;
    }
    case 'pay': {
      const pid = P(eff.player);
      if (!pid || pid === 'bank') return;
      if (!pay(ctx, pid, evalResourceMap(ctx, env, eff.resources))) abort(ctx, th, `${playerName(ctx, pid)} cannot afford this`);
      return;
    }
    case 'transfer': {
      const from = P(eff.from);
      const to = P(eff.to);
      if (!from || !to || from === to) return;
      const amount = Math.max(0, Math.floor(evalExpr(ctx, env, eff.amount)));
      if (!amount) return;
      if (eff.resource === 'random') {
        let moved = 0;
        for (let i = 0; i < amount; i++) {
          const r = from === 'bank' ? randomBankResource(ctx) : randomResource(ctx, from);
          if (!r) break;
          moved += moveResource(ctx, from, to, r, 1, { hidden: from !== 'bank' && to !== 'bank' });
        }
        if (moved) log(ctx, `${playerName(ctx, to)} takes ${moved} card(s) from ${from === 'bank' ? 'the bank' : playerName(ctx, from)}`, to, { kind: 'steal' });
        return;
      }
      if (eff.resource === 'choice') {
        const giver = findPlayer(ctx, from);
        if (!giver) return;
        const opts = ctx.def.resources.filter((r) => (giver.resources[r.id] ?? 0) > 0).map((r) => r.id);
        if (!opts.length) return;
        const v = tmpVar(ctx);
        raise(ctx, th, { player: from, kind: 'resource', label: 'Choose a resource to give', options: opts, optionLabels: opts.map((r) => resName(ctx, r)) },
          { k: 'bind', sc, var: v, then: [{ ...eff, resource: { var: v } }] });
        return;
      }
      const r = resolveResource(env, eff.resource);
      if (!r) return;
      const m = moveResource(ctx, from, to, r, amount);
      if (m) log(ctx, `${from === 'bank' ? 'The bank' : playerName(ctx, from)} gives ${m} ${resName(ctx, r)} to ${to === 'bank' ? 'the bank' : playerName(ctx, to)}`, to === 'bank' ? from : to, { kind: 'transfer' });
      return;
    }
    case 'steal': {
      const from = P(eff.from);
      const to = P(eff.to);
      if (!from || !to || from === 'bank' || from === to) return;
      const amount = eff.amount === undefined ? 1 : Math.max(0, Math.floor(evalExpr(ctx, env, eff.amount)));
      let moved = 0;
      for (let i = 0; i < amount; i++) {
        const r = randomResource(ctx, from);
        if (!r) break;
        moved += moveResource(ctx, from, to, r, 1, { hidden: true });
      }
      log(ctx, moved ? `${playerName(ctx, to)} stole ${moved} card(s) from ${playerName(ctx, from)}` : `${playerName(ctx, from)} had nothing to steal`, to, { kind: 'steal' });
      return;
    }
    case 'discard': {
      const pid = P(eff.player);
      const p = findPlayer(ctx, pid);
      if (!p) return;
      const amount = Math.max(0, Math.floor(evalExpr(ctx, env, eff.amount)));
      if (!amount) return;
      const eligible = ctx.def.resources.filter((r) => (!eff.kind || r.kind === eff.kind) && (p.resources[r.id] ?? 0) > 0).map((r) => r.id);
      const total = eligible.reduce((a, r) => a + p.resources[r], 0);
      if (total <= amount) {
        for (const r of eligible) moveResource(ctx, p.id, 'bank', r, p.resources[r]);
        if (total) log(ctx, `${p.name} discards ${total} card(s)`, p.id, { kind: 'discard' });
        return;
      }
      raise(ctx, th, { player: p.id, kind: 'discard', label: `Discard ${amount} card(s)`, options: eligible, amount },
        { k: 'discard', player: p.id, kind: eff.kind });
      return;
    }
    case 'chooseAndGain': {
      const pid = P(eff.player);
      if (!pid || pid === 'bank') return;
      const n = Math.max(0, Math.floor(evalExpr(ctx, env, eff.amount)));
      if (!n) return;
      const v = tmpVar(ctx);
      const options = eff.options ?? ctx.def.resources.filter((r) => !eff.kind || r.kind === eff.kind).map((r) => r.id);
      const sc2 = newScope(ctx, th, pid, { ...env.vars });
      th.frames.push({ t: 'block', sc: sc2, pc: 0, own: true, fx: [{
        op: 'repeat', times: n, do: [
          { op: 'chooseResource', as: v, options, label: 'Choose a resource to take', $bankOnly: true } as Effect,
          { op: 'if', cond: { varSet: v }, then: [{ op: 'transfer', from: 'bank', to: 'self', resource: { var: v }, amount: 1 }] },
        ],
      }] });
      return;
    }
    case 'produce': {
      const hex = eff.hex ? locOf(ctx, env, eff.hex) ?? undefined : undefined;
      const roll = eff.roll !== undefined ? evalExpr(ctx, env, eff.roll) : s.lastRoll?.total;
      const player = eff.player ? P(eff.player) ?? undefined : undefined;
      if (hex === undefined && roll === undefined) return;
      const gold = runProduction(ctx, { roll: hex ? undefined : roll, hex, player });
      for (const g of gold.reverse()) {
        pushScoped(ctx, th, g.player, [{ op: 'chooseAndGain', amount: g.amount, options: g.options }]);
      }
      return;
    }

    /* ---------------- pieces & board ---------------- */
    case 'place': {
      const pid = P(eff.player);
      const pdef = ctx.L.pieces.get(eff.piece);
      if (!pid || pid === 'bank' || !pdef) return;
      if (eff.location?.at === undefined) {
        const opts = legalPlacements(ctx, env, eff.piece, pid, { ignoreConnection: eff.ignoreConnection, where: eff.location?.where });
        if (!opts.length) { bind(eff.as, null); log(ctx, `No legal location for ${pdef.name}`, pid); return; }
        const v = tmpVar(ctx);
        raise(ctx, th, {
          player: pid, kind: 'location', label: eff.location?.label ?? `Place ${pdef.name}`, options: opts, piece: pdef.id,
          optional: eff.$cancelable,
        }, { k: 'bind', sc, var: v, then: [{ ...eff, location: { ...eff.location, at: v } }] });
        return;
      }
      const at = locOf(ctx, env, eff.location.at);
      if (!at) { bind(eff.as, null); return; }
      if (supplyLeft(ctx, pid, pdef.id) <= 0) { log(ctx, `No ${pdef.name} left in supply`, pid); bind(eff.as, null); return; }
      if (!eff.free && pdef.cost && !pay(ctx, pid, evalResourceMap(ctx, env, pdef.cost))) {
        abort(ctx, th, `${playerName(ctx, pid)} cannot afford ${pdef.name}`);
        return;
      }
      const old = piecesAt(ctx, at).find((p) => p.owner === pid && pdef.upgradesFrom?.includes(p.type));
      if (old) removePieceInstance(ctx, old.id, false);
      const inst = addPiece(ctx, pdef.id, pid, at, old?.cargo);
      bind(eff.as, at);
      bind(eff.asId, inst.id);
      log(ctx, `${playerName(ctx, pid)} ${old ? 'upgrades to' : 'places'} a ${pdef.name}`, pid, { kind: 'build', piece: pdef.id, at });
      emit(ctx, 'piecePlaced', { piece: pdef.id, at, owner: pid, player: pid, pieceId: inst.id }, pid);
      if (old) emit(ctx, 'pieceUpgraded', { from: old.type, piece: pdef.id, at, owner: pid, player: pid, pieceId: inst.id }, pid);
      return;
    }
    case 'upgrade': {
      const pid = P(eff.player);
      const to = ctx.L.pieces.get(eff.to);
      if (!pid || pid === 'bank' || !to) return;
      const from = Array.isArray(eff.from) ? eff.from : [eff.from];
      if (eff.location?.at === undefined) {
        const opts = legalUpgrades(ctx, env, from, to.id, pid, eff.location?.where);
        if (!opts.length) { bind(eff.as, null); return; }
        const v = tmpVar(ctx);
        raise(ctx, th, { player: pid, kind: 'location', label: eff.location?.label ?? `Upgrade to ${to.name}`, options: opts, piece: to.id, optional: eff.$cancelable },
          { k: 'bind', sc, var: v, then: [{ ...eff, location: { ...eff.location, at: v } }] });
        return;
      }
      const at = locOf(ctx, env, eff.location.at);
      const old = at ? ownPieceAt(ctx, env, eff.location.at, pid, from) : undefined;
      if (!at || !old) { bind(eff.as, null); bind(eff.asId, null); return; }
      if (supplyLeft(ctx, pid, to.id) <= 0) { bind(eff.as, null); bind(eff.asId, null); return; }
      if (!eff.free && to.cost && !pay(ctx, pid, evalResourceMap(ctx, env, to.cost))) {
        abort(ctx, th, `${playerName(ctx, pid)} cannot afford ${to.name}`);
        return;
      }
      removePieceInstance(ctx, old.id, false);
      const inst = addPiece(ctx, to.id, pid, at, old.cargo);
      bind(eff.as, at);
      bind(eff.asId, inst.id);
      log(ctx, `${playerName(ctx, pid)} upgrades to a ${to.name}`, pid, { kind: 'build', piece: to.id, at });
      emit(ctx, 'pieceUpgraded', { from: old.type, piece: to.id, at, owner: pid, player: pid, pieceId: inst.id }, pid);
      return;
    }
    case 'downgrade': {
      const pid = P(eff.player);
      const to = ctx.L.pieces.get(eff.to);
      if (!pid || pid === 'bank' || !to) { bind(eff.as, null); bind(eff.asId, null); return; }
      const from = Array.isArray(eff.from) ? eff.from : [eff.from];
      if (eff.location?.at === undefined) {
        const locs = [...new Set(s.pieces.filter((p) => p.owner === pid && from.includes(p.type)).map((p) => p.at))];
        const opts = filterLocations(ctx, env, locs, [eff.location?.where]);
        if (!opts.length) { bind(eff.as, null); bind(eff.asId, null); return; }
        const v = tmpVar(ctx);
        const names = from.map((f) => ctx.L.pieces.get(f)?.name ?? f).join(' / ');
        raise(ctx, th, { player: pid, kind: 'piece', label: eff.location?.label ?? `Choose a ${names} to reduce to a ${to.name}`, options: opts, piece: to.id },
          { k: 'bind', sc, var: v, then: [{ ...eff, location: { ...eff.location, at: v } }] });
        return;
      }
      const at = locOf(ctx, env, eff.location.at);
      const old = at ? ownPieceAt(ctx, env, eff.location.at, pid, from) : undefined;
      if (!at || !old) { bind(eff.as, null); bind(eff.asId, null); return; }
      const oldName = ctx.L.pieces.get(old.type)?.name ?? old.type;
      if (supplyLeft(ctx, pid, to.id) <= 0) {
        removePieceInstance(ctx, old.id);
        bind(eff.as, null);
        bind(eff.asId, null);
        log(ctx, `${playerName(ctx, pid)}'s ${oldName} is lost (no ${to.name} left)`, pid);
        emit(ctx, 'pieceRemoved', { piece: old.type, at, owner: pid, player: pid, pieceId: old.id }, pid);
        emit(ctx, 'pieceDowngraded', { from: old.type, piece: null, at, owner: pid, player: pid, pieceId: null }, pid);
        return;
      }
      removePieceInstance(ctx, old.id, false);
      const inst = addPiece(ctx, to.id, pid, at, old.cargo);
      bind(eff.as, at);
      bind(eff.asId, inst.id);
      log(ctx, `${playerName(ctx, pid)}'s ${oldName} is reduced to a ${to.name}`, pid);
      emit(ctx, 'pieceDowngraded', { from: old.type, piece: to.id, at, owner: pid, player: pid, pieceId: inst.id }, pid);
      return;
    }
    case 'remove': {
      if (eff.location?.at === undefined) {
        const locs = [...new Set(queryPieces(ctx, env, eff.query).map((p) => p.at))];
        const opts = filterLocations(ctx, env, locs, [eff.location?.where]);
        if (!opts.length) { bind(eff.as, null); return; }
        const v = tmpVar(ctx);
        raise(ctx, th, { player: env.self, kind: 'piece', label: eff.location?.label ?? 'Choose a piece to remove', options: opts },
          { k: 'bind', sc, var: v, then: [{ ...eff, location: { ...eff.location, at: v } }] });
        return;
      }
      const pc = pieceOf(ctx, env, eff.location.at, eff.query);
      if (!pc) { bind(eff.as, null); return; }
      removePieceInstance(ctx, pc.id);
      if (eff.returnToSupply === false) {
        const owner = getPlayer(ctx, pc.owner);
        owner.stats[`lost:${pc.type}`] = (owner.stats[`lost:${pc.type}`] ?? 0) + 1;
      }
      bind(eff.as, pc.at);
      log(ctx, `${playerName(ctx, pc.owner)}'s ${ctx.L.pieces.get(pc.type)?.name ?? pc.type} is removed`, pc.owner);
      emit(ctx, 'pieceRemoved', { piece: pc.type, at: pc.at, owner: pc.owner, player: pc.owner, pieceId: pc.id }, pc.owner);
      return;
    }
    case 'movePiece': {
      const who = P(eff.player);
      const none = () => { bind(eff.as, null); bind(eff.asId, null); bind(eff.stepsAs, null); };
      if (!who || who === 'bank') { none(); return; }
      if (eff.from?.at === undefined) {
        const locs = [...new Set(queryPieces(ctx, env, eff.query).map((p) => p.at))];
        const opts = filterLocations(ctx, env, locs, [eff.from?.where]);
        if (!opts.length) { none(); return; }
        const v = tmpVar(ctx);
        raise(ctx, th, { player: who, kind: 'piece', label: eff.from?.label ?? 'Choose a piece to move', options: opts },
          { k: 'bind', sc, var: v, then: [{ ...eff, from: { ...eff.from, at: v } }] });
        return;
      }
      const pc = pieceOf(ctx, env, eff.from.at, eff.query);
      if (!pc) { none(); return; }
      const fromLoc = pc.at;
      if (eff.to?.at === undefined) {
        const dests = moveDestinations(ctx, env, eff, pc);
        if (!dests.size) { log(ctx, `The ${ctx.L.pieces.get(pc.type)?.name ?? pc.type} has nowhere to go`, pc.owner); none(); return; }
        // pin the exact piece for the continuation
        const pv = tmpVar(ctx);
        env.vars[pv] = pc.id;
        const v = tmpVar(ctx);
        raise(ctx, th, { player: who, kind: 'location', label: eff.to?.label ?? 'Move to', options: [...dests.keys()], piece: pc.type, pieceId: pc.id },
          { k: 'bind', sc, var: v, then: [{ ...eff, from: { ...eff.from, at: pv }, to: { ...eff.to, at: v }, $dist: Object.fromEntries(dests) }] });
        return;
      }
      const toLoc = locOf(ctx, env, eff.to.at);
      if (!toLoc) { none(); return; }
      let steps: number | null = eff.$dist?.[toLoc] ?? null;
      if (steps === null && eff.maxSteps !== undefined) {
        steps = reachable(ctx, pc, Math.floor(evalExpr(ctx, env, eff.maxSteps)), eff.path, env).get(toLoc) ?? null;
      }
      pc.at = toLoc;
      invalidatePieces(ctx);
      bind(eff.as, toLoc);
      bind(eff.asId, pc.id);
      bind(eff.stepsAs, steps);
      emit(ctx, 'pieceMoved', { piece: pc.type, from: fromLoc, at: toLoc, owner: pc.owner, player: pc.owner, pieceId: pc.id, steps }, pc.owner);
      return;
    }
    case 'setPieceState': {
      const pc = pieceOf(ctx, env, eff.at);
      if (pc) pc.state[eff.key] = evalExpr(ctx, env, eff.value);
      return;
    }
    case 'loadCargo': {
      const pc = pieceOf(ctx, env, eff.piece);
      const p = findPlayer(ctx, P(eff.player));
      if (!pc || !p) return;
      const amount = eff.amount === undefined ? 1 : Math.max(0, Math.floor(evalExpr(ctx, env, eff.amount)));
      if (!amount) return;
      if (eff.resource === 'choice') {
        const opts = ctx.def.resources.filter((r) => (p.resources[r.id] ?? 0) > 0).map((r) => r.id);
        if (!opts.length) return;
        const v = tmpVar(ctx);
        raise(ctx, th, { player: p.id, kind: 'resource', label: 'Choose a resource to load', options: opts, optionLabels: opts.map((r) => resName(ctx, r)) },
          { k: 'bind', sc, var: v, then: [{ ...eff, resource: { var: v } }] });
        return;
      }
      const r = resolveResource(env, eff.resource);
      if (!r || !ctx.L.resources.has(r)) return;
      const n = Math.min(amount, p.resources[r] ?? 0);
      if (n <= 0) return;
      p.resources[r] -= n;
      pc.cargo = { ...(pc.cargo ?? {}), [r]: (pc.cargo?.[r] ?? 0) + n };
      log(ctx, `${p.name} loads ${n} ${resName(ctx, r)} onto a ${ctx.L.pieces.get(pc.type)?.name ?? pc.type}`, p.id);
      emit(ctx, 'resourceLost', { player: p.id, resource: r, amount: n }, p.id);
      return;
    }
    case 'unloadCargo': {
      const pc = pieceOf(ctx, env, eff.piece);
      const to = P(eff.to);
      if (!pc?.cargo || !to) return;
      const dst = to === 'bank' ? null : findPlayer(ctx, to);
      if (to !== 'bank' && !dst) return;
      const keys = eff.resource === undefined || eff.resource === 'all'
        ? Object.keys(pc.cargo).filter((k) => ctx.L.resources.has(k))
        : [resolveResource(env, eff.resource)].filter((k): k is string => !!k);
      const cap = eff.amount === undefined ? Infinity : Math.max(0, Math.floor(evalExpr(ctx, env, eff.amount)));
      for (const k of keys) {
        const have = pc.cargo[k] ?? 0;
        const n = Math.min(have, cap);
        if (n <= 0) continue;
        const isRes = ctx.L.resources.has(k);
        if (!isRes && dst) continue; // abstract goods can only be discarded (to: 'bank')
        if (have - n > 0) pc.cargo[k] = have - n; else delete pc.cargo[k];
        if (!isRes) continue;
        if (dst) {
          dst.resources[k] = (dst.resources[k] ?? 0) + n;
          emit(ctx, 'resourceGained', { player: dst.id, resource: k, amount: n }, dst.id);
          log(ctx, `${dst.name} unloads ${n} ${resName(ctx, k)}`, dst.id);
        } else if ((s.bank[k] ?? 0) >= 0) s.bank[k] = (s.bank[k] ?? 0) + n;
      }
      if (!Object.keys(pc.cargo).length) delete pc.cargo;
      return;
    }
    case 'addCargo': {
      const pc = pieceOf(ctx, env, eff.piece);
      if (!pc) return;
      const n = Math.floor(evalExpr(ctx, env, eff.amount));
      const next = Math.max(0, (pc.cargo?.[eff.key] ?? 0) + n);
      pc.cargo = { ...(pc.cargo ?? {}) };
      if (next > 0) pc.cargo[eff.key] = next; else delete pc.cargo[eff.key];
      if (!Object.keys(pc.cargo).length) delete pc.cargo;
      return;
    }
    case 'moveToken': {
      const t = ctx.L.tokens.get(eff.token);
      if (!t) return;
      if (eff.to?.at === undefined) {
        const opts = legalTokenSpots(ctx, env, t.id, eff.to?.where);
        if (!opts.length) { bind(eff.as, null); return; }
        const v = tmpVar(ctx);
        raise(ctx, th, { player: env.self, kind: 'location', label: eff.to?.label ?? `Move the ${t.name}`, options: opts },
          { k: 'bind', sc, var: v, then: [{ ...eff, to: { ...eff.to, at: v } }] });
        return;
      }
      const at = locOf(ctx, env, eff.to.at);
      if (!at) { bind(eff.as, null); return; }
      const prev = s.tokens[t.id] ?? null;
      s.tokens[t.id] = at;
      bind(eff.as, at);
      log(ctx, `${playerName(ctx, env.self)} moves the ${t.name}`, env.self);
      emit(ctx, 'tokenMoved', { token: t.id, at, from: prev, player: env.self }, env.self);
      if (t.onMove?.length) pushScoped(ctx, th, env.self, t.onMove, { ...env.vars, at, token: t.id });
      return;
    }
    case 'removeToken': {
      const prev = s.tokens[eff.token] ?? null;
      if (!ctx.L.tokens.has(eff.token) || prev === null) return;
      s.tokens[eff.token] = null;
      log(ctx, `${playerName(ctx, env.self)} takes the ${ctx.L.tokens.get(eff.token)!.name} off the board`, env.self);
      emit(ctx, 'tokenMoved', { token: eff.token, at: null, from: prev, player: env.self }, env.self);
      return;
    }
    case 'setTerrain': {
      const at = locOf(ctx, env, eff.at);
      if (at && s.hexes[at]) { s.hexes[at].terrain = eff.terrain; ctx.regions = undefined; }
      return;
    }
    case 'setHexNumber': {
      const at = locOf(ctx, env, eff.at);
      if (at && s.hexes[at]) s.hexes[at].number = eff.number === null ? null : evalExpr(ctx, env, eff.number);
      return;
    }
    case 'revealHex': {
      const at = locOf(ctx, env, eff.at);
      if (at && s.hexes[at] && !s.hexes[at].revealed) {
        s.hexes[at].revealed = true;
        emit(ctx, 'hexRevealed', { at, terrain: s.hexes[at].terrain, player: env.self }, env.self);
      }
      return;
    }

    /* ---------------- cards ---------------- */
    case 'drawCard': {
      const pid = P(eff.player);
      if (!pid || pid === 'bank') return;
      const n = eff.count === undefined ? 1 : Math.max(0, Math.floor(evalExpr(ctx, env, eff.count)));
      for (let i = 0; i < n; i++) {
        const inst = drawCard(ctx, eff.deck, pid);
        if (!inst) { log(ctx, `The ${ctx.L.decks.get(eff.deck)?.name ?? eff.deck} deck is empty`); break; }
        afterAcquire(ctx, th, pid, inst);
      }
      return;
    }
    case 'giveCard': {
      const pid = P(eff.player);
      const p = findPlayer(ctx, pid);
      if (!p || !ctx.L.cards.has(eff.card)) return;
      const inst: CardInstance = { id: nextId(ctx, 'c'), card: eff.card, deck: ctx.L.deckOfCard.get(eff.card) ?? '', acquiredTurn: s.turn };
      p.hand.push(inst);
      emit(ctx, 'cardDrawn', { card: eff.card, deck: inst.deck, player: p.id }, p.id);
      afterAcquire(ctx, th, p.id, inst, true);
      return;
    }
    case 'discardCard': {
      const pid = P(eff.player);
      const p = findPlayer(ctx, pid);
      if (!p) return;
      const cands = p.hand.filter((c) => (eff.card === undefined || c.card === eff.card) && (eff.$deck === undefined || c.deck === eff.$deck));
      if (!cands.length) return;
      if (eff.choose && cands.length > 1) {
        raise(ctx, th, {
          player: p.id, kind: 'card', label: 'Choose a card to discard', options: cands.map((c) => c.id),
          optionLabels: cands.map((c) => ctx.L.cards.get(c.card)?.name ?? c.card),
        }, { k: 'discardCard', player: p.id });
        return;
      }
      discardCardInstance(ctx, p.id, cands[0].id);
      return;
    }
    case 'takeCard': {
      const from = findPlayer(ctx, P(eff.from, 'self'));
      const to = findPlayer(ctx, P(eff.to));
      if (!from || !to || from.id === to.id) return;
      const cands = from.hand.filter((c) => eff.deck === undefined || c.deck === eff.deck);
      if (!cands.length) { log(ctx, `${from.name} has no card to take`, to.id); return; }
      if (eff.choose && cands.length > 1) {
        raise(ctx, th, {
          player: to.id, kind: 'card', label: `Choose a card to take from ${from.name}`, options: cands.map((c) => c.id),
          optionLabels: cands.map((c) => ctx.L.cards.get(c.card)?.name ?? c.card),
        }, { k: 'takeCard', from: from.id, to: to.id });
        return;
      }
      const inst = eff.choose ? cands[0] : cands[randInt(rng(ctx), 0, cands.length - 1)];
      moveCardInstance(ctx, th, from.id, to.id, inst.id);
      return;
    }
    case 'shuffleDeck': {
      const d = s.decks[eff.deck];
      if (!d) return;
      d.draw = shuffle(rng(ctx), [...d.draw, ...d.discard]);
      d.discard = [];
      return;
    }

    /* ---------------- scoring & state ---------------- */
    case 'addVP': {
      const p = findPlayer(ctx, P(eff.player));
      if (!p) return;
      const n = evalExpr(ctx, env, eff.amount);
      p.tokenVP += n;
      log(ctx, `${p.name} ${n >= 0 ? 'gains' : 'loses'} ${Math.abs(n)} VP${eff.reason ? ` (${eff.reason})` : ''}`, p.id);
      return;
    }
    case 'addStat': {
      const p = findPlayer(ctx, P(eff.player));
      if (p) p.stats[eff.key] = (p.stats[eff.key] ?? 0) + evalExpr(ctx, env, eff.amount);
      return;
    }
    case 'setStat': {
      const p = findPlayer(ctx, P(eff.player));
      if (p) p.stats[eff.key] = evalExpr(ctx, env, eff.value);
      return;
    }
    case 'addGlobal': s.globals[eff.key] = (s.globals[eff.key] ?? 0) + evalExpr(ctx, env, eff.amount); return;
    case 'setGlobal': s.globals[eff.key] = evalExpr(ctx, env, eff.value); return;
    case 'setFlag': {
      const p = findPlayer(ctx, P(eff.player));
      if (p) p.flags[eff.flag] = { value: eff.value, until: eff.until ?? 'forever' };
      return;
    }
    case 'grantTradeRate': {
      const p = findPlayer(ctx, P(eff.player));
      if (!p) return;
      const r = eff.resource === 'any' ? 'any' : resolveResource(env, eff.resource);
      if (!r) return;
      p.tradeRates.push({ resource: r, ratio: eff.ratio, until: eff.until ?? 'forever' });
      return;
    }

    /* ---------------- turn flow ---------------- */
    case 'rollDice': doRoll(ctx, eff.values?.map((v) => evalExpr(ctx, env, v))); return;
    case 'extraBuildPhase': {
      s.specialBuild = { queue: playersFrom(ctx).slice(1), turnPlayerIndex: s.currentPlayerIndex };
      return;
    }
    case 'endTurn': {
      pushScoped(ctx, th, env.self, [{ op: '$advanceTurn' }]);
      if (s.phase !== 'specialBuild') emit(ctx, 'turnEnd', { player: currentPlayerId(s) }, currentPlayerId(s));
      return;
    }
    case 'win': {
      const pid = P(eff.player);
      if (!pid || !findPlayer(ctx, pid)) return;
      s.winner = pid;
      s.phase = 'gameOver';
      log(ctx, `${playerName(ctx, pid)} wins!`, pid);
      return;
    }

    /* ---------------- internal ---------------- */
    case '$setupStep': if (s.setupProgress) s.setupProgress.step = eff.step; return;
    case '$setupNext': advanceSetup(ctx, th); return;
    case '$startingResources': startingResources(ctx, th, env.self); return;
    case '$turnStart': turnStart(ctx); return;
    case '$advanceTurn': advanceTurn(ctx, th); return;
    case '$afterCardPlay': afterCardPlay(ctx, env.self, eff.instance); return;
    case '$bindPieceId': env.vars[eff.to] = pieceOf(ctx, env, eff.from, eff.query)?.id ?? null; return;
    case '$chooseMany': {
      const base = eff.base;
      let picked = eff.picked;
      if (eff.pickVar) {
        const v = env.vars[eff.pickVar];
        delete env.vars[eff.pickVar];
        if (typeof v !== 'string') { finishChooseMany(th, sc, env, base, picked); return; }
        picked = [...picked, v];
      }
      const who = P(base.player);
      if (!who || who === 'bank' || picked.length >= eff.n) { finishChooseMany(th, sc, env, base, picked); return; }
      const opts = chooseManyOptions(ctx, env, base).filter((o) => !picked.includes(o));
      if (!opts.length) { finishChooseMany(th, sc, env, base, picked); return; }
      const kind = base.of === 'player' ? 'player' : base.of === 'resource' ? 'resource' : base.of === 'piece' ? 'piece' : 'location';
      const optionLabels = base.of === 'player' ? opts.map((p) => playerName(ctx, p)) : base.of === 'resource' ? opts.map((r) => resName(ctx, r)) : undefined;
      const v = tmpVar(ctx);
      raise(ctx, th, {
        player: who, kind, label: `${base.label ?? `Choose a ${base.of}`} (${picked.length + 1}/${eff.n})`, options: opts, optionLabels,
        optional: picked.length >= eff.m ? true : undefined,
        progress: { picked: picked.length, max: eff.n, min: eff.m, chosen: [...picked] },
      }, { k: 'bind', sc, var: v, always: true, then: [{ ...eff, picked, pickVar: v }] });
      return;
    }
  }
}

function randomBankResource(ctx: Ctx): Id | null {
  const opts = ctx.def.resources.filter((r) => bankHas(ctx, r.id) > 0).map((r) => r.id);
  return opts.length ? opts[randInt(rng(ctx), 0, opts.length - 1)] : null;
}

/* ------------------------------ piece helpers --------------------------- */

export function addPiece(ctx: Ctx, type: Id, owner: string, at: string, cargo?: Record<Id, number>): PieceInstance {
  const def = ctx.L.pieces.get(type);
  const inst: PieceInstance = { id: nextId(ctx, 'pc'), type, owner, at, state: { ...(def?.initialState ?? {}) } };
  if (cargo && Object.keys(cargo).length) inst.cargo = { ...cargo };
  ctx.s.pieces.push(inst);
  invalidatePieces(ctx);
  return inst;
}

/** Take a piece off the board. Resource cargo goes back to the bank unless `returnCargo` is false
 *  (used when the piece is replaced and the cargo carries over). */
export function removePieceInstance(ctx: Ctx, id: string, returnCargo = true): void {
  const pc = ctx.s.pieces.find((p) => p.id === id);
  if (pc?.cargo && returnCargo) {
    for (const [r, n] of Object.entries(pc.cargo)) {
      if (ctx.L.resources.has(r) && (ctx.s.bank[r] ?? 0) >= 0) ctx.s.bank[r] = (ctx.s.bank[r] ?? 0) + n;
    }
  }
  ctx.s.pieces = ctx.s.pieces.filter((p) => p.id !== id);
  invalidatePieces(ctx);
}

/** The player's piece of one of `types` referred to by a var (piece id or location). */
function ownPieceAt(ctx: Ctx, env: Env, name: string, pid: string, types: Id[]): PieceInstance | undefined {
  const v = env.vars[name];
  if (typeof v !== 'string') return undefined;
  const byId = pieceById(ctx, v);
  if (byId) return byId.owner === pid && types.includes(byId.type) ? byId : undefined;
  return piecesAt(ctx, v).find((p) => p.owner === pid && types.includes(p.type));
}

/* ------------------------------ movement -------------------------------- */

/** Neighbouring locations of the same kind, with the location connecting them. */
function stepsFrom(ctx: Ctx, loc: LocationId): [LocationId, LocationId][] {
  const topo = boardTopo(ctx.s);
  const k = kindOf(loc);
  if (k === 'vertex') {
    const vs = new Set(topo.vertices);
    return vertexNeighbors(loc).filter((n) => vs.has(n)).map((n) => [n, edgeIdOf(loc, n)]);
  }
  if (k === 'edge') {
    const es = new Set(topo.edges);
    const out: [LocationId, LocationId][] = [];
    for (const v of edgeVertices(loc)) for (const e of vertexEdges(v)) if (e !== loc && es.has(e)) out.push([e, v]);
    return out;
  }
  const c = parseHexId(loc);
  const sides = hexEdges(c);
  return hexNeighbors(c).map((n, i) => [hexId(n), sides[i]] as [LocationId, LocationId]).filter(([h]) => topo.hexSet.has(h));
}

/** Breadth-first reach from a piece: location -> fewest steps (1..max). `path` is evaluated from the
 *  owner's perspective with `at` = next step, `prev`, `via`. */
function reachable(ctx: Ctx, pc: PieceInstance, max: number, path: Condition | undefined, env: Env): Map<LocationId, number> {
  const out = new Map<LocationId, number>();
  const vars = { ...env.vars };
  const e: Env = { self: pc.owner, vars };
  const seen = new Set<LocationId>([pc.at]);
  let frontier = [pc.at];
  for (let d = 1; d <= max && frontier.length; d++) {
    const next: LocationId[] = [];
    for (const cur of frontier) {
      for (const [nb, via] of stepsFrom(ctx, cur)) {
        if (seen.has(nb)) continue;
        vars.at = nb; vars.prev = cur; vars.via = via;
        if (!evalCond(ctx, e, path)) continue;
        seen.add(nb);
        out.set(nb, d);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return out;
}

/** Legal destinations for movePiece (piece lifted off the board while computing). */
function moveDestinations(ctx: Ctx, env: Env, eff: MovePieceEffect, pc: PieceInstance): Map<LocationId, number | null> {
  const s = ctx.s;
  const idx = s.pieces.indexOf(pc);
  s.pieces.splice(idx, 1);
  invalidatePieces(ctx);
  try {
    const reach = eff.maxSteps !== undefined
      ? reachable(ctx, pc, Math.floor(evalExpr(ctx, env, eff.maxSteps)), eff.path, env)
      : null;
    let cands: LocationId[];
    if (eff.anywhere) {
      cands = filterLocations(ctx, env, reach ? [...reach.keys()] : allLocations(ctx, kindOf(pc.at)), [eff.to?.where], 'at', pc.owner);
    } else {
      cands = legalPlacements(ctx, env, pc.type, pc.owner, { ignoreSupply: true, where: eff.to?.where });
      if (reach) cands = cands.filter((l) => reach.has(l));
    }
    return new Map(cands.filter((l) => l !== pc.at).map((l) => [l, reach ? reach.get(l)! : null]));
  } finally {
    s.pieces.splice(idx, 0, pc);
    invalidatePieces(ctx);
  }
}

/* ------------------------------ chooseMany ------------------------------ */


function chooseManyOptions(ctx: Ctx, env: Env, eff: ChooseManyEffect): string[] {
  const vars = { ...env.vars };
  const e: Env = { self: env.self, vars };
  const keep = (x: string) => { vars[eff.as] = x; return evalCond(ctx, e, eff.filter); };
  switch (eff.of) {
    case 'player': return playersFrom(ctx).filter((pid) => (eff.filter === undefined ? pid !== env.self : keep(pid)));
    case 'resource': return (eff.options ?? ctx.def.resources.map((r) => r.id)).filter(keep);
    case 'piece': return [...new Set(queryPieces(ctx, env, eff.query ?? {}).map((p) => p.at))].filter(keep);
    default: return allLocations(ctx, eff.kind ?? 'hex').filter(keep);
  }
}

function finishChooseMany(th: Thread, sc: string, env: Env, eff: ChooseManyEffect, picked: string[]): void {
  if (eff.countAs) env.vars[eff.countAs] = picked.length;
  if (picked.length && eff.do.length) th.frames.push({ t: 'each', sc, fx: eff.do, items: picked, i: 0, as: eff.as });
}

/* ------------------------------ card helpers ---------------------------- */

export function drawCard(ctx: Ctx, deckId: Id, pid: string): CardInstance | null {
  const d = ctx.s.decks[deckId];
  const ddef = ctx.L.decks.get(deckId);
  const p = findPlayer(ctx, pid);
  if (!d || !p) return null;
  if (!d.draw.length && ddef?.reshuffleDiscards && d.discard.length) {
    d.draw = shuffle(rng(ctx), d.discard);
    d.discard = [];
  }
  const card = d.draw.shift();
  if (!card) return null;
  const inst: CardInstance = { id: nextId(ctx, 'c'), card, deck: deckId, acquiredTurn: ctx.s.turn };
  p.hand.push(inst);
  emit(ctx, 'cardDrawn', { card, deck: deckId, player: pid }, pid);
  return inst;
}

/** Hand limits and `immediate` cards after a card is acquired. */
function afterAcquire(ctx: Ctx, th: Thread, pid: string, inst: CardInstance, skipLimit = false): void {
  const cdef = ctx.L.cards.get(inst.card);
  const p = getPlayer(ctx, pid);
  if (cdef?.play.timing === 'immediate') {
    p.hand = p.hand.filter((c) => c.id !== inst.id);
    pushScoped(ctx, th, pid, [...cdef.effect, { op: '$afterCardPlay', instance: inst }]);
    return;
  }
  const limit = ctx.L.decks.get(inst.deck)?.handLimit;
  if (!skipLimit && limit !== undefined && p.hand.filter((c) => c.deck === inst.deck).length > limit) {
    pushScoped(ctx, th, pid, [{ op: 'discardCard', player: 'self', choose: true, $deck: inst.deck }]);
  }
}

/** takeCard: move one card instance between hands; the receiver acquires it now (cardDrawn, hand limit). */
function moveCardInstance(ctx: Ctx, th: Thread, fromId: string, toId: string, instId: string): void {
  const from = getPlayer(ctx, fromId);
  const to = getPlayer(ctx, toId);
  const inst = from.hand.find((c) => c.id === instId);
  if (!inst) return;
  from.hand = from.hand.filter((c) => c.id !== instId);
  const moved: CardInstance = { ...inst, acquiredTurn: ctx.s.turn };
  to.hand.push(moved);
  log(ctx, `${to.name} takes a card from ${from.name}`, to.id);
  emit(ctx, 'cardDrawn', { card: moved.card, deck: moved.deck, player: to.id }, to.id);
  afterAcquire(ctx, th, to.id, moved);
}

export function discardCardInstance(ctx: Ctx, pid: string, instId: string): void {
  const p = getPlayer(ctx, pid);
  const inst = p.hand.find((c) => c.id === instId);
  if (!inst) return;
  p.hand = p.hand.filter((c) => c.id !== instId);
  ctx.s.decks[inst.deck]?.discard.push(inst.card);
  log(ctx, `${p.name} discards a card`, pid);
}

function afterCardPlay(ctx: Ctx, pid: string, inst: CardInstance): void {
  const cdef = ctx.L.cards.get(inst.card);
  const p = getPlayer(ctx, pid);
  if (cdef?.countsAs) p.stats[cdef.countsAs] = (p.stats[cdef.countsAs] ?? 0) + 1;
  const after = cdef?.afterPlay ?? 'keepFaceUp';
  const d = ctx.s.decks[inst.deck];
  if (after === 'keepFaceUp' || !d) p.played.push(inst);
  else if (after === 'discard') d.discard.push(inst.card);
  else d.draw.push(inst.card);
  emit(ctx, 'cardPlayed', { card: inst.card, deck: inst.deck, player: pid }, pid);
}

/* -------------------------------- respond ------------------------------- */

export function respond(ctx: Ctx, pid: string, promptId: string, answer: unknown): void {
  const pr = ctx.s.prompts.find((p) => p.id === promptId);
  if (!pr) throw new CommandError('No such prompt');
  if (pr.player !== pid) throw new CommandError('This prompt is not for you');
  const th = threads(ctx).find((t) => t.pending?.prompt === promptId);
  if (!th || !th.pending) throw new CommandError('Prompt is not active');
  const pending = th.pending;

  if (pending.k === 'discard') {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new CommandError('Answer must be a resource map');
    const p = getPlayer(ctx, pending.player);
    let sum = 0;
    for (const [r, n] of Object.entries(answer as Record<string, unknown>)) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new CommandError('Invalid amount');
      if (n === 0) continue;
      if (!pr.options.includes(r)) throw new CommandError(`Cannot discard ${r}`);
      if ((p.resources[r] ?? 0) < n) throw new CommandError(`Not enough ${r}`);
      sum += n;
    }
    if (sum !== pr.amount) throw new CommandError(`Must discard exactly ${pr.amount}`);
    for (const [r, n] of Object.entries(answer as Record<string, number>)) if (n > 0) moveResource(ctx, p.id, 'bank', r, n);
    log(ctx, `${p.name} discards ${sum} card(s)`, p.id, { kind: 'discard' });
  } else {
    let val: string | null;
    if (answer === null || answer === undefined) {
      if (!pr.optional) throw new CommandError('An answer is required');
      val = null;
    } else {
      if (typeof answer !== 'string' || !pr.options.includes(answer)) throw new CommandError('Illegal answer');
      val = answer;
    }
    if (pending.k === 'bind') {
      const scope = th.scopes[pending.sc];
      if (scope) scope.vars[pending.var] = val;
      if (pending.then && (val !== null || pending.always)) pushBlock(th, pending.sc, pending.then);
    } else if (pending.k === 'option') {
      if (val !== null) pushBlock(th, pending.sc, pending.branches[Number(val)] ?? []);
    } else if (pending.k === 'discardCard') {
      if (val !== null) discardCardInstance(ctx, pending.player, val);
    } else if (pending.k === 'takeCard') {
      if (val !== null) moveCardInstance(ctx, th, pending.from, pending.to, val);
    }
  }
  ctx.s.prompts = ctx.s.prompts.filter((p) => p.id !== promptId);
  delete th.pending;
  flushEvents(ctx, th);
}
