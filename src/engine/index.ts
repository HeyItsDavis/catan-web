/**
 * Public engine API. The engine is pure: no DOM, no network, no React.
 * Network host and UI import ONLY from this file (plus schema & topology).
 */
import type {
  ActionDef, CardDef, Command, CommandResult, GameDefinition, GameState, Id, LobbySettings, ModDef, PieceDef,
} from './schema';
import { buildDefinition as buildDef, ModValidationError } from './merge';
import { validateMod as validate, type Problem } from './validate';
import { createGame as create, applyCommand as apply } from './commands';
import { redactState } from './redaction';
import { availableMoves } from './moves';
import { makeCtx } from './context';
import { computeVPInternal } from './vp';

export * from './schema';
export * as topology from './board/topology';
export { ModValidationError };
export type { Problem as ValidationProblem };

/** Merge mods (base first) into a full definition. Throws ModValidationError on bad content. */
export function buildDefinition(mods: ModDef[]): GameDefinition {
  return buildDef(mods);
}

/** Validate a single mod in the context of what it extends. Returns human-readable problems. */
export function validateMod(mod: ModDef, available: ModDef[]): { path: string; message: string; severity: 'error' | 'warning' }[] {
  return validate(mod, available);
}

export interface NewPlayer { id: string; name: string; color: string }

/**
 * Create a game: generate map from settings.mapId, deal decks, enter setup phase.
 * `now` (ms, optional) is recorded as GameState.turnStartedAt.
 */
export function createGame(def: GameDefinition, settings: LobbySettings, players: NewPlayer[], seed: number, now?: number): GameState {
  return create(def, settings, players, seed, now);
}

/**
 * Apply one command from one player. Never mutates input.
 * `now` (ms, optional) is recorded as GameState.turnStartedAt whenever a turn begins.
 */
export function applyCommand(def: GameDefinition, state: GameState, playerId: string, cmd: Command, now?: number): CommandResult {
  return apply(def, state, playerId, cmd, now);
}

/** Copy of state safe to send to `playerId` (others' hands & deck order hidden). null = spectator. */
export function redactFor(def: GameDefinition, state: GameState, playerId: string | null): GameState {
  return redactState(def, state, playerId);
}

/** What the UI should offer this player right now. */
export interface AvailableMoves {
  canRoll: boolean;
  canEndTurn: boolean;
  /** Pieces buildable now (affordable, supply left, at least one legal spot). */
  builds: { piece: PieceDef; affordable: boolean; hasSpot: boolean }[];
  buyableDecks: { deck: Id; affordable: boolean }[];
  playableCards: { cardInstance: string; card: CardDef }[];
  actions: { action: ActionDef; enabled: boolean; pieceId?: string }[];
  /** Effective bank rate per resource after ports & modifiers. */
  bankRates: Record<Id, number>;
  /** Prompt this player must answer now, if any. */
  prompt: GameState['prompts'][number] | null;
}
export function getAvailableMoves(def: GameDefinition, state: GameState, playerId: string): AvailableMoves {
  return availableMoves(makeCtx(def, state, true), playerId);
}

/** Visible VP (and total incl. hidden when includeHidden). */
export function computeVP(def: GameDefinition, state: GameState, playerId: string, includeHidden: boolean): number {
  return computeVPInternal(makeCtx(def, state, true), playerId, includeHidden);
}
