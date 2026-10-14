/** One form per collection item type. */
import type {
  ActionDef, AwardDef, CardDef, DeckDef, ModDef, PieceDef, PortDef, ResourceDef, SettingDef, TerrainDef, TokenDef, TriggerDef,
} from '../../engine/schema';
import { EVENTS } from '../../editor/catalog';
import { describeExpr, summarizeEffects } from '../../editor/describe';
import { formatPath, slugify, uniqueId, type Path } from '../../editor/paths';
import { actionScope, atScope, cardScope, eventScope, setupScope } from '../../editor/vars';
import { ConditionField, EffectsField, EventPicker, ExprEditor, ResourceMapEditor } from './blocks';
import { useEditor } from './context';
import { PieceDisplayEditor } from './display';
import {
  Checkbox, ColorInput, Field, ListInput, MultiRef, NumberInput, NumberMap, RefSelect, Section, Select, SuggestInput, TextArea, TextInput,
} from './fields';

export interface FormProps<T> {
  value: T;
  onChange(v: T): void;
  path: Path;
  /** Id also exists in what the mod extends: this item overrides it (don't auto-change the id). */
  overrides: boolean;
  /** Ids used by other items of the same collection. */
  otherIds: string[];
  mod: ModDef;
  updateMod(fn: (m: ModDef) => ModDef): void;
}

type Named = { id: string; name: string };

/** Name + id, where the id follows the name until the designer edits it by hand. */
export function NameId<T extends Named>(props: FormProps<T> & { noName?: boolean }) {
  const { value, onChange, path, overrides, otherIds } = props;
  const follows = !overrides && (value.id === '' || value.id === slugify(value.name ?? '') || value.id === uniqueId(slugify(value.name ?? ''), otherIds));
  const dup = otherIds.includes(value.id);
  return (
    <div className="me-form-grid">
      {props.noName ? null : (
        <Field label="Name" path={[...path, 'name']}>
          <TextInput value={value.name} onChange={name => onChange({ ...value, name, ...(follows && slugify(name) ? { id: uniqueId(slugify(name), otherIds) } : {}) })} />
        </Field>
      )}
      <Field label="Id" path={[...path, 'id']} help="Used by rules and other mods to refer to this. Follows the name until you edit it."
        aside={overrides ? <span className="me-badge me-badge-override" title="An item with this id exists in the mods this extends; yours replaces it.">overrides base</span> : follows ? <span className="me-muted">auto</span> : null}>
        <TextInput value={value.id} onChange={id => onChange({ ...value, id })} mono invalid={!value.id || dup} title={dup ? 'Another item already uses this id' : undefined} />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

export function ResourceForm(props: FormProps<ResourceDef>) {
  const { value: v, onChange, path } = props;
  const { def } = useEditor();
  const kinds = [...new Set(['resource', 'commodity', ...def.resources.map(r => r.kind)])];
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Color" path={[...path, 'color']}><ColorInput value={v.color} onChange={color => onChange({ ...v, color })} /></Field>
        <Field label="Icon" path={[...path, 'icon']} help="Icon key or an emoji"><TextInput value={v.icon} onChange={icon => onChange({ ...v, icon: icon || undefined })} placeholder="🧱" /></Field>
        <Field label="Kind" path={[...path, 'kind']} help="Bank trade rates are set per kind (Rules tab).">
          <SuggestInput value={v.kind} onChange={kind => onChange({ ...v, kind })} suggestions={kinds} />
        </Field>
        <Field label="Bank supply" path={[...path, 'bankSupply']} help="-1 = unlimited">
          <span className="me-inline">
            <NumberInput value={v.bankSupply} onChange={n => onChange({ ...v, bankSupply: n ?? 0 })} small />
            <Checkbox label="Unlimited" value={v.bankSupply === -1} onChange={u => onChange({ ...v, bankSupply: u ? -1 : 19 })} />
          </span>
        </Field>
      </div>
      <TerrainsProducing id={v.id} />
    </>
  );
}

function TerrainsProducing({ id }: { id: string }) {
  const { def } = useEditor();
  const ts = def.terrains.filter(t => t.produces && id in t.produces);
  return (
    <div className="me-note">
      {ts.length ? <>Produced by: {ts.map(t => t.name).join(', ')}.</> : <>⚠ No terrain produces this yet. Add one in the Terrains tab (or use the “Resource + terrain” template).</>}
    </div>
  );
}

export function TerrainForm(props: FormProps<TerrainDef>) {
  const { value: v, onChange, path } = props;
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Color" path={[...path, 'color']}><ColorInput value={v.color} onChange={color => onChange({ ...v, color })} /></Field>
        <Field label="Icon" path={[...path, 'icon']}><TextInput value={v.icon} onChange={icon => onChange({ ...v, icon: icon || undefined })} /></Field>
        <Field label="Flags" path={[...path, 'water']}>
          <span className="me-inline">
            <Checkbox label="Water" value={v.water} onChange={x => onChange({ ...v, water: x || undefined })} />
            <Checkbox label="Gets a number" value={v.numbered} onChange={x => onChange({ ...v, numbered: x || undefined })} />
            <Checkbox label="Hidden (fog)" value={v.hidden} onChange={x => onChange({ ...v, hidden: x || undefined })} />
          </span>
        </Field>
      </div>
      <Field label="Produces" path={[...path, 'produces']} wide help="What a building with production ×1 gets when this hex’s number is rolled.">
        <ResourceMapEditor value={v.produces} onChange={produces => onChange({ ...v, produces: Object.keys(produces).length ? produces : undefined })} path={[...path, 'produces']} scope={[]} />
      </Field>
      <Field label="Player picks instead (gold field)" path={[...path, 'producesChoice']} wide>
        {v.producesChoice ? (
          <div className="me-inline">
            <span>Amount</span>
            <NumberInput value={v.producesChoice.amount} small onChange={n => onChange({ ...v, producesChoice: { ...v.producesChoice!, amount: n ?? 1 } })} />
            <span>from</span>
            <MultiRef collection="resources" value={v.producesChoice.options} onChange={o => onChange({ ...v, producesChoice: { ...v.producesChoice!, options: o.length ? o : undefined } })} />
            <button type="button" className="me-icon-btn" onClick={() => { const c = { ...v }; delete c.producesChoice; onChange(c); }}>×</button>
          </div>
        ) : <button type="button" className="me-chip me-chip-add" onClick={() => onChange({ ...v, producesChoice: { amount: 1 } })}>＋ Let the player choose</button>}
      </Field>
    </>
  );
}

