/**
 * Plain-language rendering of Effects / Conditions / Exprs, e.g.
 *   { op:'repeat', times:2, do:[{ op:'place', piece:'road', free:true }] }
 *   → "Repeat 2 times: place a Road for free"
 * Used for previews under block trees and on list items, and for docs.
 */
import type {
  Condition, Effect, Expr, GameDefinition, LocationChoice, PieceQuery, PlayerRef, ResourceMap, ResourceRef,
} from '../engine/schema';
import { EFFECTS, EVENTS, conditionSpec, effectSpec, exprSpec } from './catalog';

export type NameKind = 'resources' | 'terrains' | 'pieces' | 'cards' | 'decks' | 'tokens' | 'settings' | 'awards' | 'actions';

export interface DescribeContext {
  /** Display names by collection then id. Missing names fall back to a prettified id. */
  names?: Partial<Record<NameKind, Record<string, string>>>;
}

export function contextFromDefinition(def: Partial<GameDefinition> | undefined): DescribeContext {
  const names: Partial<Record<NameKind, Record<string, string>>> = {};
  const kinds: NameKind[] = ['resources', 'terrains', 'pieces', 'cards', 'decks', 'tokens', 'settings', 'awards', 'actions'];
  for (const k of kinds) {
    const list = (def?.[k] ?? []) as { id: string; name?: string }[];
    names[k] = Object.fromEntries(list.map(x => [x.id, x.name || prettify(x.id)]));
  }
  return { names };
}

