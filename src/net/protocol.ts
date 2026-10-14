/**
 * Wire protocol between the host browser (authoritative) and guest browsers.
 * Transport: PeerJS data channels. The host's peer id IS the room code.
 * Room link: <site>/#/room/<roomCode>
 */
import type { Command, GameState, LobbyPlayer, LobbySettings, ModDef } from '../engine/schema';

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  /**
   * `secret` (additive): random per-browser token. The host binds it to `playerId` on first
   * hello so another guest can't take over a seat by copying a (public) player id.
   */
  | { t: 'hello'; protocol: number; playerId: string; name: string; secret?: string }
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
  /** `hostId` is the host's player id. */
  | { t: 'welcome'; you: string; hostId: string }
  | { t: 'error'; message: string; clientSeq?: number }
  /** `started` (additive): true once the game has begun. */
  | { t: 'lobby'; players: LobbyPlayer[]; settings: LobbySettings; mods: ModDef[]; started?: boolean }
  /** Full redacted state. Simple and robust for 4-6 players; send on every change. */
  | { t: 'game:state'; state: GameState }
  | { t: 'game:rejected'; clientSeq: number; error: string }
  /** `from` is a player id ('system' for host notices). `name` (additive) is the sender's display name. */
  | { t: 'chat'; from: string; text: string; at: number; name?: string }
  | { t: 'pong'; at: number }
  /** (additive) You were removed by the host; do not auto-reconnect. */
  | { t: 'kicked'; reason: string }
  /** (additive) Turn timer: epoch ms by which `player` must act, or null when off. */
  | { t: 'timer'; deadline: number | null; player: string | null }
  /** (additive) The same player connected from another tab/device; this connection is closed
   *  and should NOT auto-reconnect (that would steal the seat back, forever). */
  | { t: 'replaced'; message: string };
