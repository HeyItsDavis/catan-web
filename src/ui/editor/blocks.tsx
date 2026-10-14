/**
 * Visual block editor for Effect[] / Condition / Expr trees. Entirely driven by
 * the block catalog (src/editor/catalog.ts): adding an op to the catalog makes
 * it appear here with a working form.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Condition, Effect, Expr, LocationChoice, PieceQuery, PlayerRef, ResourceMap, TurnPhase } from '../../engine/schema';
import {
  COMPARE_OPS, CONDITIONS, CONDITION_CATEGORIES, EFFECTS, EFFECT_CATEGORIES, EVENTS, EXPRS, EXPR_CATEGORIES, LOCATION_KINDS,
  TURN_PHASES, blockList, conditionSpec, defaultForParam, effectSpec, exprSpec, paramPathSegments, readParams, writeParams,
  type BlockSpec, type Category, type ConditionKind, type ExprKind, type ParamSpec, type VarType,
} from '../../editor/catalog';
import { describeCondition, describeEffect, describeEffects, describeExpr } from '../../editor/describe';
import { formatPath, type Path } from '../../editor/paths';
import { atScope, candidateScope, innerScope, loopVarsOf, mergeScope, scopeAt, varsOfType, type VarInfo } from '../../editor/vars';
import { useEditor } from './context';
import { Checkbox, MultiRef, NumberInput, NumberMap, NumbersInput, RefSelect, Select, SuggestInput, TextInput, type Opt } from './fields';

type Family = 'effect' | 'condition' | 'expr';

const catClass = (c: Category) => `me-cat-${c.toLowerCase().replace(/\s+/g, '-')}`;

/* ======================================================================== */
/*  Block menu (searchable, grouped)                                        */
/* ======================================================================== */

interface WrapOption { key: string; label: string; description: string }

