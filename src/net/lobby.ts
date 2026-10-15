/**
 * Pure lobby logic (no network, no engine calls except through `ctx.resolveDef`).
 * The host feeds every lobby-affecting message through `lobbyReducer`.
 */
import type { GameDefinition, LobbyPlayer, LobbySettings, MapDef, ModDef, SettingDef } from '../engine/schema';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_NAME_LENGTH = 20;
export const TURN_TIMER_OPTIONS = [0, 30, 45, 60, 90, 120, 180, 240] as const;
/** Max serialized size of the room's mod list (they travel to every guest). */
export const MAX_MODS_BYTES = 4_000_000;

/** Eight distinct player colors (enough for the 8-player cap). */
export const PLAYER_COLORS: readonly string[] = [
  '#e53935', // red
  '#1e88e5', // blue
  '#fb8c00', // orange
  '#f5f5f5', // white
  '#43a047', // green
  '#8e24aa', // purple
  '#6d4c41', // brown
  '#00acc1', // teal
];

export interface LobbyState {
  players: LobbyPlayer[];
  settings: LobbySettings;
  /** Full mod definitions, applied in order on top of base. */
  mods: ModDef[];
  hostPlayerId: string;
  started: boolean;
  /** Player ids removed by the host; they may not rejoin this room. */
  kicked: string[];
}

export type LobbyAction =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'connected'; playerId: string; connected: boolean }
  | { type: 'setName'; by: string; name: string }
  | { type: 'setColor'; by: string; color: string }
  | { type: 'setReady'; by: string; ready: boolean }
  | { type: 'settings'; by: string; settings: unknown }
  | { type: 'mods'; by: string; mods: unknown }
  | { type: 'kick'; by: string; playerId: string }
  | { type: 'start'; by: string };

export type LobbyResult = { ok: true; state: LobbyState } | { ok: false; error: string };

export interface LobbyContext {
  /** Definition for the current mod list (null if the engine can't build one). */
  def: GameDefinition | null;
  /** Build a definition for a candidate mod list. Throws on invalid content. */
  resolveDef: (mods: ModDef[]) => GameDefinition;
}

/* ------------------------------------------------------------------------ */

export function createLobby(host: { id: string; name: string }, def: GameDefinition | null): LobbyState {
  return {
    players: [{
      id: host.id, name: sanitizeName(host.name) || 'Host', color: PLAYER_COLORS[0],
      isHost: true, connected: true, ready: true,
    }],
    settings: defaultSettings(def),
    mods: [],
    hostPlayerId: host.id,
    started: false,
    kicked: [],
  };
}

export function defaultSettings(def: GameDefinition | null, maxPlayers = 4): LobbySettings {
  const maps = def ? mapsForPlayerCount(def, maxPlayers) : [];
  return {
    mapId: maps[0]?.id ?? def?.maps[0]?.id ?? 'standard',
    maxPlayers,
    victoryPoints: def?.victoryPoints ?? 10,
    discardLimit: def?.discardLimit ?? 7,
    diceMode: 'random',
    friendlyRobber: false,
    hideBankCards: false,
    turnTimerSeconds: 0,
    randomizeTurnOrder: true,
    mods: [],
    modSettings: def ? defaultModSettings(def.settings) : {},
  };
}

export function defaultModSettings(defs: SettingDef[]): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const s of defs) out[s.id] = s.default;
  return out;
}

/** Maps that support `players` seats. */
export function mapsForPlayerCount(def: GameDefinition, players: number): MapDef[] {
  return def.maps.filter((m) => m.minPlayers <= players && players <= m.maxPlayers);
}

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  // Strip control chars and collapse whitespace.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export function firstFreeColor(players: LobbyPlayer[], except?: string): string {
  const used = new Set(players.filter((p) => p.id !== except).map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
}

export function canStart(state: LobbyState): { ok: true } | { ok: false; reason: string } {
  if (state.started) return { ok: false, reason: 'Game already started' };
  const connected = state.players.filter((p) => p.connected);
  if (state.players.length < MIN_PLAYERS) return { ok: false, reason: `Need at least ${MIN_PLAYERS} players` };
  if (connected.length !== state.players.length) return { ok: false, reason: 'Waiting for disconnected players' };
  if (state.players.some((p) => !p.isHost && !p.ready)) return { ok: false, reason: 'Not everyone is ready' };
  if (state.players.length > state.settings.maxPlayers) return { ok: false, reason: 'Too many players for these settings' };
  return { ok: true };
}

/* ------------------------------------------------------------------------ */

const ok = (state: LobbyState): LobbyResult => ({ ok: true, state });
const err = (error: string): LobbyResult => ({ ok: false, error });

