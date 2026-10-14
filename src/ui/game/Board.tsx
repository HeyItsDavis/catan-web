/**
 * SVG board renderer with pan / zoom (wheel, drag, pinch).
 * All geometry comes from engine/board/topology.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameDefinition, GameState, HexState, LocationId, PieceDef, PieceInstance } from '../../engine/schema';
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
import { cargoChips, isShipLike, pieceBadges, pieceInactive, pieceSummary } from './display';
import { byId, contrastText } from './util';

export const HEX_SIZE = 50;

export interface BoardPick {
  /** Location ids (h:/v:/e:) and/or piece instance ids that may be clicked. */
  locations: Set<string>;
  pieces: Set<string>;
  onPick: (id: string) => void;
  /** 'move' = destinations of a moving piece (drawn distinctly from placements). */
  mode?: 'place' | 'move' | 'select';
  /** Instance id of the piece being moved (ringed, and ghosted at its destinations). */
  movingPieceId?: string;
  /** Piece type previewed at the highlighted spots. */
  ghostPiece?: string;
  /** Already-picked items of a multi-select (location ids or piece instance ids). */
  chosen?: Set<string>;
}

interface Props {
  def: GameDefinition;
  state: GameState;
  pick: BoardPick | null;
  /** Tap / click on a piece that is not a pick option (opens the piece menu). Coordinates are
   *  relative to the board container. */
  onPieceTap?: (pieceId: string, at: { x: number; y: number; w: number; h: number }) => void;
  /** Piece whose menu is open (drawn with a ring). */
  selectedPiece?: string | null;
}

interface View { x: number; y: number; w: number; h: number }

/** Minimum hit-target radius in CSS px (fine pointer / touch). */
const HIT_PX = { fine: 11, coarse: 22 };

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

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

