/** Rules tab: VP target, discard limit, setup rounds, trade rules, dice. */
import type { ReactNode } from 'react';
import type { DiceDef, ModDef, SetupRound, TradeRules } from '../../engine/schema';
import { useEditor } from './context';
import { Checkbox, Field, ListInput, NumberInput, NumberMap, RefSelect, Section, Select, TextInput } from './fields';

function Inherit(props: { inherited: boolean; summary: ReactNode; onCustomize(): void; onReset(): void; children: ReactNode }) {
  if (props.inherited) {
    return (
      <div className="me-inherit">
        <span className="me-muted">Inherited:</span> {props.summary}
        <button type="button" className="me-btn me-btn-small" onClick={props.onCustomize}>Customize</button>
      </div>
    );
  }
  return (
    <div>
      {props.children}
      <button type="button" className="me-btn me-btn-small" onClick={() => { if (confirm('Drop your changes and use the inherited rules?')) props.onReset(); }}>Reset to inherited</button>
    </div>
  );
}

const triState = (v: boolean | undefined) => (v === undefined ? 'inherit' : v ? 'yes' : 'no');
const fromTri = (s: string) => (s === 'inherit' ? undefined : s === 'yes');

export function RulesTab(props: { mod: ModDef; onChange(m: ModDef): void }) {
  const { mod, onChange } = props;
  const { parent } = useEditor();
  const set = <K extends keyof ModDef>(k: K, v: ModDef[K] | undefined) => {
    const c = { ...mod };
    if (v === undefined) delete c[k]; else c[k] = v;
    onChange(c);
  };
  const setup = mod.setup;
  const trade = mod.trade;
  const setTrade = (t: Partial<TradeRules>) => {
    const clean = Object.fromEntries(Object.entries(t).filter(([, x]) => x !== undefined));
    set('trade', Object.keys(clean).length ? clean : undefined);
  };
  const dice = mod.dice;

  return (
    <div className="me-form">
      <Section title="Winning & the robber">
        <div className="me-form-grid">
          <Field label="Victory points to win" path={['victoryPoints']} aside={<span className="me-muted">base {parent.victoryPoints}</span>}>
            <NumberInput value={mod.victoryPoints} onChange={n => set('victoryPoints', n)} allowEmpty placeholder={String(parent.victoryPoints)} small />
          </Field>
          <Field label="Discard limit on a 7" path={['discardLimit']} aside={<span className="me-muted">base {parent.discardLimit}</span>}>
            <NumberInput value={mod.discardLimit} onChange={n => set('discardLimit', n)} allowEmpty placeholder={String(parent.discardLimit)} small />
          </Field>
        </div>
        <div className="me-note">The lobby can still override these per game.</div>
      </Section>

      <Section title="Setup rounds" path={['setup']} hint="What each player places before the game starts.">
        <Inherit inherited={setup === undefined}
          summary={parent.setup.length ? parent.setup.map((r, i) => `Round ${i + 1}: ${r.place.map(p => p.piece).join(' + ')} (${r.order})`).join('; ') : 'no setup rounds'}
          onCustomize={() => set('setup', structuredClone(parent.setup.length ? parent.setup : [{ place: [], order: 'forward' }]))}
          onReset={() => set('setup', undefined)}>
          <div className="me-rows">
            {(setup ?? []).map((r, i) => {
              const setRound = (nr: SetupRound) => set('setup', setup!.map((x, j) => (j === i ? nr : x)));
              return (
                <div key={i} className="me-subcard" data-path={`setup[${i}]`}>
                  <div className="me-subcard-head">
                    <b>Round {i + 1}</b>
                    <Select value={r.order} onChange={o => setRound({ ...r, order: o as SetupRound['order'] })} options={[{ value: 'forward', label: 'In turn order' }, { value: 'reverse', label: 'Reverse order (snake)' }]} />
                    <Checkbox label="Grant starting resources" value={r.grantStartingResources} onChange={x => setRound({ ...r, grantStartingResources: x || undefined })} />
                    <span className="me-spacer" />
                    <button type="button" className="me-icon-btn me-danger" onClick={() => set('setup', setup!.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  <div className="me-rows">
                    {r.place.map((p, j) => (
                      <div key={j} className="me-row" data-path={`setup[${i}].place[${j}]`}>
                        <span>Place</span>
                        <RefSelect collection="pieces" value={p.piece} onChange={piece => setRound({ ...r, place: r.place.map((x, k) => (k === j ? { ...x, piece } : x)) })} />
                        <Checkbox label="free" value={p.free} onChange={free => setRound({ ...r, place: r.place.map((x, k) => (k === j ? { ...x, free: free || undefined } : x)) })} />
                        <button type="button" className="me-icon-btn me-danger" onClick={() => setRound({ ...r, place: r.place.filter((_, k) => k !== j) })}>✕</button>
                      </div>
                    ))}
                    <button type="button" className="me-add-btn me-add-small" onClick={() => setRound({ ...r, place: [...r.place, { piece: '', free: true }] })}>＋ Piece</button>
                  </div>
                </div>
              );
            })}
            <button type="button" className="me-add-btn me-add-small" onClick={() => set('setup', [...(setup ?? []), { place: [], order: 'forward' }])}>＋ Round</button>
          </div>
        </Inherit>
      </Section>

      <Section title="Trading" path={['trade']}>
        <div className="me-form-grid">
          <Field label="Player trading" path={['trade', 'playerTrading']} aside={<span className="me-muted">base {parent.trade.playerTrading ? 'on' : 'off'}</span>}>
            <Select value={triState(trade?.playerTrading)} onChange={s => setTrade({ ...trade, playerTrading: fromTri(s) })}
              options={[{ value: 'inherit', label: 'Inherit' }, { value: 'yes', label: 'Allowed' }, { value: 'no', label: 'Not allowed' }]} />
          </Field>
          <Field label="Only current player starts trades" path={['trade', 'onlyCurrentPlayer']} aside={<span className="me-muted">base {parent.trade.onlyCurrentPlayer ? 'yes' : 'no'}</span>}>
            <Select value={triState(trade?.onlyCurrentPlayer)} onChange={s => setTrade({ ...trade, onlyCurrentPlayer: fromTri(s) })}
              options={[{ value: 'inherit', label: 'Inherit' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          </Field>
          <Field label="Bank rates by resource kind" path={['trade', 'bankRates']}
            aside={<span className="me-muted">base {Object.entries(parent.trade.bankRates).map(([k, n]) => `${k} ${n}:1`).join(', ')}</span>}>
            <NumberMap value={trade?.bankRates} onChange={br => setTrade({ ...trade, bankRates: br })} keyPlaceholder="kind" suggestions={[...new Set(['resource', 'commodity', ...parent.resources.map(r => r.kind)])]} />
          </Field>
        </div>
      </Section>

      <Section title="Dice" path={['dice']}>
        <Inherit inherited={dice === undefined}
          summary={`${parent.dice.numeric.map(d => `d${d.sides}`).join(' + ')}${parent.dice.eventDice?.length ? ` + ${parent.dice.eventDice.length} event dice` : ''}`}
          onCustomize={() => set('dice', structuredClone(parent.dice))}
          onReset={() => set('dice', undefined)}>
          {dice ? <DiceEditor value={dice} onChange={d => set('dice', d)} /> : null}
        </Inherit>
      </Section>
    </div>
  );
}

function DiceEditor(props: { value: DiceDef; onChange(d: DiceDef): void }) {
  const d = props.value;
  return (
    <div className="me-rows">
      <div className="me-row" data-path="dice.numeric">
        <span>Number dice</span>
        {d.numeric.map((x, i) => (
          <span key={i} className="me-inline">
            d<NumberInput value={x.sides} small onChange={n => props.onChange({ ...d, numeric: d.numeric.map((y, j) => (j === i ? { sides: n ?? 6 } : y)) })} />
            <button type="button" className="me-icon-btn me-danger" onClick={() => props.onChange({ ...d, numeric: d.numeric.filter((_, j) => j !== i) })}>✕</button>
          </span>
        ))}
        <button type="button" className="me-add-btn me-add-small" onClick={() => props.onChange({ ...d, numeric: [...d.numeric, { sides: 6 }] })}>＋ Die</button>
      </div>
      {(d.eventDice ?? []).map((e, i) => (
        <div key={i} className="me-row" data-path={`dice.eventDice[${i}]`}>
          <span>Event die</span>
          <TextInput value={e.id} mono className="me-small" onChange={id => props.onChange({ ...d, eventDice: d.eventDice!.map((y, j) => (j === i ? { ...y, id } : y)) })} />
          <span>faces</span>
          <ListInput value={e.faces} onChange={faces => props.onChange({ ...d, eventDice: d.eventDice!.map((y, j) => (j === i ? { ...y, faces: faces ?? [] } : y)) })} placeholder="barbarian, barbarian, barbarian, blue, green, yellow" />
          <button type="button" className="me-icon-btn me-danger" onClick={() => props.onChange({ ...d, eventDice: d.eventDice!.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="me-add-btn me-add-small" onClick={() => props.onChange({ ...d, eventDice: [...(d.eventDice ?? []), { id: 'event', faces: [] }] })}>＋ Event die</button>
      <div className="me-note">Each event die face fires a custom event of that name — react to it in Triggers.</div>
    </div>
  );
}
