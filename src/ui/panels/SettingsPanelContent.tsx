import React, { useState } from 'react';
import { useAppStore, ShadingModeType, type SplatOptSettings, type ViewportSettings } from '../store/useAppStore';
import { dispatchViewport } from '../buses';
import { RESOLUTION_PRESET_GROUPS } from '../data/resolutionPresets';

// ── Colour palette ─────────────────────────────────────────────────────────────
const C = {
  bg:      'var(--maya-bg-dark)',
  bgRaise: 'var(--maya-bg-raised)',
  strip:   'var(--maya-tab-strip)',
  border:  'var(--maya-border)',
  text:    'var(--maya-text)',
  muted:   'var(--maya-text-muted)',
  dim:     'var(--maya-text-dim)',
  accent:  'var(--maya-accent)',
  blue:    '#99c8f0',
  green:   '#7ec89c',
  orange:  '#d4a46e',
};

// ── Collapsible section header (matches AttributeEditorPanel style) ─────────────
const Sec: React.FC<{
  title: string;
  tag?: string;
  open: boolean;
  onToggle: () => void;
  accent?: boolean;
}> = ({ title, tag, open, onToggle, accent }) => (
  <div
    onClick={onToggle}
    style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
      background: C.strip,
      borderBottom: `1px solid ${C.border}`,
      borderTop: `1px solid ${C.border}`,
      cursor: 'pointer', userSelect: 'none',
    }}
  >
    <span style={{ color: C.dim, fontSize: 9, width: 8 }}>{open ? '▼' : '▶'}</span>
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.3px',
      color: accent ? C.accent : C.text,
      fontFamily: '"Segoe UI",system-ui,sans-serif',
      textTransform: 'uppercase',
    }}>{title}</span>
    {tag && (
      <span style={{ fontSize: 9, color: C.dim, marginLeft: 'auto', fontFamily: 'monospace' }}>
        {tag}
      </span>
    )}
  </div>
);

// ── Label / value grid row ─────────────────────────────────────────────────────
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '42% 1fr',
    borderBottom: `1px solid ${C.border}`,
  }}>
    <div style={{
      padding: '4px 8px', fontSize: 11, color: C.muted,
      fontFamily: '"Segoe UI",system-ui,sans-serif',
      display: 'flex', alignItems: 'center',
      borderRight: `1px solid ${C.border}`, userSelect: 'none',
    }}>{label}</div>
    <div style={{ padding: '3px 8px', display: 'flex', alignItems: 'center' }}>
      {children}
    </div>
  </div>
);

// ── Toggle switch ──────────────────────────────────────────────────────────────
const Toggle: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <div
    onClick={e => { e.stopPropagation(); onChange(); }}
    style={{
      width: 30, height: 15, borderRadius: 8,
      background: checked ? C.accent : 'rgba(255,255,255,0.12)',
      position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      cursor: 'pointer',
    }}
  >
    <div style={{
      position: 'absolute', top: 2, left: checked ? 16 : 2,
      width: 11, height: 11, borderRadius: '50%',
      background: '#fff', transition: 'left 0.15s',
    }} />
  </div>
);

// ── Toggle row (label + switch) ────────────────────────────────────────────────
const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
  <Row label={label}>
    <Toggle checked={checked} onChange={onChange} />
  </Row>
);

// ── Radio chip group row ───────────────────────────────────────────────────────
const RadioRow: React.FC<{
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}> = ({ label, options, value, onChange }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '42% 1fr',
    borderBottom: `1px solid ${C.border}`,
  }}>
    <div style={{
      padding: '4px 8px', fontSize: 11, color: C.muted,
      fontFamily: '"Segoe UI",system-ui,sans-serif',
      display: 'flex', alignItems: 'center',
      borderRight: `1px solid ${C.border}`, userSelect: 'none',
    }}>{label}</div>
    <div style={{ padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '2px 7px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
            border: `1px solid ${value === opt.value ? C.accent : 'rgba(255,255,255,0.15)'}`,
            background: value === opt.value ? C.accent : 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontFamily: '"Segoe UI",system-ui,sans-serif',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

// ── Slider row ─────────────────────────────────────────────────────────────────
const SliderRow: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  unit?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit, onChange }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '42% 1fr',
    borderBottom: `1px solid ${C.border}`,
  }}>
    <div style={{
      padding: '4px 8px', fontSize: 11, color: C.muted,
      fontFamily: '"Segoe UI",system-ui,sans-serif',
      display: 'flex', alignItems: 'center',
      borderRight: `1px solid ${C.border}`, userSelect: 'none',
    }}>{label}</div>
    <div style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: C.accent, cursor: 'pointer' }}
      />
      <span style={{
        fontSize: 10, color: C.blue, minWidth: 28, textAlign: 'right',
        fontFamily: '"Consolas","Menlo",monospace', flexShrink: 0,
      }}>{value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}</span>
      {unit && (
        <span style={{
          fontSize: 9, color: C.dim, flexShrink: 0,
          fontFamily: '"Segoe UI",system-ui,sans-serif',
          minWidth: 14,
        }}>{unit}</span>
      )}
    </div>
  </div>
);

