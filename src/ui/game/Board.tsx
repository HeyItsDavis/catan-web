/**
 * SVG board renderer with pan / zoom (wheel, drag, pinch).
 * All geometry comes from engine/board/topology.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameDefinition, GameState, HexState, LocationId, PieceInstance } from '../../engine/schema';
import {
  edgeHexes,
  edgeIdOf,
  edgeToPixel,
  hexCornerPoints,
  hexId,
  hexToPixel,
  vertexToPixel,
  type Point,
} from '../../engine/board/topology';
import { IconGlyph } from '../shared/icons';
import { byId, contrastText } from './util';

export const HEX_SIZE = 50;

export interface BoardPick {
  /** Location ids (h:/v:/e:) and/or piece instance ids that may be clicked. */
  locations: Set<string>;
  pieces: Set<string>;
  onPick: (id: string) => void;
}

interface Props {
  def: GameDefinition;
  state: GameState;
  pick: BoardPick | null;
}

interface View { x: number; y: number; w: number; h: number }

const pts = (p: Point[]) => p.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');

function pipCount(n: number): number {
  return n <= 7 ? n - 1 : 13 - n;
}

function scalePoly(points: Point[], center: Point, f: number): Point[] {
  return points.map((p) => ({ x: center.x + (p.x - center.x) * f, y: center.y + (p.y - center.y) * f }));
}

function locationPoint(loc: LocationId): Point {
  if (loc.startsWith('v:')) return vertexToPixel(loc, HEX_SIZE);
  if (loc.startsWith('e:')) return edgeToPixel(loc, HEX_SIZE).mid;
  const [q, r] = loc.slice(2).split(',').map(Number);
  return hexToPixel({ q, r }, HEX_SIZE);
}

