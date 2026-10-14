/**
 * The authoritative room host. Runs in the room creator's browser.
 *
 * Every participant — including the host's own UI — talks to HostRoom through a
 * `Connection` and the wire protocol. The host UI uses an in-memory loopback
 * connection (`connectLocal()`), so there is exactly one code path.
 */
import * as engine from '../engine';
import { baseMod as defaultBaseMod } from '../content/base';
import type { Command, GameDefinition, GameState, LobbySettings, ModDef } from '../engine/schema';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import { createLobby, lobbyReducer, type LobbyAction, type LobbyState } from './lobby';
import { createMemoryPair } from './memoryTransport';
import type { Connection, Listener, Unsubscribe } from './transport';
import { Emitter } from './transport';
import { cleanChat, parseClientMessage } from './validate';

export interface EngineApi {
  buildDefinition(mods: ModDef[]): GameDefinition;
  createGame(def: GameDefinition, settings: LobbySettings, players: { id: string; name: string; color: string }[], seed: number): GameState;
  applyCommand(def: GameDefinition, state: GameState, playerId: string, cmd: Command): { ok: true; state: GameState } | { ok: false; error: string };
  redactFor(def: GameDefinition, state: GameState, playerId: string | null): GameState;
}

export interface ChatRecord { from: string; name: string; text: string; at: number }

/** Everything needed to resume a room after a host refresh. */
export interface SavedRoom {
  v: 1;
  roomCode: string;
  lobby: LobbyState;
  game: GameState | null;
  /** playerId -> secret bound on first hello. */
  secrets: Record<string, string>;
  chat: ChatRecord[];
  savedAt: number;
}

export const HOST_SAVE_KEY = 'catanweb:hostRoom';
const CHAT_HISTORY = 100;

export interface HostOptions {
  roomCode: string;
  hostPlayer: { id: string; name: string };
  /** Resume from a previous save (must match roomCode). */
  saved?: SavedRoom | null;
  engine?: EngineApi;
  baseMod?: ModDef;
  /** Where to autosave. null disables persistence. Defaults to window.localStorage when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
  random?: () => number;
  /**
   * Called when a turn timer expires.
   * TODO(turn-timer): auto end turn / auto-resolve prompts once the engine exposes a
   * "default answer" helper. Today the host only broadcasts the deadline.
   */
  onTurnTimeout?: (room: HostRoom, playerId: string) => void;
}

interface Session {
  conn: Connection;
  playerId: string | null;
  unsub: Unsubscribe[];
}

export class HostRoom {
  readonly roomCode: string;
  private engine: EngineApi;
  private baseMod: ModDef;
  private storage: HostOptions['storage'];
  private now: () => number;
  private random: () => number;
  private onTurnTimeout?: HostOptions['onTurnTimeout'];

  private lobby: LobbyState;
  private game: GameState | null;
  private secrets: Record<string, string>;
  private chat: ChatRecord[];
  private sessions = new Set<Session>();
  private listeners: { listener: Listener; unsub: Unsubscribe[] }[] = [];
  private defCache: { key: ModDef[]; def: GameDefinition | null } | null = null;
  private timer: { key: string; deadline: number | null; player: string | null } = { key: '', deadline: null, player: null };
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Fires after every state change (lobby or game). Useful for debugging/tests. */
  readonly changed = new Emitter<void>();
  readonly transportErrors = new Emitter<string>();

  constructor(opts: HostOptions) {
    this.roomCode = opts.roomCode;
    this.engine = opts.engine ?? (engine as unknown as EngineApi);
    this.baseMod = opts.baseMod ?? defaultBaseMod;
    this.storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.onTurnTimeout = opts.onTurnTimeout;

    const saved = opts.saved && opts.saved.roomCode === opts.roomCode && opts.saved.lobby.hostPlayerId === opts.hostPlayer.id
      ? opts.saved : null;
    if (saved) {
      // Nobody is connected right after a restart; they will reconnect.
      this.lobby = { ...saved.lobby, players: saved.lobby.players.map((p) => ({ ...p, connected: false })) };
      this.game = saved.game;
      this.secrets = { ...saved.secrets };
      this.chat = [...saved.chat];
    } else {
      this.lobby = createLobby(opts.hostPlayer, this.tryDef([]));
      this.game = null;
      this.secrets = {};
      this.chat = [];
    }
    this.save();
    this.refreshTimer();
  }

  /* ---------------------------------------------------------------- public */

