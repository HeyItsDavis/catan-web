/** Primitive form controls for the mod editor. */
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { GameDefinition } from '../../engine/schema';
import { formatPath, type Path } from '../../editor/paths';
import { useEditor } from './context';

export function Field(props: {
  label: string;
  path?: Path;
  help?: string;
  children: ReactNode;
  wide?: boolean;
  /** Shown to the right of the label (e.g. "inherits 10"). */
  aside?: ReactNode;
}) {
  return (
    <div className={`me-field${props.wide ? ' me-field-wide' : ''}`} data-path={props.path ? formatPath(props.path) : undefined}>
      <div className="me-field-label">
        <span title={props.help}>{props.label}{props.help ? <span className="me-help" title={props.help}>?</span> : null}</span>
        {props.aside}
      </div>
      <div className="me-field-control">{props.children}</div>
    </div>
  );
}

export function TextInput(props: { value: string | undefined; onChange(v: string): void; placeholder?: string; mono?: boolean; className?: string; list?: string; invalid?: boolean; title?: string }) {
  return (
    <input
      type="text"
      className={`me-input${props.mono ? ' me-mono' : ''}${props.invalid ? ' me-invalid' : ''} ${props.className ?? ''}`}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      list={props.list}
      title={props.title}
      onChange={e => props.onChange(e.target.value)}
    />
  );
}

export function TextArea(props: { value: string | undefined; onChange(v: string): void; rows?: number; placeholder?: string }) {
  return (
    <textarea className="me-input me-textarea" rows={props.rows ?? 3} value={props.value ?? ''} placeholder={props.placeholder}
      onChange={e => props.onChange(e.target.value)} />
  );
}

/** Number input that tolerates intermediate text like "-" while typing. */
export function NumberInput(props: { value: number | undefined; onChange(v: number | undefined): void; min?: number; max?: number; step?: number; placeholder?: string; small?: boolean; allowEmpty?: boolean }) {
  const [text, setText] = useState(props.value === undefined ? '' : String(props.value));
  useEffect(() => {
    if (Number(text) !== props.value || (text === '' && props.value !== undefined)) setText(props.value === undefined ? '' : String(props.value));
  }, [props.value]);
  return (
    <input
      type="number"
      className={`me-input me-number${props.small ? ' me-small' : ''}`}
      value={text}
      min={props.min}
      max={props.max}
      step={props.step}
      placeholder={props.placeholder}
      onChange={e => {
        setText(e.target.value);
        if (e.target.value === '') { if (props.allowEmpty) props.onChange(undefined); return; }
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) props.onChange(n);
      }}
    />
  );
}

export function Checkbox(props: { value: boolean | undefined; onChange(v: boolean): void; label?: string; title?: string }) {
  return (
    <label className="me-check" title={props.title}>
      <input type="checkbox" checked={!!props.value} onChange={e => props.onChange(e.target.checked)} />
      {props.label ? <span>{props.label}</span> : null}
    </label>
  );
}

export interface Opt { value: string; label: string; group?: string; title?: string }

export function Select(props: { value: string | undefined; options: Opt[]; onChange(v: string): void; placeholder?: string; invalid?: boolean; className?: string; title?: string }) {
  const known = props.options.some(o => o.value === props.value);
  const groups = new Map<string, Opt[]>();
  for (const o of props.options) {
    const g = o.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  return (
    <select
      className={`me-input me-select${props.invalid || (props.value && !known) ? ' me-invalid' : ''} ${props.className ?? ''}`}
      value={props.value ?? ''}
      title={props.title}
      onChange={e => props.onChange(e.target.value)}
    >
      {!props.value || !known ? (
        <option value={props.value ?? ''}>{props.value ? `⚠ ${props.value} (missing)` : (props.placeholder ?? '— pick —')}</option>
      ) : null}
      {[...groups.entries()].map(([g, opts]) =>
        g ? (
          <optgroup key={g} label={g}>{opts.map(o => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)}</optgroup>
        ) : (
          opts.map(o => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)
        ),
      )}
    </select>
  );
}

export type RefCollection = 'resources' | 'terrains' | 'pieces' | 'cards' | 'decks' | 'tokens' | 'settings' | 'actions' | 'ports' | 'awards';

export function refOptions(def: GameDefinition, coll: RefCollection): Opt[] {
  return ((def[coll] ?? []) as { id: string; name?: string }[]).map(x => ({
    value: x.id,
    label: x.name ? `${x.name}` : x.id,
    title: x.id,
  }));
}

/** Dropdown of ids from the merged definition (base + this mod). */
export function RefSelect(props: { collection: RefCollection; value: string | undefined; onChange(v: string): void; extra?: Opt[]; placeholder?: string; filter?: (item: { id: string }) => boolean }) {
  const { def } = useEditor();
  let opts = refOptions(def, props.collection);
  if (props.filter) {
    const list = (def[props.collection] ?? []) as { id: string }[];
    const allowed = new Set(list.filter(props.filter).map(x => x.id));
    opts = opts.filter(o => allowed.has(o.value));
  }
  if (opts.length === 0 && !props.extra?.length) {
    // Nothing to pick from (e.g. empty base): fall back to typing an id.
    return <TextInput value={props.value} onChange={props.onChange} placeholder={`${props.collection.slice(0, -1)} id`} mono />;
  }
  return <Select value={props.value} options={[...(props.extra ?? []), ...opts]} onChange={props.onChange} placeholder={props.placeholder} />;
}

/** Toggle chips for picking several ids. */
export function MultiRef(props: { collection: RefCollection; value: string[] | undefined; onChange(v: string[]): void }) {
  const { def } = useEditor();
  const opts = refOptions(def, props.collection);
  const value = props.value ?? [];
  const unknown = value.filter(v => !opts.some(o => o.value === v));
  const [adding, setAdding] = useState('');
  return (
    <div className="me-chips">
      {opts.map(o => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className={`me-chip${on ? ' on' : ''}`} title={o.value}
            onClick={() => props.onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])}>
            {o.label}
          </button>
        );
      })}
      {unknown.map(u => (
        <button key={u} type="button" className="me-chip on me-chip-bad" title="Not defined — click to remove" onClick={() => props.onChange(value.filter(v => v !== u))}>⚠ {u} ×</button>
      ))}
      {opts.length === 0 ? (
        <span className="me-inline">
          <TextInput value={adding} onChange={setAdding} placeholder="id" mono className="me-small" />
          <button type="button" className="me-btn me-btn-small" onClick={() => { if (adding) { props.onChange([...value, adding]); setAdding(''); } }}>Add</button>
        </span>
      ) : null}
    </div>
  );
}