export function Board({ def, state, pick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hexes = useMemo(() => Object.values(state.hexes), [state.hexes]);

  /* ------------------------------- bounds -------------------------------- */
  const bounds = useMemo<View>(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const h of hexes) {
      for (const p of hexCornerPoints(h.coord, HEX_SIZE)) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
    if (!isFinite(minX)) return { x: -100, y: -100, w: 200, h: 200 };
    const pad = HEX_SIZE * 0.6;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  }, [hexes]);

  const [view, setView] = useState<View>(bounds);
  const boundsKey = `${bounds.x},${bounds.y},${bounds.w},${bounds.h}`;
  const lastKey = useRef(boundsKey);
  useEffect(() => {
    if (lastKey.current !== boundsKey) {
      lastKey.current = boundsKey;
      setView(bounds);
    }
  }, [boundsKey, bounds]);

  /* ------------------------------ pan / zoom ----------------------------- */
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const dragged = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; cx: number; cy: number; dist: number; moved: number } | null>(null);

  /** Svg units per CSS pixel (viewBox is fitted with "meet"). */
  const unitsPerPx = useCallback(() => {
    const el = svgRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    return Math.max(v.w / Math.max(1, r.width), v.h / Math.max(1, r.height));
  }, []);

  const clientToSvg = useCallback((cx: number, cy: number): Point => {
    const el = svgRef.current!;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    const k = unitsPerPx();
    // centre-aligned meet
    const offX = (r.width * k - v.w) / 2;
    const offY = (r.height * k - v.h) / 2;
    return { x: v.x - offX + (cx - r.left) * k, y: v.y - offY + (cy - r.top) * k };
  }, [unitsPerPx]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const p = clientToSvg(cx, cy);
    setView((cur) => {
      const v = cur;
      const maxW = bounds.w * 2.5;
      const minW = bounds.w / 6;
      const nw = Math.min(maxW, Math.max(minW, v.w * factor));
      const f = nw / v.w;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f };
    });
  }, [bounds.w, clientToSvg]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const centroid = () => {
    const ps = [...pointers.current.values()];
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const cy = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { cx, cy, dist };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = centroid();
    gesture.current = { start: viewRef.current, ...c, moved: gesture.current?.moved ?? 0 };
    if (pointers.current.size === 1) {
      dragged.current = false;
      gesture.current.moved = 0;
    }
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId) || !gesture.current) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      const c = centroid();
      const dx = c.cx - g.cx;
      const dy = c.cy - g.cy;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      if (g.moved > 6) dragged.current = true;
      if (!dragged.current) return;
      const k = unitsPerPx();
      let next: View = { ...g.start, x: g.start.x - dx * k, y: g.start.y - dy * k };
      if (pointers.current.size > 1 && g.dist > 0 && c.dist > 0) {
        const f = g.dist / c.dist;
        const nw = Math.min(bounds.w * 2.5, Math.max(bounds.w / 6, g.start.w * f));
        const ff = nw / g.start.w;
        const cxs = next.x + next.w / 2;
        const cys = next.y + next.h / 2;
        next = { x: cxs - (next.w * ff) / 2, y: cys - (next.h * ff) / 2, w: next.w * ff, h: next.h * ff };
      }
      setView(next);
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.current.delete(e.pointerId)) return;
      if (pointers.current.size > 0 && gesture.current) {
        gesture.current = { start: viewRef.current, ...centroid(), moved: gesture.current.moved };
      } else {
        gesture.current = null;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [bounds.w, unitsPerPx]);

  const click = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragged.current) return;
    pick?.onPick(id);
  };

  /* ------------------------------ lookups -------------------------------- */
  const playerColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of state.players) m.set(p.id, p.color);
    return m;
  }, [state.players]);

  const piecesByKind = useMemo(() => {
    const v: PieceInstance[] = [], e: PieceInstance[] = [], h: PieceInstance[] = [];
    for (const p of state.pieces) {
      if (p.at.startsWith('v:')) v.push(p);
      else if (p.at.startsWith('e:')) e.push(p);
      else h.push(p);
    }
    return { v, e, h };
  }, [state.pieces]);

  const tokensAt = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [tok, loc] of Object.entries(state.tokens)) {
      if (!loc) continue;
      m.set(loc, [...(m.get(loc) ?? []), tok]);
    }
    return m;
  }, [state.tokens]);

  const rolled = state.lastRoll?.total;

  const isHidden = (h: HexState) => {
    const t = byId(def.terrains, h.terrain);
    return !h.revealed || !!t?.hidden;
  };

  const isLand = (id: string) => {
    const h = state.hexes[id];
    if (!h) return false;
    const t = byId(def.terrains, h.terrain);
    return !t?.water;
  };

  const hl = pick?.locations ?? new Set<string>();
  const hlPieces = pick?.pieces ?? new Set<string>();

  /* ------------------------------- render -------------------------------- */
  const S = HEX_SIZE;

  return (
    <div className="g-board">
      <svg
        ref={svgRef}
        className="g-board-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
      >
        {/* hexes */}
        <g>
          {hexes.map((h) => {
            const terrain = byId(def.terrains, h.terrain);
            const hidden = isHidden(h);
            const center = hexToPixel(h.coord, S);
            const corners = hexCornerPoints(h.coord, S);
            const fill = hidden ? 'var(--g-fog)' : terrain?.color ?? '#888';
            const blocked = (tokensAt.get(h.id) ?? []).some((t) => byId(def.tokens, t)?.blocksProduction);
            const hot = !hidden && h.number != null && h.number === rolled && !blocked;
            const iconName = hidden ? 'fog' : terrain?.icon;
            const hasNumber = !hidden && h.number != null;
            return (
              <g key={h.id} className={`g-hex${terrain?.water ? ' g-hex--water' : ''}${hot ? ' g-hex--hot' : ''}`}>
                <title>{hidden ? 'Unexplored' : `${terrain?.name ?? h.terrain}${h.number != null ? ` (${h.number})` : ''}`}</title>
                <polygon points={pts(corners)} fill={fill} className="g-hex-shape" />
                <polygon points={pts(scalePoly(corners, center, 0.9))} className="g-hex-inner" />
                {(iconName || hidden) && (
                  <g opacity={terrain?.water && !hidden ? 0.35 : 0.55}>
                    <IconGlyph
                      x={center.x}
                      y={hasNumber ? center.y - S * 0.52 : center.y}
                      size={hasNumber ? S * 0.32 : S * 0.5}
                      name={iconName ?? 'question'}
                      label={terrain?.name}
                      fill="rgba(255,255,255,0.7)"
                      stroke="rgba(0,0,0,0.55)"
                      detail="rgba(0,0,0,0.25)"
                    />
                  </g>
                )}
                {hasNumber && (
                  <g className="g-numtoken">
                    <circle cx={center.x} cy={center.y + S * 0.06} r={S * 0.29} className="g-numtoken-disc" />
                    <text
                      x={center.x}
                      y={center.y + S * 0.02}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={S * (h.number === 6 || h.number === 8 ? 0.3 : 0.26)}
                      className={h.number === 6 || h.number === 8 ? 'g-num g-num--red' : 'g-num'}
                    >
                      {h.number}
                    </text>
                    {Array.from({ length: Math.max(0, pipCount(h.number!)) }, (_, i) => i).map((i, _, arr) => (
                      <circle
                        key={i}
                        cx={center.x + (i - (arr.length - 1) / 2) * S * 0.065}
                        cy={center.y + S * 0.22}
                        r={S * 0.022}
                        className={h.number === 6 || h.number === 8 ? 'g-pip g-pip--red' : 'g-pip'}
                      />
                    ))}
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* ports */}
        <g>
          {state.ports.map((port, i) => {
            const portDef = byId(def.ports, port.port);
            const edge = edgeIdOf(port.vertices[0], port.vertices[1]);
            const { a, b, mid } = edgeToPixel(edge, S);
            const land = edgeHexes(edge).map(hexId).find(isLand);
            const lc = land ? hexToPixel(state.hexes[land].coord, S) : hexToPixel(state.hexes[port.hex]?.coord ?? { q: 0, r: 0 }, S);
            let nx = mid.x - lc.x, ny = mid.y - lc.y;
            const len = Math.hypot(nx, ny) || 1;
            nx /= len; ny /= len;
            const m = { x: mid.x + nx * S * 0.5, y: mid.y + ny * S * 0.5 };
            const res = portDef && portDef.resource !== 'any' ? byId(def.resources, portDef.resource) : undefined;
            const color = res?.color ?? '#f3efe2';
            const ratio = portDef ? `${portDef.ratio}:1` : '?';
            return (
              <g key={`${port.hex}-${port.side}-${i}`} className="g-port">
                <title>{portDef ? `${ratio} ${res ? res.name : 'any resource'} port` : 'Port'}</title>
                <line x1={a.x} y1={a.y} x2={m.x} y2={m.y} className="g-port-pier" />
                <line x1={b.x} y1={b.y} x2={m.x} y2={m.y} className="g-port-pier" />
                <circle cx={m.x} cy={m.y} r={S * 0.25} fill={color} className="g-port-disc" />
                {res ? (
                  <IconGlyph x={m.x} y={m.y - S * 0.06} size={S * 0.22} name={res.icon ?? res.id} label={res.name} fill={res.color} stroke={contrastText(color) === '#fff' ? '#fff' : '#222'} />
                ) : (
                  <text x={m.x} y={m.y - S * 0.06} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.16} className="g-port-q">?</text>
                )}
                <text x={m.x} y={m.y + S * 0.13} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.13} fill={contrastText(color)} className="g-port-ratio">
                  {ratio}
                </text>
              </g>
            );
          })}
        </g>

        {/* hex-located pieces */}
        <g>
          {piecesByKind.h.map((p) => {
            const pd = byId(def.pieces, p.type);
            const c = locationPoint(p.at);
            return (
              <g key={p.id} className={hlPieces.has(p.id) ? 'g-piece g-piece--pick' : 'g-piece'} onClick={hlPieces.has(p.id) ? click(p.id) : undefined}>
                <title>{`${pd?.name ?? p.type}`}</title>
                <IconGlyph x={c.x + S * 0.42} y={c.y + S * 0.1} size={S * 0.36} name={pd?.icon ?? p.type} label={pd?.name} fill={playerColor.get(p.owner) ?? '#aaa'} />
              </g>
            );
          })}
        </g>

        {/* edge pieces */}
        <g>
          {piecesByKind.e.map((p) => {
            const pd = byId(def.pieces, p.type);
            const { a, b, mid } = edgeToPixel(p.at, S);
            const color = playerColor.get(p.owner) ?? '#aaa';
            const icon = pd?.icon ?? p.type;
            const pickable = hlPieces.has(p.id);
            const asBar = !icon || icon === 'road' || !pd?.icon;
            const t = 0.18;
            const a2 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            const b2 = { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
            return (
              <g key={p.id} className={pickable ? 'g-piece g-piece--pick' : 'g-piece'} onClick={pickable ? click(p.id) : undefined}>
                <title>{`${pd?.name ?? p.type} — ${state.players.find((x) => x.id === p.owner)?.name ?? p.owner}`}</title>
                {asBar ? (
                  <>
                    <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke="#1d1d22" strokeWidth={S * 0.17} strokeLinecap="round" />
                    <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={color} strokeWidth={S * 0.11} strokeLinecap="round" />
                  </>
                ) : (
                  <IconGlyph x={mid.x} y={mid.y} size={S * 0.4} name={icon} label={pd?.name} fill={color} />
                )}
                {pickable && <circle cx={mid.x} cy={mid.y} r={S * 0.26} className="g-pick-ring" />}
              </g>
            );
          })}
        </g>

        {/* vertex pieces */}
        <g>
          {piecesByKind.v.map((p) => {
            const pd = byId(def.pieces, p.type);
            const c = vertexToPixel(p.at, S);
            const pickable = hlPieces.has(p.id);
            const stateTip = Object.entries(p.state ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ');
            return (
              <g key={p.id} className={pickable ? 'g-piece g-piece--pick' : 'g-piece'} onClick={pickable ? click(p.id) : undefined}>
                <title>{`${pd?.name ?? p.type} — ${state.players.find((x) => x.id === p.owner)?.name ?? p.owner}${stateTip ? ` (${stateTip})` : ''}`}</title>
                <IconGlyph x={c.x} y={c.y - S * 0.03} size={S * 0.44} name={pd?.icon ?? p.type} label={pd?.name} fill={playerColor.get(p.owner) ?? '#aaa'} />
                {pickable && <circle cx={c.x} cy={c.y} r={S * 0.3} className="g-pick-ring" />}
              </g>
            );
          })}
        </g>

        {/* tokens */}
        <g>
          {[...tokensAt.entries()].flatMap(([loc, toks]) =>
            toks.map((tokId, i) => {
              const td = byId(def.tokens, tokId);
              const c = locationPoint(loc);
              const onHex = loc.startsWith('h:');
              const x = onHex ? c.x - S * 0.45 + i * S * 0.3 : c.x;
              const y = onHex ? c.y + S * 0.08 : c.y;
              return (
                <g key={`${tokId}`} className="g-token">
                  <title>{td?.name ?? tokId}</title>
                  <IconGlyph x={x} y={y} size={S * (onHex ? 0.5 : 0.4)} name={td?.icon ?? tokId} label={td?.name} fill="#2b2b33" stroke="#e8e8e8" />
                </g>
              );
            }),
          )}
        </g>

        {/* location highlights (prompt) */}
        {pick && (
          <g className="g-highlights">
            {[...hl].filter((id) => id.startsWith('h:')).map((id) => {
              const h = state.hexes[id];
              const coord = h?.coord ?? (() => { const [q, r] = id.slice(2).split(',').map(Number); return { q, r }; })();
              const corners = hexCornerPoints(coord, S);
              return (
                <polygon key={id} points={pts(scalePoly(corners, hexToPixel(coord, S), 0.94))} className="g-hl g-hl-hex" onClick={click(id)}>
                  <title>Choose this hex</title>
                </polygon>
              );
            })}
            {[...hl].filter((id) => id.startsWith('e:')).map((id) => {
              const { a, b } = edgeToPixel(id, S);
              const t = 0.2;
              return (
                <g key={id} className="g-hl g-hl-edge" onClick={click(id)}>
                  <line x1={a.x + (b.x - a.x) * t} y1={a.y + (b.y - a.y) * t} x2={b.x + (a.x - b.x) * t} y2={b.y + (a.y - b.y) * t} className="g-hl-edge-line" strokeWidth={S * 0.14} />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={S * 0.3} />
                </g>
              );
            })}
            {[...hl].filter((id) => id.startsWith('v:')).map((id) => {
              const c = vertexToPixel(id, S);
              return (
                <g key={id} className="g-hl g-hl-vertex" onClick={click(id)}>
                  <circle cx={c.x} cy={c.y} r={S * 0.3} fill="transparent" />
                  <circle cx={c.x} cy={c.y} r={S * 0.13} className="g-hl-vertex-dot" />
                </g>
              );
            })}
          </g>
        )}
      </svg>
      <div className="g-board-ctrls">
        <button type="button" onClick={() => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2); }} title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); }} title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setView(bounds)} title="Fit board" aria-label="Fit board">⤢</button>
      </div>
    </div>
  );
}
