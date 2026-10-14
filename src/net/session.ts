/**
 * Room sessions: wires HostRoom / RoomClient / PeerJS together for the UI.
 * Sessions are ref-counted with a deferred teardown so React StrictMode's
 * mount → unmount → mount doesn't tear down the Peer and re-register the room id.
 */
import { RoomClient } from './client';
import { HostRoom, loadSavedRoom, HOST_SAVE_KEY } from './host';
import { getPlayerId, getPlayerSecret, getSavedName } from './identity';
import { listenPeer, peerConnector, RoomIdTakenError } from './peerTransport';
import { generateRoomCode } from './roomCode';
import { Emitter, type Unsubscribe } from './transport';

export type HostNetStatus = 'starting' | 'online' | 'retrying' | 'error';
export interface HostNetState { status: HostNetStatus; message: string | null }

/** Minimal observable value for useSyncExternalStore. */
export class Store<T> {
  private value: T;
  private em = new Emitter<void>();
  constructor(initial: T) { this.value = initial; }
  get = (): T => this.value;
  set(v: T): void { this.value = v; this.em.emit(); }
  subscribe = (cb: () => void): Unsubscribe => this.em.on(cb);
}

export interface RoomSession {
  code: string;
  role: 'host' | 'guest';
  client: RoomClient;
  host: HostRoom | null;
  /** Host only: is the room reachable on the PeerJS broker? */
  hostNet: Store<HostNetState>;
  /** Tear down. `closeRoom` (host only) also tells guests the room is gone and forgets the save. */
  destroy(opts?: { closeRoom?: boolean }): void;
}

/** True if this browser is the host of `code` (it has the saved room). */
export function isHostOf(code: string): boolean {
  const saved = loadSavedRoom();
  return !!saved && saved.roomCode === code && saved.lobby.hostPlayerId === getPlayerId();
}

/** The room this browser hosts, if any (for a "resume" button). */
export function hostedRoomCode(): string | null {
  const saved = loadSavedRoom();
  return saved && saved.lobby.hostPlayerId === getPlayerId() ? saved.roomCode : null;
}

/** Create a brand-new hosted room (replacing any previous one) and return its code. */
export function createHostedRoom(name: string): string {
  const code = generateRoomCode();
  for (const [c, e] of sessions) if (e.session.role === 'host') { e.session.destroy(); sessions.delete(c); }
  try { localStorage.removeItem(HOST_SAVE_KEY); } catch { /* ignore */ }
  // Constructing persists the fresh lobby; the live instance is created by the room page.
  new HostRoom({ roomCode: code, hostPlayer: { id: getPlayerId(), name } }).destroy();
  return code;
}

/** Host closes the room for good. */
export function closeHostedRoom(code: string): void {
  const entry = sessions.get(code);
  if (entry) {
    sessions.delete(code);
    entry.session.destroy({ closeRoom: true });
  }
  if (loadSavedRoom()?.roomCode === code) {
    try { localStorage.removeItem(HOST_SAVE_KEY); } catch { /* ignore */ }
  }
}

function startHostSession(code: string): RoomSession {
  const playerId = getPlayerId();
  const host = new HostRoom({
    roomCode: code,
    hostPlayer: { id: playerId, name: getSavedName() || 'Host' },
    saved: loadSavedRoom(),
  });
  const hostNet = new Store<HostNetState>({ status: 'starting', message: null });
  let destroyed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  const listen = async () => {
    attempts++;
    try {
      const listener = await listenPeer(code);
      if (destroyed) { listener.destroy(); return; }
      host.attachListener(listener);
      hostNet.set({ status: 'online', message: null });
    } catch (e) {
      if (destroyed) return;
      const taken = e instanceof RoomIdTakenError;
      // After a refresh the broker may hold our old id for a little while.
      hostNet.set({
        status: taken ? 'retrying' : 'error',
        message: taken ? 'Re-registering room code (this can take up to a minute after a refresh)…'
          : `${e instanceof Error ? e.message : String(e)} — retrying`,
      });
      retry = setTimeout(listen, Math.min(15_000, 2000 + attempts * 1000));
    }
  };
  void listen();
  const offErr = host.transportErrors.on((m) => {
    if (hostNet.get().status === 'online') hostNet.set({ status: 'online', message: m });
  });

  const client = new RoomClient({
    connector: async () => host.connectLocal(),
    playerId,
    secret: getPlayerSecret(),
    name: getSavedName() || 'Host',
  });
  client.start();

  return {
    code, role: 'host', client, host, hostNet,
    destroy(opts) {
      destroyed = true;
      if (retry) clearTimeout(retry);
      offErr();
      client.stop();
      if (opts?.closeRoom) host.closeRoom(); else host.destroy();
    },
  };
}

function startGuestSession(code: string): RoomSession {
  const client = new RoomClient({
    connector: peerConnector(code),
    playerId: getPlayerId(),
    secret: getPlayerSecret(),
    name: getSavedName() || 'Guest',
  });
  client.start();
  return {
    code, role: 'guest', client, host: null,
    hostNet: new Store<HostNetState>({ status: 'online', message: null }),
    destroy() { client.stop(); },
  };
}

const sessions = new Map<string, { session: RoomSession; refs: number; teardown: ReturnType<typeof setTimeout> | null }>();

export function acquireSession(code: string): RoomSession {
  let entry = sessions.get(code);
  if (!entry) {
    const session = isHostOf(code) ? startHostSession(code) : startGuestSession(code);
    entry = { session, refs: 0, teardown: null };
    sessions.set(code, entry);
  }
  if (entry.teardown) { clearTimeout(entry.teardown); entry.teardown = null; }
  entry.refs++;
  return entry.session;
}

export function releaseSession(code: string): void {
  const entry = sessions.get(code);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  // The host keeps serving the room while browsing elsewhere in the app (e.g. the editor);
  // it ends on closeHostedRoom(), createHostedRoom() or page unload.
  if (entry.session.role === 'host') return;
  entry.teardown = setTimeout(() => {
    if (entry.refs > 0) return;
    entry.session.destroy();
    sessions.delete(code);
  }, 1000);
}
