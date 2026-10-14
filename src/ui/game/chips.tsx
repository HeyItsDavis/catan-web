/** Primitive chips shared across game UI components. */
import type { GameDefinition, Id, PlayerState, ResourceDef, ResourceMap } from '../../engine/schema';
import { Icon } from '../shared/icons';
import { byId, contrastText, costEntries } from './util';

/* ---------------------------------- chips --------------------------------- */

export function ResIcon({ res, id, size = 16 }: { res?: ResourceDef; id: string; size?: number }) {
  return <Icon name={res?.icon ?? id} label={res?.name ?? id} fill={res?.color ?? '#999'} size={size} />;
}

/** Resource chip: coloured pill with icon and optional amount. */
export function ResChip({
  def,
  id,
  amount,
  small,
  title,
}: {
  def: GameDefinition;
  id: Id;
  amount?: number | string;
  small?: boolean;
  title?: string;
}) {
  const res = byId(def.resources, id);
  const color = res?.color ?? '#888';
  return (
    <span
      className={`g-reschip${small ? ' g-reschip--sm' : ''}`}
      style={{ background: color, color: contrastText(color) }}
      title={title ?? res?.name ?? id}
    >
      <ResIcon res={res} id={id} size={small ? 12 : 16} />
      {amount !== undefined && <b>{amount}</b>}
    </span>
  );
}

export function CostChips({ def, cost }: { def: GameDefinition; cost: ResourceMap | undefined }) {
  const entries = costEntries(def, cost);
  if (entries.length === 0) return <span className="g-muted g-free">free</span>;
  return (
    <span className="g-cost">
      {entries.map((e) => (
        <ResChip key={e.id} def={def} id={e.id} amount={e.label} small />
      ))}
    </span>
  );
}

export function PlayerDot({ color, size = 12 }: { color: string; size?: number }) {
  return <span className="g-pdot" style={{ background: color, width: size, height: size }} />;
}

export function PlayerName({ p }: { p: Pick<PlayerState, 'name' | 'color'> | undefined }) {
  if (!p) return <span>?</span>;
  return (
    <span className="g-pname">
      <PlayerDot color={p.color} />
      {p.name}
    </span>
  );
}