export function PieceForm(props: FormProps<PieceDef>) {
  const { value: v, onChange, path } = props;
  const { def } = useEditor();
  const networks = [...new Set(def.pieces.map(p => p.network).filter(Boolean) as string[])];
  const set = <K extends keyof PieceDef>(k: K, x: PieceDef[K] | undefined) => {
    const c = { ...v };
    if (x === undefined) delete c[k]; else c[k] = x;
    onChange(c);
  };
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Icon" path={[...path, 'icon']}><TextInput value={v.icon} onChange={x => set('icon', x || undefined)} /></Field>
        <Field label="Supply per player" path={[...path, 'supply']} help="-1 = unlimited"><NumberInput value={v.supply} onChange={n => set('supply', n ?? 0)} small /></Field>
        <Field label="Victory points" path={[...path, 'vp']}><NumberInput value={v.vp} onChange={n => set('vp', n || undefined)} small allowEmpty placeholder="0" /></Field>
        <Field label="Production ×" path={[...path, 'productionMultiplier']} help="Settlement 1, city 2. Empty = produces nothing.">
          <NumberInput value={v.productionMultiplier} onChange={n => set('productionMultiplier', n)} small allowEmpty placeholder="0" />
        </Field>
        <Field label="Network" path={[...path, 'network']} help="Pieces with the same network link up for longest-road style networks (e.g. roads).">
          <SuggestInput value={v.network} onChange={x => set('network', x || undefined)} suggestions={networks} placeholder="roads" />
        </Field>
        {v.network ? (
          <Field label="Switch network type" path={[...path, 'networkSwitchAt']} help="In a mixed network (roads + ships), where a route may change from this piece type to another.">
            <Select value={v.networkSwitchAt ?? 'anyVertex'} onChange={x => set('networkSwitchAt', x === 'anyVertex' ? undefined : x as PieceDef['networkSwitchAt'])}
              options={[{ value: 'anyVertex', label: 'Anywhere' }, { value: 'ownPiece', label: 'Only at own building' }]} />
          </Field>
        ) : null}
        <Field label="Breaks networks" path={[...path, 'breaksNetworks']}>
          <Checkbox value={v.breaksNetworks ?? v.placement?.on === 'vertex'} onChange={x => set('breaksNetworks', x)} />
        </Field>
        <Field label="Tags" path={[...path, 'tags']} help="Free-form labels rules can test, e.g. building, knight."><ListInput value={v.tags} onChange={x => set('tags', x)} /></Field>
      </div>
      <Section title="Recipe (build cost)" path={[...path, 'cost']} hint="Empty = can’t be built with the standard Build button.">
        <ResourceMapEditor value={v.cost} onChange={c => set('cost', Object.keys(c).length ? c : undefined)} path={[...path, 'cost']} scope={[]} />
        <Field label="Upgrades from" path={[...path, 'upgradesFrom']} wide help="Building this replaces one of these at the same spot.">
          <MultiRef collection="pieces" value={v.upgradesFrom} onChange={x => set('upgradesFrom', x.length ? x : undefined)} />
        </Field>
      </Section>
      <Section title="Placement" path={[...path, 'placement']}>
        <Field label="Sits on" path={[...path, 'placement', 'on']}>
          <Select value={v.placement?.on} onChange={on => set('placement', { ...v.placement, on: on as 'hex' | 'vertex' | 'edge' })}
            options={[{ value: 'vertex', label: 'Corner (vertex)' }, { value: 'edge', label: 'Edge' }, { value: 'hex', label: 'Hex' }]} />
        </Field>
        <Field label="Allowed where" path={[...path, 'placement', 'where']} wide help="`at` is the spot being considered.">
          <ConditionField value={v.placement?.where} onChange={where => set('placement', { ...v.placement, where })} path={[...path, 'placement', 'where']} scope={atScope()} />
        </Field>
        <Field label="During setup" path={[...path, 'placement', 'setupWhere']} wide help="Looser rule for setup rounds. Default: same rule minus the connection requirement.">
          {v.placement?.setupWhere !== undefined ? (
            <div>
              <ConditionField value={v.placement.setupWhere} onChange={sw => set('placement', { ...v.placement, setupWhere: sw })} path={[...path, 'placement', 'setupWhere']} scope={setupScope()} />
              <button type="button" className="me-btn me-btn-small" onClick={() => { const pl = { ...v.placement }; delete pl.setupWhere; set('placement', pl); }}>Use default</button>
            </div>
          ) : <button type="button" className="me-chip me-chip-add" onClick={() => set('placement', { ...v.placement, setupWhere: true })}>＋ Custom setup rule</button>}
        </Field>
      </Section>
      <Section title="Extras">
        <Field label="Production bonus" path={[...path, 'productionBonus']} wide help="Extra goods when next to a terrain (e.g. C&K city on forest gives paper).">
          <div className="me-rows">
            {(v.productionBonus ?? []).map((b, i) => (
              <div key={i} className="me-row" data-path={formatPath([...path, 'productionBonus', i])}>
                <span>On</span>
                <RefSelect collection="terrains" value={b.terrain} onChange={t => set('productionBonus', v.productionBonus!.map((x, j) => (j === i ? { ...x, terrain: t } : x)))} />
                <span>also gives</span>
                <ResourceMapEditor value={b.gives} onChange={g => set('productionBonus', v.productionBonus!.map((x, j) => (j === i ? { ...x, gives: g } : x)))} path={[...path, 'productionBonus', i, 'gives']} scope={[]} />
                <button type="button" className="me-icon-btn me-danger" onClick={() => set('productionBonus', v.productionBonus!.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="me-add-btn me-add-small" onClick={() => set('productionBonus', [...(v.productionBonus ?? []), { terrain: def.terrains[0]?.id ?? '', gives: {} }])}>＋ Bonus</button>
          </div>
        </Field>
        <Field label="Initial state" path={[...path, 'initialState']} help="Numbers stored on each piece (e.g. strength, active).">
          <NumberMap value={v.initialState} onChange={x => set('initialState', x)} keyPlaceholder="strength" />
        </Field>
        <Field label="Actions on this piece" path={[...path, 'pieceActions']} wide>
          <MultiRef collection="actions" value={v.pieceActions} onChange={x => set('pieceActions', x.length ? x : undefined)} />
        </Field>
      </Section>
      <Section title="On the board" path={[...path, 'display']} hint="How the game screen draws this piece's state and cargo (looks only).">
        <PieceDisplayEditor value={v.display} onChange={d => set('display', d)} path={[...path, 'display']} stateKeys={Object.keys(v.initialState ?? {})} />
      </Section>
      <Section title="Piece triggers" path={[...path, 'triggers']} hint="Rules that only apply while this piece type exists.">
        <TriggerList value={v.triggers ?? []} onChange={t => set('triggers', t.length ? t : undefined)} path={[...path, 'triggers']} />
      </Section>
    </>
  );
}

function TriggerList(props: { value: TriggerDef[]; onChange(v: TriggerDef[]): void; path: Path }) {
  const list = props.value;
  return (
    <div className="me-rows">
      {list.map((t, i) => (
        <div key={i} className="me-subcard">
          <div className="me-subcard-head">
            <b>{EVENTS[t.on as keyof typeof EVENTS]?.label ?? t.on}</b> <span className="me-muted me-mono">{t.id}</span>
            <span className="me-spacer" />
            <button type="button" className="me-icon-btn me-danger" onClick={() => props.onChange(list.filter((_, j) => j !== i))}>✕</button>
          </div>
          <TriggerBody value={t} onChange={x => props.onChange(list.map((y, j) => (j === i ? x : y)))} path={[...props.path, i]} />
        </div>
      ))}
      <button type="button" className="me-add-btn me-add-small" onClick={() => props.onChange([...list, { id: uniqueId('trigger', list.map(t => t.id)), on: 'piecePlaced', do: [] }])}>＋ Trigger</button>
    </div>
  );
}

export function CardForm(props: FormProps<CardDef>) {
  const { value: v, onChange, path } = props;
  const { def, suggestions } = useEditor();
  const groups = [...new Set(def.cards.map(c => c.play?.limitGroup).filter(Boolean) as string[])];
  const play = v.play ?? { timing: 'ownTurn' };
  const setPlay = (p: CardDef['play']) => onChange({ ...v, play: p });
  return (
    <>
      <NameId {...props} />
      <Field label="Card text" path={[...path, 'description']} wide>
        <TextArea value={v.description} onChange={description => onChange({ ...v, description })} rows={2} placeholder="What players read on the card" />
      </Field>
      <div className="me-form-grid">
        <Field label="Icon" path={[...path, 'icon']}><TextInput value={v.icon} onChange={x => onChange({ ...v, icon: x || undefined })} /></Field>
        <Field label="When playable" path={[...path, 'play', 'timing']}>
          <Select value={play.timing} onChange={t => setPlay({ ...play, timing: t as CardDef['play']['timing'] })} options={[
            { value: 'ownTurn', label: 'On your turn' },
            { value: 'ownTurnBeforeRoll', label: 'Your turn, before rolling' },
            { value: 'ownTurnAfterRoll', label: 'Your turn, after rolling' },
            { value: 'anyTime', label: 'Any time' },
            { value: 'immediate', label: 'Immediately when drawn' },
            { value: 'never', label: 'Never (kept, e.g. VP card)' },
          ]} />
        </Field>
        <Field label="Not on the turn bought" path={[...path, 'play', 'notOnAcquiredTurn']}>
          <Checkbox value={play.notOnAcquiredTurn ?? play.timing.startsWith('ownTurn')} onChange={x => setPlay({ ...play, notOnAcquiredTurn: x })} />
        </Field>
        <Field label="One-per-turn group" path={[...path, 'play', 'limitGroup']} help="Cards sharing a group share a one-per-turn limit.">
          <SuggestInput value={play.limitGroup} onChange={x => setPlay({ ...play, limitGroup: x || undefined })} suggestions={groups} placeholder="development" />
        </Field>
        <Field label="After play" path={[...path, 'afterPlay']}>
          <Select value={v.afterPlay ?? 'discard'} onChange={x => onChange({ ...v, afterPlay: x as CardDef['afterPlay'] })} options={[
            { value: 'discard', label: 'Discard' }, { value: 'returnToDeck', label: 'Back into the deck' }, { value: 'keepFaceUp', label: 'Stays face up' },
          ]} />
        </Field>
        <Field label="Hidden VP while held" path={[...path, 'vp']}><NumberInput value={v.vp} onChange={n => onChange({ ...v, vp: n || undefined })} small allowEmpty placeholder="0" /></Field>
        <Field label="Counts as stat" path={[...path, 'countsAs']} help="Stat added when played, e.g. knightsPlayed for Largest Army.">
          <SuggestInput value={v.countsAs} onChange={x => onChange({ ...v, countsAs: x || undefined })} suggestions={suggestions.stat} mono />
        </Field>
      </div>
      <Field label="Extra play condition" path={[...path, 'play', 'cond']} wide>
        {play.cond !== undefined ? (
          <div>
            <ConditionField value={play.cond} onChange={cond => setPlay({ ...play, cond })} path={[...path, 'play', 'cond']} scope={cardScope()} />
            <button type="button" className="me-btn me-btn-small" onClick={() => { const p = { ...play }; delete p.cond; setPlay(p); }}>Remove condition</button>
          </div>
        ) : <button type="button" className="me-chip me-chip-add" onClick={() => setPlay({ ...play, cond: true })}>＋ Only playable if…</button>}
      </Field>
      <Section title="When played" path={[...path, 'effect']}>
        <EffectsField value={v.effect} onChange={effect => onChange({ ...v, effect })} path={[...path, 'effect']} scope={cardScope()} emptyHint="Add what happens when the card is played." />
      </Section>
      <CardDecks {...props} />
    </>
  );
}

/** Which decks contain this card, with "add to deck" that copies a base deck into the mod if needed. */
function CardDecks(props: FormProps<CardDef>) {
  const { def } = useEditor();
  const id = props.value.id;
  const holding = def.decks.filter(d => d.cards?.some(c => c.card === id));
  const others = def.decks.filter(d => !holding.includes(d));
  const addTo = (deckId: string) => {
    props.updateMod(m => {
      const own = m.decks?.find(d => d.id === deckId);
      const base = def.decks.find(d => d.id === deckId)!;
      const deck: DeckDef = structuredClone(own ?? base);
      deck.cards = [...(deck.cards ?? []), { card: id, count: 1 }];
      const decks = own ? m.decks!.map(d => (d.id === deckId ? deck : d)) : [...(m.decks ?? []), deck];
      return { ...m, decks };
    });
  };
  return (
    <Section title="Decks" hint="A card must be in a deck before anyone can draw it.">
      <div className="me-inline">
        {holding.length ? holding.map(d => (
          <span key={d.id} className="me-badge">{d.name} ×{d.cards.find(c => c.card === id)?.count}</span>
        )) : <span className="me-warn-text">Not in any deck yet.</span>}
        {others.length ? (
          <Select value="" placeholder="Add to deck…" options={others.map(d => ({ value: d.id, label: d.name }))} onChange={addTo} />
        ) : null}
      </div>
      {others.some(d => !props.mod.decks?.some(x => x.id === d.id)) ? (
        <div className="me-note">Adding to a base deck copies that deck into your mod (as an override).</div>
      ) : null}
    </Section>
  );
}

export function DeckForm(props: FormProps<DeckDef>) {
  const { value: v, onChange, path } = props;
  const cards = v.cards ?? [];
  const total = cards.reduce((s, c) => s + (c.count || 0), 0);
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Color" path={[...path, 'color']}><ColorInput value={v.color} onChange={color => onChange({ ...v, color })} /></Field>
        <Field label="Hand limit" path={[...path, 'handLimit']}><NumberInput value={v.handLimit} onChange={n => onChange({ ...v, handLimit: n })} small allowEmpty placeholder="none" /></Field>
        <Field label="Options" path={[...path, 'public']}>
          <span className="me-inline">
            <Checkbox label="Face up (public)" value={v.public} onChange={x => onChange({ ...v, public: x || undefined })} />
            <Checkbox label="Reshuffle discards" value={v.reshuffleDiscards} onChange={x => onChange({ ...v, reshuffleDiscards: x || undefined })} />
          </span>
        </Field>
      </div>
      <Section title={`Cards (${total} total)`} path={[...path, 'cards']}>
        <div className="me-rows">
          {cards.map((c, i) => (
            <div key={i} className="me-row" data-path={formatPath([...path, 'cards', i])}>
              <NumberInput value={c.count} small min={0} onChange={n => onChange({ ...v, cards: cards.map((x, j) => (j === i ? { ...x, count: n ?? 0 } : x)) })} />
              <span>×</span>
              <RefSelect collection="cards" value={c.card} onChange={card => onChange({ ...v, cards: cards.map((x, j) => (j === i ? { ...x, card } : x)) })} />
              <button type="button" className="me-icon-btn me-danger" onClick={() => onChange({ ...v, cards: cards.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="me-add-btn me-add-small" onClick={() => onChange({ ...v, cards: [...cards, { card: '', count: 1 }] })}>＋ Card</button>
        </div>
      </Section>
      <Section title="Price" path={[...path, 'cost']} hint="Empty = can’t be bought.">
        <ResourceMapEditor value={v.cost} onChange={cost => onChange({ ...v, cost: Object.keys(cost).length ? cost : undefined })} path={[...path, 'cost']} scope={[]} />
      </Section>
    </>
  );
}

export function ActionForm(props: FormProps<ActionDef>) {
  const { value: v, onChange, path } = props;
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Button group" path={[...path, 'group']}>
          <SuggestInput value={v.group} onChange={g => onChange({ ...v, group: g || undefined })} suggestions={['build', 'cards', 'trade', 'special']} />
        </Field>
        <Field label="Icon" path={[...path, 'icon']}><TextInput value={v.icon} onChange={x => onChange({ ...v, icon: x || undefined })} /></Field>
        <Field label="Uses per turn" path={[...path, 'limitPerTurn']}><NumberInput value={v.limitPerTurn} onChange={n => onChange({ ...v, limitPerTurn: n })} small allowEmpty placeholder="∞" /></Field>
      </div>
      <Field label="Description" path={[...path, 'description']} wide><TextArea value={v.description} onChange={d => onChange({ ...v, description: d || undefined })} rows={2} /></Field>
      <Section title="Cost" path={[...path, 'cost']}>
        <ResourceMapEditor value={v.cost} onChange={cost => onChange({ ...v, cost: Object.keys(cost).length ? cost : undefined })} path={[...path, 'cost']} scope={[]} />
      </Section>
      <Section title="Available when" path={[...path, 'available']}>
        <ConditionField value={v.available} onChange={available => onChange({ ...v, available })} path={[...path, 'available']} scope={actionScope()} />
      </Section>
      <Section title="What it does" path={[...path, 'effect']}>
        <EffectsField value={v.effect} onChange={effect => onChange({ ...v, effect })} path={[...path, 'effect']} scope={actionScope()} />
      </Section>
    </>
  );
}

export function TokenForm(props: FormProps<TokenDef>) {
  const { value: v, onChange, path } = props;
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Icon" path={[...path, 'icon']}><TextInput value={v.icon} onChange={x => onChange({ ...v, icon: x || undefined })} /></Field>
        <Field label="Sits on" path={[...path, 'on']}>
          <Select value={v.on} onChange={on => onChange({ ...v, on: on as TokenDef['on'] })} options={[{ value: 'hex', label: 'Hex' }, { value: 'vertex', label: 'Corner' }, { value: 'edge', label: 'Edge' }]} />
        </Field>
        <Field label="Blocks production" path={[...path, 'blocksProduction']}><Checkbox value={v.blocksProduction} onChange={x => onChange({ ...v, blocksProduction: x || undefined })} /></Field>
        <Field label="Starts" path={[...path, 'start']}>
          <span className="me-inline">
            <Select value={v.start ?? 'none'} onChange={s => onChange({ ...v, start: s as TokenDef['start'] })} options={[{ value: 'none', label: 'Off the board' }, { value: 'firstOfTerrain', label: 'On the first hex of…' }]} />
            {v.start === 'firstOfTerrain' ? <RefSelect collection="terrains" value={v.startTerrain} onChange={t => onChange({ ...v, startTerrain: t })} /> : null}
          </span>
        </Field>
      </div>
      <Section title="Can move to" path={[...path, 'where']}>
        <ConditionField value={v.where} onChange={where => onChange({ ...v, where })} path={[...path, 'where']} scope={atScope()} />
      </Section>
      <Section title="After it moves" path={[...path, 'onMove']} hint="`at` is the new location.">
        <EffectsField value={v.onMove} onChange={onMove => onChange({ ...v, onMove: onMove.length ? onMove : undefined })} path={[...path, 'onMove']} scope={atScope()} />
      </Section>
    </>
  );
}

export function AwardForm(props: FormProps<AwardDef>) {
  const { value: v, onChange, path } = props;
  const { dctx } = useEditor();
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Victory points" path={[...path, 'vp']}><NumberInput value={v.vp} onChange={n => onChange({ ...v, vp: n ?? 0 })} small /></Field>
        <Field label="Minimum score" path={[...path, 'min']}><NumberInput value={v.min} onChange={n => onChange({ ...v, min: n ?? 0 })} small /></Field>
        <Field label="Holder keeps on tie" path={[...path, 'holderKeepsOnTie']}><Checkbox value={v.holderKeepsOnTie} onChange={x => onChange({ ...v, holderKeepsOnTie: x || undefined })} /></Field>
        <Field label="Once won" path={[...path, 'mode']} help="“Kept until beaten”: the holder keeps it even if their score drops, until someone strictly beats them (metropolis).">
          <Select value={v.mode ?? 'highest'} onChange={x => { const c = { ...v }; if (x === 'highest') delete c.mode; else c.mode = x as AwardDef['mode']; onChange(c); }}
            options={[{ value: 'highest', label: 'Goes to the current leader' }, { value: 'keepUntilBeaten', label: 'Kept until beaten' }]} />
        </Field>
      </div>
      <Section title="Score (per player)" path={[...path, 'metric']} hint="“You” means the player being scored.">
        <ExprEditor value={v.metric} onChange={metric => onChange({ ...v, metric: metric ?? 0 })} path={[...path, 'metric']} scope={[]} />
        <div className="me-preview me-preview-inline">
          <span className="me-preview-title">Means</span> goes to the player with the most of {describeExpr(v.metric, dctx)} (at least {v.min}).
        </div>
      </Section>
    </>
  );
}

export function PortForm(props: FormProps<PortDef>) {
  const { value: v, onChange, path } = props;
  return (
    <>
      <NameId {...props} value={{ ...v, name: '' } as PortDef & { name: string }} onChange={x => onChange({ ...v, id: x.id })} noName />
      <div className="me-form-grid">
        <Field label="Trades" path={[...path, 'resource']}>
          <RefSelect collection="resources" value={v.resource} onChange={resource => onChange({ ...v, resource })} extra={[{ value: 'any', label: 'Any resource (generic)' }]} />
        </Field>
        <Field label="Ratio (N:1)" path={[...path, 'ratio']}><NumberInput value={v.ratio} onChange={n => onChange({ ...v, ratio: n ?? 3 })} small /></Field>
      </div>
    </>
  );
}

function TriggerBody(props: { value: TriggerDef; onChange(v: TriggerDef): void; path: Path }) {
  const { value: v, onChange, path } = props;
  const scope = eventScope(v.on);
  return (
    <>
      <div className="me-form-grid">
        <Field label="When" path={[...path, 'on']}><EventPicker value={v.on} onChange={on => onChange({ ...v, on })} /></Field>
        <Field label="“You” means" path={[...path, 'as']}>
          <Select value={v.as ?? 'current'} onChange={as => onChange({ ...v, as: as as TriggerDef['as'] })} options={[
            { value: 'current', label: 'The current player' },
            { value: 'eventPlayer', label: 'The player the event is about' },
            { value: 'eachPlayer', label: 'Each player in turn' },
          ]} />
        </Field>
        <Field label="Priority" path={[...path, 'priority']} help="Lower runs first."><NumberInput value={v.priority} onChange={n => onChange({ ...v, priority: n })} small allowEmpty placeholder="0" /></Field>
      </div>
      {scope.length ? (
        <div className="me-note">Event data you can use: {scope.map(s => <code key={s.name} className="me-var-chip" title={s.source}>{s.name}</code>)}</div>
      ) : null}
      <Field label="Only if" path={[...path, 'when']} wide>
        {v.when !== undefined ? (
          <div>
            <ConditionField value={v.when} onChange={when => onChange({ ...v, when })} path={[...path, 'when']} scope={scope} />
            <button type="button" className="me-btn me-btn-small" onClick={() => { const c = { ...v }; delete c.when; onChange(c); }}>Always run</button>
          </div>
        ) : <button type="button" className="me-chip me-chip-add" onClick={() => onChange({ ...v, when: true })}>＋ Only if…</button>}
      </Field>
      <Field label="Then" path={[...path, 'do']} wide>
        <EffectsField value={v.do} onChange={d => onChange({ ...v, do: d })} path={[...path, 'do']} scope={scope} />
      </Field>
    </>
  );
}

export function TriggerForm(props: FormProps<TriggerDef>) {
  return (
    <>
      <NameId {...props} value={{ ...props.value, name: '' }} onChange={x => props.onChange({ ...props.value, id: x.id })} noName />
      <TriggerBody value={props.value} onChange={props.onChange} path={props.path} />
    </>
  );
}

export function SettingForm(props: FormProps<SettingDef>) {
  const { value: v, onChange, path } = props;
  return (
    <>
      <NameId {...props} />
      <div className="me-form-grid">
        <Field label="Type" path={[...path, 'type']}>
          <Select value={v.type} onChange={t => {
            const type = t as SettingDef['type'];
            onChange({ ...v, type, default: type === 'boolean' ? false : type === 'number' ? 0 : (v.options?.[0]?.value ?? '') });
          }} options={[{ value: 'number', label: 'Number' }, { value: 'boolean', label: 'On / off' }, { value: 'select', label: 'Pick one' }]} />
        </Field>
        <Field label="Default" path={[...path, 'default']}>
          {v.type === 'boolean' ? <Checkbox value={v.default as boolean} onChange={d => onChange({ ...v, default: d })} />
            : v.type === 'number' ? <NumberInput value={v.default as number} onChange={d => onChange({ ...v, default: d ?? 0 })} small />
              : <Select value={v.default as string} onChange={d => onChange({ ...v, default: d })} options={(v.options ?? []).map(o => ({ value: o.value, label: o.label }))} />}
        </Field>
        {v.type === 'number' ? (
          <>
            <Field label="Min" path={[...path, 'min']}><NumberInput value={v.min} onChange={n => onChange({ ...v, min: n })} small allowEmpty /></Field>
            <Field label="Max" path={[...path, 'max']}><NumberInput value={v.max} onChange={n => onChange({ ...v, max: n })} small allowEmpty /></Field>
          </>
        ) : null}
      </div>
      {v.type === 'select' ? (
        <Section title="Choices" path={[...path, 'options']}>
          <div className="me-rows">
            {(v.options ?? []).map((o, i) => (
              <div key={i} className="me-row">
                <TextInput value={o.label} placeholder="Label" onChange={label => onChange({ ...v, options: v.options!.map((x, j) => (j === i ? { ...x, label, value: x.value || slugify(label) } : x)) })} />
                <TextInput value={o.value} placeholder="value" mono onChange={value => onChange({ ...v, options: v.options!.map((x, j) => (j === i ? { ...x, value } : x)) })} />
                <button type="button" className="me-icon-btn me-danger" onClick={() => onChange({ ...v, options: v.options!.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button type="button" className="me-add-btn me-add-small" onClick={() => onChange({ ...v, options: [...(v.options ?? []), { value: '', label: '' }] })}>＋ Choice</button>
          </div>
        </Section>
      ) : null}
      <div className="me-note">
        {v.type === 'boolean' ? <>Test it in rules with the check “Lobby setting is on”.</> : <>Use it in rules with the formula “Lobby setting”.</>}
      </div>
    </>
  );
}

/** One-line subtitle for list items. */
export function itemSubtitle(collection: string, item: Record<string, unknown>, dctx: import('../../editor/describe').DescribeContext): string {
  switch (collection) {
    case 'cards': return summarizeEffects(item.effect as never, dctx);
    case 'actions': return summarizeEffects(item.effect as never, dctx);
    case 'triggers': return `${EVENTS[item.on as keyof typeof EVENTS]?.label ?? item.on}: ${summarizeEffects(item.do as never, dctx)}`;
    case 'tokens': return item.onMove ? `On move: ${summarizeEffects(item.onMove as never, dctx)}` : String(item.on ?? '');
    case 'pieces': {
      const p = item as unknown as PieceDef;
      return [p.placement?.on, p.vp ? `${p.vp} VP` : '', p.cost ? 'buildable' : ''].filter(Boolean).join(' · ');
    }
    case 'resources': return String(item.kind ?? '');
    case 'decks': return `${((item.cards as DeckDef['cards']) ?? []).reduce((s, c) => s + (c.count || 0), 0)} cards`;
    case 'awards': return `${item.vp} VP · ${describeExpr(item.metric as never, dctx)}`;
    case 'ports': return `${item.resource === 'any' ? 'Any' : item.resource} ${item.ratio}:1`;
    case 'settings': return String(item.type ?? '');
    case 'maps': return `${(item.hexes as unknown[] | undefined)?.length ?? 0} hexes · ${item.minPlayers}–${item.maxPlayers} players`;
    case 'terrains': return item.produces ? `produces ${Object.keys(item.produces as object).join(', ')}` : item.water ? 'water' : '';
  }
  return '';
}
