import { useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import type { ModDef } from '../../engine/schema';
import type { RoomView } from '../../net/useRoom';
import { addWithDependencies, builtinMods, removeWithDependents } from '../../content/builtins';
import { listMods, MOD_LIBRARY_KEY, parseModJson, saveMod, subscribeModLibrary, type LibraryEntry } from '../shared/modLibrary';

// listMods() returns a new array each call; cache by raw storage string for useSyncExternalStore.
let cacheKey: string | null = null;
let cacheVal: LibraryEntry[] = [];
function librarySnapshot(): LibraryEntry[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(MOD_LIBRARY_KEY); } catch { /* ignore */ }
  if (raw !== cacheKey) { cacheKey = raw; cacheVal = listMods(); }
  return cacheVal;
}

export function ModsPanel({ room }: { room: RoomView }) {
  const { snapshot, isHost, setMods } = room;
  const mods = snapshot.mods;
  const library = useSyncExternalStore(subscribeModLibrary, librarySnapshot);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const inRoom = new Set(mods.map((m) => m.meta.id));
  const available = library.filter((e) => !inRoom.has(e.mod.meta.id));
  const builtinAvailable = builtinMods.filter((m) => !inRoom.has(m.meta.id));

  const addMod = (mod: ModDef) => {
    if (mod.meta.id === 'base') { setMsg('The base game is always included.'); return; }
    // Mods this one builds on (e.g. a Seafarers scenario needs Seafarers) come along automatically.
    const without = mods.filter((m) => m.meta.id !== mod.meta.id);
    const next = addWithDependencies(without, mod, [...builtinMods, ...library.map((e) => e.mod)]);
    setMods(next);
    const extra = next.filter((m) => m.meta.id !== mod.meta.id && !inRoom.has(m.meta.id)).map((m) => m.meta.name);
    setMsg(`${inRoom.has(mod.meta.id) ? 'Replaced' : 'Added'} ${mod.meta.name}${extra.length ? ` (with ${extra.join(', ')})` : ''}`);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= mods.length) return;
    const next = [...mods];
    [next[i], next[j]] = [next[j], next[i]];
    setMods(next);
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    const added: ModDef[] = [];
    for (const f of files) {
      const res = parseModJson(await f.text());
      if (!res.ok) { setMsg(`${f.name}: ${res.error}`); return; }
      added.push(res.mod);
    }
    if (!added.length) return;
    const ids = new Set(added.map((m) => m.meta.id));
    setMods([...mods.filter((m) => !ids.has(m.meta.id)), ...added]);
    // Keep uploads in the local library too, so they're available next time.
    for (const m of added) { try { saveMod(m); } catch { /* storage full: ignore */ } }
    setMsg(`Added ${added.map((m) => m.meta.name).join(', ')}`);
  };

  const saveToLibrary = (m: ModDef) => {
    try { saveMod(m); setMsg(`Saved ${m.meta.name} to your library`); } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mods">
      <ol className="mod-list">
        <li className="mod-row base">
          <div className="mod-info">
            <strong>Base game</strong>
            <span className="muted small">Always on</span>
          </div>
        </li>
        {mods.map((m, i) => (
          <li key={m.meta.id} className="mod-row">
            <div className="mod-info">
              <strong>{m.meta.name}</strong>
              <span className="muted small">
                v{m.meta.version}{m.meta.author ? ` · by ${m.meta.author}` : ''}
              </span>
              {m.meta.description && <span className="small">{m.meta.description}</span>}
            </div>
            <div className="mod-actions">
              {!library.some((e) => e.mod.meta.id === m.meta.id) && !builtinMods.some((b) => b.meta.id === m.meta.id) && (
                <button className="btn ghost small" title="Save to my library" onClick={() => saveToLibrary(m)}>💾</button>
              )}
              {isHost && (
                <>
                  <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="btn ghost small" disabled={i === mods.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn ghost small danger" onClick={() => setMods(removeWithDependents(mods, m.meta.id))} aria-label="Remove">✕</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {mods.length === 0 && <p className="muted small">No mods — classic rules.</p>}

      {isHost && (
        <div className="mod-add">
          {builtinAvailable.length > 0 && (
            <>
              <h3 className="settings-sub">Expansions &amp; variants</h3>
              <ul className="mod-library">
                {builtinAvailable.map((m) => (
                  <li key={m.meta.id} className="mod-row">
                    <div className="mod-info">
                      <strong>{m.meta.name}</strong>
                      {m.meta.description && <span className="muted small">{m.meta.description}</span>}
                    </div>
                    <button className="btn small" onClick={() => addMod(m)}>Add</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="settings-sub">My mods</h3>
          {available.length > 0 ? (
            <ul className="mod-library">
              {available.map((e) => (
                <li key={e.mod.meta.id} className="mod-row">
                  <div className="mod-info">
                    <strong>{e.mod.meta.name}</strong>
                    <span className="muted small">v{e.mod.meta.version} · saved {new Date(e.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <button className="btn small" onClick={() => addMod(e.mod)}>Add</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              Your mod library is empty. Make one in the <a href="#/editor" target="_blank" rel="noreferrer">Mod Editor</a> or upload a file.
            </p>
          )}
          <div className="row gap">
            <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Upload .json</button>
            <a className="btn ghost" href="#/editor" target="_blank" rel="noreferrer">Open Mod Editor ↗</a>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={onUpload} />
        </div>
      )}
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  );
}
