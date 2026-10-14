/**
 * The mod editor. Routed at `#/editor` (no props).
 *
 * Layout: library sidebar | tabs + current tab | validation panel.
 * State: the mod being edited lives in an undo/redo history and autosaves to
 * the local mod library (src/ui/shared/modLibrary.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { baseMod } from '../../content/base/index';
import type { CollectionKey, ModDef } from '../../engine/schema';
import { contextFromDefinition } from '../../editor/describe';
import { createHistory, pushHistory, redo, undo, type History } from '../../editor/history';
import { COLLECTION_KEYS, fullDefinition, parentDefinition } from '../../editor/merge';
import { formatPath, parsePath, slugify, uniqueId } from '../../editor/paths';
import { TEMPLATES, applyTemplate } from '../../editor/templates';
import { validateAll, type Issue } from '../../editor/validate';
import { deleteMod, listModDefs as listMods, saveMod } from '../shared/modLibrary';
import { COLLECTIONS, CollectionTab } from './collection';
import { EditorContext, collectSuggestions, type EditorCtx } from './context';
import { Field, TextArea, TextInput } from './fields';
import { RulesTab } from './rules';
import './editor.css';

type TabKey = 'overview' | CollectionKey | 'rules' | 'json';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  ...COLLECTION_KEYS.map(k => ({ key: k as TabKey, label: COLLECTIONS[k].label })),
  { key: 'rules', label: 'Rules' },
  { key: 'json', label: 'JSON' },
];
const RULE_KEYS = new Set(['victoryPoints', 'discardLimit', 'setup', 'trade', 'dice']);
const CURRENT_KEY = 'catanweb:editor:current';

function newMod(library: ModDef[]): ModDef {
  const id = uniqueId('my-mod', [...library.map(m => m.meta.id), 'base']);
  return { meta: { id, name: 'My mod', version: '0.1.0', extends: ['base'] } };
}

/** Stable per-element key so typing in one input coalesces into one undo step. */
const elementKeys = new WeakMap<Element, string>();
let elementCounter = 0;
function activeEditKey(): string | undefined {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return undefined;
  const typing = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'number', 'search', ''].includes((el as HTMLInputElement).type));
  if (!typing) return undefined;
  if (!elementKeys.has(el)) elementKeys.set(el, `el${++elementCounter}`);
  return elementKeys.get(el);
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

