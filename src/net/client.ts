/**
 * Room client: one per open room tab (host and guests alike).
 * Handles hello, auto-reconnect with backoff, heartbeat/latency, and exposes an
 * immutable snapshot + subscribe API (fits React's useSyncExternalStore).
 */
import type { Command, GameState, LobbyPlayer, LobbySettings, ModDef } from '../engine/schema';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';
import type { Connection, Connector, Unsubscribe } from './transport';
import { parseServerMessage } from './validate';

export type ConnStatus =
  | 'connecting'    // first attempt in progress
  | 'connected'     // welcomed by the host
  | 'reconnecting'  // lost connection, retrying
  | 'kicked'        // removed by host; no retry
  | 'failed'        // gave up (room not found / rejected)
  | 'closed';       // stopped locally

export interface ChatEntry { from: string; name: string; text: string; at: number }

export interface RoomSnapshot {
  status: ConnStatus;
  /** Last error/notice from host or transport (for a toast). */
  error: { message: string; at: number } | null;
  you: string | null;
  hostId: string | null;
  players: LobbyPlayer[];
  settings: LobbySettings | null;
  /** Stable reference while contents are unchanged. */
  mods: ModDef[];
  started: boolean;
  game: GameState | null;
  chat: ChatEntry[];
  latencyMs: number | null;
  timer: { deadline: number | null; player: string | null };
  /** Consecutive failed connection attempts. */
  attempt: number;
}

export interface ClientOptions {
  connector: Connector;
  playerId: string;
  secret: string;
  name: string;
  now?: () => number;
  pingIntervalMs?: number;
  /** Close & reconnect if nothing is heard for this long. */
  silenceTimeoutMs?: number;
  /** Give up after this many failures if we were never welcomed. */
  maxInitialAttempts?: number;
  backoff?: (attempt: number) => number;
}

const CHAT_LIMIT = 200;