  /** Start accepting remote connections from a transport listener. */
  attachListener(listener: Listener): void {
    const unsub = [
      listener.onConnection((c) => this.accept(c)),
      listener.onError((e) => this.transportErrors.emit(e)),
    ];
    this.listeners.push({ listener, unsub });
  }

  /** A loopback connection for the host's own UI. Returns the client end. */
  connectLocal(): Connection {
    const [client, server] = createMemoryPair({ aId: 'local', bId: this.roomCode, local: true });
    this.accept(server);
    return client;
  }

  getLobby(): LobbyState { return this.lobby; }
  getGame(): GameState | null { return this.game; }
  /** Definition for the room's current mods (null if the engine cannot build it). */
  getDefinition(): GameDefinition | null { return this.tryDef(this.lobby.mods); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    for (const s of [...this.sessions]) s.conn.close();
    for (const l of this.listeners) { l.unsub.forEach((u) => u()); l.listener.destroy(); }
    this.listeners = [];
    this.changed.clear();
  }

  /** Remove the persisted room (e.g. host chose "close room"). */
  forget(): void {
    this.storage?.removeItem(HOST_SAVE_KEY);
  }

  /* ------------------------------------------------------------ connections */

  private accept(conn: Connection): void {
    if (this.destroyed) { conn.close(); return; }
    const session: Session = { conn, playerId: null, unsub: [] };
    this.sessions.add(session);
    session.unsub.push(
      conn.onMessage((raw) => this.onMessage(session, raw)),
      conn.onClose(() => this.onClose(session)),
    );
  }

  private onClose(session: Session): void {
    if (!this.sessions.delete(session)) return;
    session.unsub.forEach((u) => u());
    const id = session.playerId;
    if (!id) return;
    // Only mark offline if no newer session took over this seat.
    if ([...this.sessions].some((s) => s.playerId === id)) return;
    this.dispatch({ type: 'connected', playerId: id, connected: false });
    this.broadcastLobby();
  }

  private send(session: Session, msg: ServerMessage): void {
    session.conn.send(msg);
  }

  private reject(session: Session, message: string, close = false): void {
    this.send(session, { t: 'error', message });
    if (close) setTimeout(() => session.conn.close(), 50);
  }

  /* --------------------------------------------------------------- messages */

  private onMessage(session: Session, raw: unknown): void {
    if (this.destroyed) return;
    const msg = parseClientMessage(raw);
    if (!msg) { this.reject(session, 'Malformed message'); return; }

    if (msg.t === 'ping') { this.send(session, { t: 'pong', at: msg.at }); return; }
    if (msg.t === 'hello') { this.onHello(session, msg); return; }

    const by = session.playerId;
    if (!by) { this.reject(session, 'Say hello first'); return; }

    switch (msg.t) {
      case 'lobby:setName': this.lobbyAction({ type: 'setName', by, name: msg.name }, session); return;
      case 'lobby:setColor': this.lobbyAction({ type: 'setColor', by, color: msg.color }, session); return;
      case 'lobby:ready': this.lobbyAction({ type: 'setReady', by, ready: msg.ready }, session); return;
      case 'lobby:settings':
        if (!this.isHostSession(session)) { this.reject(session, 'Only the host can change settings'); return; }
        this.lobbyAction({ type: 'settings', by, settings: msg.settings }, session); return;
      case 'lobby:mods':
        if (!this.isHostSession(session)) { this.reject(session, 'Only the host can change mods'); return; }
        this.lobbyAction({ type: 'mods', by, mods: msg.mods }, session); return;
      case 'lobby:kick':
        if (!this.isHostSession(session)) { this.reject(session, 'Only the host can kick'); return; }
        this.onKick(session, msg.playerId); return;
      case 'lobby:start':
        if (!this.isHostSession(session)) { this.reject(session, 'Only the host can start'); return; }
        this.onStart(session); return;
      case 'game:command': this.onCommand(session, by, msg.command, msg.clientSeq); return;
      case 'chat': this.onChat(by, msg.text); return;
    }
  }

  private isHostSession(session: Session): boolean {
    return session.conn.isLocal && session.playerId === this.lobby.hostPlayerId;
  }