export function Board({ def, state, pick, onPieceTap, selectedPiece }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  const movingId = pick?.movingPieceId;
  const movingInst = movingId ? state.pieces.find((p) => p.id === movingId) : undefined;
  const ghostDef = byId(def.pieces, pick?.ghostPiece ?? movingInst?.type);
  const ghostColor = (movingInst && playerColor.get(movingInst.owner)) || '#ffffff';

  const click = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragged.current) return;
    pick?.onPick(id);
  };

  /** Click on a piece: answer the pick if it is an option, else open its menu. */
  const pieceClick = (p: PieceInstance) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragged.current) return;
    if (hlPieces.has(p.id)) { pick?.onPick(p.id); return; }
    if (!onPieceTap) return;
    const r = wrapRef.current?.getBoundingClientRect();
    onPieceTap(p.id, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), w: r?.width ?? 0, h: r?.height ?? 0 });
  };

  /* --------------------------- hit-target sizing -------------------------- */
  // SVG units per CSS pixel: hit areas never shrink below HIT_PX on screen (bigger on touch),
  // capped so neighbouring spots don't swallow each other.
  const k = box && box.w > 0 && box.h > 0 ? Math.max(view.w / box.w, view.h / box.h) : 1;
  const hitR = (base: number, cap: number) => Math.min(cap, Math.max(base, (coarse ? HIT_PX.coarse : HIT_PX.fine) * k));

  const interactive = (p: PieceInstance) => hlPieces.has(p.id) || !!onPieceTap;
  const pieceClass = (p: PieceInstance, pd: PieceDef | undefined) =>
    ['g-piece', hlPieces.has(p.id) && 'g-piece--pick', interactive(p) && 'g-piece--tap', pieceInactive(pd, p) && 'g-piece--inactive',
      p.id === movingId && 'g-piece--moving', p.id === selectedPiece && 'g-piece--selected'].filter(Boolean).join(' ');
  const ringClass = (p: PieceInstance) =>
    p.id === movingId ? 'g-pick-ring g-moving-ring' : p.id === selectedPiece && !hlPieces.has(p.id) ? 'g-pick-ring g-select-ring' : 'g-pick-ring';
  const ringed = (p: PieceInstance) => hlPieces.has(p.id) || p.id === selectedPiece || p.id === movingId;

  /** Where a piece is drawn (its tap centre). */
  const piecePoint = (p: PieceInstance): Point => {
    const c = locationPoint(p.at);
    return p.at.startsWith('h:') ? { x: c.x + HEX_SIZE * 0.42, y: c.y + HEX_SIZE * 0.1 } : c;
  };

  /** A tap that missed every target: resolve it to the NEAREST pickable spot / piece within a
   *  finger-sized radius (so small, dense targets stay usable on phones without overlapping). */
  const onBackgroundClick = (e: React.MouseEvent) => {
    if (dragged.current || !svgRef.current) return;
    const at = clientToSvg(e.clientX, e.clientY);
    const maxD = (coarse ? HIT_PX.coarse * 1.4 : HIT_PX.fine * 1.4) * k;
    let best: { d: number; run: () => void } | null = null;
    const consider = (pt: Point, run: () => void) => {
      const d = Math.hypot(pt.x - at.x, pt.y - at.y);
      if (d <= maxD && (!best || d < best.d)) best = { d, run };
    };
    if (pick) {
      for (const id of hl) if (!id.startsWith('h:')) consider(locationPoint(id), () => pick.onPick(id));
      for (const p of state.pieces) if (hlPieces.has(p.id)) consider(piecePoint(p), () => pick.onPick(p.id));
    }
    if (onPieceTap && !best) {
      const r = wrapRef.current?.getBoundingClientRect();
      for (const p of state.pieces) {
        consider(piecePoint(p), () => onPieceTap(p.id, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), w: r?.width ?? 0, h: r?.height ?? 0 }));
      }
    }
    (best as { run: () => void } | null)?.run();
  };

  /* ------------------------------- render -------------------------------- */
  const S = HEX_SIZE;

  /** State badges (pips under the piece, numbers top-left) and cargo chips (top-right). */
  const pieceDecor = (p: PieceInstance, pd: PieceDef | undefined, x: number, y: number, off: number) => {
    const badges = pieceBadges(pd, p).filter((b) => b.style !== 'toggle');
    const cargo = cargoChips(def, pd, p);
    if (!badges.length && !cargo.length) return null;
    const pips = badges.filter((b) => b.style === 'pips');
    const nums = badges.filter((b) => b.style === 'number');
    const pr = S * 0.045;
    return (
      <g className="g-piece-decor" pointerEvents="none">
        {pips.map((b, row) => {
          const n = Math.max(b.max, b.value);
          return (
            <g key={b.key} className="g-pips">
              {Array.from({ length: n }, (_, i) => (
                <circle key={i} cx={x + (i - (n - 1) / 2) * pr * 2.4} cy={y + off + row * pr * 2.6} r={pr} className={i < b.value ? 'g-pip-on' : 'g-pip-off'} />
              ))}
            </g>
          );
        })}
        {nums.map((b, i) => {
          const bx = x - off * 1.05, by = y - off * 0.9 + i * S * 0.21;
          return (
            <g key={b.key} className="g-statbadge">
              <circle cx={bx} cy={by} r={S * 0.1} />
              <text x={bx} y={by + S * 0.005} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.13}>{b.value}</text>
            </g>
          );
        })}
        {cargo.map((c, i) => {
          const cx = x + off * 1.05 + i * S * 0.17, cy = y - off * 0.95;
          return (
            <g key={c.key} className="g-cargo">
              <circle cx={cx} cy={cy} r={S * 0.1} fill={c.color} />
              <IconGlyph x={cx} y={cy} size={S * 0.14} name={c.icon} label={c.label} fill={c.color} stroke={contrastText(c.color) === '#fff' ? '#fff' : '#222'} />
              {c.n > 1 && (
                <text x={cx + S * 0.08} y={cy + S * 0.09} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.11} className="g-cargo-n">{c.n}</text>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div className="g-board" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="g-board-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onClick={onBackgroundClick}
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
            const gold = !hidden ? terrain?.producesChoice : undefined;
            const cls = ['g-hex', terrain?.water && !hidden && 'g-hex--water', hidden && 'g-hex--fog', gold && 'g-hex--gold', hot && 'g-hex--hot']
              .filter(Boolean).join(' ');
            return (
              <g key={h.id} className={cls} data-hex={h.id}>
                <title>
                  {hidden
                    ? 'Unexplored'
                    : `${terrain?.name ?? h.terrain}${h.number != null ? ` (${h.number})` : ''}${gold ? ` — produces ${gold.amount} resource${gold.amount === 1 ? '' : 's'} of your choice` : ''}`}
                </title>
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
                {gold && (
                  <g className="g-goldbadge">
                    <circle cx={center.x + S * 0.5} cy={center.y - S * 0.3} r={S * 0.16} />
                    <IconGlyph x={center.x + S * 0.5} y={center.y - S * 0.3} size={S * 0.22} name="gold" label="Gold" fill="#f6cf3e" stroke="#5b4300" />
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
            const x = c.x + S * 0.42, y = c.y + S * 0.1;
            return (
              <g key={p.id} className={pieceClass(p, pd)} onClick={interactive(p) ? pieceClick(p) : undefined} data-piece={p.id}>
                <title>{pieceSummary(def, state, p)}</title>
                {interactive(p) && <circle cx={x} cy={y} r={hitR(S * 0.22, S * 0.4)} className="g-hit" />}
                <IconGlyph x={x} y={y} size={S * 0.36} name={pd?.icon ?? p.type} label={pd?.name} fill={playerColor.get(p.owner) ?? '#aaa'} />
                {pieceDecor(p, pd, x, y, S * 0.2)}
                {ringed(p) && <circle cx={x} cy={y} r={S * 0.26} className={ringClass(p)} />}
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
            const ship = isShipLike(pd);
            const asBar = !ship && (!pd?.icon || pd.icon === 'road');
            const t = 0.18;
            const a2 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            const b2 = { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
            return (
              <g key={p.id} className={pieceClass(p, pd)} onClick={interactive(p) ? pieceClick(p) : undefined} data-piece={p.id}>
                <title>{pieceSummary(def, state, p)}</title>
                {interactive(p) && <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} className="g-hit" strokeWidth={2 * hitR(S * 0.12, S * 0.24)} />}
                {asBar ? (
                  <>
                    <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke="#1d1d22" strokeWidth={S * 0.17} strokeLinecap="round" />
                    <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={color} strokeWidth={S * 0.11} strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    {ship && (
                      <line
                        x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y}
                        stroke={color} strokeWidth={S * 0.05} strokeDasharray={`${S * 0.08} ${S * 0.07}`} strokeLinecap="round" className="g-wake"
                      />
                    )}
                    <IconGlyph x={mid.x} y={mid.y} size={S * (ship ? 0.46 : 0.4)} name={pd?.icon ?? (ship ? 'ship' : p.type)} label={pd?.name} fill={color} />
                  </>
                )}
                {pieceDecor(p, pd, mid.x, mid.y, S * 0.22)}
                {ringed(p) && <circle cx={mid.x} cy={mid.y} r={S * 0.28} className={ringClass(p)} />}
              </g>
            );
          })}
        </g>

        {/* vertex pieces */}
        <g>
          {piecesByKind.v.map((p) => {
            const pd = byId(def.pieces, p.type);
            const c = vertexToPixel(p.at, S);
            return (
              <g key={p.id} className={pieceClass(p, pd)} onClick={interactive(p) ? pieceClick(p) : undefined} data-piece={p.id}>
                <title>{pieceSummary(def, state, p)}</title>
                {interactive(p) && <circle cx={c.x} cy={c.y} r={hitR(S * 0.26, S * 0.46)} className="g-hit" />}
                <IconGlyph x={c.x} y={c.y - S * 0.03} size={S * 0.44} name={pd?.icon ?? p.type} label={pd?.name} fill={playerColor.get(p.owner) ?? '#aaa'} />
                {pieceDecor(p, pd, c.x, c.y, S * 0.24)}
                {ringed(p) && <circle cx={c.x} cy={c.y} r={S * 0.3} className={ringClass(p)} />}
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
                <g key={`${tokId}`} className="g-token" data-token={tokId}>
                  <title>{td?.name ?? tokId}</title>
                  <IconGlyph x={x} y={y} size={S * (onHex ? 0.5 : 0.4)} name={td?.icon ?? tokId} label={td?.name} fill="#2b2b33" stroke="#e8e8e8" />
                </g>
              );
            }),
          )}
        </g>

        {/* location highlights (prompt) */}
        {pick && (
          <g className={`g-highlights${pick.mode === 'move' ? ' g-hl--move' : ''}`}>
            {ghostDef &&
              [...hl].map((id) => {
                const c = locationPoint(id);
                return (
                  <g key={`ghost:${id}`} className="g-ghost" pointerEvents="none">
                    <IconGlyph x={c.x} y={c.y} size={S * 0.34} name={ghostDef.icon ?? (isShipLike(ghostDef) ? 'ship' : ghostDef.id)} label={ghostDef.name} fill={ghostColor} />
                  </g>
                );
              })}
            {[...hl].filter((id) => id.startsWith('h:')).map((id) => {
              const h = state.hexes[id];
              const coord = h?.coord ?? (() => { const [q, r] = id.slice(2).split(',').map(Number); return { q, r }; })();
              const corners = hexCornerPoints(coord, S);
              return (
                <polygon key={id} points={pts(scalePoly(corners, hexToPixel(coord, S), 0.94))} className="g-hl g-hl-hex" data-loc={id} onClick={click(id)}>
                  <title>{pick.mode === 'move' ? 'Move here' : 'Choose this hex'}</title>
                </polygon>
              );
            })}
            {[...hl].filter((id) => id.startsWith('e:')).map((id) => {
              const { a, b } = edgeToPixel(id, S);
              const t = 0.2;
              return (
                <g key={id} className="g-hl g-hl-edge" data-loc={id} onClick={click(id)}>
                  <line x1={a.x + (b.x - a.x) * t} y1={a.y + (b.y - a.y) * t} x2={b.x + (a.x - b.x) * t} y2={b.y + (a.y - b.y) * t} className="g-hl-edge-line" strokeWidth={S * 0.14} />
                  <line
                    x1={a.x + (b.x - a.x) * 0.12} y1={a.y + (b.y - a.y) * 0.12} x2={b.x + (a.x - b.x) * 0.12} y2={b.y + (a.y - b.y) * 0.12}
                    className="g-hit" strokeWidth={2 * hitR(S * 0.15, S * 0.26)}
                  />
                </g>
              );
            })}
            {[...hl].filter((id) => id.startsWith('v:')).map((id) => {
              const c = vertexToPixel(id, S);
              return (
                <g key={id} className="g-hl g-hl-vertex" data-loc={id} onClick={click(id)}>
                  <circle cx={c.x} cy={c.y} r={hitR(S * 0.3, S * 0.48)} className="g-hit" />
                  <circle cx={c.x} cy={c.y} r={S * 0.13} className="g-hl-vertex-dot" />
                </g>
              );
            })}
            {[...(pick.chosen ?? [])].map((id) => {
              const loc = state.pieces.find((x) => x.id === id)?.at ?? id;
              if (!/^[hve]:/.test(loc)) return null;
              const c = locationPoint(loc);
              return (
                <g key={`chosen:${id}`} className="g-chosen" pointerEvents="none" data-chosen={loc}>
                  <circle cx={c.x} cy={c.y} r={S * 0.19} />
                  <text x={c.x} y={c.y + S * 0.01} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.22}>✓</text>
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
