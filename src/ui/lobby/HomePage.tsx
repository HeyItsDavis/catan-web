import { useState, type FormEvent } from 'react';
import { getSavedName, saveName } from '../../net/identity';
import { sanitizeName } from '../../net/lobby';
import { normalizeRoomCode } from '../../net/roomCode';
import { createHostedRoom, hostedRoomCode } from '../../net/session';
import { navigate } from '../router';
import './lobby.css';

export function HomePage() {
  const [name, setName] = useState(getSavedName);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resumable = hostedRoomCode();
  const cleanName = sanitizeName(name);

  const requireName = (): boolean => {
    if (!cleanName) { setError('Pick a name first'); return false; }
    saveName(cleanName);
    return true;
  };

  const create = () => {
    if (!requireName()) return;
    if (resumable && !confirm(`Creating a new room closes your current room ${resumable}. Continue?`)) return;
    navigate(`/room/${createHostedRoom(cleanName)}`);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (!c) { setError('Room codes are 6 letters/numbers, like K7QX2M'); return; }
    if (!requireName()) return;
    navigate(`/room/${c}`);
  };

  return (
    <main className="home">
      <section className="home-hero">
        <div className="logo-hex" aria-hidden>⬡</div>
        <h1>Hexlands</h1>
        <p className="muted">Build, trade and settle with friends — right in your browser. Fully moddable.</p>
      </section>

      <section className="card home-card">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={20}
            placeholder="e.g. Ada"
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onBlur={() => cleanName && saveName(cleanName)}
            autoFocus={!name}
          />
        </label>

        <div className="home-actions">
          <button className="btn primary big" onClick={create}>Create room</button>
          {resumable && (
            <button className="btn big" onClick={() => requireName() && navigate(`/room/${resumable}`)}>
              Resume room <span className="mono">{resumable}</span>
            </button>
          )}
        </div>

        <div className="divider"><span>or join a friend</span></div>

        <form className="join-row" onSubmit={join}>
          <input
            className="mono code-input"
            value={code}
            placeholder="ROOM CODE"
            maxLength={64}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            aria-label="Room code or invite link"
          />
          <button className="btn" type="submit">Join</button>
        </form>

        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      <nav className="home-links">
        <a href="#/editor">🛠 Mod Editor</a>
      </nav>
    </main>
  );
}
