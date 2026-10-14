/**
 * Wire protocol between the host browser (authoritative) and guest browsers.
 * Transport: PeerJS data channels. The host's peer id IS the room code.
 * Room link: <site>/#/room/<roomCode>
 */
import type { Command, GameState, LobbyPlayer, LobbySettings, ModDef } from '../engine/schema';

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { t: 'hello'; protocol: number; playerId: string; name: string }
  | { t: 'lobby:setName'; name: string }
  | { t: 'lobby:setColor'; color: string }
  | { t: 'lobby:ready'; ready: boolean }
  /** Host-only (host's own UI also goes through this path for uniformity). */
  | { t: 'lobby:settings'; settings: LobbySettings }
  | { t: 'lobby:mods'; mods: ModDef[] }
  | { t: 'lobby:kick'; playerId: string }
  | { t: 'lobby:start' }
  | { t: 'game:command'; command: Command; clientSeq: number }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number };

export type ServerMessage =
  | { t: 'welcome'; you: string; hostId: string }
  | { t: 'error'; message: string; clientSeq?: number }
  | { t: 'lobby'; players: LobbyPlayer[]; settings: LobbySettings; mods: ModDef[] }
  /** Full redacted state. Simple and robust for 4-6 players; send on every change. */
  | { t: 'game:state'; state: GameState }
  | { t: 'game:rejected'; clientSeq: number; error: string }
  | { t: 'chat'; from: string; text: string; at: number }
  | { t: 'pong'; at: number };
