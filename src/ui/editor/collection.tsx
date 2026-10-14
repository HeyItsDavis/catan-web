/** Generic tab for one mod collection: item list (+ base items / overrides / removals) and the item form. */
import { useState, type ComponentType } from 'react';
import type { CollectionKey, ModDef } from '../../engine/schema';
import { formatPath, uniqueId } from '../../editor/paths';
import { TEMPLATES, applyTemplate } from '../../editor/templates';
import { useEditor } from './context';
import {
  ActionForm, AwardForm, CardForm, DeckForm, PortForm, PieceForm, ResourceForm, SettingForm, TerrainForm, TokenForm, TriggerForm,
  itemSubtitle, type FormProps,
} from './forms';
import { MapForm } from './maps';

type Item = { id: string; name?: string } & Record<string, unknown>;

interface CollectionInfo {
  label: string;
  singular: string;
  blurb: string;
  Form: ComponentType<FormProps<any>>;
  blank(): Record<string, unknown>;
}

export const COLLECTIONS: Record<CollectionKey, CollectionInfo> = {
  resources: { label: 'Resources', singular: 'resource', blurb: 'Cards players collect and spend (brick, wool, paper…).', Form: ResourceForm,
    blank: () => ({ color: '#999999', kind: 'resource', bankSupply: 19 }) },
  terrains: { label: 'Terrains', singular: 'terrain', blurb: 'Hex types on the board and what they produce.', Form: TerrainForm,
    blank: () => ({ color: '#88aa66', numbered: true, produces: {} }) },
  pieces: { label: 'Pieces', singular: 'piece', blurb: 'Buildings, roads, ships, knights — anything placed on the board.', Form: PieceForm,
    blank: () => ({ supply: 5, placement: { on: 'vertex', where: true } }) },
  cards: { label: 'Cards', singular: 'card', blurb: 'Development / progress cards and what they do.', Form: CardForm,
    blank: () => ({ description: '', play: { timing: 'ownTurn' }, effect: [] }) },
  decks: { label: 'Decks', singular: 'deck', blurb: 'Which cards are in which deck, and what a card costs.', Form: DeckForm,
    blank: () => ({ cards: [] }) },
  actions: { label: 'Actions', singular: 'action', blurb: 'Named buttons (recipes): pay a cost, run steps.', Form: ActionForm,
    blank: () => ({ available: { all: [{ isTurnOf: 'self' }, { hasRolled: true }] }, effect: [] }) },
  tokens: { label: 'Tokens', singular: 'token', blurb: 'Robber, pirate, merchant… shared markers that move around.', Form: TokenForm,
    blank: () => ({ on: 'hex', where: true }) },
  awards: { label: 'Awards', singular: 'award', blurb: 'Bonus VP for the leader in something (Longest Road…).', Form: AwardForm,
    blank: () => ({ vp: 2, metric: 0, min: 1 }) },
  ports: { label: 'Ports', singular: 'port', blurb: 'Harbor types and their trade ratios.', Form: PortForm,
    blank: () => ({ resource: 'any', ratio: 3 }) },
  triggers: { label: 'Triggers', singular: 'trigger', blurb: '“When X happens, do Y” rules.', Form: TriggerForm,
    blank: () => ({ on: 'turnStart', do: [] }) },
  settings: { label: 'Settings', singular: 'setting', blurb: 'Options the host picks in the lobby.', Form: SettingForm,
    blank: () => ({ type: 'boolean', default: false }) },
  maps: { label: 'Maps', singular: 'map', blurb: 'Board layouts the lobby can choose.', Form: MapForm,
    blank: () => ({ minPlayers: 3, maxPlayers: 4, hexes: [] }) },
};

const titleOf = (k: CollectionKey, it: Item) =>
  k === 'triggers' ? it.id : k === 'ports' ? `${it.id}` : (it.name || it.id || '(unnamed)');

