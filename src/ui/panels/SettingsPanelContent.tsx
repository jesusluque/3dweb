import React, { useState } from 'react';
import { useAppStore, ShadingModeType } from '../store/useAppStore';
import { dispatchViewport } from '../buses';
import { RESOLUTION_PRESET_GROUPS } from '../data/resolutionPresets';

/* ── Palette ─────────────────────────────────────────────────────────────── */
const C = {
  bg:      'var(--maya-bg-dark)',
  bgRaise: 'var(--maya-bg-raised)',
  strip:   'var(--maya-tab-strip)',
  border:  'var(--maya-border)',
  text:    'var(--maya-text)',
  muted:   'var(--maya-text-muted)',
  dim:     'var(--maya-text-dim)',
  accent:  'var(--maya-accent)',
};

const font: React.CSSProperties = { fontFamily: '"Segoe UI", system-ui, sans-serif' };
const mono: React.CSSProperties = { fontFamily: '"Consolas","Menlo",monospace' };

/* ── Section header ──────────────────────────────────────────────────────── */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 2 }}>
    <div style={{
      padding: '4px 10px',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: C.muted,
      background: C.strip,
      borderBottom: `1px solid ${C.border}`,
      userSelect: 'none',
      ...font,
    }}>
      {title}
    </div>
    {children}
  </div>
);

/* ── Toggle row ──────────────────────────────────────────────────────────── */
const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
  <div
    onClick={onChange}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '5px 10px',
      borderBottom: `1px solid ${C.border}`,
      cursor: 'pointer',
      userSelect: 'none',
      ...font,
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
  >
    <span style={{ fontSize: 12, color: C.text }}>{label}</span>
    {/* Toggle pill */}
    <div style={{
      width: 32, height: 16, borderRadius: 8,
      background: checked ? C.accent : 'rgba(255,255,255,0.12)',
      position: 'relative', transition: 'background 0.15s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 12, height: 12, borderRadius: '50%',
        background: '#fff', transition: 'left 0.15s',
      }} />
    </div>
  </div>
);

/* ── Radio group row ─────────────────────────────────────────────────────── */
const RadioRow: React.FC<{
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}> = ({ label, options, value, onChange }) => (
  <div style={{
    padding: '5px 10px',
    borderBottom: `1px solid ${C.border}`,
    ...font,
  }}>
    <div style={{ fontSize: 11, color: C.muted, marginBottom: 5, userSelect: 'none' }}>{label}</div>
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '3px 9px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
            border: `1px solid ${value === opt.value ? C.accent : 'rgba(255,255,255,0.15)'}`,
            background: value === opt.value ? C.accent : 'rgba(255,255,255,0.05)',
            color: '#fff', ...font,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

/* ── Slider row ──────────────────────────────────────────────────────────── */
const SliderRow: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, onChange }) => (
  <div style={{ padding: '5px 10px', borderBottom: `1px solid ${C.border}`, ...font }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: C.muted, userSelect: 'none' }}>{label}</span>
      <span style={{ fontSize: 11, color: C.text, ...mono }}>{value.toFixed(2)}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', accentColor: C.accent, cursor: 'pointer' }}
    />
  </div>
);

/* ── Outline colour swatches ─────────────────────────────────────────────── */
const OUTLINE_COLORS = [
  { label: 'Maya Gold',  color: '#d4aa30' },
  { label: 'White',      color: '#ffffff' },
  { label: 'Cyan',       color: '#00d0ff' },
  { label: 'Green',      color: '#00ff88' },
  { label: 'Orange',     color: '#ff8c00' },
  { label: 'Red',        color: '#ff3333' },
];

