/**
 * Public engine API. The engine is pure: no DOM, no network, no React.
 * Network host and UI import ONLY from this file (plus schema & topology).
 *
 * Implementation is owned by the engine workstream; until it lands these
 * signatures are the contract.
 */
import type {
  ActionDef, CardDef, Command, CommandResult, GameDefinition, GameState, Id, LobbySettings, ModDef, PieceDef,
} from './schema';

export * from './schema';
export * as topology from './board/topology';

/** Merge mods (base first) into a full definition. Throws ModValidationError on bad content. */
export declare function buildDefinition(mods: ModDef[]): GameDefinition;

/** Validate a single mod in the context of what it extends. Returns human-readable problems. */
export declare function validateMod(mod: ModDef, available: ModDef[]): { path: string; message: string; severity: 'error' | 'warning' }[];

export interface NewPlayer { id: string; name: string; color: string }

/** Create a game: generate map from settings.mapId, deal decks, enter setup phase. */
export declare function createGame(def: GameDefinition, settings: LobbySettings, players: NewPlayer[], seed: number): GameState;

/** Apply one command from one player. Never mutates input. */
export declare function applyCommand(def: GameDefinition, state: GameState, playerId: string, cmd: Command): CommandResult;

/** Copy of state safe to send to `playerId` (others' hands & deck order hidden). null = spectator. */
export declare function redactFor(def: GameDefinition, state: GameState, playerId: string | null): GameState;

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
export declare function getAvailableMoves(def: GameDefinition, state: GameState, playerId: string): AvailableMoves;

/** Visible VP (and total incl. hidden when includeHidden). */
export declare function computeVP(def: GameDefinition, state: GameState, playerId: string, includeHidden: boolean): number;
