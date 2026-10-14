import { useState } from 'react';
import { canStart, type LobbyState } from '../../net/lobby';
import { closeHostedRoom } from '../../net/session';
import type { RoomView } from '../../net/useRoom';
import { navigate, roomLink } from '../router';
import { ChatPanel } from './ChatPanel';
import { ModsPanel } from './ModsPanel';
import { PlayerList } from './PlayerList';
import { SettingsPanel } from './SettingsPanel';

export function LobbyScreen({ room, code }: { room: RoomView; code: string }) {
  const { snapshot, isHost, me } = room;
  const settings = snapshot.settings!;
  const [tab, setTab] = useState<'settings' | 'mods'>('settings');

  const startCheck = canStart({
    players: snapshot.players, settings, mods: snapshot.mods, started: snapshot.started,
    hostPlayerId: snapshot.hostId ?? '', kicked: [],
  } satisfies LobbyState);

  const leave = () => {
    if (isHost) {
      const choice = confirm('Close this room for everyone?\n\nOK = close room · Cancel = just leave (you can resume it later from the home page)');
      if (choice) closeHostedRoom(code);
    }
    navigate('/');
  };

  return (
    <div className="lobby">
      <header className="topbar">
        <a className="brand" href="#/">⬡ Hexlands</a>
        <InviteBox code={code} />
        <div className="topbar-right">
          <LatencyDot ms={snapshot.latencyMs} local={room.role === 'host'} />
          <button className="btn ghost small" onClick={leave}>Leave</button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="card lobby-players">
          <h2>Players <span className="muted">{snapshot.players.length}/{settings.maxPlayers}</span></h2>
          <PlayerList room={room} />
          <div className="lobby-cta">
            {isHost ? (
              <>
                <button
                  className="btn primary big"
                  disabled={!startCheck.ok}
                  onClick={() => room.sendMessage({ t: 'lobby:start' })}
                >
                  Start game
                </button>
                {!startCheck.ok && <p className="muted small center">{startCheck.reason}</p>}
              </>
            ) : me ? (
              <button
                className={`btn big ${me.ready ? 'success' : 'primary'}`}
                onClick={() => room.sendMessage({ t: 'lobby:ready', ready: !me.ready })}
              >
                {me.ready ? '✓ Ready — click to cancel' : "I'm ready"}
              </button>
            ) : null}
            {!isHost && <p className="muted small center">Waiting for the host to start…</p>}
          </div>
        </section>

        <section className="card lobby-settings">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
              Game settings
            </button>
            <button role="tab" aria-selected={tab === 'mods'} className={tab === 'mods' ? 'active' : ''} onClick={() => setTab('mods')}>
              Mods {snapshot.mods.length > 0 && <span className="pill">{snapshot.mods.length}</span>}
            </button>
          </div>
          {!isHost && <p className="muted small">Only the host can change settings.</p>}
          {room.defError && <p className="error-text small">Rules failed to load: {room.defError}</p>}
          {tab === 'settings' ? <SettingsPanel room={room} /> : <ModsPanel room={room} />}
        </section>

        <section className="card lobby-chat">
          <h2>Chat</h2>
          <ChatPanel chat={snapshot.chat} players={snapshot.players} you={snapshot.you} onSend={room.sendChat} />
        </section>
      </div>
    </div>
  );
}

function InviteBox({ code }: { code: string }) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const copy = async (what: 'link' | 'code') => {
    const text = what === 'link' ? roomLink(code) : code;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt('Copy this:', text);
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="invite">
      <button className="room-code mono" title="Copy room code" onClick={() => copy('code')}>
        {copied === 'code' ? 'Copied!' : code}
      </button>
      <button className="btn small" onClick={() => copy('link')}>
        {copied === 'link' ? '✓ Link copied' : '🔗 Copy invite link'}
      </button>
    </div>
  );
}

function LatencyDot({ ms, local }: { ms: number | null; local: boolean }) {
  if (local) return <span className="latency" title="You are hosting this room">● Host</span>;
  const cls = ms === null ? '' : ms < 150 ? 'good' : ms < 400 ? 'ok' : 'bad';
  return <span className={`latency ${cls}`} title="Round-trip to host">● {ms === null ? '—' : `${ms} ms`}</span>;
}