// ── Colour swatch picker ───────────────────────────────────────────────────────
const SwatchPicker: React.FC<{
  colors: { label: string; color: string }[];
  value: string;
  onChange: (c: string) => void;
}> = ({ colors, value, onChange }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
    {colors.map(c => (
      <div
        key={c.color}
        title={c.label}
        onClick={() => onChange(c.color)}
        style={{
          width: 18, height: 18, borderRadius: 2,
          background: c.color,
          border: value === c.color
            ? `2px solid ${C.accent}`
            : '1px solid rgba(255,255,255,0.18)',
          cursor: 'pointer', boxSizing: 'border-box', flexShrink: 0,
        }}
      />
    ))}
  </div>
);

const BG_COLORS = [
  { label: 'Dark',       color: '#202020' },
  { label: 'Charcoal',   color: '#2a2a2a' },
  { label: 'Slate',      color: '#3a3a3a' },
  { label: 'Mid-Grey',   color: '#555555' },
  { label: 'Light Grey', color: '#808080' },
  { label: 'White',      color: '#f0f0f0' },
  { label: 'Dark Blue',  color: '#1a1a2e' },
  { label: 'Dark Green', color: '#1a2e1a' },
  { label: 'Warm Brown', color: '#2e2218' },
];

const OUTLINE_COLORS = [
  { label: 'Maya Gold', color: '#d4aa30' },
  { label: 'White',     color: '#ffffff' },
  { label: 'Cyan',      color: '#00d0ff' },
  { label: 'Green',     color: '#00ff88' },
  { label: 'Orange',    color: '#ff8c00' },
  { label: 'Red',       color: '#ff3333' },
];

