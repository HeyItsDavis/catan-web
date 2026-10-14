import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LobbyPlayer } from '../../engine/schema';
import type { ChatEntry } from '../../net/client';

export function ChatPanel({ chat, players, you, onSend }: {
  chat: ChatEntry[];
  players: LobbyPlayer[];
  you: string | null;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  const colorOf = (id: string) => players.find((p) => p.id === id)?.color;

  return (
    <div className="chat">
      <div className="chat-log" ref={listRef} aria-live="polite">
        {chat.length === 0 && <p className="muted small center">Say hi 👋</p>}
        {chat.map((c, i) => c.from === 'system' ? (
          <div key={i} className="chat-msg system">{c.text}</div>
        ) : (
          <div key={i} className={`chat-msg ${c.from === you ? 'mine' : ''}`}>
            <span className="chat-name" style={{ color: colorOf(c.from) }}>{c.name}</span>
            <span className="chat-text">{c.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input value={text} maxLength={300} placeholder="Message…" onChange={(e) => setText(e.target.value)} aria-label="Chat message" />
        <button className="btn" type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
