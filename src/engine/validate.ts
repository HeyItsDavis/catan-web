/**
 * Static validation of mod content. Produces human-readable problems with JSON paths
 * (e.g. `cards[3].effect[0].do[1].piece`) for the mod editor.
 *
 * Errors: unknown ids, unknown ops / condition / expr shapes, duplicate ids, broken maps.
 * Warnings: variables that are never bound before use, unknown settings, suspicious values.
 */
import { EVENT_PAYLOAD_VARS } from './schema';
import type {
  Condition, Effect, Expr, GameDefinition, ModDef, PieceQuery, PlayerRef, ResourceMap, ResourceRef, TriggerDef,
} from './schema';
import { isKnownSetting } from './context';
import { mergeMods, sortMods, COLLECTIONS, ModValidationError } from './merge';

export interface Problem { path: string; message: string; severity: 'error' | 'warning' }

const EFFECT_OPS = new Set([
  'sequence', 'repeat', 'if', 'forEachPlayer', 'forEachPiece', 'forEachLocation', 'chooseOption', 'setVar', 'emit', 'log', 'abortIf',
  'choosePlayer', 'chooseResource', 'chooseLocation', 'choosePiece', 'chooseMany',
  'gain', 'pay', 'transfer', 'steal', 'discard', 'chooseAndGain', 'produce',
  'place', 'upgrade', 'downgrade', 'remove', 'movePiece', 'setPieceState', 'moveToken', 'setTerrain', 'setHexNumber', 'revealHex',
  'loadCargo', 'unloadCargo', 'addCargo',
  'drawCard', 'giveCard', 'discardCard', 'shuffleDeck',
  'addVP', 'addStat', 'setStat', 'addGlobal', 'setGlobal', 'setFlag', 'grantTradeRate',
  'rollDice', 'extraBuildPhase', 'endTurn', 'win',
]);

const COND_KEYS = [
  'all', 'any', 'not', 'cmp', 'canAfford', 'isTurnOf', 'phase', 'hasRolled', 'flag', 'setting', 'samePlayer', 'varSet', 'varIs',
  'terrainIs', 'isWater', 'isCoastal', 'occupied', 'adjacentTo', 'connectedTo', 'distanceRule', 'hasToken', 'hexNumberIn',
  'isAdjacent', 'isNetworkEnd', 'sameRegion',
];
const EXPR_KEYS = [
  'var', 'param', 'add', 'sub', 'mul', 'div', 'min', 'max', 'if', 'random', 'resourceCount', 'pieceCount', 'cardCount',
  'stat', 'global', 'vp', 'dice', 'playerCount', 'longestRoad', 'pieceState', 'sumPieceState', 'cargoCount', 'countPlayers',
];
const PHASES = ['setup', 'preRoll', 'main', 'specialBuild', 'gameOver'];
const KINDS = ['hex', 'vertex', 'edge'];
const TIMINGS = ['ownTurn', 'ownTurnBeforeRoll', 'ownTurnAfterRoll', 'anyTime', 'never', 'immediate'];

/** Variables available in each builtin event's trigger (besides `event`). */
export const EVENT_PAYLOAD: Record<string, string[]> = EVENT_PAYLOAD_VARS;

type Scope = { vars: Set<string>; lenient: boolean };

class Validator {
  problems: Problem[] = [];
  ids: Record<string, Set<string>>;
  def: GameDefinition;
  constructor(def: GameDefinition) {
    this.def = def;
    this.ids = {};
    for (const k of COLLECTIONS) this.ids[k] = new Set((def[k] as { id: string }[]).map((x) => x.id));
  }
  err(path: string, message: string) { this.problems.push({ path, message, severity: 'error' }); }
  warn(path: string, message: string) { this.problems.push({ path, message, severity: 'warning' }); }