/** "victoryPoint" / "victory_point" / "victory-point" → "Victory point" */
export function prettify(id: string): string {
  if (!id) return '?';
  const s = id.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nm(ctx: DescribeContext, kind: NameKind, id: string | undefined): string {
  if (!id) return `(no ${kind.slice(0, -1)})`;
  return ctx.names?.[kind]?.[id] ?? prettify(id);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function capFirst(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function plural(n: Expr, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function list(items: string[], joiner = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

function oneOrMany(ctx: DescribeContext, kind: NameKind, v: string | string[] | undefined, joiner = 'or'): string {
  if (v === undefined) return '';
  const arr = Array.isArray(v) ? v : [v];
  return list(arr.map(id => nm(ctx, kind, id)), joiner);
}

/* ------------------------------------------------------------------------ */
/*  Players & resources                                                      */
/* ------------------------------------------------------------------------ */

export function describePlayer(p: PlayerRef | 'any' | 'others' | undefined, ctx: DescribeContext = {}): string {
  void ctx;
  if (p === undefined || p === 'self') return 'you';
  if (p === 'current') return 'the current player';
  if (p === 'bank') return 'the bank';
  if (p === 'any') return 'anyone';
  if (p === 'others') return 'another player';
  if (typeof p === 'object' && 'var' in p) return `player “${p.var}”`;
  if (typeof p === 'object' && 'ownerOf' in p) return `the owner of “${p.ownerOf}”`;
  return '?';
}

function possessive(p: PlayerRef | undefined, ctx: DescribeContext): string {
  if (p === undefined || p === 'self') return 'your';
  return `${describePlayer(p, ctx)}’s`;
}

/** Imperative when the actor is "you", third person otherwise. */
function act(p: PlayerRef | undefined, ctx: DescribeContext, base: string, third: string): string {
  if (p === undefined || p === 'self') return base;
  return `${describePlayer(p, ctx)} ${third}`;
}

export function describeResourceRef(r: ResourceRef | 'random' | 'choice' | 'any' | undefined, ctx: DescribeContext = {}): string {
  if (r === undefined || r === 'any') return 'resource';
  if (r === 'random') return 'random resource';
  if (r === 'choice') return 'resource of their choice';
  if (typeof r === 'object') return `“${r.var}” resource`;
  return nm(ctx, 'resources', r);
}

export function describeResourceMap(m: ResourceMap | undefined, ctx: DescribeContext = {}): string {
  const entries = Object.entries(m ?? {});
  if (entries.length === 0) return 'nothing';
  return list(entries.map(([id, amt]) => `${describeExpr(amt, ctx)} ${nm(ctx, 'resources', id)}`));
}

export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}

export function describePieceQuery(q: PieceQuery | undefined, ctx: DescribeContext = {}, many = false): string {
  const qq = q ?? {};
  const ids = qq.piece === undefined ? [] : Array.isArray(qq.piece) ? qq.piece : [qq.piece];
  const names = ids.map(id => nm(ctx, 'pieces', id));
  const what = names.length ? list(many ? names.map(pluralize) : names, 'or') : many ? 'pieces' : 'piece';
  let s = what;
  if (qq.tag) s += ` tagged “${qq.tag}”`;
  if (qq.owner !== undefined && qq.owner !== 'any') {
    s += qq.owner === 'others' ? ' owned by other players' : ` owned by ${describePlayer(qq.owner, ctx)}`;
  }
  if (qq.near) s += ` near “${qq.near}”`;
  if (qq.onTerrain?.length) s += ` on ${oneOrMany(ctx, 'terrains', qq.onTerrain)}`;
  if (qq.state && Object.keys(qq.state).length) s += ` with ${list(Object.entries(qq.state).map(([k, v]) => `“${k}” = ${v}`))}`;
  if (qq.region) s += ` on the same island as “${qq.region}”`;
  if (qq.where !== undefined && qq.where !== true) s += ` where ${describeCondition(qq.where, ctx)}`;
  return s;
}

function describeLocation(l: LocationChoice | undefined, ctx: DescribeContext, fallback = ''): string {
  if (!l) return fallback;
  const parts: string[] = [];
  if (l.at) parts.push(`at “${l.at}”`);
  if (l.where !== undefined && l.where !== true) parts.push(`where ${describeCondition(l.where, ctx)}`);
  return parts.length ? ' ' + parts.join(' ') : fallback;
}

/* ------------------------------------------------------------------------ */
/*  Exprs                                                                    */
/* ------------------------------------------------------------------------ */

export function describeExpr(e: Expr | null | undefined, ctx: DescribeContext = {}): string {
  if (e === null) return 'none';
  if (e === undefined) return '?';
  if (typeof e === 'number') return String(e);
  const spec = exprSpec(e);
  if (!spec) return '(unknown formula)';
  const x = e as Record<string, unknown>;
  const sub = (v: unknown) => wrap(v as Expr, ctx);
  switch (spec.key) {
    case 'var': return `“${x.var}”`;
    case 'param': return `setting “${nm(ctx, 'settings', x.param as string)}”`;
    case 'add': return (x.add as Expr[]).map(sub).join(' + ') || '0';
    case 'sub': { const [a, b] = x.sub as Expr[]; return `${sub(a)} − ${sub(b)}`; }
    case 'mul': return (x.mul as Expr[]).map(sub).join(' × ') || '1';
    case 'div': { const [a, b] = x.div as Expr[]; return `${sub(a)} ÷ ${sub(b)} (rounded down)`; }
    case 'min': return `the smaller of ${list((x.min as Expr[]).map(v => describeExpr(v, ctx)))}`;
    case 'max': return `the larger of ${list((x.max as Expr[]).map(v => describeExpr(v, ctx)))}`;
    case 'if': {
      const [c, a, b] = x.if as [Condition, Expr, Expr];
      return `${describeExpr(a, ctx)} if ${describeCondition(c, ctx)}, otherwise ${describeExpr(b, ctx)}`;
    }
    case 'random': { const [a, b] = x.random as Expr[]; return `a random number from ${describeExpr(a, ctx)} to ${describeExpr(b, ctx)}`; }
    case 'resourceCount': {
      const o = (x.resourceCount ?? {}) as { player?: PlayerRef; resource?: ResourceRef | 'any'; kind?: string };
      const what = o.resource && o.resource !== 'any' ? describeResourceRef(o.resource, ctx) : o.kind ? o.kind : 'resource';
      return `the number of ${what} cards ${o.player === undefined || o.player === 'self' ? 'you hold' : `${describePlayer(o.player, ctx)} holds`}`;
    }
    case 'pieceCount': return `the number of ${describePieceQuery(x.pieceCount as PieceQuery, ctx, true)} on the board`;
    case 'cardCount': {
      const o = (x.cardCount ?? {}) as { player?: PlayerRef; card?: string; deck?: string; played?: boolean };
      let what = o.card ? nm(ctx, 'cards', o.card) : 'card';
      if (o.deck) what += ` from ${nm(ctx, 'decks', o.deck)}`;
      const who = o.player === undefined || o.player === 'self' ? 'you' : describePlayer(o.player, ctx);
      const verb = o.played ? (who === 'you' ? 'have played' : 'has played') : (who === 'you' ? 'hold' : 'holds');
      return `the number of ${what}s ${who} ${verb}`;
    }
    case 'stat': {
      const o = (x.stat ?? {}) as { player?: PlayerRef; key: string };
      return `${possessive(o.player, ctx)} “${o.key}” stat`;
    }
    case 'global': return `the “${x.global}” counter`;
    case 'vp': return `${possessive(x.vp as PlayerRef, ctx)} victory point total`;
    case 'dice': return x.dice === 'total' ? 'the dice total' : `die #${Number(x.dice) + 1}`;
    case 'playerCount': return 'the number of players';
    case 'longestRoad': return `${possessive(x.longestRoad as PlayerRef, ctx)} longest road length`;
    case 'pieceState': {
      const o = (x.pieceState ?? {}) as { piece: string; key: string };
      return `the “${o.key}” of “${o.piece}”`;
    }
    case 'sumPieceState': {
      const o = (x.sumPieceState ?? {}) as { query: PieceQuery; key: string };
      return `the total “${o.key}” of ${describePieceQuery(o.query, ctx, true)}`;
    }
    case 'cargoCount': {
      const o = (x.cargoCount ?? {}) as { piece: string; key?: string };
      return o.key ? `the ${prettify(o.key)} carried by “${o.piece}”` : `the cargo carried by “${o.piece}”`;
    }
    case 'hexNumber': return `the number on “${x.hexNumber}”`;
    case 'countPlayers': {
      const o = (x.countPlayers ?? {}) as { as: string; filter?: Condition };
      return o.filter === undefined || o.filter === true
        ? 'the number of players'
        : `the number of players “${o.as}” where ${describeCondition(o.filter, ctx)}`;
    }
  }
  return spec.label;
}

/** Wrap compound sub-expressions in parentheses inside arithmetic. */
function wrap(e: Expr, ctx: DescribeContext): string {
  const s = describeExpr(e, ctx);
  const spec = typeof e === 'object' && e ? exprSpec(e) : undefined;
  return spec && ['add', 'sub', 'mul', 'div', 'if'].includes(spec.key) ? `(${s})` : s;
}

/* ------------------------------------------------------------------------ */
/*  Conditions                                                               */
/* ------------------------------------------------------------------------ */

const CMP_WORDS: Record<string, string> = {
  '==': 'is', '!=': 'is not', '<': 'is less than', '<=': 'is at most', '>': 'is more than', '>=': 'is at least',
};

export function describeCondition(c: Condition | undefined, ctx: DescribeContext = {}): string {
  if (c === undefined) return 'always';
  if (c === true) return 'always';
  if (c === false) return 'never';
  const spec = conditionSpec(c);
  if (!spec) return '(unknown check)';
  const x = c as Record<string, unknown>;
  const loc = (o: { at: string }) => `“${o.at}”`;
  switch (spec.key) {
    case 'all': {
      const items = (x.all as Condition[]).map(i => describeCondition(i, ctx));
      return items.length ? list(items, 'and') : 'always';
    }
    case 'any': {
      const items = (x.any as Condition[]).map(i => describeCondition(i, ctx));
      return items.length ? list(items, 'or') : 'never';
    }
    case 'not': return `not (${describeCondition(x.not as Condition, ctx)})`;
    case 'cmp': {
      const [a, op, b] = x.cmp as [Expr, string, Expr];
      return `${describeExpr(a, ctx)} ${CMP_WORDS[op] ?? op} ${describeExpr(b, ctx)}`;
    }
    case 'canAfford': {
      const o = x.canAfford as { cost: ResourceMap; player?: PlayerRef };
      return `${o.player === undefined || o.player === 'self' ? 'you can' : `${describePlayer(o.player, ctx)} can`} afford ${describeResourceMap(o.cost, ctx)}`;
    }
    case 'isTurnOf': return x.isTurnOf === 'self' ? 'it is your turn' : `it is ${possessive(x.isTurnOf as PlayerRef, ctx)} turn`;
    case 'phase': {
      const ph = Array.isArray(x.phase) ? x.phase as string[] : [x.phase as string];
      return `it is the ${list(ph.map(prettify).map(s => s.toLowerCase()), 'or')} phase`;
    }
    case 'hasRolled': return x.hasRolled ? 'the dice have been rolled' : 'the dice have not been rolled yet';
    case 'flag': return `${possessive(x.player as PlayerRef | undefined, ctx)} “${x.flag}” flag is on`;
    case 'setting': return `the “${nm(ctx, 'settings', x.setting as string)}” setting is on`;
    case 'samePlayer': {
      const [a, b] = x.samePlayer as [PlayerRef, PlayerRef];
      return `${describePlayer(a, ctx)} ${a === 'self' || a === undefined ? 'are' : 'is'} ${describePlayer(b, ctx)}`;
    }
    case 'varSet': return `“${x.varSet}” has been chosen`;
    case 'varIs': {
      const o = (x.varIs ?? {}) as { var: string; value: string };
      return `“${o.var}” is “${o.value}”`;
    }
    case 'terrainIs': {
      const o = x.terrainIs as { at: string; terrain: string | string[] };
      return `${loc(o)} is ${oneOrMany(ctx, 'terrains', o.terrain)}`;
    }
    case 'isWater': return `${loc(x.isWater as { at: string })} is water`;
    case 'isCoastal': return `${loc(x.isCoastal as { at: string })} is on the coast`;
    case 'occupied': {
      const o = x.occupied as { at: string; piece?: string | string[]; owner?: PlayerRef | 'any' | 'others' };
      return `${loc(o)} has ${article(describePieceQuery({ piece: o.piece, owner: o.owner }, ctx))} on it`;
    }
    case 'adjacentTo': {
      const o = x.adjacentTo as { at: string; piece?: string | string[]; owner?: PlayerRef | 'any' | 'others'; tag?: string };
      const what = describePieceQuery({ piece: o.piece, owner: o.owner, tag: o.tag }, ctx);
      return `${loc(o)} is next to ${article(what)}`;
    }
    case 'connectedTo': {
      const o = x.connectedTo as { at: string; owner: PlayerRef; via?: string[] };
      const via = o.via?.length ? ` via ${oneOrMany(ctx, 'pieces', o.via)}` : '';
      return `${loc(o)} connects to ${possessive(o.owner, ctx)} network${via}`;
    }
    case 'distanceRule': {
      const o = x.distanceRule as { at: string; minDistance?: number };
      const d = o.minDistance ?? 2;
      return `no corner piece is closer than ${d} ${d === 1 ? 'edge' : 'edges'} to ${loc(o)}`;
    }
    case 'hasToken': {
      const o = x.hasToken as { at: string; token: string; near?: boolean };
      return `the ${nm(ctx, 'tokens', o.token)} is ${o.near ? 'on or next to' : 'on'} ${loc(o)}`;
    }
    case 'isNetworkEnd': {
      const o = x.isNetworkEnd as { at: string; owner?: PlayerRef; via?: string[] };
      const via = o.via?.length ? ` of ${oneOrMany(ctx, 'pieces', o.via)}` : '';
      return `${loc(o)} is an open end of ${o.owner ? possessive(o.owner, ctx) : 'its owner’s'} route${via}`;
    }
    case 'sameRegion': {
      const [a, b] = x.sameRegion as [string, string];
      return `“${a}” is on the same island as “${b}”`;
    }
    case 'atPort': {
      const o = x.atPort as { at: string; port?: string };
      return `${loc(o)} is at ${o.port ? `a “${o.port}” harbor` : 'a harbor'}`;
    }
    case 'hexNumberIn': {
      const o = x.hexNumberIn as { at: string; numbers: number[] };
      return `${loc(o)} has number ${list((o.numbers ?? []).map(String), 'or')}`;
    }
  }
  return spec.label;
}

/* ------------------------------------------------------------------------ */
/*  Effects                                                                  */
/* ------------------------------------------------------------------------ */

function steps(list: Effect[] | undefined, ctx: DescribeContext): string {
  if (!list || list.length === 0) return 'do nothing';
  return list.map(e => describeEffect(e, ctx)).join(', then ');
}

const untilText = (u: string | undefined) =>
  u === 'endOfTurn' ? ' until the end of the turn' : u === 'endOfRound' ? ' until the end of the round' : '';

function prompted(label: string | undefined): string {
  return label ? ` (“${label}”)` : '';
}

export function describeEffect(e: Effect, ctx: DescribeContext = {}): string {
  const spec = effectSpec(e);
  if (!spec) return `(unknown block “${(e as { op?: string })?.op ?? '?'}”)`;
  switch (e.op) {
    case 'sequence': return steps(e.do, ctx);
    case 'repeat': {
      const t = typeof e.times === 'number' ? `${e.times} ${e.times === 1 ? 'time' : 'times'}` : `${describeExpr(e.times, ctx)} times`;
      return `repeat ${t}: ${steps(e.do, ctx)}`;
    }
    case 'if': {
      const els = e.else && e.else.length ? `; otherwise ${steps(e.else, ctx)}` : '';
      return `if ${describeCondition(e.cond, ctx)}: ${steps(e.then, ctx)}${els}`;
    }
    case 'forEachPlayer': {
      const f = e.filter !== undefined && e.filter !== true ? ` where ${describeCondition(e.filter, ctx)}` : '';
      const simul = e.order === 'simultaneous' ? ' (all at once)' : '';
      return `for each player “${e.as}”${f}${simul}: ${steps(e.do, ctx)}`;
    }
    case 'forEachLocation': {
      const f = e.filter !== undefined && e.filter !== true ? ` where ${describeCondition(e.filter, ctx)}` : '';
      const kind = e.kind === 'vertex' ? 'corner' : e.kind;
      return `for each ${kind} “${e.as}”${f}: ${steps(e.do, ctx)}`;
    }
    case 'forEachPiece': return `for each ${describePieceQuery(e.query, ctx)} (“${e.as}”): ${steps(e.do, ctx)}`;
    case 'chooseOption': {
      const opts = (e.options ?? []).map(o => `“${o.label}” → ${steps(o.do, ctx)}`);
      return `${act(e.player, ctx, 'choose', 'chooses')} one${prompted(e.label)}: ${opts.join(' | ') || 'no options'}`;
    }
    case 'setVar': return `let “${e.name}” = ${describeExpr(e.value, ctx)}`;
    case 'emit': {
      const ev = (EVENTS as Record<string, { label: string }>)[e.event];
      return `fire the “${ev?.label ?? e.event}” event`;
    }
    case 'log': return `log “${e.text}”`;
    case 'abortIf': return `cancel the action if ${describeCondition(e.cond, ctx)}${e.message ? ` (“${e.message}”)` : ''}`;
    case 'choosePlayer': {
      const f = e.filter !== undefined && e.filter !== true ? ` where ${describeCondition(e.filter, ctx)}` : '';
      return `${act(e.player, ctx, 'choose', 'chooses')} a player${f} as “${e.as}”${e.optional ? ' (may skip)' : ''}`;
    }
    case 'chooseResource': {
      const opts = e.options?.length ? ` from ${oneOrMany(ctx, 'resources', e.options)}` : e.kind ? ` (${e.kind})` : '';
      return `${act(e.player, ctx, 'name', 'names')} a resource${opts} as “${e.as}”`;
    }
    case 'chooseLocation': {
      const f = e.filter !== undefined && e.filter !== true ? ` where ${describeCondition(e.filter, ctx)}` : '';
      const kind = e.kind === 'vertex' ? 'corner' : e.kind;
      return `${act(e.player, ctx, 'choose', 'chooses')} ${article(kind ?? 'location')}${f} as “${e.as}”${e.optional ? ' (may skip)' : ''}`;
    }
    case 'choosePiece': {
      const f = e.filter !== undefined && e.filter !== true ? ` where ${describeCondition(e.filter, ctx)}` : '';
      return `${act(e.player, ctx, 'choose', 'chooses')} ${article(describePieceQuery(e.query, ctx))}${f} as “${e.as}”${e.optional ? ' (may skip)' : ''}`;
    }
    case 'chooseMany': {
      const what = e.of === 'location' ? (e.kind === 'vertex' ? 'corners' : e.kind ? `${e.kind}s` : 'hexes')
        : e.of === 'piece' ? describePieceQuery(e.query, ctx, true) : `${e.of}s`;
      const f = e.filter !== undefined && e.filter !== true ? ` where ${describeCondition(e.filter, ctx)}` : '';
      const atLeast = e.min !== undefined ? ` (at least ${describeExpr(e.min, ctx)})` : '';
      return `${act(e.player, ctx, 'choose', 'chooses')} up to ${describeExpr(e.count, ctx)} different ${what}${f}${atLeast}; for each “${e.as}”: ${steps(e.do, ctx)}`;
    }
    case 'gain': return `${act(e.player, ctx, 'gain', 'gains')} ${describeResourceMap(e.resources, ctx)}`;
    case 'pay': return `${act(e.player, ctx, 'pay', 'pays')} ${describeResourceMap(e.resources, ctx)}`;
    case 'transfer': {
      const amt = describeExpr(e.amount, ctx);
      return `move ${amt} ${describeResourceRef(e.resource, ctx)} ${plural(e.amount, 'card')} from ${describePlayer(e.from, ctx)} to ${describePlayer(e.to, ctx)}`;
    }
    case 'steal': {
      const amt = e.amount === undefined ? 1 : e.amount;
      return `${act(e.to, ctx, 'steal', 'steals')} ${describeExpr(amt, ctx)} random ${plural(amt, 'card')} from ${describePlayer(e.from, ctx)}`;
    }
    case 'discard': return `${act(e.player, ctx, 'discard', 'discards')} ${describeExpr(e.amount, ctx)} ${e.kind ? `${e.kind} ` : ''}${plural(e.amount, 'card')} of their choice`;
    case 'chooseAndGain': {
      const from = e.options?.length ? ` (from ${oneOrMany(ctx, 'resources', e.options)})` : '';
      return `${act(e.player, ctx, 'take', 'takes')} ${describeExpr(e.amount, ctx)} ${e.kind ?? 'resource'}${typeof e.amount === 'number' && e.amount === 1 ? '' : 's'} of choice from the bank${from}`;
    }
    case 'produce': {
      if (e.hex) return `produce resources from hex “${e.hex}”${e.player ? ` for ${describePlayer(e.player, ctx)}` : ''}`;
      return `produce resources for ${e.roll === undefined ? 'the roll' : `number ${describeExpr(e.roll, ctx)}`}${e.player ? ` (only ${describePlayer(e.player, ctx)})` : ''}`;
    }
    case 'grantTradeRate': {
      const r = e.resource === 'any' ? 'any resource' : describeResourceRef(e.resource, ctx);
      return `${act(e.player, ctx, 'trade', 'trades')} ${r} at ${e.ratio}:1${untilText(e.until)}`;
    }
    case 'place': {
      let s = `${act(e.player, ctx, 'place', 'places')} ${article(nm(ctx, 'pieces', e.piece))}`;
      s += describeLocation(e.location, ctx);
      if (e.free) s += ' for free';
      if (e.ignoreConnection) s += ' (need not connect)';
      return s;
    }
    case 'upgrade': {
      let s = `${act(e.player, ctx, 'upgrade', 'upgrades')} ${article(oneOrMany(ctx, 'pieces', e.from))} to ${article(nm(ctx, 'pieces', e.to))}`;
      s += describeLocation(e.location, ctx);
      if (e.free) s += ' for free';
      return s;
    }
    case 'remove': return `remove ${article(describePieceQuery(e.query, ctx))}${describeLocation(e.location, ctx)}${e.returnToSupply ? ' (back to its supply)' : ''}`;
    case 'movePiece': {
      const from = e.from ? ` from${describeLocation(e.from, ctx, ' anywhere')}` : '';
      const to = e.to ? ` to${describeLocation(e.to, ctx, ' a new spot')}` : '';
      let s = `${act(e.player, ctx, 'move', 'moves')} ${article(describePieceQuery(e.query, ctx))}${from}${to}`;
      if (e.maxSteps !== undefined) s += ` up to ${describeExpr(e.maxSteps, ctx)} steps`;
      if (e.path !== undefined && e.path !== true) s += ` (each step where ${describeCondition(e.path, ctx)})`;
      if (e.anywhere) s += ', ignoring placement rules';
      return s;
    }
    case 'downgrade': {
      let s = `${act(e.player, ctx, 'reduce', 'reduces')} ${article(oneOrMany(ctx, 'pieces', e.from))} to ${article(nm(ctx, 'pieces', e.to))}`;
      s += describeLocation(e.location, ctx);
      return s;
    }
    case 'setPieceState': return `set “${e.key}” of “${e.at}” to ${describeExpr(e.value, ctx)}`;
    case 'loadCargo': {
      const amt = e.amount === undefined ? 1 : e.amount;
      return `${act(e.player, ctx, 'load', 'loads')} ${describeExpr(amt, ctx)} ${describeResourceRef(e.resource, ctx)} onto “${e.piece}”`;
    }
    case 'unloadCargo': {
      const what = e.resource === undefined || e.resource === 'all' ? 'all resource cargo' : describeResourceRef(e.resource, ctx);
      const amt = e.amount === undefined ? '' : `${describeExpr(e.amount, ctx)} `;
      return `unload ${amt}${what} from “${e.piece}” to ${describePlayer(e.to, ctx)}`;
    }
    case 'addCargo': return `add ${describeExpr(e.amount, ctx)} ${prettify(e.key)} to the cargo of “${e.piece}”`;
    case 'moveToken': return `move the ${nm(ctx, 'tokens', e.token)}${e.to ? describeLocation(e.to, ctx, '') : ''}`;
    case 'removeToken': return `take the ${nm(ctx, 'tokens', e.token)} off the board`;
    case 'setTerrain': return `turn “${e.at}” into ${nm(ctx, 'terrains', e.terrain)}`;
    case 'setHexNumber': return e.number === null ? `clear the number on “${e.at}”` : `set the number on “${e.at}” to ${describeExpr(e.number, ctx)}`;
    case 'revealHex': return `reveal hex “${e.at}”`;
    case 'drawCard': {
      const n = e.count === undefined ? 1 : e.count;
      return `${act(e.player, ctx, 'draw', 'draws')} ${describeExpr(n, ctx)} ${plural(n, 'card')} from ${nm(ctx, 'decks', e.deck)}`;
    }
    case 'giveCard': return `${act(e.player, ctx, 'receive', 'receives')} ${article(nm(ctx, 'cards', e.card))} card`;
    case 'discardCard': {
      const what = e.card ? article(nm(ctx, 'cards', e.card)) + ' card' : 'a card';
      return `${act(e.player, ctx, 'discard', 'discards')} ${what}${e.choose ? ' of their choice' : ''}`;
    }
    case 'shuffleDeck': return `shuffle ${nm(ctx, 'decks', e.deck)}`;
    case 'addVP': {
      const amt = describeExpr(e.amount, ctx);
      return `${act(e.player, ctx, 'gain', 'gains')} ${amt} victory ${e.amount === 1 ? 'point' : 'points'}${e.reason ? ` (${e.reason})` : ''}`;
    }
    case 'addStat': return `add ${describeExpr(e.amount, ctx)} to ${possessive(e.player, ctx)} “${e.key}” stat`;
    case 'setStat': return `set ${possessive(e.player, ctx)} “${e.key}” stat to ${describeExpr(e.value, ctx)}`;
    case 'addGlobal': return `add ${describeExpr(e.amount, ctx)} to the “${e.key}” counter`;
    case 'setGlobal': return `set the “${e.key}” counter to ${describeExpr(e.value, ctx)}`;
    case 'setFlag': return `turn ${e.value ? 'on' : 'off'} ${possessive(e.player, ctx)} “${e.flag}” flag${untilText(e.until)}`;
    case 'rollDice': return 'roll the dice';
    case 'extraBuildPhase': return 'start a special building phase';
    case 'endTurn': return 'end the turn';
    case 'win': return e.player === undefined || e.player === 'self' ? 'you win the game' : `${describePlayer(e.player, ctx)} wins the game`;
  }
  return EFFECTS[(e as Effect).op]?.label ?? '?';
}

/** One capitalised sentence per top-level effect. */
export function describeEffects(list: Effect[] | undefined, ctx: DescribeContext = {}): string[] {
  return (list ?? []).map(e => capFirst(describeEffect(e, ctx)));
}

/** Whole list as one short sentence (for list-item subtitles). */
export function summarizeEffects(list: Effect[] | undefined, ctx: DescribeContext = {}): string {
  if (!list || list.length === 0) return 'Does nothing yet';
  return capFirst(list.map(e => describeEffect(e, ctx)).join(', then '));
}