  private onHello(session: Session, msg: Extract<ClientMessage, { t: 'hello' }>): void {
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.reject(session, 'Version mismatch: please refresh the page', true);
      return;
    }
    if (session.playerId && session.playerId !== msg.playerId) {
      this.reject(session, 'Already identified');
      return;
    }
    const id = msg.playerId;
    if (id === this.lobby.hostPlayerId && !session.conn.isLocal) {
      this.reject(session, 'That seat belongs to the host', true);
      return;
    }
    if (this.lobby.kicked.includes(id)) {
      this.send(session, { t: 'kicked', reason: 'You were removed from this room' });
      setTimeout(() => session.conn.close(), 50);
      return;
    }
    const known = this.secrets[id];
    if (known !== undefined && msg.secret !== known) {
      this.reject(session, 'That seat is in use by another browser', true);
      return;
    }
    const res = lobbyReducer(this.lobby, { type: 'join', playerId: id, name: msg.name }, this.ctx());
    if (!res.ok) { this.reject(session, res.error, true); return; }
    if (known === undefined && msg.secret) this.secrets[id] = msg.secret;
    this.lobby = res.state;

    // One live session per seat: newest wins.
    for (const other of this.sessions) {
      if (other !== session && other.playerId === id) {
        other.playerId = null;
        this.send(other, { t: 'error', message: 'Connected from another tab' });
        other.conn.close();
      }
    }
    session.playerId = id;