  ref(path: string, coll: string, id: unknown, what: string) {
    if (typeof id !== 'string' || !this.ids[coll].has(id)) this.err(path, `Unknown ${what} "${String(id)}"`);
  }
  varUse(path: string, name: unknown, sc: Scope) {
    if (typeof name !== 'string') { this.err(path, 'Variable name must be a string'); return; }
    if (!sc.lenient && !sc.vars.has(name)) this.warn(path, `Variable "${name}" is not bound here`);
  }
  player(path: string, r: PlayerRef | 'any' | 'others' | undefined, sc: Scope) {
    if (r === undefined || r === 'self' || r === 'current' || r === 'bank' || r === 'any' || r === 'others') return;
    if (r && typeof r === 'object') {
      if ('var' in r) return this.varUse(`${path}.var`, r.var, sc);
      if ('ownerOf' in r) return this.varUse(`${path}.ownerOf`, r.ownerOf, sc);
    }
    this.err(path, `Invalid player reference ${JSON.stringify(r)}`);
  }
  resRef(path: string, r: ResourceRef | 'any' | 'random' | 'choice' | undefined, sc: Scope, allow: string[] = []) {
    if (r === undefined) return;
    if (typeof r === 'string') { if (!allow.includes(r)) this.ref(path, 'resources', r, 'resource'); return; }
    if (r && typeof r === 'object' && 'var' in r) return this.varUse(`${path}.var`, r.var, sc);
    this.err(path, 'Invalid resource reference');
  }
  resMap(path: string, m: ResourceMap | undefined, sc: Scope) {
    if (m === undefined) return;
    if (!m || typeof m !== 'object') { this.err(path, 'Expected a resource map'); return; }
    for (const [r, x] of Object.entries(m)) {
      this.ref(`${path}.${r}`, 'resources', r, 'resource');
      this.expr(`${path}.${r}`, x, sc);
    }
  }
  query(path: string, q: PieceQuery | undefined, sc: Scope) {
    if (!q || typeof q !== 'object') { this.err(path, 'Expected a piece query'); return; }
    this.player(`${path}.owner`, q.owner, sc);
    if (q.piece !== undefined) (Array.isArray(q.piece) ? q.piece : [q.piece]).forEach((p, i) => this.ref(`${path}.piece${Array.isArray(q.piece) ? `[${i}]` : ''}`, 'pieces', p, 'piece'));
    if (q.near !== undefined) this.varUse(`${path}.near`, q.near, sc);
    q.onTerrain?.forEach((t, i) => this.ref(`${path}.onTerrain[${i}]`, 'terrains', t, 'terrain'));
    if (q.region !== undefined) this.varUse(`${path}.region`, q.region, sc);
    if (q.state !== undefined && (typeof q.state !== 'object' || Object.values(q.state).some((v) => typeof v !== 'number'))) {
      this.err(`${path}.state`, 'state must map keys to numbers');
    }
    if (q.where !== undefined) this.cond(`${path}.where`, q.where, { vars: new Set([...sc.vars, 'candidate', 'candidateId']), lenient: sc.lenient });
  }
  setting(path: string, id: unknown) {
    if (typeof id !== 'string' || !isKnownSetting(this.def, id)) this.warn(path, `Unknown setting "${String(id)}"`);
  }

  expr(path: string, e: Expr, sc: Scope) {
    if (typeof e === 'number') return;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { this.err(path, `Invalid expression ${JSON.stringify(e)}`); return; }
    const k = Object.keys(e)[0];
    if (!EXPR_KEYS.includes(k)) { this.err(path, `Unknown expression "${k}"`); return; }
    const x = e as Record<string, unknown>;
    const list = (key: string) => {
      const arr = x[key];
      if (!Array.isArray(arr)) { this.err(`${path}.${key}`, 'Expected a list'); return; }
      arr.forEach((y, i) => this.expr(`${path}.${key}[${i}]`, y as Expr, sc));
    };
    switch (k) {
      case 'var': this.varUse(`${path}.var`, x.var, sc); break;
      case 'param': this.setting(`${path}.param`, x.param); break;
      case 'add': case 'mul': case 'min': case 'max': case 'sub': case 'div': case 'random': list(k); break;
      case 'if': {
        const a = x.if as [Condition, Expr, Expr];
        if (!Array.isArray(a) || a.length !== 3) { this.err(`${path}.if`, 'Expected [condition, then, else]'); break; }
        this.cond(`${path}.if[0]`, a[0], sc); this.expr(`${path}.if[1]`, a[1], sc); this.expr(`${path}.if[2]`, a[2], sc);
        break;
      }
      case 'resourceCount': {
        const q = x.resourceCount as { player?: PlayerRef; resource?: ResourceRef | 'any' };
        this.player(`${path}.resourceCount.player`, q?.player, sc);
        this.resRef(`${path}.resourceCount.resource`, q?.resource, sc, ['any']);
        break;
      }
      case 'pieceCount': this.query(`${path}.pieceCount`, x.pieceCount as PieceQuery, sc); break;
      case 'cardCount': {
        const q = x.cardCount as { player?: PlayerRef; card?: string; deck?: string };
        this.player(`${path}.cardCount.player`, q?.player, sc);
        if (q?.card !== undefined) this.ref(`${path}.cardCount.card`, 'cards', q.card, 'card');
        if (q?.deck !== undefined) this.ref(`${path}.cardCount.deck`, 'decks', q.deck, 'deck');
        break;
      }
      case 'stat': this.player(`${path}.stat.player`, (x.stat as { player?: PlayerRef })?.player, sc); break;
      case 'vp': this.player(`${path}.vp`, x.vp as PlayerRef, sc); break;
      case 'longestRoad': this.player(`${path}.longestRoad`, x.longestRoad as PlayerRef, sc); break;
      case 'pieceState': this.varUse(`${path}.pieceState.piece`, (x.pieceState as { piece?: string })?.piece, sc); break;
      case 'cargoCount': this.varUse(`${path}.cargoCount.piece`, (x.cargoCount as { piece?: string })?.piece, sc); break;
      case 'countPlayers': {
        const q = x.countPlayers as { as: string; filter?: Condition };
        if (!q?.as) { this.err(`${path}.countPlayers.as`, 'countPlayers needs "as"'); break; }
        this.cond(`${path}.countPlayers.filter`, q.filter, { vars: new Set([...sc.vars, q.as]), lenient: sc.lenient });
        break;
      }
      case 'sumPieceState': this.query(`${path}.sumPieceState.query`, (x.sumPieceState as { query: PieceQuery })?.query, sc); break;
    }
  }

