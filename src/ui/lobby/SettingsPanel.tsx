import type { ReactNode } from 'react';
import type { LobbySettings, SettingDef } from '../../engine/schema';
import { MAX_PLAYERS, MIN_PLAYERS, mapsForPlayerCount, TURN_TIMER_OPTIONS } from '../../net/lobby';
import type { RoomView } from '../../net/useRoom';

export function SettingsPanel({ room }: { room: RoomView }) {
  const { snapshot, isHost, def, updateSettings } = room;
  const s = snapshot.settings!;
  const ro = !isHost;
  const set = <K extends keyof LobbySettings>(k: K, v: LobbySettings[K]) => updateSettings({ [k]: v } as Partial<LobbySettings>);

  const fitting = def ? mapsForPlayerCount(def, s.maxPlayers) : [];
  const maps = fitting.length ? fitting : def?.maps ?? [];
  const currentMap = def?.maps.find((m) => m.id === s.mapId);

  return (
    <div className="settings">
      <Row label="Map">
        {ro || maps.length === 0 ? (
          <Value>{currentMap?.name ?? s.mapId}</Value>
        ) : (
          <select value={s.mapId} onChange={(e) => set('mapId', e.target.value)}>
            {maps.map((m) => (
              <option key={m.id} value={m.id} title={`${m.minPlayers}–${m.maxPlayers} players`}>
                {/player/i.test(m.name) ? m.name : `${m.name} (${m.minPlayers}–${m.maxPlayers} players)`}
              </option>
            ))}
          </select>
        )}
      </Row>

      <Row label="Max players">
        <Stepper value={s.maxPlayers} min={Math.max(MIN_PLAYERS, snapshot.players.length)} max={MAX_PLAYERS} ro={ro} onChange={(v) => {
          // Keep the map valid for the new seat count.
          const fit = def ? mapsForPlayerCount(def, v) : [];
          const mapId = fit.length && !fit.some((m) => m.id === s.mapId) ? fit[0].id : s.mapId;
          updateSettings({ maxPlayers: v, mapId });
        }} />
      </Row>

      <Row label="Points to win">
        <Stepper value={s.victoryPoints} min={3} max={30} ro={ro} onChange={(v) => set('victoryPoints', v)} />
      </Row>

      <Row label="Discard limit" hint="Cards above this are halved on a 7">
        <Stepper value={s.discardLimit} min={2} max={40} ro={ro} onChange={(v) => set('discardLimit', v)} />
      </Row>

      <Row label="Dice" hint="Balanced deals every outcome fairly over time">
        <Segmented
          ro={ro}
          value={s.diceMode}
          options={[{ value: 'random', label: 'Random' }, { value: 'balanced', label: 'Balanced' }]}
          onChange={(v) => set('diceMode', v as LobbySettings['diceMode'])}
        />
      </Row>

      <Row label="Turn timer" hint="10 seconds to roll, then the turn length. Each action adds 10 seconds, up to the turn length.">
        {ro ? <Value>{s.turnTimerSeconds ? `${s.turnTimerSeconds}s` : 'Off'}</Value> : (
          <select value={s.turnTimerSeconds} onChange={(e) => set('turnTimerSeconds', Number(e.target.value))}>
            {TURN_TIMER_OPTIONS.map((t) => <option key={t} value={t}>{t ? `${t} seconds` : 'Off'}</option>)}
          </select>
        )}
      </Row>

      <Row label="Friendly robber" hint="Can't rob players with 2 or fewer points">
        <Toggle ro={ro} value={s.friendlyRobber} onChange={(v) => set('friendlyRobber', v)} />
      </Row>
      <Row label="Hide bank cards">
        <Toggle ro={ro} value={s.hideBankCards} onChange={(v) => set('hideBankCards', v)} />
      </Row>
      <Row label="Randomize turn order">
        <Toggle ro={ro} value={s.randomizeTurnOrder} onChange={(v) => set('randomizeTurnOrder', v)} />
      </Row>

      {def && def.settings.length > 0 && (
        <>
          <h3 className="settings-sub">Mod settings</h3>
          {def.settings.map((sd) => (
            <ModSettingRow
              key={sd.id}
              def={sd}
              value={s.modSettings[sd.id] ?? sd.default}
              ro={ro}
              onChange={(v) => updateSettings({ modSettings: { ...s.modSettings, [sd.id]: v } })}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ModSettingRow({ def, value, ro, onChange }: {
  def: SettingDef; value: number | boolean | string; ro: boolean; onChange: (v: number | boolean | string) => void;
}) {
  switch (def.type) {
    case 'boolean':
      return <Row label={def.name}><Toggle ro={ro} value={!!value} onChange={onChange} /></Row>;
    case 'number':
      return (
        <Row label={def.name}>
          <Stepper value={Number(value)} min={def.min ?? -999} max={def.max ?? 999} ro={ro} onChange={onChange} />
        </Row>
      );
    case 'select': {
      const opts = def.options ?? [];
      return (
        <Row label={def.name}>
          {ro ? <Value>{opts.find((o) => o.value === value)?.label ?? String(value)}</Value> : (
            <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
              {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </Row>
      );
    }
  }
}

/* ---------------------------------------------------------------- controls */

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="setting-value">{children}</span>;
}

function Stepper({ value, min, max, ro, onChange }: { value: number; min: number; max: number; ro: boolean; onChange: (v: number) => void }) {
  if (ro) return <Value>{value}</Value>;
  return (
    <div className="stepper">
      <button className="btn small" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Decrease">−</button>
      <span className="stepper-value">{value}</span>
      <button className="btn small" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Increase">+</button>
    </div>
  );
}

function Toggle({ value, ro, onChange }: { value: boolean; ro: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      className={`toggle ${value ? 'on' : ''}`}
      disabled={ro}
      onClick={() => onChange(!value)}
    >
      <span className="knob" />
    </button>
  );
}

function Segmented({ value, options, ro, onChange }: {
  value: string; options: { value: string; label: string }[]; ro: boolean; onChange: (v: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} disabled={ro && o.value !== value} onClick={() => !ro && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