/** Free text with suggestions. */
export function SuggestInput(props: { value: string | undefined; onChange(v: string): void; suggestions: string[]; placeholder?: string; mono?: boolean; invalid?: boolean; title?: string }) {
  const id = useId();
  return (
    <>
      <TextInput value={props.value} onChange={props.onChange} list={id} placeholder={props.placeholder} mono={props.mono} invalid={props.invalid} title={props.title} />
      <datalist id={id}>{props.suggestions.map(s => <option key={s} value={s} />)}</datalist>
    </>
  );
}

export function ColorInput(props: { value: string | undefined; onChange(v: string): void }) {
  const v = props.value ?? '#888888';
  const isHex = /^#[0-9a-f]{6}$/i.test(v);
  return (
    <span className="me-inline">
      <input type="color" className="me-color" value={isHex ? v : '#888888'} onChange={e => props.onChange(e.target.value)} />
      <TextInput value={props.value} onChange={props.onChange} mono className="me-small" />
    </span>
  );
}

/** Comma-separated list of strings. */
export function ListInput(props: { value: string[] | undefined; onChange(v: string[] | undefined): void; placeholder?: string }) {
  const [text, setText] = useState((props.value ?? []).join(', '));
  useEffect(() => {
    const parsed = text.split(',').map(s => s.trim()).filter(Boolean);
    if (parsed.join(',') !== (props.value ?? []).join(',')) setText((props.value ?? []).join(', '));
  }, [props.value]);
  return (
    <TextInput value={text} placeholder={props.placeholder ?? 'a, b, c'} onChange={t => {
      setText(t);
      const parsed = t.split(',').map(s => s.trim()).filter(Boolean);
      props.onChange(parsed.length ? parsed : undefined);
    }} />
  );
}

/** Comma-separated list of numbers. */
export function NumbersInput(props: { value: number[] | undefined; onChange(v: number[]): void; placeholder?: string }) {
  const [text, setText] = useState((props.value ?? []).join(', '));
  useEffect(() => {
    const parsed = text.split(/[,\s]+/).filter(Boolean).map(Number);
    if (parsed.join(',') !== (props.value ?? []).join(',')) setText((props.value ?? []).join(', '));
  }, [props.value]);
  const bad = text.split(/[,\s]+/).filter(Boolean).some(s => Number.isNaN(Number(s)));
  return (
    <TextInput value={text} invalid={bad} placeholder={props.placeholder ?? '2, 3, 4'} onChange={t => {
      setText(t);
      const parts = t.split(/[,\s]+/).filter(Boolean);
      if (parts.every(s => !Number.isNaN(Number(s)))) props.onChange(parts.map(Number));
    }} />
  );
}

/** Small key → number table (initialState, bankRates). */
export function NumberMap(props: { value: Record<string, number> | undefined; onChange(v: Record<string, number> | undefined): void; keyPlaceholder?: string; suggestions?: string[] }) {
  const value = props.value ?? {};
  const [newKey, setNewKey] = useState('');
  const set = (next: Record<string, number>) => props.onChange(Object.keys(next).length ? next : undefined);
  return (
    <div className="me-kv">
      {Object.entries(value).map(([k, n]) => (
        <div key={k} className="me-kv-row">
          <span className="me-mono me-kv-key">{k}</span>
          <NumberInput value={n} small onChange={v => set({ ...value, [k]: v ?? 0 })} />
          <button type="button" className="me-icon-btn" title="Remove" onClick={() => { const c = { ...value }; delete c[k]; set(c); }}>×</button>
        </div>
      ))}
      <div className="me-kv-row">
        <SuggestInput value={newKey} onChange={setNewKey} suggestions={props.suggestions ?? []} placeholder={props.keyPlaceholder ?? 'key'} mono />
        <button type="button" className="me-btn me-btn-small" disabled={!newKey || newKey in value}
          onClick={() => { set({ ...value, [newKey]: 0 }); setNewKey(''); }}>Add</button>
      </div>
    </div>
  );
}

/** A section with a heading and optional actions. */
export function Section(props: { title: string; children: ReactNode; actions?: ReactNode; hint?: string; path?: Path }) {
  return (
    <section className="me-section" data-path={props.path ? formatPath(props.path) : undefined}>
      <header className="me-section-head">
        <h3>{props.title}</h3>
        {props.hint ? <span className="me-hint">{props.hint}</span> : null}
        <span className="me-spacer" />
        {props.actions}
      </header>
      <div className="me-section-body">{props.children}</div>
    </section>
  );
}