  cond(path: string, c: Condition | undefined, sc: Scope) {
    if (c === undefined || c === true || c === false) return;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { this.err(path, `Invalid condition ${JSON.stringify(c)}`); return; }
    const k = Object.keys(c).find((key) => COND_KEYS.includes(key));
    if (!k) { this.err(path, `Unknown condition "${Object.keys(c)[0]}"`); return; }
    const x = c as Record<string, unknown>;
    const at = (o: { at?: unknown } | undefined, p: string) => this.varUse(`${p}.at`, o?.at, sc);
    switch (k) {
      case 'all': case 'any':
        if (!Array.isArray(x[k])) this.err(`${path}.${k}`, 'Expected a list');
        else (x[k] as Condition[]).forEach((y, i) => this.cond(`${path}.${k}[${i}]`, y, sc));
        break;
      case 'not': this.cond(`${path}.not`, x.not as Condition, sc); break;
      case 'cmp': {
        const a = x.cmp as [Expr, string, Expr];
        if (!Array.isArray(a) || a.length !== 3) { this.err(`${path}.cmp`, 'Expected [expr, op, expr]'); break; }
        if (!['==', '!=', '<', '<=', '>', '>='].includes(a[1])) this.err(`${path}.cmp[1]`, `Bad comparison operator "${a[1]}"`);
        this.expr(`${path}.cmp[0]`, a[0], sc); this.expr(`${path}.cmp[2]`, a[2], sc);
        break;
      }
      case 'canAfford': {
        const q = x.canAfford as { cost: ResourceMap; player?: PlayerRef };
        this.resMap(`${path}.canAfford.cost`, q?.cost, sc); this.player(`${path}.canAfford.player`, q?.player, sc);
        break;
      }
      case 'isTurnOf': this.player(`${path}.isTurnOf`, x.isTurnOf as PlayerRef, sc); break;
      case 'phase': {
        const ps = Array.isArray(x.phase) ? x.phase : [x.phase];
        ps.forEach((p) => { if (!PHASES.includes(p as string)) this.err(`${path}.phase`, `Unknown phase "${String(p)}"`); });
        break;
      }
      case 'flag': this.player(`${path}.player`, x.player as PlayerRef, sc); break;
      case 'setting': this.setting(`${path}.setting`, x.setting); break;
      case 'samePlayer': (x.samePlayer as PlayerRef[]).forEach((r, i) => this.player(`${path}.samePlayer[${i}]`, r, sc)); break;
      case 'varSet': break;
      case 'varIs': this.varUse(`${path}.varIs.var`, (x.varIs as { var?: string })?.var, sc); break;
      case 'isAdjacent': case 'sameRegion':
        if (!Array.isArray(x[k]) || (x[k] as string[]).length !== 2) { this.err(`${path}.${k}`, 'Expected [location, location]'); break; }
        (x[k] as string[]).forEach((v, i) => this.varUse(`${path}.${k}[${i}]`, v, sc)); break;
      case 'isNetworkEnd': {
        const q = x.isNetworkEnd as { at: string; owner?: PlayerRef; via?: string[] };
        at(q, `${path}.isNetworkEnd`);
        this.player(`${path}.isNetworkEnd.owner`, q?.owner, sc);
        q?.via?.forEach((p, i) => this.ref(`${path}.isNetworkEnd.via[${i}]`, 'pieces', p, 'piece'));
        break;
      }
      case 'terrainIs': {
        const q = x.terrainIs as { at: string; terrain: string | string[] };
        at(q, `${path}.terrainIs`);
        (Array.isArray(q?.terrain) ? q.terrain : [q?.terrain]).forEach((t) => this.ref(`${path}.terrainIs.terrain`, 'terrains', t, 'terrain'));
        break;
      }
      case 'isWater': case 'isCoastal': case 'distanceRule': case 'hexNumberIn': at(x[k] as { at: string }, `${path}.${k}`); break;
      case 'occupied': case 'adjacentTo': {
        const q = x[k] as { at: string; piece?: string | string[]; owner?: PlayerRef | 'any' | 'others' };
        at(q, `${path}.${k}`);
        this.player(`${path}.${k}.owner`, q?.owner, sc);
        if (q?.piece !== undefined) (Array.isArray(q.piece) ? q.piece : [q.piece]).forEach((p) => this.ref(`${path}.${k}.piece`, 'pieces', p, 'piece'));
        break;
      }
      case 'connectedTo': {
        const q = x.connectedTo as { at: string; owner: PlayerRef; via?: string[] };
        at(q, `${path}.connectedTo`);
        this.player(`${path}.connectedTo.owner`, q?.owner, sc);
        q?.via?.forEach((p, i) => this.ref(`${path}.connectedTo.via[${i}]`, 'pieces', p, 'piece'));
        break;
      }
      case 'hasToken': {
        const q = x.hasToken as { at: string; token: string };
        at(q, `${path}.hasToken`);
        this.ref(`${path}.hasToken.token`, 'tokens', q?.token, 'token');
        break;
      }
    }
  }