export function CollectionTab(props: {
  k: CollectionKey;
  mod: ModDef;
  onChange(m: ModDef): void;
  selected: number | undefined;
  onSelect(i: number | undefined): void;
}) {
  const { k, mod, onChange } = props;
  const info = COLLECTIONS[k];
  const { parent, def, dctx } = useEditor();
  const [showBase, setShowBase] = useState(true);
  const items = ((mod[k] ?? []) as unknown as Item[]);
  const parentItems = (parent[k] as unknown as Item[]);
  const parentIds = new Set(parentItems.map(x => x.id));
  const removed = mod.remove?.[k] ?? [];
  const sel = props.selected !== undefined && props.selected < items.length ? props.selected : items.length ? 0 : undefined;
  const current = sel !== undefined ? items[sel] : undefined;

  const setItems = (next: Item[]) => {
    const m = { ...mod } as Record<string, unknown>;
    if (next.length) m[k] = next; else delete m[k];
    onChange(m as unknown as ModDef);
  };
  const setRemoved = (ids: string[]) => {
    const r = { ...(mod.remove ?? {}) };
    if (ids.length) r[k] = ids; else delete r[k];
    const m = { ...mod, remove: r };
    if (!Object.keys(r).length) delete (m as Partial<ModDef>).remove;
    onChange(m);
  };
  const allIds = () => [...items.map(i => i.id), ...parentItems.map(i => i.id)];

  const addNew = () => {
    const name = `New ${info.singular}`;
    const id = uniqueId(`new-${info.singular}`, allIds());
    const item = { id, ...(k === 'ports' || k === 'triggers' ? {} : { name }), ...info.blank() } as Item;
    setItems([...items, item]);
    props.onSelect(items.length);
  };
  const override = (base: Item) => {
    setItems([...items, structuredClone(base)]);
    props.onSelect(items.length);
  };
  const templates = TEMPLATES.filter(t => t.collection === k);

  return (
    <div className="me-coll">
      <aside className="me-coll-list">
        <div className="me-coll-head">
          <h2>{info.label}</h2>
          <p className="me-muted">{info.blurb}</p>
          <div className="me-inline me-wrap">
            <button type="button" className="me-btn me-btn-primary" onClick={addNew}>＋ New {info.singular}</button>
            {templates.map(t => (
              <button key={t.id} type="button" className="me-btn" title={t.description} onClick={() => {
                const res = t.make({ def, mod });
                const next = applyTemplate(mod, res);
                onChange(next);
                props.onSelect(((next[res.focus.collection] ?? []) as unknown as Item[]).findIndex(x => x.id === res.focus.id));
              }}>✦ {t.label}</button>
            ))}
          </div>
        </div>
        <div className="me-list-group">
          <div className="me-list-title">In this mod ({items.length})</div>
          {items.length === 0 ? <div className="me-empty">Nothing yet. Create one, start from a template, or customise a base {info.singular} below.</div> : null}
          {items.map((it, i) => (
            <button key={i} type="button" className={`me-list-item${i === sel ? ' sel' : ''}`} onClick={() => props.onSelect(i)} data-path={formatPath([k, i])}>
              <span className="me-list-item-title">
                {typeof it.color === 'string' ? <span className="me-dot" style={{ background: it.color }} /> : null}
                {titleOf(k, it)}
                {parentIds.has(it.id) ? <span className="me-badge me-badge-override">overrides base</span> : <span className="me-badge me-badge-new">new</span>}
              </span>
              <span className="me-list-item-sub">{itemSubtitle(k, it, dctx)}</span>
            </button>
          ))}
        </div>
        {parentItems.length ? (
          <div className="me-list-group">
            <button type="button" className="me-list-title me-linkish" onClick={() => setShowBase(!showBase)}>
              {showBase ? '▾' : '▸'} From base ({parentItems.length})
            </button>
            {showBase ? parentItems.map(b => {
              const isOverridden = items.some(x => x.id === b.id);
              const isRemoved = removed.includes(b.id);
              return (
                <div key={b.id} className={`me-base-item${isRemoved ? ' removed' : ''}`}>
                  <span className="me-list-item-title">
                    {typeof b.color === 'string' ? <span className="me-dot" style={{ background: b.color }} /> : null}
                    {titleOf(k, b)}
                  </span>
                  <span className="me-spacer" />
                  {isRemoved ? (
                    <button type="button" className="me-btn me-btn-small" onClick={() => setRemoved(removed.filter(x => x !== b.id))}>Restore</button>
                  ) : isOverridden ? (
                    <span className="me-muted">customised</span>
                  ) : (
                    <>
                      <button type="button" className="me-btn me-btn-small" title="Copy into this mod and edit it" onClick={() => override(b)}>Customise</button>
                      <button type="button" className="me-btn me-btn-small me-danger" title={`Remove this ${info.singular} from the game`} onClick={() => setRemoved([...removed, b.id])}>Remove</button>
                    </>
                  )}
                </div>
              );
            }) : null}
          </div>
        ) : null}
        {removed.filter(id => !parentIds.has(id)).length ? (
          <div className="me-list-group" data-path={formatPath(['remove', k])}>
            <div className="me-list-title">Removed (not found in base)</div>
            {removed.map((id, i) => parentIds.has(id) ? null : (
              <div key={id} className="me-base-item removed" data-path={formatPath(['remove', k, i])}>
                <span className="me-mono">{id}</span><span className="me-spacer" />
                <button type="button" className="me-btn me-btn-small" onClick={() => setRemoved(removed.filter(x => x !== id))}>Drop</button>
              </div>
            ))}
          </div>
        ) : null}
      </aside>
      <div className="me-coll-form">
        {current && sel !== undefined ? (
          <ItemEditor
            key={`${k}-${sel}`}
            k={k}
            index={sel}
            item={current}
            items={items}
            parentItem={parentItems.find(p => p.id === current.id)}
            mod={mod}
            onChange={onChange}
            setItems={setItems}
            onSelect={props.onSelect}
          />
        ) : (
          <div className="me-empty me-empty-big">
            Select a {info.singular} on the left, or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function ItemEditor(props: {
  k: CollectionKey; index: number; item: Item; items: Item[]; parentItem?: Item; mod: ModDef;
  onChange(m: ModDef): void; setItems(i: Item[]): void; onSelect(i: number | undefined): void;
}) {
  const { k, index: i, item, items, parentItem } = props;
  const info = COLLECTIONS[k];
  const { parent } = useEditor();
  const Form = info.Form;
  const otherIds = [...items.filter((_, j) => j !== i).map(x => x.id)];
  const update = (v: Item) => props.setItems(items.map((x, j) => (j === i ? v : x)));
  return (
    <div className="me-form" data-path={formatPath([k, i])}>
      <div className="me-form-toolbar">
        <h2>{titleOf(k, item)}</h2>
        {parentItem ? <span className="me-badge me-badge-override">overrides base</span> : null}
        <span className="me-spacer" />
        {parentItem ? (
          <button type="button" className="me-btn" title="Throw away your changes and start again from the base version"
            onClick={() => { if (confirm(`Replace with the base version of “${parentItem.name ?? parentItem.id}”?`)) update(structuredClone(parentItem)); }}>
            ↺ Copy from base
          </button>
        ) : null}
        <button type="button" className="me-icon-btn" title="Move up" disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; props.setItems(n); props.onSelect(i - 1); }}>↑</button>
        <button type="button" className="me-icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; props.setItems(n); props.onSelect(i + 1); }}>↓</button>
        <button type="button" className="me-btn" onClick={() => {
          const copy = structuredClone(item);
          copy.id = uniqueId(`${item.id}-copy`, [...items.map(x => x.id), ...(parent[k] as unknown as Item[]).map(x => x.id)]);
          if (typeof copy.name === 'string') copy.name = `${copy.name} (copy)`;
          props.setItems([...items.slice(0, i + 1), copy, ...items.slice(i + 1)]);
          props.onSelect(i + 1);
        }}>⧉ Duplicate</button>
        <button type="button" className="me-btn me-danger" onClick={() => {
          if (!confirm(parentItem ? `Stop overriding “${titleOf(k, item)}”? The base version will be used again.` : `Delete “${titleOf(k, item)}”?`)) return;
          props.setItems(items.filter((_, j) => j !== i));
          props.onSelect(Math.max(0, i - 1));
        }}>{parentItem ? 'Revert to base' : 'Delete'}</button>
      </div>
      <Form value={item} onChange={update} path={[k, i]} overrides={!!parentItem} otherIds={otherIds} mod={props.mod}
        updateMod={fn => props.onChange(fn(props.mod))} />
    </div>
  );
}
