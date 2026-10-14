import { Emitter, type Connection, type Listener, type Unsubscribe } from './transport';

/** Messages are JSON round-tripped so tests catch non-serializable payloads. */
function cloneMsg(msg: unknown): unknown {
  return msg === undefined ? undefined : JSON.parse(JSON.stringify(msg));
}

class MemoryConnection implements Connection {
  peer!: MemoryConnection;
  isOpen = true;
  private messages = new Emitter<unknown>();
  private closed = new Emitter<void>();
  readonly remoteId: string;
  readonly isLocal: boolean;
  constructor(remoteId: string, isLocal: boolean) {
    this.remoteId = remoteId;
    this.isLocal = isLocal;
  }

  send(msg: unknown): void {
    if (!this.isOpen) return;
    const copy = cloneMsg(msg);
    const target = this.peer;
    queueMicrotask(() => { if (target.isOpen) target.messages.emit(copy); });
  }
  close(): void {
    if (!this.isOpen) return;
    this.shutdown();
    const target = this.peer;
    queueMicrotask(() => target.shutdown());
  }
  shutdown(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closed.emit();
    this.closed.clear();
    this.messages.clear();
  }
  onMessage(cb: (msg: unknown) => void): Unsubscribe { return this.messages.on(cb); }
  onClose(cb: () => void): Unsubscribe {
    if (!this.isOpen) { queueMicrotask(cb); return () => {}; }
    return this.closed.on(cb);
  }
}

/** Two connected ends. `a` is typically the client, `b` the server side. */
export function createMemoryPair(opts: { aId?: string; bId?: string; local?: boolean } = {}): [Connection, Connection] {
  const a = new MemoryConnection(opts.bId ?? 'server', !!opts.local);
  const b = new MemoryConnection(opts.aId ?? 'client', !!opts.local);
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** In-memory "broker" for tests: rooms keyed by code. */
export class MemoryNetwork {
  private listeners = new Map<string, MemoryListener>();
  private n = 0;

  listen(roomCode: string): Listener {
    if (this.listeners.has(roomCode)) throw new Error('unavailable-id');
    const l = new MemoryListener(roomCode, () => this.listeners.delete(roomCode));
    this.listeners.set(roomCode, l);
    return l;
  }

  connect(roomCode: string): Promise<Connection> {
    const l = this.listeners.get(roomCode);
    if (!l) return Promise.reject(new Error('Room not found'));
    const [client, server] = createMemoryPair({ aId: `guest-${++this.n}`, bId: roomCode });
    l.accept(server);
    return Promise.resolve(client);
  }
}

class MemoryListener implements Listener {
  private conns = new Emitter<Connection>();
  private errors = new Emitter<string>();
  private open = new Set<Connection>();
  readonly roomCode: string;
  private onDestroy: () => void;
  constructor(roomCode: string, onDestroy: () => void) {
    this.roomCode = roomCode;
    this.onDestroy = onDestroy;
  }
  accept(conn: Connection): void {
    this.open.add(conn);
    conn.onClose(() => this.open.delete(conn));
    this.conns.emit(conn);
  }
  onConnection(cb: (conn: Connection) => void): Unsubscribe { return this.conns.on(cb); }
  onError(cb: (message: string) => void): Unsubscribe { return this.errors.on(cb); }
  destroy(): void {
    for (const c of [...this.open]) c.close();
    this.conns.clear();
    this.onDestroy();
  }
}
