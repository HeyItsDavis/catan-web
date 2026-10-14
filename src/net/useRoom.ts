/**
 * React binding for a room. No state library: useSyncExternalStore over RoomClient.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as engine from '../engine';
import { baseMod } from '../content/base';
import type { Command, GameDefinition, LobbyPlayer, LobbySettings, ModDef } from '../engine/schema';
import type { RoomSnapshot } from './client';
import type { ClientMessage } from './protocol';
import { acquireSession, releaseSession, type HostNetState, type RoomSession } from './session';

const EMPTY_SNAPSHOT: RoomSnapshot = {
  status: 'connecting', error: null, you: null, hostId: null, players: [], settings: null, mods: [],
  started: false, game: null, chat: [], latencyMs: null, timer: { deadline: null, player: null }, attempt: 0,
};
const ONLINE: HostNetState = { status: 'online', message: null };
const noopSubscribe = () => () => {};

/** Build the merged definition for a mod list. Guests do this locally too. */
export function buildDefinitionSafe(mods: ModDef[]): { def: GameDefinition | null; error: string | null } {
  try {
    return { def: engine.buildDefinition([baseMod, ...mods]), error: null };
  } catch (e) {
    return { def: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RoomView {
  session: RoomSession | null;
  role: 'host' | 'guest' | null;
  snapshot: RoomSnapshot;
  hostNet: HostNetState;
  def: GameDefinition | null;
  defError: string | null;
  me: LobbyPlayer | null;
  isHost: boolean;
  /** Raw protocol message (lobby actions etc.). */
  sendMessage: (msg: ClientMessage) => void;
  send: (cmd: Command) => void;
  sendChat: (text: string) => void;
  updateSettings: (patch: Partial<LobbySettings>) => void;
  setMods: (mods: ModDef[]) => void;
  retry: () => void;
  clearError: () => void;
}

export function useRoom(code: string): RoomView {
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    // Acquiring is a side effect (ref-counted network session), so it belongs in an effect.
    const s = acquireSession(code);
    // eslint-disable-next-line react/set-state-in-effect
    setSession(s);
    return () => { releaseSession(code); };
  }, [code]);

  const snapshot = useSyncExternalStore(
    session?.client.subscribe ?? noopSubscribe,
    session?.client.getSnapshot ?? (() => EMPTY_SNAPSHOT),
  );
  const hostNet = useSyncExternalStore(
    session?.hostNet.subscribe ?? noopSubscribe,
    session?.hostNet.get ?? (() => ONLINE),
  );

  const { def, error: defError } = useMemo(() => buildDefinitionSafe(snapshot.mods), [snapshot.mods]);

  const me = snapshot.players.find((p) => p.id === snapshot.you) ?? null;
  const isHost = !!me?.isHost && session?.role === 'host';

  const sendMessage = useCallback((msg: ClientMessage) => { session?.client.send(msg); }, [session]);
  const send = useCallback((cmd: Command) => { session?.client.sendCommand(cmd); }, [session]);
  const sendChat = useCallback((text: string) => { session?.client.sendChat(text); }, [session]);
  const settings = snapshot.settings;
  const updateSettings = useCallback((patch: Partial<LobbySettings>) => {
    if (settings) session?.client.send({ t: 'lobby:settings', settings: { ...settings, ...patch } });
  }, [session, settings]);
  const setMods = useCallback((mods: ModDef[]) => { session?.client.send({ t: 'lobby:mods', mods }); }, [session]);
  const retry = useCallback(() => session?.client.retryNow(), [session]);
  const clearError = useCallback(() => session?.client.clearError(), [session]);

  return {
    session, role: session?.role ?? null, snapshot, hostNet, def, defError, me, isHost,
    sendMessage, send, sendChat, updateSettings, setMods, retry, clearError,
  };
}