  loc(path: string, l: { at?: string; where?: Condition } | undefined, sc: Scope) {
    if (!l) return;
    if (l.at !== undefined) this.varUse(`${path}.at`, l.at, sc);
    if (l.where !== undefined) this.cond(`${path}.where`, l.where, { vars: new Set([...sc.vars, 'at']), lenient: sc.lenient });
  }

  effects(path: string, fx: Effect[] | undefined, sc: Scope) {
    if (fx === undefined) return;
    if (!Array.isArray(fx)) { this.err(path, 'Expected a list of effects'); return; }
    fx.forEach((e, i) => this.effect(`${path}[${i}]`, e, sc));
  }

  effect(path: string, e: Effect, sc: Scope) {
    if (!e || typeof e !== 'object' || typeof (e as { op?: unknown }).op !== 'string') { this.err(path, 'Effect must have an "op"'); return; }
    if (!EFFECT_OPS.has(e.op)) { this.err(`${path}.op`, `Unknown op "${e.op}"`); return; }
    const bindVar = (name: string | undefined) => { if (name) sc.vars.add(name); };
    const withVar = (name: string) => ({ vars: new Set([...sc.vars, name]), lenient: sc.lenient });
    switch (e.op) {
      case 'sequence': this.effects(`${path}.do`, e.do, sc); break;
      case 'repeat': this.expr(`${path}.times`, e.times, sc); bindVar(e.as); this.effects(`${path}.do`, e.do, sc); break;
      case 'if': this.cond(`${path}.cond`, e.cond, sc); this.effects(`${path}.then`, e.then, sc); this.effects(`${path}.else`, e.else, sc); break;
      case 'forEachPlayer':
        if (!e.as) this.err(`${path}.as`, 'forEachPlayer needs "as"');
        this.cond(`${path}.filter`, e.filter, withVar(e.as)); bindVar(e.as); this.effects(`${path}.do`, e.do, sc);
        if (e.order !== undefined && e.order !== 'turn' && e.order !== 'simultaneous') this.err(`${path}.order`, 'order must be "turn" or "simultaneous"');
        break;
      case 'forEachPiece': this.query(`${path}.query`, e.query, sc); bindVar(e.as); bindVar(e.asId); this.effects(`${path}.do`, e.do, sc); break;
      case 'forEachLocation':
        if (!e.as) this.err(`${path}.as`, 'forEachLocation needs "as"');
        if (!KINDS.includes(e.kind)) this.err(`${path}.kind`, `kind must be one of ${KINDS.join(', ')}`);
        this.cond(`${path}.filter`, e.filter, withVar(e.as)); bindVar(e.as); this.effects(`${path}.do`, e.do, sc);
        break;
      case 'chooseMany': {
        if (!['player', 'location', 'piece', 'resource'].includes(e.of)) this.err(`${path}.of`, 'of must be player, location, piece or resource');
        if (!e.as) this.err(`${path}.as`, 'chooseMany needs "as"');
        this.player(`${path}.player`, e.player, sc);
        this.expr(`${path}.count`, e.count, sc);
        if (e.min !== undefined) this.expr(`${path}.min`, e.min, sc);
        if (e.kind !== undefined && !KINDS.includes(e.kind)) this.err(`${path}.kind`, `kind must be one of ${KINDS.join(', ')}`);
        if (e.query !== undefined) this.query(`${path}.query`, e.query, sc);
        e.options?.forEach((r, i) => this.ref(`${path}.options[${i}]`, 'resources', r, 'resource'));
        this.cond(`${path}.filter`, e.filter, withVar(e.as));
        bindVar(e.as); bindVar(e.countAs);
        this.effects(`${path}.do`, e.do, sc);
        break;
      }
      case 'chooseOption':
        this.player(`${path}.player`, e.player, sc);
        if (!Array.isArray(e.options) || !e.options.length) this.err(`${path}.options`, 'chooseOption needs options');
        else e.options.forEach((o, i) => { this.cond(`${path}.options[${i}].cond`, o.cond, sc); this.effects(`${path}.options[${i}].do`, o.do, sc); });
        break;
      case 'setVar': this.expr(`${path}.value`, e.value, sc); bindVar(e.name); break;
      case 'emit': for (const [k, x] of Object.entries(e.payload ?? {})) this.expr(`${path}.payload.${k}`, x, sc); break;
      case 'log': break;
      case 'abortIf': this.cond(`${path}.cond`, e.cond, sc); break;
      case 'choosePlayer':
        this.player(`${path}.player`, e.player, sc); this.cond(`${path}.filter`, e.filter, withVar(e.as)); bindVar(e.as); break;
      case 'chooseResource':
        this.player(`${path}.player`, e.player, sc);
        e.options?.forEach((r, i) => this.ref(`${path}.options[${i}]`, 'resources', r, 'resource'));
        bindVar(e.as); break;
      case 'chooseLocation':
        this.player(`${path}.player`, e.player, sc);
        if (!KINDS.includes(e.kind)) this.err(`${path}.kind`, `kind must be one of ${KINDS.join(', ')}`);
        this.cond(`${path}.filter`, e.filter, withVar(e.as)); bindVar(e.as); break;
      case 'choosePiece':
        this.player(`${path}.player`, e.player, sc); this.query(`${path}.query`, e.query, sc);
        this.cond(`${path}.filter`, e.filter, withVar(e.as)); bindVar(e.as); bindVar(e.asId); break;
      case 'gain': case 'pay': this.player(`${path}.player`, e.player, sc); this.resMap(`${path}.resources`, e.resources, sc); break;
      case 'transfer':
        this.player(`${path}.from`, e.from, sc); this.player(`${path}.to`, e.to, sc);
        this.resRef(`${path}.resource`, e.resource, sc, ['random', 'choice']); this.expr(`${path}.amount`, e.amount, sc); break;
      case 'steal':
        this.player(`${path}.from`, e.from, sc); this.player(`${path}.to`, e.to, sc);
        if (e.amount !== undefined) this.expr(`${path}.amount`, e.amount, sc); break;
      case 'discard': this.player(`${path}.player`, e.player, sc); this.expr(`${path}.amount`, e.amount, sc); break;
      case 'chooseAndGain':
        this.player(`${path}.player`, e.player, sc); this.expr(`${path}.amount`, e.amount, sc);
        e.options?.forEach((r, i) => this.ref(`${path}.options[${i}]`, 'resources', r, 'resource')); break;
      case 'produce':
        if (e.roll !== undefined) this.expr(`${path}.roll`, e.roll, sc);
        if (e.hex !== undefined) this.varUse(`${path}.hex`, e.hex, sc);
        this.player(`${path}.player`, e.player, sc); break;
      case 'place':
        this.ref(`${path}.piece`, 'pieces', e.piece, 'piece'); this.player(`${path}.player`, e.player, sc);
        this.loc(`${path}.location`, e.location, sc); bindVar(e.as); bindVar(e.asId); break;
      case 'upgrade':
        (Array.isArray(e.from) ? e.from : [e.from]).forEach((p) => this.ref(`${path}.from`, 'pieces', p, 'piece'));
        this.ref(`${path}.to`, 'pieces', e.to, 'piece'); this.player(`${path}.player`, e.player, sc);
        this.loc(`${path}.location`, e.location, sc); bindVar(e.as); bindVar(e.asId); break;
      case 'remove': this.query(`${path}.query`, e.query, sc); this.loc(`${path}.location`, e.location, sc); bindVar(e.as); break;
      case 'movePiece':
        this.query(`${path}.query`, e.query, sc); this.loc(`${path}.from`, e.from, sc); this.loc(`${path}.to`, e.to, sc);
        this.player(`${path}.player`, e.player, sc);
        if (e.maxSteps !== undefined) this.expr(`${path}.maxSteps`, e.maxSteps, sc);
        if (e.path !== undefined) this.cond(`${path}.path`, e.path, { vars: new Set([...sc.vars, 'at', 'prev', 'via']), lenient: sc.lenient });
        bindVar(e.as); bindVar(e.asId); bindVar(e.stepsAs); break;
      case 'downgrade':
        (Array.isArray(e.from) ? e.from : [e.from]).forEach((p) => this.ref(`${path}.from`, 'pieces', p, 'piece'));
        this.ref(`${path}.to`, 'pieces', e.to, 'piece'); this.player(`${path}.player`, e.player, sc);
        this.loc(`${path}.location`, e.location, sc); bindVar(e.as); bindVar(e.asId); break;
      case 'loadCargo':
        this.varUse(`${path}.piece`, e.piece, sc); this.player(`${path}.player`, e.player, sc);
        this.resRef(`${path}.resource`, e.resource, sc, ['choice']);
        if (e.amount !== undefined) this.expr(`${path}.amount`, e.amount, sc); break;
      case 'unloadCargo':
        this.varUse(`${path}.piece`, e.piece, sc); this.player(`${path}.to`, e.to, sc);
        this.resRef(`${path}.resource`, e.resource, sc, ['all']);
        if (e.amount !== undefined) this.expr(`${path}.amount`, e.amount, sc); break;
      case 'addCargo':
        this.varUse(`${path}.piece`, e.piece, sc); this.expr(`${path}.amount`, e.amount, sc);
        if (typeof e.key !== 'string' || !e.key) this.err(`${path}.key`, 'addCargo needs a goods key'); break;
      case 'setPieceState': this.varUse(`${path}.at`, e.at, sc); this.expr(`${path}.value`, e.value, sc); break;
      case 'moveToken': this.ref(`${path}.token`, 'tokens', e.token, 'token'); this.loc(`${path}.to`, e.to, sc); bindVar(e.as); break;
      case 'setTerrain': this.varUse(`${path}.at`, e.at, sc); this.ref(`${path}.terrain`, 'terrains', e.terrain, 'terrain'); break;
      case 'setHexNumber': this.varUse(`${path}.at`, e.at, sc); if (e.number !== null) this.expr(`${path}.number`, e.number, sc); break;
      case 'revealHex': this.varUse(`${path}.at`, e.at, sc); break;
      case 'drawCard':
        this.ref(`${path}.deck`, 'decks', e.deck, 'deck'); this.player(`${path}.player`, e.player, sc);
        if (e.count !== undefined) this.expr(`${path}.count`, e.count, sc); break;
      case 'giveCard': this.ref(`${path}.card`, 'cards', e.card, 'card'); this.player(`${path}.player`, e.player, sc); break;
      case 'discardCard':
        if (e.card !== undefined) this.ref(`${path}.card`, 'cards', e.card, 'card'); this.player(`${path}.player`, e.player, sc); break;
      case 'shuffleDeck': this.ref(`${path}.deck`, 'decks', e.deck, 'deck'); break;
      case 'addVP': case 'addStat': this.player(`${path}.player`, e.player, sc); this.expr(`${path}.amount`, e.amount, sc); break;
      case 'setStat': this.player(`${path}.player`, e.player, sc); this.expr(`${path}.value`, e.value, sc); break;
      case 'addGlobal': this.expr(`${path}.amount`, e.amount, sc); break;
      case 'setGlobal': this.expr(`${path}.value`, e.value, sc); break;
      case 'setFlag': this.player(`${path}.player`, e.player, sc); break;
      case 'grantTradeRate':
        this.player(`${path}.player`, e.player, sc); this.resRef(`${path}.resource`, e.resource, sc, ['any']);
        if (!(e.ratio >= 1)) this.err(`${path}.ratio`, 'ratio must be >= 1'); break;
      case 'win': this.player(`${path}.player`, e.player, sc); break;
    }
  }