const OutlineColorRow: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => (
  <div style={{ padding: '5px 10px', borderBottom: `1px solid ${C.border}`, ...font }}>
    <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, userSelect: 'none' }}>Outline Color</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {OUTLINE_COLORS.map(c => (
        <div
          key={c.color}
          title={c.label}
          onClick={() => onChange(c.color)}
          style={{
            width: 22, height: 22, borderRadius: 3,
            background: c.color,
            border: value === c.color
              ? `2px solid ${C.accent}`
              : '1px solid rgba(255,255,255,0.18)',
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  </div>
);

/* ── Colour swatch row ───────────────────────────────────────────────────── */
const BG_COLORS = [
  { label: 'Dark',        color: '#202020' },
  { label: 'Charcoal',    color: '#2a2a2a' },
  { label: 'Slate',       color: '#3a3a3a' },
  { label: 'Mid-Grey',    color: '#555555' },
  { label: 'Light Grey',  color: '#808080' },
  { label: 'White',       color: '#f0f0f0' },
  { label: 'Dark Blue',   color: '#1a1a2e' },
  { label: 'Dark Green',  color: '#1a2e1a' },
  { label: 'Warm Brown',  color: '#2e2218' },
];

const SwatchRow: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => (
  <div style={{ padding: '5px 10px', borderBottom: `1px solid ${C.border}`, ...font }}>
    <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, userSelect: 'none' }}>Background Color</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {BG_COLORS.map(c => (
        <div
          key={c.color}
          title={c.label}
          onClick={() => onChange(c.color)}
          style={{
            width: 22, height: 22, borderRadius: 3,
            background: c.color,
            border: value === c.color
              ? `2px solid ${C.accent}`
              : '1px solid rgba(255,255,255,0.18)',
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  </div>
);

/* ── Resolution select ───────────────────────────────────────────────────── */
const ResolutionRow: React.FC<{
  value: { w: number; h: number; label: string };
  onChange: (w: number, h: number, label: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ padding: '5px 10px', borderBottom: `1px solid ${C.border}`, ...font, position: 'relative' }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, userSelect: 'none' }}>Render Resolution</div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', padding: '4px 8px', fontSize: 11,
          background: 'rgba(255,255,255,0.07)', border: `1px solid rgba(255,255,255,0.15)`,
          borderRadius: 3, color: C.text, cursor: 'pointer', ...font,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>{value.label}</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 10, right: 10, zIndex: 10000,
          background: 'var(--maya-bg-dark)',
          border: `1px solid rgba(255,255,255,0.18)`,
          borderRadius: 3, boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {RESOLUTION_PRESET_GROUPS.map(g => (
            <div key={g.group}>
              <div style={{
                padding: '3px 8px', fontSize: 10, color: C.dim,
                background: C.strip, userSelect: 'none',
                ...font,
              }}>{g.group}</div>
              {g.presets.map(p => (
                <div
                  key={p.label}
                  onClick={() => { onChange(p.w, p.h, p.label); setOpen(false); }}
                  style={{
                    padding: '4px 12px', fontSize: 11, color: C.text, cursor: 'pointer',
                    background: value.label === p.label ? 'rgba(74,144,226,0.25)' : 'transparent',
                    ...font,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = value.label === p.label ? 'rgba(74,144,226,0.25)' : 'transparent'; }}
                >
                  {p.label}{p.note ? ` (${p.note})` : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════════
   Main component
   ══════════════════════════════════════════════════════════════════════════ */
export const SettingsPanelContent: React.FC = () => {
  const vs       = useAppStore(s => s.viewportSettings);
  const updateVS = useAppStore(s => s.updateViewportSettings);
  const vm       = useAppStore(s => s.viewportManager);

  const setShading = (m: ShadingModeType) => {
    updateVS({ shadingMode: m });
    dispatchViewport.setShadingMode(m);
  };
  const toggleGrid = () => {
    const n = !vs.showGrid;
    updateVS({ showGrid: n });
    dispatchViewport.setGridVisible(n);
  };
  const toggleLighting = () => {
    const n = !vs.showLighting;
    updateVS({ showLighting: n });
    dispatchViewport.setLightingEnabled(n);
  };
  const toggleGate = () => updateVS({ showGateMask: !vs.showGateMask });
  const toggleSnap = () => {
    const n = !vs.snapGrid;
    updateVS({ snapGrid: n });
    dispatchViewport.setSnapGrid(n ? 0.5 : null);
  };
  const toggleSnapV = () => {
    const n = !vs.snapVertex;
    updateVS({ snapVertex: n });
    dispatchViewport.setSnapVertex(n);
  };
  const setSpace = (s: 'world' | 'local') => {
    updateVS({ transformSpace: s });
    dispatchViewport.setTransformSpace(s);
  };
  const setBgColor = (c: string) => { updateVS({ bgColor: c }); dispatchViewport.setBgColor(c); };
  const setRes = (w: number, h: number, label: string) => {
    updateVS({ renderRes: { w, h, label } });
    vm?.setRenderResolution(w, h);
  };
  const setGizmo = (v: number) => {
    updateVS({ gizmoSize: v });
    dispatchViewport.setGizmoSize(v);
  };
  const toggleOutline = () => {
    const n = !vs.outlineEnabled;
    updateVS({ outlineEnabled: n });
    dispatchViewport.setOutlineEnabled(n);
  };
  const setOutlineColor = (c: string) => {
    updateVS({ outlineColor: c });
    dispatchViewport.setOutlineColor(c);
  };
  const setOutlineWidth = (v: number) => {
    updateVS({ outlineWidth: v });
    dispatchViewport.setOutlineWidth(v);
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: C.bg,
      overflowY: 'auto',
      overflowX: 'hidden',
      ...font,
    }}>

      {/* ── VIEWPORT ────────────────────────────────────────────────── */}
      <Section title="Viewport">
        <ToggleRow label="Show Grid"           checked={vs.showGrid}     onChange={toggleGrid} />
        <ToggleRow label="Lighting"            checked={vs.showLighting} onChange={toggleLighting} />
        <ToggleRow label="Film Gate Mask"      checked={vs.showGateMask} onChange={toggleGate} />
        <RadioRow
          label="Shading Mode"
          options={[
            { label: 'Smooth',       value: 'smooth' },
            { label: 'Wire on Shaded', value: 'wireframe-on-shaded' },
            { label: 'Wireframe',    value: 'wireframe' },
          ]}
          value={vs.shadingMode}
          onChange={v => setShading(v as ShadingModeType)}
        />
        <SwatchRow value={vs.bgColor} onChange={setBgColor} />
      </Section>

      {/* ── TRANSFORM ───────────────────────────────────────────────── */}
      <Section title="Transform">
        <RadioRow
          label="Transform Space"
          options={[
            { label: 'World', value: 'world' },
            { label: 'Local', value: 'local' },
          ]}
          value={vs.transformSpace}
          onChange={v => setSpace(v as 'world' | 'local')}
        />
        <SliderRow
          label="Gizmo Size"
          value={vs.gizmoSize}
          min={0.1} max={5} step={0.05}
          onChange={setGizmo}
        />
      </Section>

      {/* ── SNAPPING ────────────────────────────────────────────────── */}
      <Section title="Snapping">
        <ToggleRow label="Snap to Grid"   checked={vs.snapGrid}   onChange={toggleSnap} />
        <ToggleRow label="Snap to Vertex" checked={vs.snapVertex} onChange={toggleSnapV} />
      </Section>

      {/* ── EFFECTS ─────────────────────────────────────────────────── */}
      <Section title="Effects">
        <ToggleRow label="Selection Outline" checked={vs.outlineEnabled} onChange={toggleOutline} />
        {vs.outlineEnabled && (
          <>
            <OutlineColorRow value={vs.outlineColor} onChange={setOutlineColor} />
            <SliderRow
              label="Outline Width (px)"
              value={vs.outlineWidth}
              min={0.5} max={8} step={0.25}
              onChange={setOutlineWidth}
            />
          </>
        )}
      </Section>

      {/* ── RENDER ──────────────────────────────────────────────────── */}
      <Section title="Render">
        <ResolutionRow value={vs.renderRes} onChange={setRes} />
      </Section>

    </div>
  );
};
