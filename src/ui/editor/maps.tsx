/** Map editor: clickable hex grid + bags. */
import { useMemo, useState } from 'react';
import type { MapDef } from '../../engine/schema';
import { hexCornerPoints, hexNeighbors, hexToPixel } from '../../engine/board/topology';
import { formatPath } from '../../editor/paths';
import { useEditor } from './context';
import { Checkbox, Field, ListInput, NumberInput, NumbersInput, Section, Select, TextInput, type Opt } from './fields';
import { NameId, type FormProps } from './forms';

type Hex = MapDef['hexes'][number];
const SIZE = 26;
const key = (q: number, r: number) => `${q},${r}`;

function ring(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) out.push({ q, r });
  }
  return out;
}

export function MapForm(props: FormProps<MapDef>) {
  const { value: v, onChange, path } = props;
  const { def } = useEditor();
  const [sel, setSel] = useState<number | null>(null);
  const [fillBag, setFillBag] = useState('');
  const hexes = v.hexes ?? [];
  const bags = v.terrainBags ?? {};
  const terrainById = useMemo(() => new Map(def.terrains.map(t => [t.id, t])), [def.terrains]);

  const occupied = new Set(hexes.map(h => key(h.q, h.r)));
  const ghosts = new Map<string, { q: number; r: number }>();
  for (const h of hexes) for (const n of hexNeighbors(h)) if (!occupied.has(key(n.q, n.r))) ghosts.set(key(n.q, n.r), n);
  if (hexes.length === 0) ghosts.set('0,0', { q: 0, r: 0 });

  const all = [...hexes, ...ghosts.values()];
  const pts = all.flatMap(h => hexCornerPoints(h, SIZE));
  const minX = Math.min(...pts.map(p => p.x)) - 4, maxX = Math.max(...pts.map(p => p.x)) + 4;
  const minY = Math.min(...pts.map(p => p.y)) - 4, maxY = Math.max(...pts.map(p => p.y)) + 4;

  const setHexes = (next: Hex[]) => onChange({ ...v, hexes: next });
  const setHex = (i: number, h: Hex) => setHexes(hexes.map((x, j) => (j === i ? h : x)));
  const defaultTerrain = Object.keys(bags)[0] ? `@${Object.keys(bags)[0]}` : def.terrains.find(t => !t.water)?.id ?? '';

  const terrainOpts: Opt[] = [
    ...Object.keys(bags).map(b => ({ value: `@${b}`, label: `🎲 random from “${b}”`, group: 'Bags' })),
    ...def.terrains.map(t => ({ value: t.id, label: t.name, group: 'Terrains' })),
  ];
  const fillColor = (t: string) => (t.startsWith('@') ? 'url(#me-bag)' : terrainById.get(t)?.color ?? '#999');
  const selected = sel !== null ? hexes[sel] : undefined;

  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Players" path={[...path, 'minPlayers']}>
          <span className="me-inline">
            <NumberInput value={v.minPlayers} small onChange={n => onChange({ ...v, minPlayers: n ?? 2 })} />–
            <NumberInput value={v.maxPlayers} small onChange={n => onChange({ ...v, maxPlayers: n ?? 4 })} />
          </span>
        </Field>
        <Field label="No adjacent 6/8" path={[...path, 'noAdjacentRedNumbers']}>
          <Checkbox value={v.noAdjacentRedNumbers} onChange={x => onChange({ ...v, noAdjacentRedNumbers: x || undefined })} />
        </Field>
      </div>
      <Section title={`Board (${hexes.length} hexes)`} path={[...path, 'hexes']} hint="Click a hex to edit it, a dashed hex to add one."
        actions={
          <span className="me-inline">
            <Select value={fillBag} placeholder="Fill hexagon with…" options={terrainOpts} onChange={setFillBag} />
            {[1, 2, 3].map(r => (
              <button key={r} type="button" className="me-btn me-btn-small" disabled={!fillBag} title={`Replace the board with a radius-${r} hexagon (${ring(r).length} hexes)`}
                onClick={() => { if (hexes.length === 0 || confirm('Replace all hexes?')) { setHexes(ring(r).map(c => ({ ...c, terrain: fillBag, number: '@' as const }))); setSel(null); } }}>
                r{r}
              </button>
            ))}
          </span>
        }>
        <div className="me-map">
          <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="me-map-svg">
            <defs>
              <pattern id="me-bag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#8a8f99" /><line x1="0" y1="0" x2="0" y2="6" stroke="#b9bec8" strokeWidth="3" />
              </pattern>
            </defs>
            {[...ghosts.values()].map(g => (
              <polygon key={`g${key(g.q, g.r)}`} className="me-hex-ghost" points={hexCornerPoints(g, SIZE - 1).map(p => `${p.x},${p.y}`).join(' ')}
                onClick={() => { setHexes([...hexes, { q: g.q, r: g.r, terrain: defaultTerrain }]); setSel(hexes.length); }}>
                <title>Add hex ({g.q},{g.r})</title>
              </polygon>
            ))}
            {hexes.map((h, i) => {
              const c = hexToPixel(h, SIZE);
              const corners = hexCornerPoints(h, SIZE - 1);
              return (
                <g key={key(h.q, h.r)} className={`me-hex${sel === i ? ' sel' : ''}`} onClick={() => setSel(i)}>
                  <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill={fillColor(h.terrain)} />
                  {h.number !== undefined ? (
                    <text x={c.x} y={c.y + 4} textAnchor="middle" className={`me-hex-num${h.number === 6 || h.number === 8 ? ' red' : ''}`}>{h.number === '@' ? '?' : h.number}</text>
                  ) : null}
                  {h.port ? (() => {
                    const a = corners[h.port.side % 6], b = corners[(h.port.side + 1) % 6];
                    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="me-hex-port"><title>Port {h.port.port}</title></line>;
                  })() : null}
                </g>
              );
            })}
          </svg>
          <div className="me-map-side" data-path={sel !== null ? formatPath([...path, 'hexes', sel]) : undefined}>
            {selected && sel !== null ? (
              <>
                <div className="me-subcard-head"><b>Hex ({selected.q}, {selected.r})</b><span className="me-spacer" />
                  <button type="button" className="me-btn me-btn-small me-danger" onClick={() => { setHexes(hexes.filter((_, j) => j !== sel)); setSel(null); }}>Delete hex</button>
                </div>
                <Field label="Terrain" path={[...path, 'hexes', sel, 'terrain']}>
                  <Select value={selected.terrain} options={terrainOpts} onChange={t => setHex(sel, { ...selected, terrain: t })} />
                </Field>
                <Field label="Number" path={[...path, 'hexes', sel, 'number']}>
                  <Select value={selected.number === undefined ? '' : String(selected.number)} placeholder="none"
                    options={[{ value: '', label: 'None' }, { value: '@', label: '🎲 From number bag' }, ...[2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map(n => ({ value: String(n), label: String(n) }))]}
                    onChange={n => { const h = { ...selected }; if (n === '') delete h.number; else h.number = n === '@' ? '@' : Number(n); setHex(sel, h); }} />
                </Field>
                <Field label="Port" path={[...path, 'hexes', sel, 'port']}>
                  <span className="me-inline">
                    <Select value={selected.port?.port ?? ''} placeholder="none"
                      options={[{ value: '', label: 'None' }, { value: '@', label: '🎲 From port bag' }, ...def.ports.map(p => ({ value: p.id, label: `${p.resource} ${p.ratio}:1` }))]}
                      onChange={p => { const h = { ...selected }; if (!p) delete h.port; else h.port = { port: p, side: selected.port?.side ?? 0 }; setHex(sel, h); }} />
                    {selected.port ? (
                      <Select value={String(selected.port.side)} options={['NE', 'E', 'SE', 'SW', 'W', 'NW'].map((s, i) => ({ value: String(i), label: `${s} side` }))}
                        onChange={s => setHex(sel, { ...selected, port: { ...selected.port!, side: Number(s) } })} />
                    ) : null}
                  </span>
                </Field>
              </>
            ) : <div className="me-muted">Select a hex.</div>}
          </div>
        </div>
      </Section>
      <Section title="Terrain bags" path={[...path, 'terrainBags']} hint="Hexes with terrain “@bag” draw randomly from the bag.">
        <div className="me-rows">
          {Object.entries(bags).map(([name, ids]) => {
            const counts = new Map<string, number>();
            ids.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
            const setBag = (next: string[] | undefined, newName = name) => {
              const nb: Record<string, string[]> = {};
              for (const [k, x] of Object.entries(bags)) {
                if (k === name) { if (next) nb[newName] = next; } else nb[k] = x;
              }
              onChange({ ...v, terrainBags: Object.keys(nb).length ? nb : undefined });
            };
            return (
              <div key={name} className="me-subcard" data-path={formatPath([...path, 'terrainBags', name])}>
                <div className="me-subcard-head">
                  <TextInput value={name} mono className="me-small" onChange={n => n && !(n in bags) && setBag(ids, n)} />
                  <span className="me-muted">{ids.length} tiles</span><span className="me-spacer" />
                  <button type="button" className="me-icon-btn me-danger" onClick={() => setBag(undefined)}>✕</button>
                </div>
                <div className="me-resmap">
                  {def.terrains.map(t => (
                    <span key={t.id} className={`me-res${counts.get(t.id) ? ' on' : ''}`}>
                      <span className="me-dot" style={{ background: t.color }} />
                      <span className="me-res-name">{t.name}</span>
                      <NumberInput value={counts.get(t.id) ?? 0} small min={0} onChange={n => {
                        const c = new Map(counts); c.set(t.id, Math.max(0, n ?? 0));
                        setBag([...c.entries()].flatMap(([id, k]) => Array(k).fill(id)));
                      }} />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <button type="button" className="me-add-btn me-add-small" onClick={() => {
            let n = 'land'; let i = 2; while (n in bags) n = `land${i++}`;
            onChange({ ...v, terrainBags: { ...bags, [n]: [] } });
          }}>＋ Bag</button>
        </div>
      </Section>
      <div className="me-form-grid">
        <Field label="Number bag" path={[...path, 'numberBag']} help="Numbers dealt to hexes with number “@”.">
          <NumbersInput value={v.numberBag} onChange={nb => onChange({ ...v, numberBag: nb.length ? nb : undefined })} placeholder="2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12" />
        </Field>
        <Field label="Port bag" path={[...path, 'portBag']} help="Port ids dealt to ports marked “@”.">
          <ListInput value={v.portBag} onChange={l => onChange({ ...v, portBag: l })} placeholder="any3, brick2, …" />
        </Field>
      </div>
    </>
  );
}