export function ModEditor() {
  const [library, setLibrary] = useState<ModDef[]>(() => listMods());
  const [hist, setHist] = useState<History<ModDef> | null>(() => {
    const lib = listMods();
    const cur = safeGet(CURRENT_KEY);
    const m = lib.find(x => x.meta.id === cur) ?? lib[0];
    return m ? createHistory(m) : null;
  });
  const [storedId, setStoredId] = useState<string | null>(() => hist?.present.meta.id ?? null);
  const [savedJson, setSavedJson] = useState<string>(() => (hist ? JSON.stringify(hist.present) : ''));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [selection, setSelection] = useState<Partial<Record<CollectionKey, number>>>({});
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(true);
  const mod = hist?.present ?? null;
  const dirty = !!mod && JSON.stringify(mod) !== savedJson;

  /* ---------------- library ---------------- */
  const refreshLibrary = () => setLibrary(listMods());
  const open = (m: ModDef) => {
    setHist(createHistory(m));
    setStoredId(m.meta.id);
    setSavedJson(JSON.stringify(m));
    setSaveError(null);
    setSelection({});
    setFocusPath(null);
    safeSet(CURRENT_KEY, m.meta.id);
  };

  /* ---------------- save ---------------- */
  const latest = useRef({ mod, storedId, dirty, library });
  latest.current = { mod, storedId, dirty, library };

  const save = useCallback(() => {
    const { mod: m, storedId: sid } = latest.current;
    if (!m) return;
    const lib = listMods();
    if (!m.meta.id) { setSaveError('Give the mod an id to save it.'); return; }
    if (m.meta.id === 'base') { setSaveError('“base” is reserved. Pick another id to save.'); return; }
    if (m.meta.id !== sid && lib.some(x => x.meta.id === m.meta.id)) {
      setSaveError(`Another mod in your library already uses the id “${m.meta.id}”. Not saved.`);
      return;
    }
    try {
      saveMod(m);
    } catch (e) {
      setSaveError(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (sid && sid !== m.meta.id) deleteMod(sid);
    setStoredId(m.meta.id);
    setSavedJson(JSON.stringify(m));
    setSaveError(null);
    safeSet(CURRENT_KEY, m.meta.id);
    refreshLibrary();
  }, []);

  // Autosave shortly after the last change.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(save, 700);
    return () => clearTimeout(t);
  }, [mod, dirty, save]);

  useEffect(() => {
    const h = () => { if (latest.current.dirty) save(); };
    window.addEventListener('beforeunload', h);
    return () => { window.removeEventListener('beforeunload', h); h(); };
  }, [save]);

  /* ---------------- history ---------------- */
  const commit = useCallback((next: ModDef) => {
    setHist(h => (h ? pushHistory(h, next, activeEditKey()) : h));
  }, []);
  const doUndo = useCallback(() => setHist(h => (h ? undo(h) : h)), []);
  const doRedo = useCallback(() => setHist(h => (h ? redo(h) : h)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const inJson = (e.target as HTMLElement)?.classList?.contains('me-json');
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); save(); return; }
      if (inJson) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo, save]);

  /* ---------------- definitions & context ---------------- */
  const available = useMemo(
    () => [baseMod, ...library.filter(m => m.meta.id !== storedId && m.meta.id !== mod?.meta.id && m.meta.id !== 'base')],
    [library, storedId, mod?.meta.id],
  );
  const ctx: EditorCtx | null = useMemo(() => {
    if (!mod) return null;
    const def = fullDefinition(mod, available);
    const parent = parentDefinition(mod, available);
    return { def, parent, dctx: contextFromDefinition(def), focusPath, suggestions: collectSuggestions(def), library };
  }, [mod, available, focusPath, library]);

  /* ---------------- validation ---------------- */
  const [validation, setValidation] = useState<ReturnType<typeof validateAll>>({ issues: [], engineStatus: 'unavailable' });
  useEffect(() => {
    if (!mod) return;
    const t = setTimeout(() => {
      try {
        setValidation(validateAll(mod, available));
      } catch (e) {
        setValidation({ issues: [{ path: '', message: `Validator crashed: ${(e as Error).message}`, severity: 'error', source: 'editor' }], engineStatus: 'crashed' });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [mod, available]);

  /* ---------------- navigation ---------------- */
  const navigate = (pathStr: string) => {
    if (!mod) return;
    const segs = parsePath(pathStr);
    const head = segs[0];
    if (head === undefined) { setTab('overview'); return; }
    if (head === 'meta') setTab('overview');
    else if (RULE_KEYS.has(String(head))) setTab('rules');
    else if (head === 'remove' && COLLECTION_KEYS.includes(segs[1] as CollectionKey)) setTab(segs[1] as CollectionKey);
    else if (COLLECTION_KEYS.includes(head as CollectionKey)) {
      const k = head as CollectionKey;
      let idx = segs[1];
      if (typeof idx === 'string') {
        // engine may address items by id
        const found = ((mod[k] ?? []) as { id: string }[]).findIndex(x => x.id === idx);
        if (found >= 0) { idx = found; segs[1] = found; }
      }
      setTab(k);
      if (typeof idx === 'number') setSelection(s => ({ ...s, [k]: idx as number }));
    }
    setFocusPath(formatPath(segs));
  };

  // Reveal + flash the field for focusPath (longest existing prefix).
  useLayoutEffect(() => {
    if (!focusPath) return;
    const segs = parsePath(focusPath);
    const t = setTimeout(() => {
      for (let n = segs.length; n > 0; n--) {
        const p = formatPath(segs.slice(0, n));
        const el = document.querySelector(`.mod-editor [data-path="${CSS.escape(p)}"]`) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el.classList.remove('me-flash');
          void el.offsetWidth;
          el.classList.add('me-flash');
          const input = el.querySelector('input, select, textarea') as HTMLElement | null;
          input?.focus({ preventScroll: true });
          break;
        }
      }
    }, 30);
    return () => clearTimeout(t);
  }, [focusPath, tab]);

  /* ---------------- library actions ---------------- */
  const create = (m?: ModDef) => {
    const fresh = m ?? newMod(listMods());
    saveMod(fresh);
    refreshLibrary();
    open(fresh);
    setTab('overview');
  };
  const duplicate = (m: ModDef) => {
    const ids = [...listMods().map(x => x.meta.id), 'base'];
    const copy = structuredClone(m);
    copy.meta.id = uniqueId(`${m.meta.id}-copy`, ids);
    copy.meta.name = `${m.meta.name} (copy)`;
    create(copy);
  };
  const remove = (m: ModDef) => {
    if (!confirm(`Delete “${m.meta.name}” from your library? Export it first if you want a backup.`)) return;
    deleteMod(m.meta.id);
    const lib = listMods();
    setLibrary(lib);
    if (m.meta.id === storedId) {
      if (lib[0]) open(lib[0]);
      else { setHist(null); setStoredId(null); setSavedJson(''); }
    }
  };
  const exportMod = (m: ModDef) => {
    const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.meta.id || 'mod'}-${m.meta.version || '0'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const importFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      alert(`That file isn’t valid JSON: ${(e as Error).message}`);
      return;
    }
    const m = parsed as ModDef;
    if (!m || typeof m !== 'object' || !m.meta || typeof m.meta.id !== 'string') {
      alert('That file doesn’t look like a mod (missing meta.id).');
      return;
    }
    const lib = listMods();
    if (m.meta.id === 'base' || lib.some(x => x.meta.id === m.meta.id)) {
      const replace = m.meta.id !== 'base' && confirm(`A mod with id “${m.meta.id}” already exists. OK = replace it, Cancel = import as a copy.`);
      if (!replace) m.meta.id = uniqueId(`${m.meta.id}-imported`, [...lib.map(x => x.meta.id), 'base']);
    }
    create(m);
  };

  /* ---------------- render ---------------- */
  const errors = validation.issues.filter(i => i.severity === 'error').length;
  const warnings = validation.issues.length - errors;
  const counts = (k: CollectionKey) => ((mod?.[k] ?? []) as unknown[]).length + (mod?.remove?.[k]?.length ?? 0);

  return (
    <div className="mod-editor">
      <aside className="me-library">
        <div className="me-library-head">
          <a href="#/" className="me-home" title="Back to the game">⬡</a>
          <b>Mod library</b>
        </div>
        <div className="me-inline me-wrap">
          <button type="button" className="me-btn me-btn-primary" onClick={() => create()}>＋ New mod</button>
          <button type="button" className="me-btn" onClick={() => fileInput.current?.click()}>Import…</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        </div>
        <div className="me-library-list">
          {library.length === 0 ? <div className="me-empty">No mods yet.</div> : null}
          {library.map(m => {
            const active = m.meta.id === storedId;
            return (
              <div key={m.meta.id} className={`me-lib-item${active ? ' sel' : ''}`}>
                <button type="button" className="me-lib-open" onClick={() => { if (!active) { save(); open(m); } }}>
                  <span className="me-lib-name">{active && mod ? mod.meta.name : m.meta.name}</span>
                  <span className="me-lib-sub me-mono">{m.meta.id} · v{m.meta.version}</span>
                </button>
                <span className="me-lib-actions">
                  <button type="button" className="me-icon-btn" title="Duplicate" onClick={() => duplicate(active && mod ? mod : m)}>⧉</button>
                  <button type="button" className="me-icon-btn" title="Export .json" onClick={() => exportMod(active && mod ? mod : m)}>⤓</button>
                  <button type="button" className="me-icon-btn me-danger" title="Delete" onClick={() => remove(m)}>✕</button>
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {!mod || !ctx ? (
        <main className="me-main me-welcome">
          <h1>Make your own rules</h1>
          <p>Mods change or extend the base game: new resources, buildings, cards, rules and maps. Everything is built from blocks — no code needed.</p>
          <button type="button" className="me-btn me-btn-primary me-btn-big" onClick={() => create()}>＋ Create your first mod</button>
          <p className="me-muted">or import a .json mod from a friend.</p>
        </main>
      ) : (
        <EditorContext.Provider value={ctx}>
          <main className="me-main">
            <header className="me-topbar">
              <div className="me-title">
                <span className="me-title-name">{mod.meta.name || mod.meta.id}</span>
                <span className="me-muted me-mono">{mod.meta.id} v{mod.meta.version}</span>
              </div>
              <span className={`me-save${saveError ? ' err' : dirty ? ' dirty' : ''}`} title={saveError ?? undefined}>
                {saveError ? `⚠ ${saveError}` : dirty ? '● Unsaved changes…' : '✓ Saved'}
              </span>
              <span className="me-spacer" />
              <button type="button" className="me-btn" disabled={!hist?.past.length} onClick={doUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
              <button type="button" className="me-btn" disabled={!hist?.future.length} onClick={doRedo} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
              <button type="button" className="me-btn" onClick={() => exportMod(mod)} title="Download as .json">⤓ Export</button>
              <button type="button" className={`me-btn me-issues-btn${errors ? ' has-errors' : warnings ? ' has-warnings' : ' ok'}`} onClick={() => setShowIssues(!showIssues)}>
                {errors ? `✕ ${errors} error${errors === 1 ? '' : 's'}` : warnings ? `⚠ ${warnings} warning${warnings === 1 ? '' : 's'}` : '✓ No problems'}
              </button>
            </header>
            <nav className="me-tabs">
              {TABS.map(t => {
                const n = COLLECTION_KEYS.includes(t.key as CollectionKey) ? counts(t.key as CollectionKey) : 0;
                const tabErrors = validation.issues.filter(i => i.severity === 'error' && tabOfPath(i.path) === t.key).length;
                return (
                  <button key={t.key} type="button" className={`me-tab${tab === t.key ? ' sel' : ''}`} onClick={() => { setTab(t.key); setFocusPath(null); }}>
                    {t.label}
                    {n ? <span className="me-tab-count">{n}</span> : null}
                    {tabErrors ? <span className="me-tab-err" title={`${tabErrors} errors`}>!</span> : null}
                  </button>
                );
              })}
            </nav>
            <div className="me-body">
              <div className="me-content">
                {tab === 'overview' ? <OverviewTab mod={mod} onChange={commit} library={library} goTo={setTab} select={(k, i) => { setTab(k); setSelection(s => ({ ...s, [k]: i })); }} /> : null}
                {COLLECTION_KEYS.includes(tab as CollectionKey) ? (
                  <CollectionTab k={tab as CollectionKey} mod={mod} onChange={commit}
                    selected={selection[tab as CollectionKey]} onSelect={i => setSelection(s => ({ ...s, [tab]: i }))} />
                ) : null}
                {tab === 'rules' ? <RulesTab mod={mod} onChange={commit} /> : null}
                {tab === 'json' ? <JsonTab mod={mod} onChange={commit} /> : null}
              </div>
              {showIssues ? <IssuesPanel issues={validation.issues} engineStatus={validation.engineStatus} engineError={validation.engineError} onPick={navigate} onClose={() => setShowIssues(false)} /> : null}
            </div>
          </main>
        </EditorContext.Provider>
      )}
    </div>
  );
}

export default ModEditor;

function tabOfPath(path: string): TabKey | undefined {
  const head = parsePath(path)[0];
  if (head === undefined || head === 'meta') return 'overview';
  if (RULE_KEYS.has(String(head))) return 'rules';
  if (head === 'remove') return parsePath(path)[1] as TabKey;
  if (COLLECTION_KEYS.includes(head as CollectionKey)) return head as TabKey;
  return undefined;
}

/* ======================================================================== */

function OverviewTab(props: {
  mod: ModDef; onChange(m: ModDef): void; library: ModDef[]; goTo(t: TabKey): void; select(k: CollectionKey, i: number): void;
}) {
  const { mod, onChange } = props;
  const meta = mod.meta;
  const setMeta = (m: Partial<ModDef['meta']>) => onChange({ ...mod, meta: { ...meta, ...m } });
  const extendsList = meta.extends ?? [];
  const choices = ['base', ...props.library.map(m => m.meta.id).filter(id => id !== meta.id)];
  const idFollows = meta.id === slugify(meta.name ?? '');
  return (
    <div className="me-form me-overview">
      <section className="me-section">
        <header className="me-section-head"><h3>About this mod</h3></header>
        <div className="me-form-grid">
          <Field label="Name" path={['meta', 'name']}>
            <TextInput value={meta.name} onChange={name => setMeta({ name, ...(idFollows ? { id: slugify(name) } : {}) })} />
          </Field>
          <Field label="Id" path={['meta', 'id']} help="Unique id. Rooms and other mods refer to your mod by this." aside={idFollows ? <span className="me-muted">auto</span> : null}>
            <TextInput value={meta.id} onChange={id => setMeta({ id })} mono invalid={!meta.id || meta.id === 'base'} />
          </Field>
          <Field label="Version" path={['meta', 'version']}><TextInput value={meta.version} onChange={version => setMeta({ version })} mono placeholder="0.1.0" /></Field>
          <Field label="Author" path={['meta', 'author']}><TextInput value={meta.author} onChange={author => setMeta({ author: author || undefined })} /></Field>
        </div>
        <Field label="Description" path={['meta', 'description']} wide>
          <TextArea value={meta.description} onChange={d => setMeta({ description: d || undefined })} rows={3} placeholder="What does this variant change? Players see this in the lobby." />
        </Field>
        <Field label="Builds on" path={['meta', 'extends']} wide help="Mods applied before this one, in order. Almost always just the base game.">
          <div className="me-chips">
            {extendsList.map((id, i) => (
              <span key={id} className="me-chip on" data-path={formatPath(['meta', 'extends', i])}>
                {id === 'base' ? 'Base game' : props.library.find(m => m.meta.id === id)?.meta.name ?? `⚠ ${id}`}
                <button type="button" className="me-icon-btn" onClick={() => setMeta({ extends: extendsList.filter(x => x !== id) })}>×</button>
              </span>
            ))}
            {choices.filter(c => !extendsList.includes(c)).map(c => (
              <button key={c} type="button" className="me-chip me-chip-add" onClick={() => setMeta({ extends: [...extendsList, c] })}>
                ＋ {c === 'base' ? 'Base game' : props.library.find(m => m.meta.id === c)?.meta.name ?? c}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section className="me-section">
        <header className="me-section-head"><h3>Start from a template</h3><span className="me-hint">Ready-made, working starting points. Tweak from there.</span></header>
        <div className="me-templates">
          {TEMPLATES.map(t => (
            <button key={t.id} type="button" className="me-template" onClick={() => {
              const ctx = { def: fullDefinition(mod, [baseMod, ...props.library.filter(m => m.meta.id !== mod.meta.id)]), mod };
              const res = t.make(ctx);
              const next = applyTemplate(mod, res);
              onChange(next);
              props.select(res.focus.collection, ((next[res.focus.collection] ?? []) as { id: string }[]).findIndex(x => x.id === res.focus.id));
            }}>
              <b>✦ {t.label}</b>
              <span>{t.description}</span>
              <span className="me-muted">→ {COLLECTIONS[t.collection].label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="me-section">
        <header className="me-section-head"><h3>What this mod changes</h3></header>
        <div className="me-summary">
          {COLLECTION_KEYS.map(k => {
            const own = ((mod[k] ?? []) as unknown[]).length;
            const rem = mod.remove?.[k]?.length ?? 0;
            return (
              <button key={k} type="button" className={`me-summary-item${own || rem ? ' on' : ''}`} onClick={() => props.goTo(k)}>
                <b>{COLLECTIONS[k].label}</b>
                <span>{own ? `${own} added/changed` : 'unchanged'}{rem ? ` · ${rem} removed` : ''}</span>
              </button>
            );
          })}
          <button type="button" className={`me-summary-item${['victoryPoints', 'discardLimit', 'setup', 'trade', 'dice'].some(k => (mod as unknown as Record<string, unknown>)[k] !== undefined) ? ' on' : ''}`} onClick={() => props.goTo('rules')}>
            <b>Rules</b><span>VP, discard limit, setup, trading, dice</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ======================================================================== */

function JsonTab(props: { mod: ModDef; onChange(m: ModDef): void }) {
  const pretty = useMemo(() => JSON.stringify(props.mod, null, 2), [props.mod]);
  const [text, setText] = useState(pretty);
  const [edited, setEdited] = useState(false);
  useEffect(() => { if (!edited) setText(pretty); }, [pretty, edited]);
  let error: string | null = null;
  let parsed: ModDef | null = null;
  try {
    const p = JSON.parse(text) as ModDef;
    if (!p || typeof p !== 'object' || !p.meta || typeof p.meta.id !== 'string') error = 'A mod needs a "meta" object with an "id".';
    else parsed = p;
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="me-form me-json-tab">
      <div className="me-form-toolbar">
        <h2>Raw JSON</h2>
        <span className="me-hint">For power users. Changes apply when you press Apply (undo works).</span>
        <span className="me-spacer" />
        {error ? <span className="me-warn-text">⚠ {error}</span> : edited ? <span className="me-muted">Valid JSON</span> : null}
        <button type="button" className="me-btn" disabled={!edited} onClick={() => { setText(pretty); setEdited(false); }}>Discard</button>
        <button type="button" className="me-btn me-btn-primary" disabled={!edited || !parsed} onClick={() => { if (parsed) { props.onChange(parsed); setEdited(false); } }}>Apply</button>
      </div>
      <textarea className={`me-json me-mono${error ? ' me-invalid' : ''}`} spellCheck={false} value={text}
        onChange={e => { setText(e.target.value); setEdited(true); }} />
    </div>
  );
}

/* ======================================================================== */

function IssuesPanel(props: {
  issues: Issue[]; engineStatus: 'ok' | 'unavailable' | 'crashed'; engineError?: string; onPick(path: string): void; onClose(): void;
}) {
  const [showWarnings, setShowWarnings] = useState(true);
  const list = props.issues.filter(i => showWarnings || i.severity === 'error')
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return (
    <aside className="me-issues">
      <div className="me-issues-head">
        <b>Problems</b>
        <label className="me-check"><input type="checkbox" checked={showWarnings} onChange={e => setShowWarnings(e.target.checked)} /> warnings</label>
        <span className="me-spacer" />
        <button type="button" className="me-icon-btn" onClick={props.onClose} title="Hide">×</button>
      </div>
      <div className="me-issues-engine me-muted">
        {props.engineStatus === 'ok' ? 'Checked by the game engine and the editor.'
          : props.engineStatus === 'crashed' ? `Engine validator failed (${props.engineError ?? 'unknown error'}); showing editor checks only.`
            : 'Engine validator not available yet; showing editor checks only.'}
      </div>
      {list.length === 0 ? <div className="me-empty">✓ No problems found.</div> : null}
      {list.map((i, n) => (
        <button key={n} type="button" className={`me-issue me-issue-${i.severity}`} onClick={() => props.onPick(i.path)} title="Show me">
          <span className="me-issue-icon">{i.severity === 'error' ? '✕' : '⚠'}</span>
          <span className="me-issue-body">
            <span>{i.message}</span>
            <span className="me-issue-path me-mono">{i.path || '(mod)'}{i.source === 'engine' ? ' · engine' : ''}</span>
          </span>
        </button>
      ))}
    </aside>
  );
}