export function BlockMenu(props: {
  family: Family;
  onPick(key: string): void;
  onClose(): void;
  wraps?: WrapOption[];
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  const cats = props.family === 'effect' ? EFFECT_CATEGORIES : props.family === 'condition' ? CONDITION_CATEGORIES : EXPR_CATEGORIES;
  const needle = q.trim().toLowerCase();
  const blocks = blockList(props.family).filter(b =>
    !needle || b.label.toLowerCase().includes(needle) || b.description.toLowerCase().includes(needle) || b.key.toLowerCase().includes(needle));
  const ordered = cats.flatMap(c => blocks.filter(b => b.category === c));
  return (
    <div className="me-menu" ref={ref} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose(); } }}>
      <input
        autoFocus
        className="me-input me-menu-search"
        placeholder={`Search ${props.family === 'effect' ? 'steps' : props.family === 'condition' ? 'checks' : 'formulas'}…`}
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && ordered[0]) props.onPick(ordered[0].key); }}
      />
      <div className="me-menu-list">
        {props.wraps && !needle ? (
          <div className="me-menu-group">
            <div className="me-menu-cat">Wrap current in…</div>
            {props.wraps.map(w => (
              <button key={w.key} type="button" className="me-menu-item" onClick={() => props.onPick(w.key)}>
                <b>{w.label}</b><span>{w.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {cats.map(cat => {
          const items = blocks.filter(b => b.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} className="me-menu-group">
              <div className={`me-menu-cat ${catClass(cat)}`}>{cat}</div>
              {items.map(b => (
                <button key={b.key} type="button" className="me-menu-item" onClick={() => props.onPick(b.key)}>
                  <b>{b.label}</b><span>{b.description}</span>
                </button>
              ))}
            </div>
          );
        })}
        {ordered.length === 0 ? <div className="me-empty">No blocks match “{q}”.</div> : null}
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Effect lists                                                            */
/* ======================================================================== */

let dragging: { list: string; index: number } | null = null;

export function EffectList(props: { value: Effect[] | undefined; onChange(v: Effect[]): void; path: Path; scope: VarInfo[]; emptyHint?: string }) {
  const list = Array.isArray(props.value) ? props.value : [];
  const listKey = formatPath(props.path);
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const update = (next: Effect[]) => props.onChange(next);
  const insert = (i: number, e: Effect) => update([...list.slice(0, i), e, ...list.slice(i)]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    update(next);
  };
  return (
    <div className="me-effects" data-path={listKey}>
      {list.length === 0 ? <div className="me-empty">{props.emptyHint ?? 'No steps yet.'}</div> : null}
      {list.map((e, i) => (
        <div
          key={i}
          className={`me-effect-slot${dropAt === i ? ' me-drop-target' : ''}`}
          onDragOver={ev => { if (dragging?.list === listKey) { ev.preventDefault(); ev.stopPropagation(); setDropAt(i); } }}
          onDragLeave={() => setDropAt(d => (d === i ? null : d))}
          onDrop={ev => {
            if (dragging?.list !== listKey) return;
            ev.preventDefault(); ev.stopPropagation();
            move(dragging.index, i);
            dragging = null; setDropAt(null);
          }}
        >
          <EffectBlock
            value={e}
            onChange={v => update(list.map((x, j) => (j === i ? v : x)))}
            path={[...props.path, i]}
            scope={scopeAt(list, i, props.scope)}
            onDragStart={() => { dragging = { list: listKey, index: i }; }}
            toolbar={
              <>
                <button type="button" className="me-icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button type="button" className="me-icon-btn" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                <button type="button" className="me-icon-btn" title="Duplicate" onClick={() => insert(i + 1, structuredClone(e))}>⧉</button>
                <span className="me-menu-anchor">
                  <button type="button" className="me-icon-btn" title="Insert a step after this one" onClick={() => setMenuAt(i + 1)}>＋</button>
                  {menuAt === i + 1 && i !== list.length - 1 ? (
                    <BlockMenu family="effect" onClose={() => setMenuAt(null)} onPick={k => { insert(i + 1, (EFFECTS as unknown as Record<string, BlockSpec<Effect>>)[k].make()); setMenuAt(null); }} />
                  ) : null}
                </span>
                <button type="button" className="me-icon-btn me-danger" title="Delete step" onClick={() => update(list.filter((_, j) => j !== i))}>✕</button>
              </>
            }
          />
        </div>
      ))}
      <div className="me-menu-anchor">
        <button type="button" className="me-add-btn" onClick={() => setMenuAt(list.length)}>＋ Add step</button>
        {menuAt === list.length ? (
          <BlockMenu family="effect" onClose={() => setMenuAt(null)} onPick={k => { insert(list.length, (EFFECTS as unknown as Record<string, BlockSpec<Effect>>)[k].make()); setMenuAt(null); }} />
        ) : null}
      </div>
    </div>
  );
}

function useAutoOpen(path: Path): boolean {
  const { focusPath } = useEditor();
  const p = formatPath(path);
  return !!focusPath && focusPath.startsWith(p) && focusPath !== p;
}

export function EffectBlock(props: { value: Effect; onChange(v: Effect): void; path: Path; scope: VarInfo[]; toolbar?: ReactNode; onDragStart?(): void }) {
  const { dctx } = useEditor();
  const [collapsed, setCollapsed] = useState(false);
  const forceOpen = useAutoOpen(props.path);
  const open = !collapsed || forceOpen;
  const spec = effectSpec(props.value);
  if (!spec) {
    return (
      <div className="me-block me-block-unknown" data-path={formatPath(props.path)}>
        <div className="me-block-head">
          <span className="me-block-title">Unknown step “{String((props.value as { op?: string })?.op)}”</span>
          <span className="me-spacer" />{props.toolbar}
        </div>
        <pre className="me-mono me-pre">{JSON.stringify(props.value, null, 2)}</pre>
      </div>
    );
  }
  return (
    <div className={`me-block ${catClass(spec.category)}`} data-path={formatPath(props.path)}>
      <div className="me-block-head" draggable onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', spec.key); props.onDragStart?.(); }}>
        <span className="me-drag" title="Drag to reorder">⠿</span>
        <button type="button" className="me-icon-btn" onClick={() => setCollapsed(!open)} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
        <span className="me-block-title" title={spec.description}>{spec.label}</span>
        {!open ? <span className="me-block-summary">{describeEffect(props.value, dctx)}</span> : <span className="me-block-desc">{spec.description}</span>}
        <span className="me-spacer" />
        {props.toolbar}
      </div>
      {open && spec.params.length ? (
        <BlockParams spec={spec as BlockSpec<unknown>} node={props.value} onChange={v => props.onChange(v as Effect)} path={props.path} scope={props.scope} effect={props.value} />
      ) : null}
    </div>
  );
}

/* ======================================================================== */
/*  Params                                                                  */
/* ======================================================================== */

const BIG_KINDS = new Set(['effects', 'options', 'conditionList', 'exprList', 'resourceMap', 'pieceQuery', 'locationChoice', 'exprMap', 'condition']);

function isBig(p: ParamSpec, value: unknown): boolean {
  if (BIG_KINDS.has(p.kind)) return true;
  if (p.kind === 'expr' && value && typeof value === 'object') return true;
  return false;
}

export function BlockParams(props: {
  spec: BlockSpec<unknown>;
  node: unknown;
  onChange(v: unknown): void;
  path: Path;
  scope: VarInfo[];
  effect?: Effect;
  inline?: boolean;
}) {
  const { spec, node } = props;
  const values = readParams(spec, node);
  const set = (name: string, v: unknown) => props.onChange(writeParams(spec, { ...values, [name]: v }, node));
  const shown = spec.params.filter(p => values[p.name] !== undefined || !p.optional || p.kind === 'boolean');
  const hidden = spec.params.filter(p => !shown.includes(p));
  const small = props.inline ? shown : shown.filter(p => !isBig(p, values[p.name]));
  const big = props.inline ? [] : shown.filter(p => isBig(p, values[p.name]));
  const field = (p: ParamSpec) => {
    const pp = [...props.path, ...paramPathSegments(spec, p.name)];
    const s = props.effect ? innerScope(props.effect, p.name, props.scope) : mergeScope(props.scope, loopVarsOf(props.spec, values));
    return (
      <ParamRow key={p.name} p={p} value={values[p.name]} onChange={v => set(p.name, v)} path={pp} scope={s} big={isBig(p, values[p.name]) && !props.inline} />
    );
  };
  return (
    <div className={props.inline ? 'me-params-inline' : 'me-params'}>
      {small.length ? <div className="me-param-row">{small.map(field)}</div> : null}
      {big.map(field)}
      {hidden.length ? (
        <div className="me-more">
          {hidden.map(p => (
            <button key={p.name} type="button" className="me-chip me-chip-add" title={p.help} onClick={() => set(p.name, defaultForParam(p))}>＋ {p.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ParamRow(props: { p: ParamSpec; value: unknown; onChange(v: unknown): void; path: Path; scope: VarInfo[]; big: boolean }) {
  const { p } = props;
  const clearable = p.optional && p.kind !== 'boolean';
  return (
    <div className={`me-param${props.big ? ' me-param-big' : ''}`} data-path={formatPath(props.path)}>
      <span className="me-param-label" title={p.help}>
        {p.label}
        {p.help ? <span className="me-help" title={p.help}>?</span> : null}
        {clearable ? <button type="button" className="me-icon-btn me-clear" title={`Remove “${p.label}”`} onClick={() => props.onChange(undefined)}>×</button> : null}
      </span>
      <ParamEditor p={p} value={props.value} onChange={props.onChange} path={props.path} scope={props.scope} />
    </div>
  );
}

export function ParamEditor(props: { p: ParamSpec; value: unknown; onChange(v: unknown): void; path: Path; scope: VarInfo[] }) {
  const { p, value, onChange, path, scope } = props;
  const { def, suggestions } = useEditor();
  switch (p.kind) {
    case 'effects':
      return <EffectList value={value as Effect[]} onChange={onChange} path={path} scope={scope} />;
    case 'condition':
      return <ConditionEditor value={value as Condition} onChange={onChange} path={path} scope={scope} />;
    case 'expr':
      return <ExprEditor value={value as Expr | null} onChange={onChange} path={path} scope={scope} nullable={p.nullable} />;
    case 'exprList':
      return <ExprListEditor value={value as Expr[]} onChange={onChange} path={path} scope={scope} />;
    case 'conditionList':
      return <ConditionListEditor value={value as Condition[]} onChange={onChange} path={path} scope={scope} />;
    case 'exprMap':
      return <ExprMapEditor value={value as Record<string, Expr>} onChange={onChange} path={path} scope={scope} />;
    case 'options':
      return <OptionsEditor value={value as OptionItem[]} onChange={onChange} path={path} scope={scope} />;
    case 'playerRef':
      return <PlayerRefEditor value={value as PlayerRef} onChange={onChange} scope={scope} />;
    case 'playerFilter':
      return <PlayerRefEditor value={value as PlayerRef} onChange={onChange} scope={scope} filter />;
    case 'resourceRef':
      return <ResourceRefEditor value={value as string} onChange={onChange} scope={scope} extra={p.extra} />;
    case 'resourceMap':
      return <ResourceMapEditor value={value as ResourceMap} onChange={onChange} path={path} scope={scope} />;
    case 'resourceIds':
      return <MultiRef collection="resources" value={value as string[]} onChange={v => onChange(v.length ? v : (p.optional ? undefined : []))} />;
    case 'resourceKind': {
      const kinds = [...new Set(['resource', 'commodity', ...def.resources.map(r => r.kind)])];
      return <SuggestInput value={value as string} onChange={onChange} suggestions={kinds} placeholder="resource" />;
    }
    case 'pieceId': return <RefSelect collection="pieces" value={value as string} onChange={onChange} />;
    case 'cardId': return <RefSelect collection="cards" value={value as string} onChange={onChange} />;
    case 'deckId': return <RefSelect collection="decks" value={value as string} onChange={onChange} />;
    case 'tokenId': return <RefSelect collection="tokens" value={value as string} onChange={onChange} />;
    case 'terrainId': return <RefSelect collection="terrains" value={value as string} onChange={onChange} />;
    case 'settingId': return <RefSelect collection="settings" value={value as string} onChange={onChange} />;
    case 'pieceIds': case 'terrainIds': {
      const coll = p.kind === 'pieceIds' ? 'pieces' : 'terrains';
      const arr = value === undefined || value === '' ? [] : Array.isArray(value) ? value as string[] : [value as string];
      return (
        <MultiRef collection={coll} value={arr} onChange={v => {
          if (p.multiple === 'list') onChange(v);
          else onChange(v.length === 1 ? v[0] : v.length === 0 ? (p.optional ? undefined : '') : v);
        }} />
      );
    }
    case 'locationKind':
      return <Select value={value as string} onChange={onChange} options={LOCATION_KINDS.map(k => ({ value: k, label: k === 'vertex' ? 'Corner (vertex)' : k === 'hex' ? 'Hex' : 'Edge' }))} />;
    case 'locationChoice':
      return <LocationChoiceEditor value={value as LocationChoice} onChange={onChange} path={path} scope={scope} />;
    case 'locationVar':
      return <VarInput value={value as string} onChange={onChange} scope={scope} type={p.varType === 'piece' ? ['piece', 'location'] : 'location'} />;
    case 'varRef':
      return <VarInput value={value as string} onChange={onChange} scope={scope} type={p.varType ?? 'any'} />;
    case 'varName':
      return <TextInput value={value as string} onChange={onChange} mono className="me-small" invalid={typeof value !== 'string' || !/^[A-Za-z_]\w*$/.test(value)} title="Later steps can refer to this name" />;
    case 'pieceQuery':
      return <PieceQueryEditor value={value as PieceQuery} onChange={onChange} path={path} scope={scope} />;
    case 'key':
      return <SuggestInput value={value as string} onChange={onChange} suggestions={p.keySpace ? suggestions[p.keySpace] : []} mono />;
    case 'event':
      return <EventPicker value={value as string} onChange={onChange} />;
    case 'phases': {
      const arr = Array.isArray(value) ? value as TurnPhase[] : value ? [value as TurnPhase] : [];
      return (
        <div className="me-chips">
          {TURN_PHASES.map(ph => {
            const on = arr.includes(ph);
            return (
              <button key={ph} type="button" className={`me-chip${on ? ' on' : ''}`} onClick={() => {
                const next = on ? arr.filter(x => x !== ph) : [...arr, ph];
                onChange(next.length === 1 ? next[0] : next.length === 0 ? 'main' : next);
              }}>{ph}</button>
            );
          })}
        </div>
      );
    }
    case 'compareOp':
      return <Select value={value as string} onChange={onChange} options={COMPARE_OPS.map(o => ({ value: o, label: { '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' }[o] }))} className="me-small" />;
    case 'dice': {
      const dice = def.dice?.numeric?.length ?? 2;
      const opts: Opt[] = [{ value: 'total', label: 'Total' }, ...Array.from({ length: dice }, (_, i) => ({ value: String(i), label: `Die ${i + 1}` }))];
      return <Select value={String(value ?? 'total')} options={opts} onChange={v => onChange(v === 'total' ? 'total' : Number(v))} />;
    }
    case 'numbers':
      return <NumbersInput value={value as number[]} onChange={onChange} />;
    case 'number':
      return <NumberInput value={value as number} onChange={v => onChange(v ?? 0)} small />;
    case 'boolean':
      return <Checkbox value={value as boolean} onChange={v => onChange(p.optional && !v ? undefined : v)} />;
    case 'enum':
      return <Select value={value as string} onChange={onChange} options={(p.options ?? []).map(o => ({ value: o, label: o }))} />;
    case 'string':
      return <TextInput value={value as string} onChange={v => onChange(v)} />;
  }
}

/* ======================================================================== */
/*  Variables                                                               */
/* ======================================================================== */

export function VarInput(props: { value: string | undefined; onChange(v: string): void; scope: VarInfo[]; type: VarType | VarType[] }) {
  const vars = varsOfType(props.scope, props.type);
  const known = props.scope.some(v => v.name === props.value);
  return (
    <span className="me-var">
      <SuggestInput
        value={props.value}
        onChange={props.onChange}
        suggestions={vars.map(v => v.name)}
        mono
        invalid={!!props.value && !known}
        placeholder={vars[0]?.name ?? 'name'}
        title={vars.length ? `Available: ${vars.map(v => `${v.name} (${v.source})`).join(', ')}` : 'No variables are set before this point'}
      />
      {vars.length ? (
        <span className="me-var-chips">
          {vars.slice(0, 6).map(v => (
            <button key={v.name} type="button" className={`me-var-chip${v.name === props.value ? ' on' : ''}`} title={v.source} onClick={() => props.onChange(v.name)}>{v.name}</button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/* ======================================================================== */
/*  Conditions                                                              */
/* ======================================================================== */

const CONDITION_WRAPS: WrapOption[] = [
  { key: 'wrap:all', label: 'All of (and…)', description: 'Keep this check and add another that must also hold.' },
  { key: 'wrap:any', label: 'Any of (or…)', description: 'Keep this check and add an alternative.' },
  { key: 'wrap:not', label: 'Not', description: 'Flip this check.' },
];

function pickCondition(current: Condition, key: string): Condition {
  if (key === 'wrap:all') return { all: [current, true] };
  if (key === 'wrap:any') return { any: [current, true] };
  if (key === 'wrap:not') return { not: current };
  return CONDITIONS[key as ConditionKind].make();
}

export function ConditionEditor(props: { value: Condition | undefined; onChange(v: Condition): void; path: Path; scope: VarInfo[]; onRemove?(): void }) {
  const { dctx } = useEditor();
  const [menu, setMenu] = useState(false);
  const value = props.value === undefined ? true : props.value;
  const spec = conditionSpec(value);
  const literal = !spec || spec.shape === 'literal';
  const head = (
    <span className="me-node-head">
      <span className="me-menu-anchor">
        <button type="button" className="me-kind-btn" title={spec?.description ?? 'Unknown check'} onClick={() => setMenu(true)}>
          {spec ? spec.label : `⚠ Unknown check`} ▾
        </button>
        {menu ? <BlockMenu family="condition" wraps={literal ? undefined : CONDITION_WRAPS} onClose={() => setMenu(false)} onPick={k => { props.onChange(pickCondition(value, k)); setMenu(false); }} /> : null}
      </span>
      {!literal && spec?.shape !== 'list' ? <span className="me-node-preview" title="In plain words">{describeCondition(value, dctx)}</span> : null}
      {props.onRemove ? <button type="button" className="me-icon-btn me-danger" title="Remove check" onClick={props.onRemove}>✕</button> : null}
    </span>
  );
  if (!spec) return <span className="me-node me-node-bad" data-path={formatPath(props.path)}>{head}<code className="me-mono">{JSON.stringify(value)}</code></span>;
  if (literal) return <span className="me-node me-node-literal" data-path={formatPath(props.path)}>{head}</span>;
  return (
    <div className={`me-node me-node-cond ${catClass(spec.category)}`} data-path={formatPath(props.path)}>
      {head}
      <BlockParams spec={spec as BlockSpec<unknown>} node={value} onChange={v => props.onChange(v as Condition)} path={props.path} scope={props.scope} />
    </div>
  );
}

function ConditionListEditor(props: { value: Condition[] | undefined; onChange(v: Condition[]): void; path: Path; scope: VarInfo[] }) {
  const list = props.value ?? [];
  return (
    <div className="me-node-list">
      {list.map((c, i) => (
        <ConditionEditor key={i} value={c} path={[...props.path, i]} scope={props.scope}
          onChange={v => props.onChange(list.map((x, j) => (j === i ? v : x)))}
          onRemove={() => props.onChange(list.filter((_, j) => j !== i))} />
      ))}
      <button type="button" className="me-add-btn me-add-small" onClick={() => props.onChange([...list, true])}>＋ check</button>
    </div>
  );
}

/* ======================================================================== */
/*  Exprs                                                                   */
/* ======================================================================== */

const EXPR_WRAPS: WrapOption[] = [
  { key: 'wrap:add', label: 'Add (… + n)', description: 'Add something to this value.' },
  { key: 'wrap:sub', label: 'Subtract (… − n)', description: 'Subtract something from this value.' },
  { key: 'wrap:mul', label: 'Multiply (… × n)', description: 'Multiply this value.' },
  { key: 'wrap:div', label: 'Divide (… ÷ n)', description: 'Divide this value, rounding down.' },
  { key: 'wrap:min', label: 'Cap at (smallest of)', description: 'Never more than a limit.' },
  { key: 'wrap:max', label: 'At least (largest of)', description: 'Never less than a floor.' },
];

function pickExpr(current: Expr, key: string): Expr {
  switch (key) {
    case 'wrap:add': return { add: [current, 1] };
    case 'wrap:sub': return { sub: [current, 1] };
    case 'wrap:mul': return { mul: [current, 2] };
    case 'wrap:div': return { div: [current, 2] };
    case 'wrap:min': return { min: [current, 1] };
    case 'wrap:max': return { max: [current, 0] };
  }
  if (key === 'number') return typeof current === 'number' ? current : 1;
  return EXPRS[key as ExprKind].make();
}

export function ExprEditor(props: { value: Expr | null | undefined; onChange(v: Expr | null): void; path: Path; scope: VarInfo[]; nullable?: boolean }) {
  const { dctx } = useEditor();
  const [menu, setMenu] = useState(false);
  const value = props.value;
  const menuEl = menu ? (
    <BlockMenu family="expr" wraps={value === null || value === undefined ? undefined : EXPR_WRAPS} onClose={() => setMenu(false)}
      onPick={k => { props.onChange(pickExpr(value ?? 0, k)); setMenu(false); }} />
  ) : null;
  if (value === null) {
    return (
      <span className="me-expr" data-path={formatPath(props.path)}>
        <span className="me-muted">none</span>
        <button type="button" className="me-btn me-btn-small" onClick={() => props.onChange(1)}>Set number</button>
      </span>
    );
  }
  if (value === undefined || typeof value === 'number') {
    return (
      <span className="me-expr me-expr-num me-menu-anchor" data-path={formatPath(props.path)}>
        <NumberInput value={value} onChange={v => props.onChange(v ?? 0)} small />
        <button type="button" className="me-fx" title="Use a formula instead (dice, counts, settings, math…)" onClick={() => setMenu(true)}>ƒ</button>
        {props.nullable ? <button type="button" className="me-icon-btn" title="Clear (no number)" onClick={() => props.onChange(null)}>∅</button> : null}
        {menuEl}
      </span>
    );
  }
  const spec = exprSpec(value);
  if (!spec) {
    return (
      <span className="me-expr me-node-bad" data-path={formatPath(props.path)}>
        <code className="me-mono">{JSON.stringify(value)}</code>
        <button type="button" className="me-icon-btn" onClick={() => props.onChange(0)}>×</button>
      </span>
    );
  }
  const compact = spec.params.every(p => !['exprList', 'condition', 'pieceQuery'].includes(p.kind)) && spec.shape !== 'tuple';
  return (
    <span className={`me-expr me-expr-formula ${compact ? 'me-expr-compact' : ''}`} data-path={formatPath(props.path)} title={describeExpr(value, dctx)}>
      <span className="me-node-head">
        <span className="me-menu-anchor">
          <button type="button" className="me-kind-btn me-kind-expr" title={spec.description} onClick={() => setMenu(true)}>ƒ {spec.label} ▾</button>
          {menuEl}
        </span>
        <button type="button" className="me-icon-btn" title="Back to a plain number" onClick={() => props.onChange(0)}>×</button>
      </span>
      <BlockParams spec={spec as BlockSpec<unknown>} node={value} onChange={v => props.onChange(v as Expr)} path={props.path} scope={props.scope} inline={compact} />
    </span>
  );
}

function ExprListEditor(props: { value: Expr[] | undefined; onChange(v: Expr[]): void; path: Path; scope: VarInfo[] }) {
  const list = props.value ?? [];
  return (
    <div className="me-node-list me-node-list-inline">
      {list.map((e, i) => (
        <span key={i} className="me-list-item">
          <ExprEditor value={e} path={[...props.path, i]} scope={props.scope} onChange={v => props.onChange(list.map((x, j) => (j === i ? (v ?? 0) : x)))} />
          <button type="button" className="me-icon-btn me-danger" title="Remove" onClick={() => props.onChange(list.filter((_, j) => j !== i))}>✕</button>
        </span>
      ))}
      <button type="button" className="me-add-btn me-add-small" onClick={() => props.onChange([...list, 0])}>＋</button>
    </div>
  );
}

function ExprMapEditor(props: { value: Record<string, Expr> | undefined; onChange(v: Record<string, Expr> | undefined): void; path: Path; scope: VarInfo[] }) {
  const value = props.value ?? {};
  const [k, setK] = useState('');
  const set = (next: Record<string, Expr>) => props.onChange(Object.keys(next).length ? next : undefined);
  return (
    <div className="me-kv">
      {Object.entries(value).map(([key, e]) => (
        <div className="me-kv-row" key={key}>
          <span className="me-mono me-kv-key">{key}</span>
          <ExprEditor value={e} path={[...props.path, key]} scope={props.scope} onChange={v => set({ ...value, [key]: v ?? 0 })} />
          <button type="button" className="me-icon-btn me-danger" onClick={() => { const c = { ...value }; delete c[key]; set(c); }}>✕</button>
        </div>
      ))}
      <div className="me-kv-row">
        <TextInput value={k} onChange={setK} placeholder="name" mono className="me-small" />
        <button type="button" className="me-btn me-btn-small" disabled={!k || k in value} onClick={() => { set({ ...value, [k]: 0 }); setK(''); }}>Add</button>
      </div>
    </div>
  );
}

/* ======================================================================== */
/*  Composite params                                                        */
/* ======================================================================== */

interface OptionItem { label: string; cond?: Condition; do: Effect[] }

function OptionsEditor(props: { value: OptionItem[] | undefined; onChange(v: OptionItem[]): void; path: Path; scope: VarInfo[] }) {
  const list = props.value ?? [];
  const setAt = (i: number, o: OptionItem) => props.onChange(list.map((x, j) => (j === i ? o : x)));
  return (
    <div className="me-options">
      {list.map((o, i) => (
        <div key={i} className="me-option" data-path={formatPath([...props.path, i])}>
          <div className="me-option-head">
            <span className="me-muted">Option {i + 1}</span>
            <TextInput value={o.label} onChange={v => setAt(i, { ...o, label: v })} placeholder="Label shown on the button" />
            {o.cond === undefined ? (
              <button type="button" className="me-chip me-chip-add" onClick={() => setAt(i, { ...o, cond: true })}>＋ Only if…</button>
            ) : null}
            <button type="button" className="me-icon-btn me-danger" title="Remove option" onClick={() => props.onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
          {o.cond !== undefined ? (
            <div className="me-param me-param-big">
              <span className="me-param-label">Only if <button type="button" className="me-icon-btn me-clear" onClick={() => { const c = { ...o }; delete c.cond; setAt(i, c); }}>×</button></span>
              <ConditionEditor value={o.cond} onChange={v => setAt(i, { ...o, cond: v })} path={[...props.path, i, 'cond']} scope={props.scope} />
            </div>
          ) : null}
          <EffectList value={o.do} onChange={v => setAt(i, { ...o, do: v })} path={[...props.path, i, 'do']} scope={props.scope} />
        </div>
      ))}
      <button type="button" className="me-add-btn me-add-small" onClick={() => props.onChange([...list, { label: `Option ${list.length + 1}`, do: [] }])}>＋ Option</button>
    </div>
  );
}

export function PlayerRefEditor(props: { value: PlayerRef | 'any' | 'others' | undefined; onChange(v: PlayerRef | 'any' | 'others'): void; scope: VarInfo[]; filter?: boolean }) {
  const v = props.value ?? 'self';
  const mode = typeof v === 'string' ? v : 'var' in v ? 'var' : 'ownerOf';
  const opts: Opt[] = [
    ...(props.filter ? [{ value: 'any', label: 'Anyone' }, { value: 'others', label: 'Other players' }] : []),
    { value: 'self', label: 'You (who runs this)' },
    { value: 'current', label: 'Current player' },
    ...(props.filter ? [] : [{ value: 'bank', label: 'The bank' }]),
    { value: 'var', label: 'A chosen player…' },
    { value: 'ownerOf', label: 'Owner of…' },
  ];
  return (
    <span className="me-inline">
      <Select value={mode} options={opts} onChange={m => {
        if (m === 'var') props.onChange({ var: varsOfType(props.scope, 'player')[0]?.name ?? '' });
        else if (m === 'ownerOf') props.onChange({ ownerOf: varsOfType(props.scope, ['piece', 'location'])[0]?.name ?? '' });
        else props.onChange(m as PlayerRef);
      }} />
      {typeof v === 'object' && 'var' in v ? <VarInput value={v.var} onChange={n => props.onChange({ var: n })} scope={props.scope} type="player" /> : null}
      {typeof v === 'object' && 'ownerOf' in v ? <VarInput value={v.ownerOf} onChange={n => props.onChange({ ownerOf: n })} scope={props.scope} type={['piece', 'location']} /> : null}
    </span>
  );
}

function ResourceRefEditor(props: { value: string | { var: string } | undefined; onChange(v: string | { var: string }): void; scope: VarInfo[]; extra?: readonly string[] }) {
  const { def } = useEditor();
  const v = props.value;
  const isVar = typeof v === 'object' && v !== null;
  const extraLabels: Record<string, string> = { random: 'A random card', choice: 'Player’s choice', any: 'Any resource' };
  const opts: Opt[] = [
    ...(props.extra ?? []).map(x => ({ value: x, label: extraLabels[x] ?? x, group: 'Special' })),
    ...def.resources.map(r => ({ value: r.id, label: r.name, group: 'Resources' })),
    { value: '__var', label: 'A chosen resource…', group: 'Special' },
  ];
  return (
    <span className="me-inline">
      <Select value={isVar ? '__var' : (v as string)} options={opts} onChange={m => {
        if (m === '__var') props.onChange({ var: varsOfType(props.scope, 'resource')[0]?.name ?? '' });
        else props.onChange(m);
      }} />
      {isVar ? <VarInput value={(v as { var: string }).var} onChange={n => props.onChange({ var: n })} scope={props.scope} type="resource" /> : null}
    </span>
  );
}

export function ResourceMapEditor(props: { value: ResourceMap | undefined; onChange(v: ResourceMap): void; path: Path; scope: VarInfo[] }) {
  const { def } = useEditor();
  const value = props.value ?? {};
  const [custom, setCustom] = useState('');
  const set = (id: string, amt: Expr | undefined) => {
    const next = { ...value };
    if (amt === undefined) delete next[id];
    else next[id] = amt;
    props.onChange(next);
  };
  const known = new Set(def.resources.map(r => r.id));
  const unknown = Object.keys(value).filter(k => !known.has(k));
  return (
    <div className="me-resmap" data-path={formatPath(props.path)}>
      {def.resources.map(r => {
        const on = value[r.id] !== undefined;
        return (
          <span key={r.id} className={`me-res${on ? ' on' : ''}`} data-path={formatPath([...props.path, r.id])}>
            <span className="me-dot" style={{ background: r.color }} />
            {on ? (
              <>
                <span className="me-res-name">{r.name}</span>
                <ExprEditor value={value[r.id]} onChange={v => set(r.id, v ?? 0)} path={[...props.path, r.id]} scope={props.scope} />
                <button type="button" className="me-icon-btn" title="Remove" onClick={() => set(r.id, undefined)}>×</button>
              </>
            ) : (
              <button type="button" className="me-res-add" title={`Add ${r.name}`} onClick={() => set(r.id, 1)}>{r.name}</button>
            )}
          </span>
        );
      })}
      {unknown.map(k => (
        <span key={k} className="me-res on me-res-bad" data-path={formatPath([...props.path, k])}>
          ⚠ <span className="me-res-name me-mono">{k}</span>
          <ExprEditor value={value[k]} onChange={v => set(k, v ?? 0)} path={[...props.path, k]} scope={props.scope} />
          <button type="button" className="me-icon-btn" onClick={() => set(k, undefined)}>×</button>
        </span>
      ))}
      {def.resources.length === 0 ? (
        <span className="me-inline">
          <TextInput value={custom} onChange={setCustom} placeholder="resource id" mono className="me-small" />
          <button type="button" className="me-btn me-btn-small" disabled={!custom} onClick={() => { set(custom, 1); setCustom(''); }}>Add</button>
        </span>
      ) : null}
    </div>
  );
}

function PieceQueryEditor(props: { value: PieceQuery | undefined; onChange(v: PieceQuery): void; path: Path; scope: VarInfo[] }) {
  const { suggestions } = useEditor();
  const q = props.value ?? {};
  const set = <K extends keyof PieceQuery>(k: K, v: PieceQuery[K] | undefined) => {
    const next = { ...q };
    if (v === undefined) delete next[k];
    else next[k] = v;
    props.onChange(next);
  };
  const pieces = q.piece === undefined ? [] : Array.isArray(q.piece) ? q.piece : [q.piece];
  return (
    <div className="me-group">
      <div className="me-param-row">
        <div className="me-param" data-path={formatPath([...props.path, 'owner'])}>
          <span className="me-param-label">Owner</span>
          <PlayerRefEditor value={q.owner ?? 'any'} onChange={v => set('owner', v === 'any' ? undefined : v)} scope={props.scope} filter />
        </div>
        {q.tag !== undefined ? (
          <div className="me-param" data-path={formatPath([...props.path, 'tag'])}>
            <span className="me-param-label">Tag <button type="button" className="me-icon-btn me-clear" onClick={() => set('tag', undefined)}>×</button></span>
            <TextInput value={q.tag} onChange={v => set('tag', v)} className="me-small" />
          </div>
        ) : null}
        {q.near !== undefined ? (
          <div className="me-param" data-path={formatPath([...props.path, 'near'])}>
            <span className="me-param-label">Near <button type="button" className="me-icon-btn me-clear" onClick={() => set('near', undefined)}>×</button></span>
            <VarInput value={q.near} onChange={v => set('near', v)} scope={props.scope} type={['location', 'piece']} />
          </div>
        ) : null}
      </div>
      <div className="me-param me-param-big" data-path={formatPath([...props.path, 'piece'])}>
        <span className="me-param-label">Piece types <span className="me-muted">(none = all)</span></span>
        <MultiRef collection="pieces" value={pieces} onChange={v => set('piece', v.length === 0 ? undefined : v.length === 1 ? v[0] : v)} />
      </div>
      {q.onTerrain !== undefined ? (
        <div className="me-param me-param-big" data-path={formatPath([...props.path, 'onTerrain'])}>
          <span className="me-param-label">Touching terrain <button type="button" className="me-icon-btn me-clear" onClick={() => set('onTerrain', undefined)}>×</button></span>
          <MultiRef collection="terrains" value={q.onTerrain} onChange={v => set('onTerrain', v)} />
        </div>
      ) : null}
      {q.region !== undefined ? (
        <div className="me-param" data-path={formatPath([...props.path, 'region'])}>
          <span className="me-param-label">On the same island as <button type="button" className="me-icon-btn me-clear" onClick={() => set('region', undefined)}>×</button></span>
          <VarInput value={q.region} onChange={v => set('region', v)} scope={props.scope} type={['location', 'piece']} />
        </div>
      ) : null}
      {q.state !== undefined ? (
        <div className="me-param me-param-big" data-path={formatPath([...props.path, 'state'])}>
          <span className="me-param-label">With state <button type="button" className="me-icon-btn me-clear" onClick={() => set('state', undefined)}>×</button></span>
          <NumberMap value={q.state} onChange={v => set('state', v ?? {})} keyPlaceholder="active" suggestions={suggestions.pieceState} />
        </div>
      ) : null}
      {q.where !== undefined ? (
        <div className="me-param me-param-big" data-path={formatPath([...props.path, 'where'])}>
          <span className="me-param-label" title="The candidate piece is “candidate” (its spot) and “candidateId”.">Only pieces where <button type="button" className="me-icon-btn me-clear" onClick={() => set('where', undefined)}>×</button></span>
          <ConditionEditor value={q.where} onChange={v => set('where', v)} path={[...props.path, 'where']} scope={mergeScope(props.scope, candidateScope())} />
        </div>
      ) : null}
      <div className="me-more">
        {q.tag === undefined ? <button type="button" className="me-chip me-chip-add" onClick={() => set('tag', '')}>＋ Tag</button> : null}
        {q.near === undefined ? <button type="button" className="me-chip me-chip-add" onClick={() => set('near', varsOfType(props.scope, 'location')[0]?.name ?? '')}>＋ Near</button> : null}
        {q.onTerrain === undefined ? <button type="button" className="me-chip me-chip-add" onClick={() => set('onTerrain', [])}>＋ Touching terrain</button> : null}
        {q.region === undefined ? <button type="button" className="me-chip me-chip-add" onClick={() => set('region', varsOfType(props.scope, 'location')[0]?.name ?? '')}>＋ Same island</button> : null}
        {q.state === undefined ? <button type="button" className="me-chip me-chip-add" onClick={() => set('state', {})}>＋ State</button> : null}
        {q.where === undefined ? <button type="button" className="me-chip me-chip-add" onClick={() => set('where', true)}>＋ Only where</button> : null}
      </div>
    </div>
  );
}

function LocationChoiceEditor(props: { value: LocationChoice | undefined; onChange(v: LocationChoice): void; path: Path; scope: VarInfo[] }) {
  const v = props.value ?? {};
  const set = <K extends keyof LocationChoice>(k: K, x: LocationChoice[K] | undefined) => {
    const next = { ...v };
    if (x === undefined) delete next[k];
    else next[k] = x;
    props.onChange(next);
  };
  const whereScope = useMemo(() => mergeScope(props.scope, atScope()), [props.scope]);
  return (
    <div className="me-group">
      <div className="me-param-row">
        <div className="me-param">
          <span className="me-param-label">Location</span>
          <Select value={v.at !== undefined ? 'at' : 'ask'} options={[{ value: 'ask', label: 'Player picks on the board' }, { value: 'at', label: 'A remembered location…' }]}
            onChange={m => set('at', m === 'at' ? (varsOfType(props.scope, 'location')[0]?.name ?? '') : undefined)} />
          {v.at !== undefined ? <VarInput value={v.at} onChange={x => set('at', x)} scope={props.scope} type="location" /> : null}
        </div>
        {v.at === undefined ? (
          <div className="me-param" data-path={formatPath([...props.path, 'label'])}>
            <span className="me-param-label">Prompt text</span>
            <TextInput value={v.label} onChange={x => set('label', x || undefined)} placeholder="e.g. Place your road" />
          </div>
        ) : null}
      </div>
      {v.where !== undefined ? (
        <div className="me-param me-param-big" data-path={formatPath([...props.path, 'where'])}>
          <span className="me-param-label">Only where <button type="button" className="me-icon-btn me-clear" onClick={() => set('where', undefined)}>×</button></span>
          <ConditionEditor value={v.where} onChange={x => set('where', x)} path={[...props.path, 'where']} scope={whereScope} />
        </div>
      ) : (
        <div className="me-more"><button type="button" className="me-chip me-chip-add" onClick={() => set('where', true)}>＋ Extra restriction</button></div>
      )}
    </div>
  );
}

export function EventPicker(props: { value: string | undefined; onChange(v: string): void }) {
  const { suggestions } = useEditor();
  const builtin = Object.entries(EVENTS).map(([id, e]) => ({ value: id, label: e.label, group: 'Built-in events', title: e.description }));
  const custom = suggestions.event.map(e => ({ value: e, label: e, group: 'Custom events (fired by your mod)' }));
  const known = [...builtin, ...custom].some(o => o.value === props.value);
  const [typing, setTyping] = useState(!known && !!props.value);
  if (typing) {
    return (
      <span className="me-inline">
        <TextInput value={props.value} onChange={props.onChange} mono placeholder="myEvent" />
        <button type="button" className="me-btn me-btn-small" onClick={() => setTyping(false)}>List</button>
      </span>
    );
  }
  return (
    <Select value={props.value} options={[...builtin, ...custom, { value: '__custom', label: 'Custom event name…', group: 'Custom events (fired by your mod)' }]}
      onChange={v => { if (v === '__custom') setTyping(true); else props.onChange(v); }} />
  );
}

/* ======================================================================== */
/*  Plain-language preview                                                  */
/* ======================================================================== */

export function PlainPreview(props: { effects: Effect[] | undefined; title?: string }) {
  const { dctx } = useEditor();
  const lines = describeEffects(props.effects ?? [], dctx);
  return (
    <div className="me-preview">
      <div className="me-preview-title">{props.title ?? 'In plain words'}</div>
      {lines.length ? <ol>{lines.map((l, i) => <li key={i}>{l}.</li>)}</ol> : <div className="me-muted">Nothing happens yet — add a step.</div>}
    </div>
  );
}

/** Effects editor + plain-language preview, the standard combo for any Effect[] field. */
export function EffectsField(props: { value: Effect[] | undefined; onChange(v: Effect[]): void; path: Path; scope: VarInfo[]; previewTitle?: string; emptyHint?: string }) {
  return (
    <div className="me-effects-field">
      <EffectList value={props.value} onChange={props.onChange} path={props.path} scope={props.scope} emptyHint={props.emptyHint} />
      <PlainPreview effects={props.value} title={props.previewTitle} />
    </div>
  );
}

/** Condition editor + one-line preview. */
export function ConditionField(props: { value: Condition | undefined; onChange(v: Condition): void; path: Path; scope: VarInfo[] }) {
  const { dctx } = useEditor();
  return (
    <div className="me-cond-field">
      <ConditionEditor value={props.value} onChange={props.onChange} path={props.path} scope={props.scope} />
      <div className="me-preview me-preview-inline"><span className="me-preview-title">Means</span> {describeCondition(props.value, dctx)}</div>
    </div>
  );
}
