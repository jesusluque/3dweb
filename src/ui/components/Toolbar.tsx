import React, { useState } from 'react';
import {
  MousePointer2, Move3d, RotateCcw, Maximize2,
  Magnet, Grid3x3, Sun, Undo2, Redo2,
  Box, Circle, Triangle, Square, Globe, Focus, FolderOpen,
  Plus, Minus,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  ToolMode, ShadingMode, PrimitiveType,
  dispatchTool, dispatchViewport, dispatchScene,
} from '../buses';

// ── Shared tool button ─────────────────────────────────────────────────────────
interface TBtnProps {
  icon: React.ReactNode; label: string; shortcut?: string;
  active?: boolean; toggled?: boolean;
  onClick: () => void;
}
const TBtn: React.FC<TBtnProps> = ({ icon, label, shortcut, active, toggled, onClick }) => (
  <button
    title={shortcut ? `${label}  (${shortcut})` : label}
    onClick={onClick}
    style={{
      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? 'var(--maya-accent)' : toggled ? 'rgba(82,133,166,0.25)' : 'transparent',
      border: active ? '1px solid var(--maya-accent-hover)' : toggled ? '1px solid var(--maya-accent)' : '1px solid transparent',
      borderRadius: 3, cursor: 'pointer', padding: 0, flexShrink: 0,
      color: active ? '#fff' : 'var(--maya-text)',
      transition: 'background 0.1s',
    }}
    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--maya-bg-raised)'; }}
    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = toggled ? 'rgba(82,133,166,0.25)' : 'transparent'; }}
  >{icon}</button>
);

// ── Shelf mode pill ─────────────────────────────────────────────────────────────
type ShelfContext = 'object' | 'create' | 'display';
const ShelfPill: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '2px 8px', fontSize: '10px', letterSpacing: '0.4px',
      textTransform: 'uppercase', fontFamily: '"Segoe UI", system-ui, sans-serif',
      background: active ? 'var(--maya-accent)' : 'transparent',
      color: active ? '#fff' : 'var(--maya-text-muted)',
      border: active ? '1px solid var(--maya-accent-hover)' : '1px solid var(--maya-border-light)',
      borderRadius: 3, cursor: 'pointer', height: 20, flexShrink: 0,
      transition: 'background 0.1s',
    }}
    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--maya-text)'; }}
    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--maya-text-muted)'; }}
  >{label}</button>
);

// ── Vertical separator ──────────────────────────────────────────────────────────
const VSep = () => <div style={{ width: 1, height: 20, background: 'var(--maya-border-light)', margin: '0 4px', flexShrink: 0 }} />;

