/**
 * Animated resource cards: when new log entries carry resource flows (LogEntry.flows), a small copy
 * of each card flies from its source (the producing hex, the bank, a player's panel) to where it
 * went (your hand, an opponent's panel, the bank). Pure decoration: pointer-events none, nodes are
 * created imperatively (no React re-renders), capped per batch, skipped with prefers-reduced-motion.
 */
import { useEffect, useRef } from 'react';
import type { GameDefinition, GameState } from '../../engine/schema';
import { gameIconPath } from '../shared/gameIcons';
import { flightsFor, newLogEntries, type Flight, type Spot } from './flights';
import { byId, contrastText, HIDDEN_KEY } from './util';

const STEP_MS = 70;
const DURATION_MS = 750;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** First matching element that is actually laid out (visible). */
function visible(sel: string): Element | null {
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function spotRect(s: Spot, viewer: string): DOMRect | null {
  let el: Element | null = null;
  const esc = (x: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(x) : x.replace(/"/g, '\\"'));
  if (s.kind === 'hex') el = visible(`[data-hex="${esc(s.id)}"]`);
  else if (s.kind === 'bank') el = (s.res && visible(`[data-bank-res="${esc(s.res)}"]`)) || visible('[data-anchor="bank"]');
  else if (s.id === viewer) el = (s.res && visible(`[data-hand-res="${esc(s.res)}"]`)) || visible('[data-anchor="hand"]');
  else el = visible(`[data-player-panel="${esc(s.id)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function cardNode(def: GameDefinition, res: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'g-fly';
  const hidden = res === HIDDEN_KEY;
  const rd = hidden ? undefined : byId(def.resources, res);
  const bg = hidden ? '' : rd?.color ?? '#8a8f99';
  if (hidden) el.classList.add('g-fly--back');
  else el.style.background = bg;
  const fg = hidden ? 'rgba(255,255,255,0.85)' : contrastText(bg) === '#fff' ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,26,0.78)';
  const d = hidden ? gameIconPath('cardBack') : gameIconPath(rd?.icon, [res]);
  if (d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', fg);
    svg.appendChild(p);
    el.appendChild(svg);
  } else {
    el.textContent = (rd?.name ?? res).charAt(0).toUpperCase();
    el.style.color = fg;
  }
  return el;
}

function launch(layer: HTMLElement, def: GameDefinition, viewer: string, f: Flight): void {
  const a = spotRect(f.from, viewer);
  const b = spotRect(f.to, viewer);
  if (!a || !b) return;
  const el = cardNode(def, f.res);
  layer.appendChild(el);
  const w = 26, h = 36;
  const x0 = a.left + a.width / 2 - w / 2, y0 = a.top + a.height / 2 - h / 2;
  const x1 = b.left + b.width / 2 - w / 2, y1 = b.top + b.height / 2 - h / 2;
  // A little arc: lift the midpoint, jitter so stacked cards fan out.
  const jx = ((f.index % 5) - 2) * 6;
  const mx = (x0 + x1) / 2 + jx, my = Math.min(y0, y1) - 40 - (f.index % 3) * 8;
  const anim = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(0.4) rotate(-8deg)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 14}px) scale(1.1) rotate(0deg)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.75)`, opacity: 0.9, offset: 0.92 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.5)`, opacity: 0 },
    ],
    { duration: DURATION_MS, delay: f.index * STEP_MS, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' },
  );
  const done = () => el.remove();
  anim.onfinish = done;
  anim.oncancel = done;
}

/** Pulse the receiving element when its cards land. */
function pulse(spot: Spot, viewer: string, delay: number): void {
  const sel = spot.kind === 'player'
    ? spot.id === viewer ? (spot.res ? `[data-hand-res="${spot.res}"]` : '[data-anchor="hand"]') : `[data-player-panel="${spot.id}"]`
    : spot.kind === 'bank' ? '[data-anchor="bank"]' : '';
  const el = sel ? visible(sel) : null;
  if (!el || !(el as HTMLElement).animate) return;
  (el as HTMLElement).animate(
    [{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)' }, { filter: 'brightness(1)' }],
    { duration: 420, delay },
  );
}

export function FlyLayer({ def, state, playerId }: { def: GameDefinition; state: GameState; playerId: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const prev = useRef<GameState | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const el = layer.current;
    if (!el || !before || typeof el.animate !== 'function') return;
    const entries = newLogEntries(before, state);
    if (!entries.length || reducedMotion()) return;
    const flights = flightsFor(entries);
    // Too many in flight already (fast replays): drop the oldest.
    while (el.childElementCount > 60) el.firstElementChild?.remove();
    // Wait a frame so freshly rendered targets (a new hand stack) have their final layout.
    requestAnimationFrame(() => {
      for (const f of flights) launch(el, def, playerId, f);
      const seen = new Set<string>();
      for (const f of flights) {
        const k = JSON.stringify(f.to);
        if (seen.has(k)) continue;
        seen.add(k);
        pulse(f.to, playerId, f.index * STEP_MS + DURATION_MS * 0.85);
      }
    });
  }, [def, state, playerId]);
  return <div className="g-flylayer" ref={layer} aria-hidden />;
}
