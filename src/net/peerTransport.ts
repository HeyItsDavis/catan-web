/**
 * PeerJS implementation of the transport interface. This is the ONLY file that
 * imports peerjs. Uses the free public PeerJS cloud broker.
 */
import Peer, { type DataConnection } from 'peerjs';
import { Emitter, type Connection, type Connector, type Listener, type Unsubscribe } from './transport';
import { peerIdForRoom } from './roomCode';

const OPEN_TIMEOUT_MS = 12_000;

class PeerConnection implements Connection {
  readonly remoteId: string;
  readonly isLocal = false;
  private conn: DataConnection;
  private messages = new Emitter<unknown>();
  private closed = new Emitter<void>();
  private done = false;
  private onDispose?: () => void;

  constructor(conn: DataConnection, onDispose?: () => void) {
    this.conn = conn;
    this.remoteId = conn.peer;
    this.onDispose = onDispose;
    conn.on('data', (d) => this.messages.emit(d));
    conn.on('close', () => this.finish());
    conn.on('error', () => this.finish());
    // Underlying ICE failure doesn't always emit 'close'.
    conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') this.finish(); });
  }
  get isOpen(): boolean { return !this.done && this.conn.open; }
  send(msg: unknown): void {
    if (!this.isOpen) return;
    try { void this.conn.send(msg); } catch (e) { console.warn('send failed', e); this.finish(); }
  }
  close(): void {
    try { this.conn.close(); } catch { /* ignore */ }
    this.finish();
  }
  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.closed.emit();
    this.closed.clear();
    this.messages.clear();
    this.onDispose?.();
  }
  onMessage(cb: (msg: unknown) => void): Unsubscribe { return this.messages.on(cb); }
  onClose(cb: () => void): Unsubscribe {
    if (this.done) { queueMicrotask(cb); return () => {}; }
    return this.closed.on(cb);
  }
}

export class RoomIdTakenError extends Error {
  constructor() { super('That room code is still registered on the broker'); this.name = 'RoomIdTakenError'; }
}

/** Register as the host for `roomCode`. Rejects with RoomIdTakenError if the id is in use. */
export function listenPeer(roomCode: string): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerIdForRoom(roomCode));
    const conns = new Emitter<Connection>();
    const errors = new Emitter<string>();
    let opened = false;
    let destroyed = false;

    const listener: Listener = {
      roomCode,
      onConnection: (cb) => conns.on(cb),
      onError: (cb) => errors.on(cb),
      destroy: () => { destroyed = true; conns.clear(); peer.destroy(); },
    };

    peer.on('open', () => { opened = true; resolve(listener); });
    peer.on('connection', (dc) => {
      const wrap = () => conns.emit(new PeerConnection(dc));
      if (dc.open) wrap(); else dc.on('open', wrap);
    });
    peer.on('disconnected', () => {
      // Lost the broker: existing data channels survive, but new guests can't find us.
      if (!destroyed && !peer.destroyed) setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1000);
    });
    peer.on('error', (err) => {
      if (!opened) {
        peer.destroy();
        reject(err.type === 'unavailable-id' ? new RoomIdTakenError() : new Error(describe(err.type, err.message)));
        return;
      }
      errors.emit(describe(err.type, err.message));
    });
  });
}

/** Connect to the host of `roomCode`. Each call uses a fresh Peer, destroyed on close. */
export function peerConnector(roomCode: string): Connector {
  return () => new Promise((resolve, reject) => {
    const peer = new Peer();
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('Timed out connecting to host'), OPEN_TIMEOUT_MS);
    peer.on('error', (err) => fail(describe(err.type, err.message)));
    peer.on('open', () => {
      const dc = peer.connect(peerIdForRoom(roomCode), { reliable: true });
      dc.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new PeerConnection(dc, () => peer.destroy()));
      });
      dc.on('error', (e) => fail(e.message));
    });
  });
}

function describe(type: string, message: string): string {
  switch (type) {
    case 'peer-unavailable': return 'Room not found (is the host online?)';
    case 'network': return 'Cannot reach the matchmaking server';
    case 'server-error': return 'Matchmaking server error';
    case 'browser-incompatible': return 'This browser does not support WebRTC';
    default: return message || type;
  }
}