  trigger(path: string, t: TriggerDef, extra: string[] = []) {
    if (!t.id) this.err(`${path}.id`, 'Trigger needs an id');
    if (typeof t.on !== 'string' || !t.on) this.err(`${path}.on`, 'Trigger needs an event');
    const builtin = EVENT_PAYLOAD[t.on];
    const sc: Scope = { vars: new Set(['event', ...(builtin ?? []), ...extra]), lenient: !builtin || t.on === 'diceRolled' };
    if (t.as !== undefined && !['current', 'eventPlayer', 'eachPlayer'].includes(t.as)) this.err(`${path}.as`, 'as must be current, eventPlayer or eachPlayer');
    this.cond(`${path}.when`, t.when, sc);
    this.effects(`${path}.do`, t.do, sc);
  }

  /** Check every collection present in `c` (a mod or a merged definition). */
  content(c: Partial<ModDef> | GameDefinition) {
    const sc = (...vars: string[]): Scope => ({ vars: new Set(vars), lenient: false });
    for (const key of COLLECTIONS) {
      const list = (c as Record<string, unknown>)[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) { this.err(key, 'Expected a list'); continue; }
      const seen = new Set<string>();
      list.forEach((x: { id?: unknown }, i) => {
        if (typeof x?.id !== 'string' || !x.id) this.err(`${key}[${i}].id`, 'Missing id');
        else if (seen.has(x.id)) this.err(`${key}[${i}].id`, `Duplicate id "${x.id}"`);
        else seen.add(x.id);
      });
    }
    c.resources?.forEach((r, i) => {
      if (typeof r.bankSupply !== 'number') this.err(`resources[${i}].bankSupply`, 'bankSupply must be a number (-1 = unlimited)');
    });
    c.terrains?.forEach((t, i) => {
      this.resMap(`terrains[${i}].produces`, t.produces, sc('at'));
      t.producesChoice?.options?.forEach((r, j) => this.ref(`terrains[${i}].producesChoice.options[${j}]`, 'resources', r, 'resource'));
    });
    c.pieces?.forEach((p, i) => {
      const path = `pieces[${i}]`;
      if (!p.placement || !KINDS.includes(p.placement.on)) this.err(`${path}.placement.on`, `placement.on must be one of ${KINDS.join(', ')}`);
      this.cond(`${path}.placement.where`, p.placement?.where, sc('at'));
      this.cond(`${path}.placement.setupWhere`, p.placement?.setupWhere, sc('at', 'lastPlaced'));
      this.resMap(`${path}.cost`, p.cost, sc());
      p.upgradesFrom?.forEach((u, j) => this.ref(`${path}.upgradesFrom[${j}]`, 'pieces', u, 'piece'));
      p.productionBonus?.forEach((b, j) => {
        this.ref(`${path}.productionBonus[${j}].terrain`, 'terrains', b.terrain, 'terrain');
        this.resMap(`${path}.productionBonus[${j}].gives`, b.gives, sc('at'));
      });
      p.pieceActions?.forEach((a, j) => this.ref(`${path}.pieceActions[${j}]`, 'actions', a, 'action'));
      p.triggers?.forEach((t, j) => this.trigger(`${path}.triggers[${j}]`, t, ['this', 'thisId']));
      if (typeof p.supply !== 'number') this.err(`${path}.supply`, 'supply must be a number (-1 = unlimited)');
    });
    c.cards?.forEach((cd, i) => {
      const path = `cards[${i}]`;
      if (!cd.play || !TIMINGS.includes(cd.play.timing)) this.err(`${path}.play.timing`, `timing must be one of ${TIMINGS.join(', ')}`);
      this.cond(`${path}.play.cond`, cd.play?.cond, sc('card'));
      this.effects(`${path}.effect`, cd.effect, sc('card'));
      if (cd.afterPlay !== undefined && !['discard', 'returnToDeck', 'keepFaceUp'].includes(cd.afterPlay)) this.err(`${path}.afterPlay`, 'Invalid afterPlay');
    });
    c.decks?.forEach((d, i) => {
      d.cards?.forEach((x, j) => {
        this.ref(`decks[${i}].cards[${j}].card`, 'cards', x.card, 'card');
        if (!(x.count >= 0)) this.err(`decks[${i}].cards[${j}].count`, 'count must be >= 0');
      });
      this.resMap(`decks[${i}].cost`, d.cost, sc());
    });
    c.actions?.forEach((a, i) => {
      const s2 = sc('piece', 'pieceId');
      this.cond(`actions[${i}].available`, a.available, s2);
      this.resMap(`actions[${i}].cost`, a.cost, s2);
      this.effects(`actions[${i}].effect`, a.effect, s2);
    });
    c.tokens?.forEach((t, i) => {
      if (!KINDS.includes(t.on)) this.err(`tokens[${i}].on`, `on must be one of ${KINDS.join(', ')}`);
      this.cond(`tokens[${i}].where`, t.where, sc('at'));
      this.effects(`tokens[${i}].onMove`, t.onMove, sc('at', 'token'));
      if (t.startTerrain !== undefined) this.ref(`tokens[${i}].startTerrain`, 'terrains', t.startTerrain, 'terrain');
    });
    c.awards?.forEach((a, i) => this.expr(`awards[${i}].metric`, a.metric, sc()));
    c.ports?.forEach((p, i) => {
      if (p.resource !== 'any') this.ref(`ports[${i}].resource`, 'resources', p.resource, 'resource');
      if (!(p.ratio >= 1)) this.err(`ports[${i}].ratio`, 'ratio must be >= 1');
    });
    c.triggers?.forEach((t, i) => this.trigger(`triggers[${i}]`, t));
    c.settings?.forEach((st, i) => {
      if (!['number', 'boolean', 'select'].includes(st.type)) this.err(`settings[${i}].type`, 'type must be number, boolean or select');
    });
    c.maps?.forEach((m, i) => this.map(`maps[${i}]`, m));
    c.setup?.forEach((r, i) => {
      if (r.order !== 'forward' && r.order !== 'reverse') this.err(`setup[${i}].order`, 'order must be forward or reverse');
      r.place?.forEach((p, j) => this.ref(`setup[${i}].place[${j}].piece`, 'pieces', p.piece, 'piece'));
    });
    if (c.dice) {
      if (!Array.isArray(c.dice.numeric)) this.err('dice.numeric', 'Expected a list of dice');
      else c.dice.numeric.forEach((d, i) => { if (!(d.sides >= 1)) this.err(`dice.numeric[${i}].sides`, 'sides must be >= 1'); });
    }
  }

