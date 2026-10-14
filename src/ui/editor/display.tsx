/** Editors for the optional UI display hints (PieceDef.display, ModDef.display). */
import type { DisplayHints, PieceDisplay } from '../../engine/schema';
import { formatPath, type Path } from '../../editor/paths';
import { useEditor } from './context';
import { Checkbox, ColorInput, Field, NumberInput, Select, SuggestInput, TextInput } from './fields';

type Badge = NonNullable<PieceDisplay['stateBadges']>[number];

const STYLE_OPTS = [
  { value: 'number', label: 'Number badge' },
  { value: 'pips', label: 'Pips (dots)' },
  { value: 'toggle', label: 'On/off (dim when 0)' },
];

/** Strip empty arrays / undefined so the JSON stays tidy. */
function clean<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
  return Object.keys(out).length ? (out as T) : undefined;
}

export function PieceDisplayEditor(props: { value: PieceDisplay | undefined; onChange(v: PieceDisplay | undefined): void; path: Path; stateKeys: string[] }) {
  const { suggestions } = useEditor();
  const v = props.value ?? {};
  const badges = v.stateBadges ?? [];
  const keys = [...new Set([...props.stateKeys, ...suggestions.pieceState])];
  const setBadges = (b: Badge[]) => props.onChange(clean({ ...v, stateBadges: b }));
  const setBadge = (i: number, b: Badge) => setBadges(badges.map((x, j) => (j === i ? b : x)));
  return (
    <div className="me-rows">
      {badges.map((b, i) => (
        <div key={i} className="me-row" data-path={formatPath([...props.path, 'stateBadges', i])}>
          <span>Show</span>
          <SuggestInput value={b.key} onChange={key => setBadge(i, { ...b, key })} suggestions={keys} placeholder="strength" mono />
          <span>as</span>
          <Select value={b.style ?? 'number'} options={STYLE_OPTS} onChange={s => setBadge(i, { ...b, style: s === 'number' ? undefined : (s as Badge['style']) })} />
          {b.style === 'pips' ? (
            <>
              <span>max</span>
              <NumberInput value={b.max} small allowEmpty placeholder="3" onChange={n => setBadge(i, { ...b, max: n })} />
            </>
          ) : null}
          <span>label</span>
          <TextInput value={b.label} className="me-small" placeholder="Strength" onChange={label => setBadge(i, { ...b, label: label || undefined })} />
          <button type="button" className="me-icon-btn me-danger" onClick={() => setBadges(badges.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="me-add-btn me-add-small" onClick={() => setBadges([...badges, { key: keys[0] ?? '' }])}>＋ State badge</button>
      <Checkbox label="Show cargo chips on the board" value={v.showCargo ?? true} onChange={x => props.onChange(clean({ ...v, showCargo: x ? undefined : false }))} />
    </div>
  );
}

export function DisplayHintsEditor(props: { value: DisplayHints | undefined; onChange(v: DisplayHints | undefined): void }) {
  const { suggestions, def } = useEditor();
  const v = props.value ?? {};
  const set = (patch: Partial<DisplayHints>) => props.onChange(clean({ ...v, ...patch }));
  const globals = v.globals ?? [];
  const stats = v.stats ?? [];
  const faces = v.eventFaces ?? [];
  const faceSuggestions = [...new Set((def.dice.eventDice ?? []).flatMap(d => d.faces))];
  return (
    <div className="me-rows">
      <Field label="Global counters" path={['display', 'globals']} wide help="How the game screen shows global counters (e.g. a barbarian track). Max draws a track.">
        <div className="me-rows">
          {globals.map((g, i) => {
            const upd = (x: typeof g) => set({ globals: globals.map((y, j) => (j === i ? x : y)) });
            return (
              <div key={i} className="me-row" data-path={`display.globals[${i}]`}>
                <SuggestInput value={g.key} onChange={key => upd({ ...g, key })} suggestions={suggestions.global} placeholder="barbarians" mono />
                <span>label</span>
                <TextInput value={g.label} className="me-small" onChange={label => upd({ ...g, label: label || undefined })} />
                <span>max</span>
                <NumberInput value={g.max} small allowEmpty onChange={max => upd({ ...g, max })} />
                <span>icon</span>
                <TextInput value={g.icon} className="me-small" onChange={icon => upd({ ...g, icon: icon || undefined })} />
                <ColorInput value={g.color} onChange={color => upd({ ...g, color: color || undefined })} />
                <Checkbox label="hidden" value={g.hidden} onChange={hidden => upd({ ...g, hidden: hidden || undefined })} />
                <button type="button" className="me-icon-btn me-danger" onClick={() => set({ globals: globals.filter((_, j) => j !== i) })}>✕</button>
              </div>
            );
          })}
          <button type="button" className="me-add-btn me-add-small" onClick={() => set({ globals: [...globals, { key: suggestions.global[0] ?? '' }] })}>＋ Global</button>
        </div>
      </Field>
      <Field label="Player stats" path={['display', 'stats']} wide help="Labels for per-player counters shown next to each player.">
        <div className="me-rows">
          {stats.map((st, i) => {
            const upd = (x: typeof st) => set({ stats: stats.map((y, j) => (j === i ? x : y)) });
            return (
              <div key={i} className="me-row" data-path={`display.stats[${i}]`}>
                <SuggestInput value={st.key} onChange={key => upd({ ...st, key })} suggestions={suggestions.stat} placeholder="knightsPlayed" mono />
                <span>label</span>
                <TextInput value={st.label} className="me-small" onChange={label => upd({ ...st, label: label || undefined })} />
                <span>icon</span>
                <TextInput value={st.icon} className="me-small" onChange={icon => upd({ ...st, icon: icon || undefined })} />
                <span>max</span>
                <NumberInput value={st.max} small allowEmpty onChange={max => upd({ ...st, max })} />
                <Checkbox label="hidden" value={st.hidden} onChange={hidden => upd({ ...st, hidden: hidden || undefined })} />
                <button type="button" className="me-icon-btn me-danger" onClick={() => set({ stats: stats.filter((_, j) => j !== i) })}>✕</button>
              </div>
            );
          })}
          <button type="button" className="me-add-btn me-add-small" onClick={() => set({ stats: [...stats, { key: suggestions.stat[0] ?? '' }] })}>＋ Stat</button>
        </div>
      </Field>
      <Field label="Event die faces" path={['display', 'eventFaces']} wide help="Label, colour and icon shown for each event-die face.">
        <div className="me-rows">
          {faces.map((f, i) => {
            const upd = (x: typeof f) => set({ eventFaces: faces.map((y, j) => (j === i ? x : y)) });
            return (
              <div key={i} className="me-row" data-path={`display.eventFaces[${i}]`}>
                <SuggestInput value={f.face} onChange={face => upd({ ...f, face })} suggestions={faceSuggestions} placeholder="barbarian" mono />
                <span>label</span>
                <TextInput value={f.label} className="me-small" onChange={label => upd({ ...f, label: label || undefined })} />
                <span>icon</span>
                <TextInput value={f.icon} className="me-small" onChange={icon => upd({ ...f, icon: icon || undefined })} />
                <ColorInput value={f.color} onChange={color => upd({ ...f, color: color || undefined })} />
                <button type="button" className="me-icon-btn me-danger" onClick={() => set({ eventFaces: faces.filter((_, j) => j !== i) })}>✕</button>
              </div>
            );
          })}
          <button type="button" className="me-add-btn me-add-small" onClick={() => set({ eventFaces: [...faces, { face: faceSuggestions.find(x => !faces.some(f => f.face === x)) ?? '' }] })}>＋ Face</button>
        </div>
      </Field>
    </div>
  );
}
