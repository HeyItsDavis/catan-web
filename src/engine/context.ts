/**
 * Execution context shared by all engine modules: the definition, the working
 * (already cloned) state, lookups, events queued by the current op, caches.
 */
import type {
  ActionDef, AwardDef, CardDef, DeckDef, GameDefinition, GameState, Id, LocationId, PieceDef, PieceInstance,
  PlayerState, PortDef, ResourceDef, SettingDef, TerrainDef, TokenDef,
} from './schema';
import type { RngHolder } from './rng';

/** Values a variable can hold: numbers, ids (player / location / resource / piece) or null. */
export type Val = number | string | boolean | null;

/** Lexical environment for evaluating effects/conditions/exprs. */
export interface Env { self: string; vars: Record<string, Val> }

export interface PendingEvent { name: string; payload: Record<string, Val>; player?: string }

export interface Lookup {
  resources: Map<Id, ResourceDef>;
  terrains: Map<Id, TerrainDef>;
  pieces: Map<Id, PieceDef>;
  cards: Map<Id, CardDef>;
  decks: Map<Id, DeckDef>;
  actions: Map<Id, ActionDef>;
  tokens: Map<Id, TokenDef>;
  awards: Map<Id, AwardDef>;
  ports: Map<Id, PortDef>;
  settings: Map<Id, SettingDef>;
  /** Action ids referenced by some PieceDef.pieceActions. */
  pieceActionIds: Set<Id>;
  /** Deck that contains each card (first match). */
  deckOfCard: Map<Id, Id>;
}

const lookupCache = new WeakMap<GameDefinition, Lookup>();

export function lookup(def: GameDefinition): Lookup {
  let l = lookupCache.get(def);
  if (l) return l;
  const m = <T extends { id: Id }>(xs: T[]) => new Map(xs.map((x) => [x.id, x] as [Id, T]));
  const deckOfCard = new Map<Id, Id>();
  for (const d of def.decks) for (const c of d.cards) if (!deckOfCard.has(c.card)) deckOfCard.set(c.card, d.id);
  l = {
    resources: m(def.resources), terrains: m(def.terrains), pieces: m(def.pieces), cards: m(def.cards),
    decks: m(def.decks), actions: m(def.actions), tokens: m(def.tokens), awards: m(def.awards), ports: m(def.ports),
    settings: m(def.settings),
    pieceActionIds: new Set(def.pieces.flatMap((p) => p.pieceActions ?? [])),
    deckOfCard,
  };
  lookupCache.set(def, l);
  return l;
}

export interface Ctx {
  def: GameDefinition;
  L: Lookup;
  /** Working state. May be replaced wholesale on abort (snapshot restore). */
  s: GameState;
  readonly: boolean;
  /** Events emitted by the op currently executing; flushed into trigger frames by the interpreter. */
  events: PendingEvent[];
  /** Set when an abortIf/failed pay cancelled the root action. */
  aborted?: string;
  /** location -> pieces index (lazy, invalidated on piece mutation). */
  idx?: Map<LocationId, PieceInstance[]>;
  tmpRng?: RngHolder;
  /** Wall-clock ms supplied by the host (for turnStartedAt). */
  now?: number;
}

export class CommandError extends Error {}

export function makeCtx(def: GameDefinition, s: GameState, readonly = false): Ctx {
  return { def, L: lookup(def), s, readonly, events: [] };
}

export function rng(ctx: Ctx): RngHolder {
  if (!ctx.readonly) return ctx.s;
  if (!ctx.tmpRng) ctx.tmpRng = { rngState: ctx.s.rngState };
  return ctx.tmpRng;
}

export function nextId(ctx: Ctx, prefix: string): string {
  const n = ctx.s.idCounter ?? 1;
  ctx.s.idCounter = n + 1;
  return `${prefix}${n}`;
}

export function currentPlayerId(s: GameState): string {
  return s.turnOrder[s.currentPlayerIndex];
}

export function getPlayer(ctx: Ctx, id: string): PlayerState {
  const p = ctx.s.players.find((x) => x.id === id);
  if (!p) throw new CommandError(`Unknown player ${id}`);
  return p;
}

export function findPlayer(ctx: Ctx, id: string | null | undefined): PlayerState | undefined {
  if (!id) return undefined;
  return ctx.s.players.find((x) => x.id === id);
}