  map(path: string, m: NonNullable<ModDef['maps']>[number]) {
    const bags = m.terrainBags ?? {};
    for (const [b, list] of Object.entries(bags)) list.forEach((t, j) => this.ref(`${path}.terrainBags.${b}[${j}]`, 'terrains', t, 'terrain'));
    const bagNeed: Record<string, number> = {};
    let numbersNeeded = 0;
    let portsNeeded = 0;
    const coords = new Set<string>();
    (m.hexes ?? []).forEach((h, j) => {
      const hp = `${path}.hexes[${j}]`;
      const key = `${h.q},${h.r}`;
      if (coords.has(key)) this.err(hp, `Duplicate hex at ${key}`);
      coords.add(key);
      if (typeof h.terrain === 'string' && h.terrain.startsWith('@')) {
        const b = h.terrain.slice(1);
        if (!bags[b]) this.err(`${hp}.terrain`, `Unknown terrain bag "${b}"`);
        bagNeed[b] = (bagNeed[b] ?? 0) + 1;
      } else this.ref(`${hp}.terrain`, 'terrains', h.terrain, 'terrain');
      if (h.number === '@') numbersNeeded++;
      else if (h.number !== undefined && typeof h.number !== 'number') this.err(`${hp}.number`, 'number must be a number or "@"');
      if (h.port) {
        if (h.port.port === '@') portsNeeded++;
        else this.ref(`${hp}.port.port`, 'ports', h.port.port, 'port');
        if (!(h.port.side >= 0 && h.port.side <= 5)) this.err(`${hp}.port.side`, 'side must be 0..5');
      }
    });
    for (const [b, n] of Object.entries(bagNeed)) {
      if (bags[b] && bags[b].length < n) this.err(`${path}.terrainBags.${b}`, `Bag has ${bags[b].length} terrains but ${n} hexes draw from it`);
    }
    if (numbersNeeded > (m.numberBag?.length ?? 0)) this.err(`${path}.numberBag`, `Needs at least ${numbersNeeded} numbers`);
    m.portBag?.forEach((p, j) => this.ref(`${path}.portBag[${j}]`, 'ports', p, 'port'));
    if (portsNeeded > (m.portBag?.length ?? 0)) this.err(`${path}.portBag`, `Needs at least ${portsNeeded} ports`);
    if (m.minPlayers > m.maxPlayers) this.warn(`${path}.minPlayers`, 'minPlayers is greater than maxPlayers');
    // numbered terrains drawn from bags also consume numbers
    if (m.numberBag) {
      let auto = 0;
      const terr = new Map(this.def.terrains.map((t) => [t.id, t]));
      for (const h of m.hexes ?? []) {
        if (h.number !== undefined) continue;
        if (h.terrain.startsWith('@')) continue;
        if (terr.get(h.terrain)?.numbered) auto++;
      }
      for (const [b, n] of Object.entries(bagNeed)) {
        const list = bags[b] ?? [];
        const numbered = list.filter((t) => terr.get(t)?.numbered).length;
        auto += Math.min(n, numbered);
      }
      if (auto + numbersNeeded > m.numberBag.length) this.warn(`${path}.numberBag`, `Number bag may be too small (${m.numberBag.length} for up to ${auto + numbersNeeded} hexes)`);
    }
  }
}

