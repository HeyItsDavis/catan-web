/**
 * Minimal transport abstraction so host/client logic never touches PeerJS directly.
 * Implementations: PeerJS (peerTransport.ts) and in-memory (memoryTransport.ts,
 * used for the host's own loopback connection and for unit tests).
 */

export type Unsubscribe = () => void;

/** A bidirectional, message-oriented connection. Messages are plain JSON-able values. */
export interface Connection {
  /** Opaque id of the remote end (peer id, or "local"). */
  readonly remoteId: string;
  /** True for the host's own in-browser loopback connection. */
  readonly isLocal: boolean;
  readonly isOpen: boolean;
  send(msg: unknown): void;
  close(): void;
  onMessage(cb: (msg: unknown) => void): Unsubscribe;
  /** Fires once when the connection closes (either side, or failure). */
  onClose(cb: () => void): Unsubscribe;
}

/** Server side: accepts incoming connections for a room. */
export interface Listener {
  readonly roomCode: string;
  onConnection(cb: (conn: Connection) => void): Unsubscribe;
  /** Non-fatal / fatal transport errors for display. */
  onError(cb: (message: string) => void): Unsubscribe;
  destroy(): void;
}

/** Client side: opens a connection to a room code. Rejects on failure. */
export type Connector = () => Promise<Connection>;

/** Tiny typed event list. */
export class Emitter<T> {
  private handlers = new Set<(v: T) => void>();
  on(cb: (v: T) => void): Unsubscribe {
    this.handlers.add(cb);
    return () => { this.handlers.delete(cb); };
  }
  emit(v: T): void {
    for (const h of [...this.handlers]) {
      try { h(v); } catch (e) { console.error(e); }
    }
  }
  clear(): void { this.handlers.clear(); }
}