function updatePlayer(state: LobbyState, id: string, patch: Partial<LobbyPlayer>): LobbyState {
  return { ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

function unreadyGuests(players: LobbyPlayer[]): LobbyPlayer[] {
  return players.map((p) => (p.isHost || !p.ready ? p : { ...p, ready: false }));
}

export function lobbyReducer(state: LobbyState, action: LobbyAction, ctx: LobbyContext): LobbyResult {
  const isHost = 'by' in action && action.by === state.hostPlayerId;
  const actor = 'by' in action ? state.players.find((p) => p.id === action.by) : undefined;
  if ('by' in action && !actor) return err('You are not in this room');

  switch (action.type) {
    case 'join': {
      if (state.kicked.includes(action.playerId)) return err('You were removed from this room');
      const existing = state.players.find((p) => p.id === action.playerId);
      const name = sanitizeName(action.name);
      if (existing) {
        return ok(updatePlayer(state, existing.id, { connected: true, ...(name ? { name } : {}) }));
      }
      if (state.started) return err('Game already in progress');
      if (state.players.length >= state.settings.maxPlayers) return err('Room is full');
      const player: LobbyPlayer = {
        id: action.playerId,
        name: name || `Player ${state.players.length + 1}`,
        color: firstFreeColor(state.players),
        isHost: action.playerId === state.hostPlayerId,
        connected: true,
        ready: false,
      };
      return ok({ ...state, players: [...state.players, player] });
    }

    case 'connected': {
      if (!state.players.some((p) => p.id === action.playerId)) return ok(state);
      // A guest who drops out of the lobby loses their ready flag.
      const patch: Partial<LobbyPlayer> = { connected: action.connected };
      if (!action.connected && !state.started && action.playerId !== state.hostPlayerId) patch.ready = false;
      return ok(updatePlayer(state, action.playerId, patch));
    }

    case 'setName': {
      const name = sanitizeName(action.name);
      if (!name) return err('Name cannot be empty');
      return ok(updatePlayer(state, action.by, { name }));
    }

    case 'setColor': {
      if (state.started) return err('Game already started');
      if (!PLAYER_COLORS.includes(action.color)) return err('Unknown color');
      if (state.players.some((p) => p.id !== action.by && p.color === action.color)) return err('Color already taken');
      return ok(updatePlayer(state, action.by, { color: action.color }));
    }

    case 'setReady': {
      if (state.started) return err('Game already started');
      if (actor!.isHost) return ok(state); // host is implicitly ready
      return ok(updatePlayer(state, action.by, { ready: !!action.ready }));
    }

    case 'settings': {
      if (!isHost) return err('Only the host can change settings');
      if (state.started) return err('Game already started');
      const res = sanitizeSettings(action.settings, state, ctx.def);
      if (!res.ok) return res;
      return ok({ ...state, settings: res.settings, players: unreadyGuests(state.players) });
    }

    case 'mods': {
      if (!isHost) return err('Only the host can change mods');
      if (state.started) return err('Game already started');
      const checked = validateModList(action.mods);
      if (!checked.ok) return checked;
      let def: GameDefinition;
      try {
        def = ctx.resolveDef(checked.mods);
      } catch (e) {
        return err(`Mods rejected: ${e instanceof Error ? e.message : String(e)}`);
      }
      const next: LobbyState = { ...state, mods: checked.mods };
      // Values the host never changed follow the rules' defaults (a mod may play to 12 VP).
      const prev = state.settings;
      const followDefault = (cur: number, oldDefault: number | undefined, newDefault: number) =>
        cur === (oldDefault ?? cur) ? newDefault : cur;
      const adopted = {
        victoryPoints: followDefault(prev.victoryPoints, ctx.def?.victoryPoints, def.victoryPoints),
        discardLimit: followDefault(prev.discardLimit, ctx.def?.discardLimit, def.discardLimit),
      };
      // Re-validate settings against the new definition (map may vanish, new mod settings appear).
      const res = sanitizeSettings({ ...prev, ...adopted, mods: checked.mods.map((m) => m.meta.id) }, next, def);
      if (!res.ok) return res;
      return ok({ ...next, settings: res.settings, players: unreadyGuests(state.players) });
    }

    case 'kick': {
      if (!isHost) return err('Only the host can kick players');
      if (action.playerId === state.hostPlayerId) return err('The host cannot be kicked');
      if (!state.players.some((p) => p.id === action.playerId)) return err('No such player');
      if (state.started) {
        // Mid-game the seat must stay (engine state references it); just ban the connection.
        return ok({ ...state, kicked: [...state.kicked, action.playerId] });
      }
      return ok({
        ...state,
        players: state.players.filter((p) => p.id !== action.playerId),
        kicked: [...state.kicked, action.playerId],
      });
    }

    case 'start': {
      if (!isHost) return err('Only the host can start the game');
      const c = canStart(state);
      if (!c.ok) return err(c.reason);
      if (ctx.def) {
        const map = ctx.def.maps.find((m) => m.id === state.settings.mapId);
        if (!map) return err('Pick a map');
        const n = state.players.length;
        if (n < map.minPlayers || n > map.maxPlayers) {
          return err(`${map.name} supports ${map.minPlayers}–${map.maxPlayers} players`);
        }
      }
      return ok({ ...state, started: true });
    }
  }
}

/* ------------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Validate & normalize host-submitted settings. Unknown keys are dropped. */
export function sanitizeSettings(
  input: unknown, state: LobbyState, def: GameDefinition | null,
): { ok: true; settings: LobbySettings } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: 'Invalid settings' };
  const prev = state.settings;
  const maxPlayers = clampInt(input.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, prev.maxPlayers);
  if (maxPlayers < state.players.length) {
    return { ok: false, error: `${state.players.length} players are already in the room` };
  }

  let mapId = typeof input.mapId === 'string' ? input.mapId : prev.mapId;
  if (def) {
    const fitting = mapsForPlayerCount(def, maxPlayers);
    const exists = def.maps.some((m) => m.id === mapId);
    if (!exists || (fitting.length > 0 && !fitting.some((m) => m.id === mapId))) {
      mapId = fitting[0]?.id ?? def.maps[0]?.id ?? mapId;
    }
  }

  const timer = clampInt(input.turnTimerSeconds, 0, 600, prev.turnTimerSeconds);

  const modSettings: Record<string, number | boolean | string> = {};
  const rawMs = isRecord(input.modSettings) ? input.modSettings : {};
  if (def) {
    for (const s of def.settings) modSettings[s.id] = coerceModSetting(s, rawMs[s.id]);
  } else {
    for (const [k, v] of Object.entries(rawMs)) {
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') modSettings[k] = v;
    }
  }

  return {
    ok: true,
    settings: {
      mapId,
      maxPlayers,
      victoryPoints: clampInt(input.victoryPoints, 3, 30, prev.victoryPoints),
      discardLimit: clampInt(input.discardLimit, 2, 40, prev.discardLimit),
      diceMode: input.diceMode === 'balanced' ? 'balanced' : input.diceMode === 'random' ? 'random' : prev.diceMode,
      friendlyRobber: typeof input.friendlyRobber === 'boolean' ? input.friendlyRobber : prev.friendlyRobber,
      hideBankCards: typeof input.hideBankCards === 'boolean' ? input.hideBankCards : prev.hideBankCards,
      turnTimerSeconds: timer,
      randomizeTurnOrder: typeof input.randomizeTurnOrder === 'boolean' ? input.randomizeTurnOrder : prev.randomizeTurnOrder,
      // The mod id list always mirrors the actual mod list; it's not independently editable.
      mods: state.mods.map((m) => m.meta.id),
      modSettings,
    },
  };
}