    this.send(session, { t: 'welcome', you: id, hostId: this.lobby.hostPlayerId });
    for (const c of this.chat) this.send(session, { t: 'chat', from: c.from, name: c.name, text: c.text, at: c.at });
    this.broadcastLobby();
    if (this.game) {
      const def = this.getDefinition();
      if (def) this.send(session, { t: 'game:state', state: this.engine.redactFor(def, this.game, id) });
      this.send(session, { t: 'timer', deadline: this.timer.deadline, player: this.timer.player });
    }
    this.persist();
  }

  private lobbyAction(action: LobbyAction, session: Session): void {
    const res = lobbyReducer(this.lobby, action, this.ctx());
    if (!res.ok) { this.reject(session, res.error); return; }
    if (res.state === this.lobby) return;
    this.lobby = res.state;
    this.broadcastLobby();
    this.persist();
  }

  private onKick(session: Session, playerId: string): void {
    const res = lobbyReducer(this.lobby, { type: 'kick', by: session.playerId!, playerId }, this.ctx());
    if (!res.ok) { this.reject(session, res.error); return; }
    const name = this.lobby.players.find((p) => p.id === playerId)?.name ?? 'A player';
    this.lobby = res.state;
    for (const s of [...this.sessions]) {
      if (s.playerId === playerId) {
        this.send(s, { t: 'kicked', reason: 'The host removed you from the room' });
        s.playerId = null;
        setTimeout(() => s.conn.close(), 50);
      }
    }
    this.systemChat(`${name} was removed by the host`);
    this.broadcastLobby();
    this.persist();
  }

  private onStart(session: Session): void {
    const def = this.getDefinition();
    if (!def) { this.reject(session, 'Cannot build the game rules (engine/mod error)'); return; }
    const res = lobbyReducer(this.lobby, { type: 'start', by: session.playerId! }, { ...this.ctx(), def });
    if (!res.ok) { this.reject(session, res.error); return; }
    let game: GameState;
    try {
      const settings: LobbySettings = { ...res.state.settings, mods: res.state.mods.map((m) => m.meta.id) };
      const players = res.state.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
      game = this.engine.createGame(def, settings, players, Math.floor(this.random() * 0x7fffffff));
    } catch (e) {
      this.reject(session, `Could not start: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.lobby = res.state;
    this.game = game;
    this.broadcastLobby();
    this.broadcastGame();
    this.refreshTimer();
    this.persist();
  }

  private onCommand(session: Session, by: string, command: Command, clientSeq: number): void {
    const def = this.getDefinition();
    if (!this.game || !def) { this.send(session, { t: 'game:rejected', clientSeq, error: 'The game has not started' }); return; }
    if (!this.game.players.some((p) => p.id === by)) {
      this.send(session, { t: 'game:rejected', clientSeq, error: 'You are not playing in this game' });
      return;
    }
    let res: ReturnType<EngineApi['applyCommand']>;
    try {
      res = this.engine.applyCommand(def, this.game, by, command);
    } catch (e) {
      res = { ok: false, error: `Engine error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) { this.send(session, { t: 'game:rejected', clientSeq, error: res.error }); return; }
    this.game = res.state;
    this.broadcastGame();
    this.refreshTimer();
    this.persist();
  }

  private onChat(by: string, text: string): void {
    const clean = cleanChat(text);
    if (!clean) return;
    const name = this.lobby.players.find((p) => p.id === by)?.name ?? '?';
    this.pushChat({ from: by, name, text: clean, at: this.now() });
  }

  private systemChat(text: string): void {
    this.pushChat({ from: 'system', name: 'System', text, at: this.now() });
  }

  private pushChat(c: ChatRecord): void {
    this.chat = [...this.chat, c].slice(-CHAT_HISTORY);
    this.broadcast({ t: 'chat', from: c.from, name: c.name, text: c.text, at: c.at });
    this.persist();
  }

  /* -------------------------------------------------------------- broadcast */

  private identified(): Session[] {
    return [...this.sessions].filter((s) => s.playerId !== null);
  }

  private broadcast(msg: ServerMessage): void {
    for (const s of this.identified()) this.send(s, msg);
  }

  private broadcastLobby(): void {
    const { players, settings, mods, started } = this.lobby;
    this.broadcast({ t: 'lobby', players, settings, mods, started });
    this.changed.emit();
  }

  private broadcastGame(): void {
    const def = this.getDefinition();
    if (!this.game || !def) return;
    for (const s of this.identified()) {
      try {
        this.send(s, { t: 'game:state', state: this.engine.redactFor(def, this.game, s.playerId) });
      } catch (e) {
        console.error('redactFor failed', e);
      }
    }
    this.changed.emit();
  }

  /* ------------------------------------------------------------------ timer */

  /** Who must act now: head prompt's player, else the current player. */
  private actingPlayer(g: GameState): string | null {
    if (g.phase === 'gameOver' || g.winner) return null;
    return g.prompts[0]?.player ?? g.turnOrder[g.currentPlayerIndex] ?? null;
  }

  private refreshTimer(): void {
    const secs = this.lobby.settings.turnTimerSeconds;
    const g = this.game;
    const player = g ? this.actingPlayer(g) : null;
    if (!g || secs <= 0 || !player) {
      if (this.timer.deadline !== null) {
        this.timer = { key: '', deadline: null, player: null };
        this.broadcast({ t: 'timer', deadline: null, player: null });
      }
      this.clearTimeoutHandle();
      return;
    }
    const key = `${g.turn}|${g.currentPlayerIndex}|${g.phase}|${player}|${g.prompts[0]?.id ?? ''}`;
    if (key === this.timer.key) return;
    const deadline = this.now() + secs * 1000;
    this.timer = { key, deadline, player };
    this.broadcast({ t: 'timer', deadline, player });
    this.clearTimeoutHandle();
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      if (this.timer.key === key) this.onTurnTimeout?.(this, player);
    }, secs * 1000);
  }

  private clearTimeoutHandle(): void {
    if (this.timeoutHandle) { clearTimeout(this.timeoutHandle); this.timeoutHandle = null; }
  }

  /* ------------------------------------------------------------ persistence */

  private persist(): void {
    this.save();
  }

  private save(): void {
    if (!this.storage) return;
    const data: SavedRoom = {
      v: 1, roomCode: this.roomCode, lobby: this.lobby, game: this.game,
      secrets: this.secrets, chat: this.chat, savedAt: this.now(),
    };
    try {
      this.storage.setItem(HOST_SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Could not autosave room', e);
    }
  }

  /* ---------------------------------------------------------------- helpers */

  private dispatch(action: LobbyAction): void {
    const res = lobbyReducer(this.lobby, action, this.ctx());
    if (res.ok) { this.lobby = res.state; this.persist(); }
  }

  private ctx() {
    return { def: this.getDefinition(), resolveDef: (mods: ModDef[]) => this.engine.buildDefinition([this.baseMod, ...mods]) };
  }

  private tryDef(mods: ModDef[]): GameDefinition | null {
    // Cached by array identity: the lobby's mod list is replaced (never mutated) on change.
    const key = mods;
    if (this.defCache && this.defCache.key === key) return this.defCache.def;
    let def: GameDefinition | null = null;
    try {
      def = this.engine.buildDefinition([this.baseMod, ...mods]);
    } catch (e) {
      console.warn('buildDefinition failed', e);
    }
    this.defCache = { key, def };
    return def;
  }
}

export function loadSavedRoom(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): SavedRoom | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(HOST_SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedRoom;
    return data && data.v === 1 && typeof data.roomCode === 'string' ? data : null;
  } catch {
    return null;
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
