import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';

export interface FloatingWindowProps {
  id: string;
  title: string;
  /** Initial position / size (only used on first mount). */
  initialRect?: { x: number; y: number; w: number; h: number };
  zIndex: number;
  minimised?: boolean;
  /** When true the window gets a yellow/gold accent border to indicate selection. */
  highlighted?: boolean;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMinimise: (id: string) => void;
  children: React.ReactNode;
}

const MIN_W = 220;
const MIN_H = 140;
const TITLE_H = 26;

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  id, title, initialRect, zIndex, minimised, highlighted,
  onClose, onFocus, onMinimise, children,
}) => {
  const [rect, setRect] = useState(() => initialRect ?? { x: 80, y: 80, w: 420, h: 320 });
  const [maximised, setMaximised] = useState(false);
  const preMaxRect = useRef(rect);
  const dragRef    = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resizeRef  = useRef<{ startX: number; startY: number; ow: number; oh: number; ox: number; oy: number; edge: string } | null>(null);

  // ── Drag (title bar) ──────────────────────────────────────────────
  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // don't drag when clicking buttons
    e.preventDefault();
    onFocus(id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: rect.x, oy: rect.y };

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setRect(r => ({
        ...r,
        x: d.ox + (ev.clientX - d.startX),
        y: Math.max(0, d.oy + (ev.clientY - d.startY)),
      }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [id, rect.x, rect.y, onFocus]);

  // ── Resize (edge handles) ─────────────────────────────────────────
  const startResize = useCallback((e: React.MouseEvent, edge: string) => {
    e.preventDefault();
    e.stopPropagation();
    onFocus(id);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, ow: rect.w, oh: rect.h, ox: rect.x, oy: rect.y, edge };

    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;
      setRect(prev => {
        let { x, y, w, h } = { ...prev };
        if (r.edge.includes('e')) w = Math.max(MIN_W, r.ow + dx);
        if (r.edge.includes('s')) h = Math.max(MIN_H, r.oh + dy);
        if (r.edge.includes('w')) {
          const newW = Math.max(MIN_W, r.ow - dx);
          x = r.ox + (r.ow - newW);
          w = newW;
        }
        if (r.edge.includes('n')) {
          const newH = Math.max(MIN_H, r.oh - dy);
          y = Math.max(0, r.oy + (r.oh - newH));
          h = newH;
        }
        return { x, y, w, h };
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [id, rect, onFocus]);

  // Double-click title = toggle maximise
  const toggleMaximise = () => {
    if (maximised) {
      setRect(preMaxRect.current);
      setMaximised(false);
    } else {
      preMaxRect.current = rect;
      // Use parent bounds (the dockable area, not the full viewport)
      setRect({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      setMaximised(true);
    }
  };

  if (minimised) return null; // hidden when minimised — the manager shows a taskbar entry

  const edgeSize = 5;
  const edgeCursors: Record<string, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', sw: 'nesw-resize',
  };
  const edges: { edge: string; style: React.CSSProperties }[] = [
    { edge: 'n',  style: { top: 0, left: edgeSize, right: edgeSize, height: edgeSize } },
    { edge: 's',  style: { bottom: 0, left: edgeSize, right: edgeSize, height: edgeSize } },
    { edge: 'e',  style: { top: edgeSize, right: 0, bottom: edgeSize, width: edgeSize } },
    { edge: 'w',  style: { top: edgeSize, left: 0, bottom: edgeSize, width: edgeSize } },
    { edge: 'ne', style: { top: 0, right: 0, width: edgeSize * 2, height: edgeSize * 2 } },
    { edge: 'nw', style: { top: 0, left: 0, width: edgeSize * 2, height: edgeSize * 2 } },
    { edge: 'se', style: { bottom: 0, right: 0, width: edgeSize * 2, height: edgeSize * 2 } },
    { edge: 'sw', style: { bottom: 0, left: 0, width: edgeSize * 2, height: edgeSize * 2 } },
  ];

  return (
    <div
      onMouseDown={() => onFocus(id)}
      style={{
        position: 'absolute',
        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        zIndex,
        display: 'flex', flexDirection: 'column',
        background: '#1e1e1e',
        border: highlighted ? '1.5px solid #d4aa30' : '1px solid #444',
        borderRadius: 4,
        boxShadow: highlighted
          ? '0 0 12px rgba(212,170,48,0.35), 0 8px 32px rgba(0,0,0,0.55)'
          : '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        contain: 'layout',
      }}
    >
      {/* ── Title bar ── */}
      <div
        onMouseDown={onTitleMouseDown}
        onDoubleClick={toggleMaximise}
        style={{
          height: TITLE_H, minHeight: TITLE_H,
          display: 'flex', alignItems: 'center',
          padding: '0 6px 0 10px',
          background: 'linear-gradient(180deg, #333 0%, #282828 100%)',
          borderBottom: '1px solid #444',
          cursor: 'grab', userSelect: 'none',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px', color: 'rgba(255,255,255,0.75)',
          gap: 6,
        }}
      >
        {/* Title text */}
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </span>

        {/* Minimise */}
        <button onClick={() => onMinimise(id)} title="Minimise"
          style={btnStyle}
          onMouseEnter={e => hoverBtn(e, true)} onMouseLeave={e => hoverBtn(e, false)}
        ><Minus size={12} /></button>

        {/* Maximise / Restore */}
        <button onClick={toggleMaximise} title={maximised ? 'Restore' : 'Maximise'}
          style={btnStyle}
          onMouseEnter={e => hoverBtn(e, true)} onMouseLeave={e => hoverBtn(e, false)}
        >{maximised ? <Minimize2 size={11} /> : <Maximize2 size={11} />}</button>

        {/* Close */}
        <button onClick={() => onClose(id)} title="Close"
          style={{ ...btnStyle, color: '#e06060' }}
          onMouseEnter={e => hoverBtn(e, true, '#e06060')} onMouseLeave={e => hoverBtn(e, false)}
        ><X size={13} /></button>
      </div>

      {/* ── Content area ── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>

      {/* ── Resize handles ── */}
      {!maximised && edges.map(({ edge, style }) => (
        <div
          key={edge}
          onMouseDown={e => startResize(e, edge)}
          style={{ position: 'absolute', ...style, cursor: edgeCursors[edge], zIndex: 2 }}
        />
      ))}
    </div>
  );
};

/* shared styles */
const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 18, padding: 0,
  background: 'transparent', border: 'none', borderRadius: 2,
  color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
};
function hoverBtn(e: React.MouseEvent, enter: boolean, activeColor?: string) {
  const el = e.currentTarget as HTMLElement;
  el.style.background = enter ? 'rgba(255,255,255,0.1)' : 'transparent';
  if (activeColor) el.style.color = enter ? '#ff8888' : activeColor;
}