export function coerceModSetting(s: SettingDef, v: unknown): number | boolean | string {
  switch (s.type) {
    case 'boolean':
      return typeof v === 'boolean' ? v : !!s.default;
    case 'number': {
      const d = typeof s.default === 'number' ? s.default : 0;
      let n = typeof v === 'number' && Number.isFinite(v) ? v : d;
      if (s.min !== undefined) n = Math.max(s.min, n);
      if (s.max !== undefined) n = Math.min(s.max, n);
      return n;
    }
    case 'select': {
      const opts = s.options ?? [];
      if (typeof v === 'string' && opts.some((o) => o.value === v)) return v;
      return typeof s.default === 'string' ? s.default : (opts[0]?.value ?? '');
    }
  }
}

/** Structural check of a mod list (deep content validation is the engine's job). */
export function validateModList(input: unknown): { ok: true; mods: ModDef[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Mods must be a list' };
  const ids = new Set<string>();
  for (const m of input) {
    const e = checkModShape(m);
    if (e) return { ok: false, error: e };
    const id = (m as ModDef).meta.id;
    if (id === 'base') return { ok: false, error: 'The base game is always included' };
    if (ids.has(id)) return { ok: false, error: `Mod "${id}" is listed twice` };
    ids.add(id);
  }
  let size = 0;
  try { size = JSON.stringify(input).length; } catch { return { ok: false, error: 'Mods are not valid JSON' }; }
  if (size > MAX_MODS_BYTES) return { ok: false, error: 'Mods are too large' };
  return { ok: true, mods: input as ModDef[] };
}

/** Returns an error string, or null if `m` looks like a ModDef. */
export function checkModShape(m: unknown): string | null {
  if (!isRecord(m)) return 'A mod must be an object';
  const meta = m.meta;
  if (!isRecord(meta)) return 'A mod needs a "meta" section';
  if (typeof meta.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(meta.id)) return 'Mod meta.id must be 1–64 letters, digits, _ . -';
  if (typeof meta.name !== 'string' || !meta.name) return `Mod "${meta.id}" needs a name`;
  if (typeof meta.version !== 'string') return `Mod "${meta.id}" needs a version`;
  return null;
}