// ── Resolution dropdown row ────────────────────────────────────────────────────
const ResolutionRow: React.FC<{
  value: { w: number; h: number; label: string };
  onChange: (w: number, h: number, label: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '42% 1fr',
      borderBottom: `1px solid ${C.border}`, position: 'relative',
    }}>
      <div style={{
        padding: '4px 8px', fontSize: 11, color: C.muted,
        fontFamily: '"Segoe UI",system-ui,sans-serif',
        display: 'flex', alignItems: 'center',
        borderRight: `1px solid ${C.border}`, userSelect: 'none',
      }}>Resolution</div>
      <div style={{ padding: '3px 6px', display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', textAlign: 'left', padding: '3px 6px', fontSize: 10,
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid rgba(255,255,255,0.15)`,
            borderRadius: 2, color: C.text, cursor: 'pointer',
            fontFamily: '"Segoe UI",system-ui,sans-serif',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>{value.label}</span>
          <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
        </button>
        {open && (
          <div style={{
            position: 'absolute', right: 0, top: '100%', zIndex: 10000, minWidth: 180,
            background: 'var(--maya-bg-dark)',
            border: `1px solid rgba(255,255,255,0.18)`,
            borderRadius: 3, boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
            maxHeight: 220, overflowY: 'auto',
          }}>
            {RESOLUTION_PRESET_GROUPS.map(g => (
              <div key={g.group}>
                <div style={{
                  padding: '3px 8px', fontSize: 9, color: C.dim,
                  background: C.strip, userSelect: 'none',
                  fontFamily: '"Segoe UI",system-ui,sans-serif',
                }}>{g.group}</div>
                {g.presets.map(p => (
                  <div
                    key={p.label}
                    onClick={() => { onChange(p.w, p.h, p.label); setOpen(false); }}
                    style={{
                      padding: '4px 12px', fontSize: 11, color: C.text, cursor: 'pointer',
                      background: value.label === p.label ? 'rgba(74,144,226,0.25)' : 'transparent',
                      fontFamily: '"Segoe UI",system-ui,sans-serif',
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
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════════════
export const SettingsPanelContent: React.FC = () => {
  const vs       = useAppStore(s => s.viewportSettings);
  const updateVS = useAppStore(s => s.updateViewportSettings);
  const vm       = useAppStore(s => s.viewportManager);

  // Section open states
  const [unitsOpen,     setUnitsOpen]     = useState(true);
  const [viewportOpen,  setViewportOpen]  = useState(true);
  const [rendererOpen,  setRendererOpen]  = useState(true);
  const [transformOpen, setTransformOpen] = useState(true);
  const [snappingOpen,  setSnappingOpen]  = useState(true);
  const [effectsOpen,   setEffectsOpen]   = useState(true);
  const [anaglyphOpen,  setAnaglyphOpen]  = useState(false);
  const [renderOpen,    setRenderOpen]    = useState(true);
  const [hdriOpen,      setHdriOpen]      = useState(true);
  const [splatOpen,     setSplatOpen]     = useState(true);

  // Scene unit abbreviation used throughout sliders
  const unitAbbr: Record<string, string> = {
    meters: 'm', centimeters: 'cm', millimeters: 'mm', feet: 'ft', inches: 'in',
  };
  const su = unitAbbr[vs.sceneUnits] ?? 'm';

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
  const toggleGate    = () => updateVS({ showGateMask: !vs.showGateMask });
  const toggleSnap    = () => {
    const n = !vs.snapGrid;
    updateVS({ snapGrid: n });
    dispatchViewport.setSnapGrid(n ? 0.5 : null);
  };
  const toggleSnapV   = () => {
    const n = !vs.snapVertex;
    updateVS({ snapVertex: n });
    dispatchViewport.setSnapVertex(n);
  };
  const setSpace      = (s: 'world' | 'local') => {
    updateVS({ transformSpace: s });
    dispatchViewport.setTransformSpace(s);
  };
  const setBgColor    = (c: string) => { updateVS({ bgColor: c }); dispatchViewport.setBgColor(c); };
  const setRes        = (w: number, h: number, label: string) => {
    updateVS({ renderRes: { w, h, label } });
    vm?.setRenderResolution(w, h);
  };
  const setGizmo      = (v: number) => {
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
  const toggleAnaglyph = () => {
    const n = !vs.anaglyphEnabled;
    updateVS({ anaglyphEnabled: n });
    vm?.setAnaglyphEnabled(n, vs.anaglyphIPD);
  };
  const setIPD = (v: number) => {
    updateVS({ anaglyphIPD: v });
    vm?.setAnaglyphIPD(v);
  };

  const updateSplatOpt = (patch: Partial<SplatOptSettings>) => {
    const next = { ...vs.splatOpt, ...patch };
    updateVS({ splatOpt: next });
    dispatchViewport.setSplatOpt(next);
  };

  // ── HDRI handlers ────────────────────────────────────────────────────────
  const toggleHdri    = () => { const n = !vs.hdriEnabled; updateVS({ hdriEnabled: n }); dispatchViewport.setHdriEnabled(n); };
  const setHdriInt    = (v: number) => { updateVS({ hdriIntensity: v }); dispatchViewport.setHdriIntensity(v); };
  const setHdriBgInt  = (v: number) => { updateVS({ hdriBgIntensity: v }); dispatchViewport.setHdriBgIntensity(v); };
  const setHdriRot    = (v: number) => { updateVS({ hdriRotation: v }); dispatchViewport.setHdriRotation(v); };
  const toggleHdriBg  = () => { const n = !vs.hdriAsBackground; updateVS({ hdriAsBackground: n }); dispatchViewport.setHdriAsBackground(n); };
  const importHdri    = () => { dispatchViewport.importHdri(); };
  const clearHdri     = () => { updateVS({ hdriEnabled: false, hdriFileName: '', hdriAsBackground: false }); dispatchViewport.clearHdri(); };

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: C.bg, overflowY: 'auto', overflowX: 'hidden',
    }}>
      {/* ── UNITS ──────────────────────────────────────────── */}
      <Sec title="Units" tag="scene" open={unitsOpen} onToggle={() => setUnitsOpen(v => !v)} accent />
      {unitsOpen && (
        <>
          <RadioRow
            label="Working Units"
            options={[
              { label: 'm',  value: 'meters'      },
              { label: 'cm', value: 'centimeters' },
              { label: 'mm', value: 'millimeters' },
              { label: 'ft', value: 'feet'        },
              { label: 'in', value: 'inches'      },
            ]}
            value={vs.sceneUnits}
            onChange={v => updateVS({ sceneUnits: v as ViewportSettings['sceneUnits'] })}
          />
          <div style={{
            padding: '4px 10px 5px', fontSize: 9.5,
            fontFamily: '"Segoe UI",system-ui,sans-serif',
            color: C.dim, borderBottom: `1px solid ${C.border}`, lineHeight: 1.5,
          }}>
            Sets the unit label shown throughout the UI. All internal values are stored in scene units.
          </div>
        </>
      )}
      {/* ── RENDERER ────────────────────────────────────────────── */}
      <Sec title="Renderer" tag="backend" open={rendererOpen} onToggle={() => setRendererOpen(v => !v)} accent />
      {rendererOpen && (
        <>
          <RadioRow
            label="Back-end"
            options={[
              { label: 'WebGPU', value: 'webgpu' },
              { label: 'WebGL',  value: 'webgl'  },
            ]}
            value={vs.rendererType}
            onChange={v => updateVS({ rendererType: v as 'webgpu' | 'webgl' })}
          />
          <div style={{
            padding: '5px 10px',
            fontSize: 10,
            fontFamily: '"Segoe UI",system-ui,sans-serif',
            color: C.dim,
            borderBottom: `1px solid ${C.border}`,
            lineHeight: 1.5,
          }}>
            {vs.rendererType === 'webgpu' ? (
              <>
                <span style={{ color: C.green }}>&#9679;</span>
                {' WebGPU — enables TSL shaders & anaglyph compositor.'}
                {' Falls back to WebGL2 automatically if GPU has no WebGPU support.'}
              </>
            ) : (
              <>
                <span style={{ color: C.orange }}>&#9679;</span>
                {' Classic WebGL — maximum compatibility.'}
                {' All geometry, lighting, clone and transform tools work normally.'}
                {' Anaglyph uses AnaglyphEffect instead of TSL compositor.'}
              </>
            )}
          </div>
          <div style={{
            padding: '4px 10px 5px',
            fontSize: 9.5,
            fontFamily: '"Segoe UI",system-ui,sans-serif',
            color: C.muted,
            fontStyle: 'italic',
            borderBottom: `1px solid ${C.border}`,
          }}>
            Switching re-initialises the viewport while preserving scene objects.
          </div>
        </>
      )}
      {/* ── VIEWPORT ──────────────────────────────────────────────── */}
      <Sec title="Viewport" open={viewportOpen} onToggle={() => setViewportOpen(v => !v)} />
      {viewportOpen && (
        <>
          <ToggleRow label="Show Grid"      checked={vs.showGrid}     onChange={toggleGrid} />
          <ToggleRow label="Lighting"       checked={vs.showLighting} onChange={toggleLighting} />
          <ToggleRow label="Film Gate Mask" checked={vs.showGateMask} onChange={toggleGate} />
          <RadioRow
            label="Shading"
            options={[
              { label: 'Smooth',  value: 'smooth' },
              { label: 'Wire+Sh', value: 'wireframe-on-shaded' },
              { label: 'Wire',    value: 'wireframe' },
            ]}
            value={vs.shadingMode}
            onChange={v => setShading(v as ShadingModeType)}
          />
          <Row label="BG Color">
            <SwatchPicker colors={BG_COLORS} value={vs.bgColor} onChange={setBgColor} />
          </Row>
        </>
      )}

      {/* ── TRANSFORM ─────────────────────────────────────────────── */}
      <Sec title="Transform" open={transformOpen} onToggle={() => setTransformOpen(v => !v)} />
      {transformOpen && (
        <>
          <RadioRow
            label="Space"
            options={[
              { label: 'World', value: 'world' },
              { label: 'Local', value: 'local' },
            ]}
            value={vs.transformSpace}
            onChange={v => setSpace(v as 'world' | 'local')}
          />
          <SliderRow label="Gizmo Size" value={vs.gizmoSize} min={0.1} max={5} step={0.05} unit={su} onChange={setGizmo} />
        </>
      )}

      {/* ── SNAPPING ──────────────────────────────────────────────── */}
      <Sec title="Snapping" open={snappingOpen} onToggle={() => setSnappingOpen(v => !v)} />
      {snappingOpen && (
        <>
          <ToggleRow label="Snap to Grid"   checked={vs.snapGrid}   onChange={toggleSnap} />
          <ToggleRow label="Snap to Vertex" checked={vs.snapVertex} onChange={toggleSnapV} />
        </>
      )}

      {/* ── EFFECTS ───────────────────────────────────────────────── */}
      <Sec title="Effects" open={effectsOpen} onToggle={() => setEffectsOpen(v => !v)} />
      {effectsOpen && (
        <>
          <ToggleRow label="Selection Outline" checked={vs.outlineEnabled} onChange={toggleOutline} />
          {vs.outlineEnabled && (
            <>
              <Row label="Outline Color">
                <SwatchPicker colors={OUTLINE_COLORS} value={vs.outlineColor} onChange={setOutlineColor} />
              </Row>
              <SliderRow
                label="Outline Width"
                value={vs.outlineWidth}
                min={0.5} max={8} step={0.25}
                unit="px"
                onChange={setOutlineWidth}
              />
            </>
          )}
        </>
      )}

      {/* ── ANAGLYPH 3D ───────────────────────────────────────────── */}
      <Sec title="Anaglyph 3D" tag="stereo" open={anaglyphOpen} onToggle={() => setAnaglyphOpen(v => !v)} />
      {anaglyphOpen && (
        <>
          <ToggleRow label="Enable Anaglyph" checked={vs.anaglyphEnabled} onChange={toggleAnaglyph} />
          <SliderRow
            label="IPD"
            value={Math.round(vs.anaglyphIPD * 1000)}
            min={40} max={100} step={1}
            unit="mm"
            onChange={v => setIPD(v / 1000)}
          />
        </>
      )}

      {/* ── RENDER ────────────────────────────────────────────────── */}
      <Sec title="Render" open={renderOpen} onToggle={() => setRenderOpen(v => !v)} />
      {renderOpen && (
        <ResolutionRow value={vs.renderRes} onChange={setRes} />
      )}

      {/* ── HDRI ENVIRONMENT ─────────────────────────────────────── */}
      <Sec title="HDRI / IBL" tag="environment" open={hdriOpen} onToggle={() => setHdriOpen(v => !v)} accent />
      {hdriOpen && (
        <>
          {/* Import / clear row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '42% 1fr',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{
              padding: '4px 8px', fontSize: 11, color: C.muted,
              fontFamily: '"Segoe UI",system-ui,sans-serif',
              display: 'flex', alignItems: 'center',
              borderRight: `1px solid ${C.border}`, userSelect: 'none',
            }}>HDR / EXR File</div>
            <div style={{ padding: '3px 6px', display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                onClick={importHdri}
                style={{
                  flex: 1, padding: '3px 6px', fontSize: 10, borderRadius: 2,
                  background: 'rgba(74,144,226,0.25)',
                  border: `1px solid rgba(74,144,226,0.5)`,
                  color: C.blue, cursor: 'pointer',
                  fontFamily: '"Segoe UI",system-ui,sans-serif',
                }}
              >
                {vs.hdriFileName ? '↺ Reload' : '↑ Import'}
              </button>
              {vs.hdriFileName && (
                <button
                  onClick={clearHdri}
                  title="Clear HDRI"
                  style={{
                    padding: '3px 6px', fontSize: 10, borderRadius: 2,
                    background: 'rgba(255,80,80,0.18)',
                    border: '1px solid rgba(255,80,80,0.4)',
                    color: '#ff8080', cursor: 'pointer',
                  }}
                >✕</button>
              )}
            </div>
          </div>

          {/* Current file name */}
          {vs.hdriFileName && (
            <div style={{
              padding: '3px 10px', fontSize: 9.5,
              fontFamily: '"Consolas","Menlo",monospace',
              color: C.green, letterSpacing: '0.2px',
              borderBottom: `1px solid ${C.border}`,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {vs.hdriFileName}
            </div>
          )}

          <ToggleRow label="Enable HDRI"     checked={vs.hdriEnabled}      onChange={toggleHdri} />
          <SliderRow
            label="Light Intensity"
            value={vs.hdriIntensity}
            min={0} max={5} step={0.05}
            unit="×"
            onChange={setHdriInt}
          />
          <ToggleRow label="Show as BG"      checked={vs.hdriAsBackground}  onChange={toggleHdriBg} />
          {vs.hdriAsBackground && (
            <SliderRow
              label="BG Intensity"
              value={vs.hdriBgIntensity}
              min={0} max={5} step={0.05}
              unit="×"
              onChange={setHdriBgInt}
            />
          )}
          <SliderRow
            label="Rotation"
            value={vs.hdriRotation}
            min={-180} max={180} step={1}
            unit="°"
            onChange={setHdriRot}
          />

          {/* Info note */}
          <div style={{
            padding: '4px 10px 5px',
            fontSize: 9.5,
            fontFamily: '"Segoe UI",system-ui,sans-serif',
            color: C.dim,
            borderBottom: `1px solid ${C.border}`,
            lineHeight: 1.5,
          }}>
            Supported: .hdr (Radiance), .exr (OpenEXR).<br />
            HDRI illuminates all PBR materials via Image-Based Lighting.
          </div>
        </>
      )}

      {/* ── GAUSSIAN SPLAT ────────────────────────────────────────── */}
      <Sec title="Gaussian Splat" tag="gsplat" open={splatOpen} onToggle={() => setSplatOpen(v => !v)} />
      {splatOpen && (
        <>
          {/* Sub-header: active */}
          <div style={{
            padding: '3px 10px', fontSize: 9,
            fontFamily: '"Segoe UI",system-ui,sans-serif',
            color: C.green, letterSpacing: '0.4px', textTransform: 'uppercase',
            background: C.bgRaise, borderBottom: `1px solid ${C.border}`,
          }}>Active optimizations</div>

          <ToggleRow
            label="Worker Sort"
            checked={vs.splatOpt.workerSort}
            onChange={() => updateSplatOpt({ workerSort: !vs.splatOpt.workerSort })}
          />
          <ToggleRow
            label="Radix Sort"
            checked={vs.splatOpt.radixSort}
            onChange={() => updateSplatOpt({ radixSort: !vs.splatOpt.radixSort })}
          />
          <ToggleRow
            label="Lazy Re-sort"
            checked={vs.splatOpt.lazyResort}
            onChange={() => updateSplatOpt({ lazyResort: !vs.splatOpt.lazyResort })}
          />
          <ToggleRow
            label="Throttle"
            checked={vs.splatOpt.throttle}
            onChange={() => updateSplatOpt({ throttle: !vs.splatOpt.throttle })}
          />
          <ToggleRow
            label="Frustum Cull"
            checked={vs.splatOpt.frustumCull}
            onChange={() => updateSplatOpt({ frustumCull: !vs.splatOpt.frustumCull })}
          />
          <ToggleRow
            label="GPU Indirect"
            checked={vs.splatOpt.gpuIndirect}
            onChange={() => updateSplatOpt({ gpuIndirect: !vs.splatOpt.gpuIndirect })}
          />
          <SliderRow
            label="Alpha Threshold"
            value={vs.splatOpt.alphaThreshold}
            min={0} max={0.1} step={0.002}
            unit="α"
            onChange={v => updateSplatOpt({ alphaThreshold: v })}
          />
          <SliderRow
            label="LOD (screen px)"
            value={vs.splatOpt.lodFactor}
            min={0.05} max={1.0} step={0.05}
            unit="px"
            onChange={v => updateSplatOpt({ lodFactor: v })}
          />
          <ToggleRow
            label="Streaming LOD"
            checked={vs.splatOpt.streamingLOD}
            onChange={() => updateSplatOpt({ streamingLOD: !vs.splatOpt.streamingLOD })}
          />
        </>
      )}

    </div>
  );
};