export function defaultBackoff(attempt: number): number {
  const base = Math.min(10_000, 500 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

const EMPTY: RoomSnapshot = {
  status: 'connecting', error: null, you: null, hostId: null, players: [], settings: null,
  mods: [], started: false, game: null, chat: [], latencyMs: null,
  timer: { deadline: null, player: null }, attempt: 0,
};

export class RoomClient {
  private opts: Required<Omit<ClientOptions, 'connector' | 'playerId' | 'secret' | 'name'>> & ClientOptions;
  private snap: RoomSnapshot = EMPTY;
  private subs = new Set<() => void>();
  private conn: Connection | null = null;
  private connUnsubs: Unsubscribe[] = [];
  private stopped = false;
  private everWelcomed = false;
  private retryHandle: ReturnType<typeof setTimeout> | null = null;
  private pingHandle: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  private seq = 0;
  private modsJson = '[]';
  private name: string;

  constructor(opts: ClientOptions) {
    this.opts = {
      now: Date.now, pingIntervalMs: 4000, silenceTimeoutMs: 15_000, maxInitialAttempts: 6,
      backoff: defaultBackoff, ...opts,
    };
    this.name = opts.name;
  }

  /* ------------------------------------------------------------ public API */

  start(): void {
    this.stopped = false;
    this.set({ status: this.everWelcomed ? 'reconnecting' : 'connecting' });
    void this.attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryHandle) clearTimeout(this.retryHandle);
    this.retryHandle = null;
    this.dropConn();
    this.set({ status: 'closed' });
  }

  /** Retry immediately (e.g. user clicked "retry" after 'failed'). */
  retryNow(): void {
    if (this.snap.status === 'kicked') return;
    if (this.retryHandle) clearTimeout(this.retryHandle);
    this.retryHandle = null;
    this.stopped = false;
    this.set({ status: this.everWelcomed ? 'reconnecting' : 'connecting', attempt: 0 });
    void this.attempt();
  }

  subscribe = (cb: () => void): Unsubscribe => {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  };

  getSnapshot = (): RoomSnapshot => this.snap;

  /** Send a raw protocol message. Returns false if not connected. */
  send(msg: ClientMessage): boolean {
    if (!this.conn || !this.conn.isOpen || this.snap.status !== 'connected') {
      this.notice('Not connected to the host');
      return false;
    }
    this.conn.send(msg);
    return true;
  }

  sendCommand(command: Command): number {
    const clientSeq = ++this.seq;
    this.send({ t: 'game:command', command, clientSeq });
    return clientSeq;
  }

  sendChat(text: string): void {
    const t = text.trim();
    if (t) this.send({ t: 'chat', text: t });
  }

  setName(name: string): void {
    this.name = name;
    this.send({ t: 'lobby:setName', name });
  }

  clearError(): void { this.set({ error: null }); }

  /* --------------------------------------------------------------- internals */

  private set(patch: Partial<RoomSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const cb of [...this.subs]) cb();
  }

  private notice(message: string): void {
    this.set({ error: { message, at: this.opts.now() } });
  }

  private async attempt(): Promise<void> {
    if (this.stopped) return;
    let conn: Connection;
    try {
      conn = await this.opts.connector();
    } catch (e) {
      if (this.stopped) return;
      this.onAttemptFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    if (this.stopped) { conn.close(); return; }
    this.useConn(conn);
  }

  private onAttemptFailed(message: string): void {
    const attempt = this.snap.attempt + 1;
    if (!this.everWelcomed && attempt >= this.opts.maxInitialAttempts) {
      this.set({ status: 'failed', attempt, error: { message, at: this.opts.now() } });
      return;
    }
    this.set({ attempt, error: { message, at: this.opts.now() } });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryHandle) return;
    if (this.snap.status === 'kicked' || this.snap.status === 'failed') return;
    this.retryHandle = setTimeout(() => {
      this.retryHandle = null;
      void this.attempt();
    }, this.opts.backoff(this.snap.attempt));
  }

  private useConn(conn: Connection): void {
    this.dropConn();
    this.conn = conn;
    this.lastHeard = this.opts.now();
    this.connUnsubs.push(
      conn.onMessage((raw) => this.onMessage(raw)),
      conn.onClose(() => this.onConnClosed(conn)),
    );
    conn.send({ t: 'hello', protocol: PROTOCOL_VERSION, playerId: this.opts.playerId, name: this.name, secret: this.opts.secret } satisfies ClientMessage);
    this.pingHandle = setInterval(() => this.heartbeat(), this.opts.pingIntervalMs);
  }

  private dropConn(): void {
    if (this.pingHandle) clearInterval(this.pingHandle);
    this.pingHandle = null;
    this.connUnsubs.forEach((u) => u());
    this.connUnsubs = [];
    const c = this.conn;
    this.conn = null;
    c?.close();
  }

  private heartbeat(): void {
    const c = this.conn;
    if (!c) return;
    if (this.opts.now() - this.lastHeard > this.opts.silenceTimeoutMs) {
      // Silent death (e.g. laptop sleep): force a reconnect.
      this.onConnClosed(c);
      return;
    }
    c.send({ t: 'ping', at: this.opts.now() } satisfies ClientMessage);
  }

  private onConnClosed(conn: Connection): void {
    if (conn !== this.conn) return;
    this.dropConn();
    if (this.stopped || this.snap.status === 'kicked' || this.snap.status === 'failed') return;
    if (this.everWelcomed) {
      this.set({ status: 'reconnecting', attempt: this.snap.attempt + 1 });
      this.scheduleRetry();
    } else {
      this.onAttemptFailed(this.snap.error?.message ?? 'Connection closed');
    }
  }

  private onMessage(raw: unknown): void {
    this.lastHeard = this.opts.now();
    const msg = parseServerMessage(raw);
    if (!msg) return;
    this.handle(msg);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.everWelcomed = true;
        // Host replays chat history after welcome.
        this.set({ status: 'connected', you: msg.you, hostId: msg.hostId, attempt: 0, chat: [], error: null });
        return;
      case 'lobby': {
        const json = JSON.stringify(msg.mods);
        const mods = json === this.modsJson ? this.snap.mods : msg.mods;
        this.modsJson = json;
        this.set({ players: msg.players, settings: msg.settings, mods, started: !!msg.started });
        return;
      }
      case 'game:state':
        this.set({ game: msg.state, started: true });
        return;
      case 'game:rejected':
        this.notice(msg.error);
        return;
      case 'error':
        if (this.snap.status !== 'connected') {
          // Rejected during hello (room full, version mismatch, seat taken…): retrying won't help.
          this.set({ status: 'failed', error: { message: msg.message, at: this.opts.now() } });
          this.dropConn();
          return;
        }
        this.notice(msg.message);
        return;
      case 'chat': {
        const entry: ChatEntry = { from: msg.from, name: msg.name ?? this.nameOf(msg.from), text: msg.text, at: msg.at };
        this.set({ chat: [...this.snap.chat, entry].slice(-CHAT_LIMIT) });
        return;
      }
      case 'pong':
        this.set({ latencyMs: Math.max(0, this.opts.now() - msg.at) });
        return;
      case 'kicked':
        this.set({ status: 'kicked', error: { message: msg.reason, at: this.opts.now() } });
        this.dropConn();
        return;
      case 'timer':
        this.set({ timer: { deadline: msg.deadline, player: msg.player } });
        return;
    }
  }

  private nameOf(id: string): string {
    if (id === 'system') return 'System';
    return this.snap.players.find((p) => p.id === id)?.name ?? '?';
  }
}