/** Validate a fully merged definition. */
export function validateDefinition(def: GameDefinition): Problem[] {
  const v = new Validator(def);
  v.content(def);
  return v.problems;
}

/** Validate one mod in the context of the mods it extends (taken from `available`). */
export function validateMod(mod: ModDef, available: ModDef[]): Problem[] {
  const problems: Problem[] = [];
  if (!mod?.meta?.id) problems.push({ path: 'meta.id', message: 'Mod needs an id', severity: 'error' });
  if (!mod?.meta?.name) problems.push({ path: 'meta.name', message: 'Mod needs a name', severity: 'warning' });
  if (!mod?.meta) return problems;
  const byId = new Map(available.map((m) => [m.meta.id, m]));
  const chain: ModDef[] = [];
  const add = (id: string, path: string) => {
    const m = byId.get(id);
    if (!m) { problems.push({ path, message: `Extends unknown mod "${id}"`, severity: 'error' }); return; }
    if (chain.includes(m)) return;
    (m.meta.extends ?? []).forEach((d) => add(d, path));
    chain.push(m);
  };
  (mod.meta.extends ?? []).forEach((id, i) => add(id, `meta.extends[${i}]`));
  let def: GameDefinition;
  try {
    // Unknown extends were reported above; merge with the ones that exist.
    const self: ModDef = { ...mod, meta: { ...mod.meta, extends: (mod.meta.extends ?? []).filter((id) => byId.has(id)) } };
    def = mergeMods(sortMods([...chain.filter((m) => m.meta.id !== mod.meta.id), self]));
  } catch (e) {
    if (e instanceof ModValidationError) return [...problems, ...e.problems];
    throw e;
  }
  const v = new Validator(def);
  v.content(mod);
  for (const [key, ids] of Object.entries(mod.remove ?? {})) {
    if (!(COLLECTIONS as string[]).includes(key)) { v.err(`remove.${key}`, `Unknown collection "${key}"`); continue; }
    const before = mergeMods(sortMods(chain.filter((m) => m.meta.id !== mod.meta.id)));
    const existing = new Set((before[key as keyof GameDefinition] as { id: string }[]).map((x) => x.id));
    (ids ?? []).forEach((id, i) => { if (!existing.has(id)) v.warn(`remove.${key}[${i}]`, `Nothing named "${id}" to remove`); });
  }
  // Content that references removed ids elsewhere in the merged definition is a real error.
  const whole = validateDefinition(def).filter((p) => p.severity === 'error' && !v.problems.some((q) => q.message === p.message));
  for (const p of whole) v.problems.push({ ...p, path: `(merged) ${p.path}` });
  return [...problems, ...v.problems];
}
