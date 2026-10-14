import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { getSavedName, saveName } from '../../net/identity';
import { sanitizeName } from '../../net/lobby';
import { isValidRoomCode } from '../../net/roomCode';
import { useRoom, type RoomView } from '../../net/useRoom';
import { GameScreen } from '../slots';
import { LobbyScreen } from './LobbyScreen';
import './lobby.css';

export function RoomPage({ code }: { code: string }) {
  const [name, setName] = useState(getSavedName);
  if (!isValidRoomCode(code)) {
    return (
      <CenterCard title="Invalid room code">
        <p className="muted"><span className="mono">{code}</span> isn't a valid room code.</p>
        <a className="btn primary" href="#/">Go home</a>
      </CenterCard>
    );
  }
  if (!sanitizeName(name)) return <NamePrompt code={code} onDone={setName} />;
  return <Room code={code} />;
}

function Room({ code }: { code: string }) {
  const room = useRoom(code);
  const { snapshot, def } = room;
  const { status } = snapshot;

  if (status === 'kicked') {
    return (
      <CenterCard title={/closed/i.test(snapshot.error?.message ?? '') ? 'Room closed' : 'Removed from room'}>
        <p className="muted">{snapshot.error?.message ?? 'The host removed you from this room.'}</p>
        <a className="btn primary" href="#/">Go home</a>
      </CenterCard>
    );
  }

  if (!snapshot.settings) {
    if (status === 'failed') {
      return (
        <CenterCard title="Couldn't join room">
          <p className="muted">{snapshot.error?.message ?? 'The room could not be reached.'}</p>
          <div className="row gap">
            <button className="btn primary" onClick={room.retry}>Try again</button>
            <a className="btn" href="#/">Go home</a>
          </div>
        </CenterCard>
      );
    }
    return (
      <CenterCard title={`Joining ${code}…`}>
        <div className="spinner" aria-hidden />
        <p className="muted">
          {snapshot.attempt > 0 ? `Attempt ${snapshot.attempt + 1} — ${snapshot.error?.message ?? ''}` : 'Connecting to the host'}
        </p>
        <a className="btn ghost" href="#/">Cancel</a>
      </CenterCard>
    );
  }

  const inGame = snapshot.started && snapshot.game && def && snapshot.you;
  return (
    <>
      <ConnectionBanner room={room} />
      <Toast room={room} />
      {inGame ? <GameView room={room} /> : <LobbyScreen room={room} code={code} />}
    </>
  );
}

function GameView({ room }: { room: RoomView }) {
  const { snapshot } = room;
  const chat = useMemo(
    () => snapshot.chat.map((c) => ({ from: c.name, text: c.text, at: c.at })),
    [snapshot.chat],
  );
  return (
    <div className="game-wrap">
      <GameScreen
        def={room.def!}
        state={snapshot.game!}
        playerId={snapshot.you!}
        send={room.send}
        chat={chat}
        sendChat={room.sendChat}
        timer={snapshot.timer}
      />
    </div>
  );
}

function ConnectionBanner({ room }: { room: RoomView }) {
  const { status, attempt } = room.snapshot;
  const net = room.hostNet;
  if (room.role === 'host' && net.status !== 'online') {
    return (
      <div className={`banner ${net.status === 'error' ? 'bad' : 'warn'}`}>
        {net.status === 'starting' ? 'Opening room to the internet…' : net.message}
      </div>
    );
  }
  if (status === 'reconnecting' || status === 'connecting') {
    return <div className="banner warn">Connection lost — reconnecting{attempt > 1 ? ` (attempt ${attempt})` : ''}…</div>;
  }
  if (status === 'failed') {
    return (
      <div className="banner bad">
        Disconnected: {room.snapshot.error?.message} <button className="btn small" onClick={room.retry}>Retry</button>
      </div>
    );
  }
  return null;
}

function Toast({ room }: { room: RoomView }) {
  const err = room.snapshot.error;
  const { clearError } = room;
  const connected = room.snapshot.status === 'connected';
  useEffect(() => {
    // Only auto-dismiss toasts; while disconnected the error is the banner's explanation.
    if (!err || !connected) return;
    const id = setTimeout(clearError, 4000);
    return () => clearTimeout(id);
  }, [err, clearError, connected]);
  if (!err || !connected) return null;
  return (
    <div className="toast" role="alert" onClick={clearError}>
      {err.message}
    </div>
  );
}

function NamePrompt({ code, onDone }: { code: string; onDone: (n: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = sanitizeName(value);
    if (!n) return;
    saveName(n);
    onDone(n);
  };
  return (
    <CenterCard title={`Join room ${code}`}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Your name</span>
          <input value={value} maxLength={20} autoFocus onChange={(e) => setValue(e.target.value)} placeholder="e.g. Ada" />
        </label>
        <button className="btn primary" type="submit" disabled={!sanitizeName(value)}>Join</button>
      </form>
    </CenterCard>
  );
}

function CenterCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="center-page">
      <div className="card narrow stack">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
