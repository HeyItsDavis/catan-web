import { useState, type FormEvent } from 'react';
import { saveName } from '../../net/identity';
import { MAX_NAME_LENGTH, PLAYER_COLORS, sanitizeName } from '../../net/lobby';
import type { RoomView } from '../../net/useRoom';

export function PlayerList({ room }: { room: RoomView }) {
  const { snapshot, isHost } = room;
  const settings = snapshot.settings!;
  const [picking, setPicking] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const empty = Math.max(0, settings.maxPlayers - snapshot.players.length);

  return (
    <ul className="player-list">
      {snapshot.players.map((p) => {
        const isMe = p.id === snapshot.you;
        return (
          <li key={p.id} className={`player-row ${isMe ? 'me' : ''} ${p.connected ? '' : 'offline'}`}>
            <div className="swatch-wrap">
              <button
                className="swatch"
                style={{ background: p.color }}
                disabled={!isMe}
                title={isMe ? 'Change color' : undefined}
                aria-label={isMe ? 'Change your color' : `${p.name}'s color`}
                onClick={() => setPicking((v) => !v)}
              />
              {isMe && picking && (
                <div className="color-pop" role="listbox">
                  {PLAYER_COLORS.map((c) => {
                    const taken = snapshot.players.some((o) => o.id !== p.id && o.color === c);
                    return (
                      <button
                        key={c}
                        className={`swatch ${c === p.color ? 'selected' : ''}`}
                        style={{ background: c }}
                        disabled={taken}
                        aria-label={taken ? 'Taken' : 'Pick color'}
                        onClick={() => { room.sendMessage({ t: 'lobby:setColor', color: c }); setPicking(false); }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="player-name">
              {isMe && editingName ? (
                <NameEditor initial={p.name} onDone={(n) => {
                  setEditingName(false);
                  if (n && n !== p.name) { saveName(n); room.session?.client.setName(n); }
                }} />
              ) : (
                <span
                  className={isMe ? 'editable' : ''}
                  title={isMe ? 'Click to rename' : undefined}
                  onClick={() => isMe && setEditingName(true)}
                >
                  {p.name}{isMe && <span className="muted"> (you)</span>}
                </span>
              )}
              <div className="badges">
                {p.isHost && <span className="badge host">👑 Host</span>}
                {!p.connected && <span className="badge offline">offline</span>}
              </div>
            </div>

            <div className="player-status">
              {p.isHost ? null : p.ready
                ? <span className="badge ready">Ready</span>
                : <span className="badge notready">Not ready</span>}
              {isHost && !p.isHost && (
                <button
                  className="btn ghost small danger"
                  title={`Kick ${p.name}`}
                  onClick={() => confirm(`Remove ${p.name} from the room?`) && room.sendMessage({ t: 'lobby:kick', playerId: p.id })}
                >
                  ✕
                </button>
              )}
            </div>
          </li>
        );
      })}
      {Array.from({ length: empty }, (_, i) => (
        <li key={`empty-${i}`} className="player-row empty">
          <span className="swatch empty" />
          <span className="muted">Open seat</span>
        </li>
      ))}
    </ul>
  );
}

function NameEditor({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [v, setV] = useState(initial);
  const submit = (e?: FormEvent) => { e?.preventDefault(); onDone(sanitizeName(v)); };
  return (
    <form onSubmit={submit} className="name-editor">
      <input value={v} maxLength={MAX_NAME_LENGTH} autoFocus onChange={(e) => setV(e.target.value)} onBlur={() => submit()} />
    </form>
  );
}