// ── Main Toolbar ───────────────────────────────────────────────────────────────
export const Toolbar: React.FC = () => {
  const [shelf,        setShelf]        = useState<ShelfContext>('object');
  const [activeTool,   setActiveTool]   = useState<ToolMode>('select');
  const core = useAppStore((s) => s.core);

  // Read shared viewport settings from store
  const vs = useAppStore(s => s.viewportSettings);
  const updateVS = useAppStore(s => s.updateViewportSettings);

  const setTool = (tool: ToolMode) => { setActiveTool(tool); dispatchTool(tool); };

  const toggleSnapGrid = () => {
    const next = !vs.snapGrid; updateVS({ snapGrid: next });
    dispatchViewport.setSnapGrid(next ? 0.5 : null);
  };
  const toggleSnapVertex = () => {
    const next = !vs.snapVertex; updateVS({ snapVertex: next });
    dispatchViewport.setSnapVertex(next);
  };
  const toggleSpace = () => {
    const next = vs.transformSpace === 'world' ? 'local' : 'world';
    updateVS({ transformSpace: next });
    dispatchViewport.setTransformSpace(next);
  };

  const create = (t: PrimitiveType) => { dispatchScene.createPrimitive(t); };

  // ── Context shelves ──────────────────────────────────────────────────────────
  const ObjectShelf = (
    <>
      <TBtn icon={<MousePointer2 size={14}/>} label="Select"  shortcut="Q" active={activeTool==='select'}    onClick={() => setTool('select')} />
      <TBtn icon={<Move3d        size={14}/>} label="Move"    shortcut="W" active={activeTool==='translate'} onClick={() => setTool('translate')} />
      <TBtn icon={<RotateCcw     size={14}/>} label="Rotate"  shortcut="E" active={activeTool==='rotate'}    onClick={() => setTool('rotate')} />
      <TBtn icon={<Maximize2     size={14}/>} label="Scale"   shortcut="R" active={activeTool==='scale'}     onClick={() => setTool('scale')} />

      <VSep />
      <TBtn icon={<Grid3x3 size={13}/>} label="Snap to Grid   (X)"   shortcut="X" toggled={vs.snapGrid}   onClick={toggleSnapGrid} />
      <TBtn icon={<Magnet  size={13}/>} label="Snap to Vertex (V)"   shortcut="V" toggled={vs.snapVertex} onClick={toggleSnapVertex} />

      <VSep />
      <TBtn
        icon={vs.transformSpace === 'local' ? <Focus size={13}/> : <Globe size={13}/>}
        label={vs.transformSpace === 'local' ? 'Local Space  (T)' : 'World Space  (T)'}
        shortcut="T"
        toggled={vs.transformSpace === 'local'}
        onClick={toggleSpace}
      />

      <VSep />
      {/* Gizmo size +/- */}
      <TBtn icon={<Minus size={12}/>} label="Decrease Manipulator Size  (-)" shortcut="-"
        onClick={() => { const s = Math.max(0.1, vs.gizmoSize - 0.15); updateVS({ gizmoSize: s }); dispatchViewport.setGizmoSize(s); }} />
      <span style={{ fontSize: 9, fontFamily: '"Consolas","Menlo",monospace',
        color: 'var(--maya-text-muted)', minWidth: 28, textAlign: 'center', userSelect: 'none' }}>
        {vs.gizmoSize.toFixed(1)}
      </span>
      <TBtn icon={<Plus size={12}/>} label="Increase Manipulator Size  (+)" shortcut="+"
        onClick={() => { const s = Math.min(5, vs.gizmoSize + 0.15); updateVS({ gizmoSize: s }); dispatchViewport.setGizmoSize(s); }} />

      {/* current tool label */}
      <span style={{ fontSize: 10, color: 'var(--maya-accent)', marginLeft: 6,
        fontFamily: '"Segoe UI",system-ui,sans-serif', letterSpacing: '0.4px' }}>
        {activeTool.toUpperCase()}
      </span>
    </>
  );

  const CreateShelf = (
    <>
      <TBtn icon={<Box      size={13}/>} label="Cube"   onClick={() => create('box')} />
      <TBtn icon={<Circle   size={13}/>} label="Sphere" onClick={() => create('sphere')} />
      <TBtn icon={<Triangle size={13}/>} label="Cone"   onClick={() => create('cone')} />
      <TBtn icon={<Square   size={13}/>} label="Plane"  onClick={() => create('plane')} />
      <VSep />
      <TBtn icon={<FolderOpen size={13}/>} label="Group Selected  (⌘G)" onClick={() => { dispatchScene.groupSelected(); }} />
      <span style={{ fontSize: 10, color: 'var(--maya-text-dim)', marginLeft: 6,
        fontFamily: '"Segoe UI",system-ui,sans-serif', fontStyle: 'italic' }}>
        Polygon primitives
      </span>
    </>
  );

  const DisplayShelf = (
    <>
      <TBtn
        icon={<Grid3x3 size={13} strokeWidth={1.5}/>}
        label="Toggle Grid"
        toggled={vs.showGrid}
        onClick={() => { const n = !vs.showGrid; updateVS({ showGrid: n }); dispatchViewport.setGridVisible(n); }}
      />
      <TBtn
        icon={<Sun size={13}/>}
        label="Toggle Lighting"
        toggled={vs.showLighting}
        onClick={() => { const n = !vs.showLighting; updateVS({ showLighting: n }); dispatchViewport.setLightingEnabled(n); }}
      />
      <VSep />
      {(['smooth', 'wireframe-on-shaded', 'wireframe'] as ShadingMode[]).map(m => {
        const labels: Record<ShadingMode, string> = { smooth: 'Smooth', 'wireframe-on-shaded': 'Wire+Shaded', wireframe: 'Wireframe' };
        return (
          <button key={m} onClick={() => dispatchViewport.setShadingMode(m)}
            style={{
              padding: '0 7px', height: 22, fontSize: 10, borderRadius: 3, cursor: 'pointer',
              fontFamily: '"Segoe UI",system-ui,sans-serif', border: '1px solid var(--maya-border-light)',
              background: 'transparent', color: 'var(--maya-text-muted)', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--maya-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--maya-text-muted)')}
          >{labels[m]}</button>
        );
      })}
    </>
  );

  return (
    <div style={{
      height: 'var(--maya-toolbar-h)', background: 'var(--maya-bg)',
      borderBottom: '1px solid var(--maya-border)',
      display: 'flex', alignItems: 'center', padding: '0 8px', gap: 3,
      flexShrink: 0, userSelect: 'none', zIndex: 50,
    }}>
      {/* ── Shelf context pills ── */}
      <ShelfPill label="Object" active={shelf==='object'}  onClick={() => setShelf('object')} />
      <ShelfPill label="Create" active={shelf==='create'}  onClick={() => setShelf('create')} />
      <ShelfPill label="Display" active={shelf==='display'} onClick={() => setShelf('display')} />
      <VSep />

      {/* ── Context section ── */}
      {shelf === 'object'  && ObjectShelf}
      {shelf === 'create'  && CreateShelf}
      {shelf === 'display' && DisplayShelf}

      {/* ── Spacer + always-visible Undo/Redo ── */}
      <div style={{ flex: 1 }} />
      <TBtn icon={<Undo2 size={14}/>} label="Undo" shortcut="⌘Z"   onClick={() => core?.commandHistory.undo()} />
      <TBtn icon={<Redo2 size={14}/>} label="Redo" shortcut="⌘⇧Z"  onClick={() => core?.commandHistory.redo()} />
    </div>
  );
};