export function playerName(ctx: Ctx, id: string | null | undefined): string {
  return findPlayer(ctx, id)?.name ?? String(id);
}

/** Players in turn order starting from `startId` (default current player). */
export function playersFrom(ctx: Ctx, startId?: string): string[] {
  const order = ctx.s.turnOrder;
  const start = startId ? Math.max(0, order.indexOf(startId)) : ctx.s.currentPlayerIndex;
  return order.map((_, i) => order[(start + i) % order.length]);
}

/* ------------------------------- pieces -------------------------------- */

export function piecesAt(ctx: Ctx, loc: LocationId): PieceInstance[] {
  if (!ctx.idx) {
    const idx = new Map<LocationId, PieceInstance[]>();
    for (const p of ctx.s.pieces) {
      const arr = idx.get(p.at);
      if (arr) arr.push(p); else idx.set(p.at, [p]);
    }
    ctx.idx = idx;
  }
  return ctx.idx.get(loc) ?? [];
}

export function invalidatePieces(ctx: Ctx): void { ctx.idx = undefined; }

/**
 * "Buildings" are pieces that grant ports and are subject to the distance rule:
 * pieces tagged 'building' or with a productionMultiplier > 0.
 */
export function isBuilding(p: PieceDef | undefined): boolean {
  if (!p) return false;
  return (p.tags ?? []).includes('building') || (p.productionMultiplier ?? 0) > 0;
}

/** Pieces of `type` the player still has in supply (Infinity if unlimited). */
export function supplyLeft(ctx: Ctx, playerId: string, type: Id): number {
  const def = ctx.L.pieces.get(type);
  if (!def || def.supply < 0) return Infinity;
  const onBoard = ctx.s.pieces.filter((p) => p.owner === playerId && p.type === type).length;
  const lost = getPlayer(ctx, playerId).stats[`lost:${type}`] ?? 0;
  return def.supply - onBoard - lost;
}

/* ------------------------------- settings ------------------------------ */

const LOBBY_KEYS = new Set([
  'maxPlayers', 'victoryPoints', 'discardLimit', 'turnTimerSeconds', 'friendlyRobber', 'hideBankCards',
  'randomizeTurnOrder', 'diceMode', 'mapId',
]);

/** Value of a lobby builtin setting, mod setting (lobby override) or SettingDef default. */
export function settingValue(ctx: Ctx, id: string): number | boolean | string | undefined {
  const st = ctx.s.settings;
  if (id === 'victoryPoints') return victoryTarget(ctx);
  if (id === 'discardLimit') return discardLimit(ctx);
  if (LOBBY_KEYS.has(id)) return (st as unknown as Record<string, number | boolean | string>)[id];
  if (st.modSettings && id in st.modSettings) return st.modSettings[id];
  return ctx.L.settings.get(id)?.default;
}

export function isKnownSetting(def: GameDefinition, id: string): boolean {
  return LOBBY_KEYS.has(id) || def.settings.some((s) => s.id === id);
}

export function victoryTarget(ctx: Ctx): number {
  const v = ctx.s.settings?.victoryPoints;
  return typeof v === 'number' && v > 0 ? v : ctx.def.victoryPoints;
}

export function discardLimit(ctx: Ctx): number {
  const v = ctx.s.settings?.discardLimit;
  return typeof v === 'number' && v > 0 ? v : ctx.def.discardLimit;
}

/* --------------------------------- misc -------------------------------- */

export function emit(ctx: Ctx, name: string, payload: Record<string, Val> = {}, player?: string): void {
  if (ctx.readonly) return;
  ctx.events.push({ name, payload, player });
}

export function log(ctx: Ctx, text: string, player?: string): void {
  if (ctx.readonly) return;
  ctx.s.log.push({ turn: ctx.s.turn, player, text });
  if (ctx.s.log.length > 500) ctx.s.log.splice(0, ctx.s.log.length - 500);
}

export function totalResources(p: PlayerState, kind?: string, L?: Lookup): number {
  let n = 0;
  for (const [r, c] of Object.entries(p.resources)) {
    if (kind && L && L.resources.get(r)?.kind !== kind) continue;
    n += c;
  }
  return n;
}
