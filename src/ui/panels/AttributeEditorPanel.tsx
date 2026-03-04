import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Plug, PlugType } from '../../core/dg/Plug';
import { DAGNode } from '../../core/dag/DAGNode';
import type { Vector3Data } from '../../core/dag/DAGNode';
import { CameraNode } from '../../core/dag/CameraNode';
import { LightNode } from '../../core/dag/LightNode';
import { GltfNode } from '../../core/dag/GltfNode';
import { SplatNode } from '../../core/dag/SplatNode';
import type { Command } from '../../core/system/CommandHistory';
import { TransformCommand } from '../../core/system/commands/TransformCommand';
import { CAMERA_PRESET_GROUPS, CAMERA_PRESET_MAP } from '../data/cameraPresets';

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
  accentH: 'var(--maya-accent-hover)',
  blue:    '#99c8f0',
  green:   '#7ec89c',
  orange:  '#d4a46e',
  // Maya axis colours
  axisX:   '#d46060',
  axisY:   '#6bb86b',
  axisZ:   '#5d8de0',
};

const ROW_H = 22; // px – compact uniform row height

// ── NumericField — MMB microslider + single-click edit ─────────────────────────
//
//  • Click         → enter edit mode, select all (type to replace)
//  • Enter / blur  → commit;  Escape → cancel
//  • MMB drag      → Maya-style microslider
//     Shift+drag   → fine   ×0.001
//     Ctrl+drag    → coarse ×1.0
//     plain drag   → normal ×0.1
//
interface NumericFieldProps {
  value: number;
  decimals?: number;
  color?: string;
  unit?: string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}

const NumericField: React.FC<NumericFieldProps> = ({
  value, decimals = 3, color, unit, onChange, onCommit,
}) => {
  const [editing,   setEditing]   = useState(false);
  const [local,     setLocal]     = useState('');
  const [scrubbing, setScrubbing] = useState(false);
  const [hovered,   setHovered]   = useState(false);
  const scrubRef = useRef<{ startX: number; startVal: number; sensitivity: number } | null>(null);

  // Handlers are created fresh inside handlePointerDown to avoid circular-ref issues
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    const sensitivity = e.shiftKey ? 0.001 : e.ctrlKey ? 1.0 : 0.1;
    scrubRef.current = { startX: e.clientX, startVal: value, sensitivity };
    setScrubbing(true);
    document.body.style.cursor = 'ew-resize';

    const onMove = (ev: PointerEvent) => {
      if (!scrubRef.current) return;
      const dx = ev.clientX - scrubRef.current.startX;
      onChange(scrubRef.current.startVal + dx * scrubRef.current.sensitivity);
    };
    const onUp = (ev: PointerEvent) => {
      if (!scrubRef.current) return;
      const dx = ev.clientX - scrubRef.current.startX;
      const nv = scrubRef.current.startVal + dx * scrubRef.current.sensitivity;
      scrubRef.current = null;
      setScrubbing(false);
      document.body.style.cursor = '';
      document.removeEventListener('pointermove', onMove);
      onCommit?.(nv);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  };

  const handleClick = () => { setLocal(String(value)); setEditing(true); };

  const commit = () => {
    const n = parseFloat(local);
    const nv = isNaN(n) ? value : n;
    setEditing(false);
    onChange(nv);
    onCommit?.(nv);
  };

  const displayBg = scrubbing
    ? 'rgba(74,144,226,0.22)'
    : hovered ? 'rgba(255,255,255,0.055)' : 'transparent';

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
      {editing ? (
        <input
          autoFocus type="number" step="any" value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            width: '100%', background: 'rgba(74,144,226,0.25)',
            color: '#d8e8ff', border: '1px solid rgba(74,144,226,0.6)',
            outline: 'none', fontSize: 11, padding: '0 4px', height: ROW_H - 2,
            fontFamily: '"Consolas","Menlo",monospace', borderRadius: 1, boxSizing: 'border-box',
          }}
        />
      ) : (
        <div
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Click to edit · MMB drag to scrub (Shift=fine, Ctrl=coarse)"
          style={{
            flex: 1, fontSize: 11, padding: '0 4px',
            height: ROW_H, lineHeight: `${ROW_H}px`,
            color: color ?? C.blue,
            fontFamily: '"Consolas","Menlo",monospace',
            cursor: scrubbing ? 'ew-resize' : 'text',
            background: displayBg, borderRadius: 1, userSelect: 'none',
            display: 'flex', alignItems: 'center', gap: 2,
            transition: 'background 0.08s',
          }}
        >
          <span style={{ flex: 1 }}>{value.toFixed(decimals)}</span>
          {unit && <span style={{ fontSize: 9, color: C.dim, paddingRight: 2 }}>{unit}</span>}
          {hovered && !scrubbing && (
            <span style={{ fontSize: 8, color: 'rgba(153,200,240,0.4)', marginLeft: 2 }}>⟺</span>
          )}
        </div>
      )}
    </div>
  );
};

// ── Row shell ──────────────────────────────────────────────────────────────────
interface RowProps { label: string; axisColor?: string; children: React.ReactNode; }
const AttrRow: React.FC<RowProps> = ({ label, axisColor, children }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '40% 1fr',
    borderBottom: `1px solid ${C.border}`,
    height: ROW_H, minHeight: ROW_H,
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 11,
      color: C.muted, fontFamily: '"Segoe UI",system-ui,sans-serif',
      borderRight: `1px solid ${C.border}`, userSelect: 'none', gap: 5, overflow: 'hidden',
      borderLeft: axisColor ? `2px solid ${axisColor}` : undefined, boxSizing: 'border-box',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', overflow: 'hidden' }}>
      {children}
    </div>
  </div>
);

// ── Read-only text row ─────────────────────────────────────────────────────────
const ReadRow: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
  <AttrRow label={label}>
    <span style={{
      fontSize: 11, fontFamily: '"Consolas","Menlo",monospace',
      color: color ?? C.dim, padding: '0 4px',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {typeof value === 'number' ? value.toFixed(3) : value}
    </span>
  </AttrRow>
);

// ── Editable numeric row ───────────────────────────────────────────────────────
interface NumRowProps {
  label: string; value: number; decimals?: number;
  axisColor?: string; color?: string; unit?: string;
  onChange: (v: number) => void; onCommit?: (v: number) => void;
}
const NumRow: React.FC<NumRowProps> = ({ label, value, decimals, axisColor, color, unit, onChange, onCommit }) => (
  <AttrRow label={label} axisColor={axisColor}>
    <NumericField value={value} decimals={decimals} color={color} unit={unit}
      onChange={onChange} onCommit={onCommit} />
  </AttrRow>
);

// ── Section header ─────────────────────────────────────────────────────────────
const Sec: React.FC<{
  title: string; tag?: string;
  open: boolean; onToggle: () => void;
  accent?: boolean;
}> = ({ title, tag, open, onToggle, accent }) => (
  <div
    onClick={onToggle}
    style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px 4px 6px',
      background: 'linear-gradient(90deg,rgba(255,255,255,0.06) 0%,transparent 100%)',
      borderBottom: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
      borderLeft: `2px solid ${accent ? C.accent : 'transparent'}`,
      cursor: 'pointer', userSelect: 'none',
    }}
  >
    <span style={{ color: open ? C.dim : 'rgba(150,150,150,0.5)', fontSize: 8, width: 8, textAlign: 'center', flexShrink: 0 }}>
      {open ? '▾' : '▸'}
    </span>
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.6px',
      color: accent ? C.accent : C.text,
      fontFamily: '"Segoe UI",system-ui,sans-serif', textTransform: 'uppercase',
    }}>{title}</span>
    {tag && (
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto',
        fontFamily: 'monospace', letterSpacing: '0.3px' }}>{tag}</span>
    )}
  </div>
);

// ── Sub-section label ──────────────────────────────────────────────────────────
const SubSec: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    padding: '2px 10px', fontSize: 9, color: C.dim,
    borderBottom: `1px solid ${C.border}`,
    fontFamily: '"Segoe UI",system-ui,sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    background: 'rgba(255,255,255,0.025)', userSelect: 'none',
  }}>{label}</div>
);

// ── Vec3 rows (translate / rotate / scale) ────────────────────────────────────
const AXIS_COLORS = [C.axisX, C.axisY, C.axisZ] as const;
const AXIS_LABELS = ['X', 'Y', 'Z'] as const;
const AXIS_UNITS: Record<string, string> = { rotate: '°' };

type Vec3RowsProps = {
  plug: Plug<Vector3Data>;
  onChange: () => void;
  node?: DAGNode;
  recordTransform?: (oldT: Vector3Data, oldR: Vector3Data, oldS: Vector3Data) => void;
};

const Vec3Rows: React.FC<Vec3RowsProps> = ({ plug, onChange, node, recordTransform }) => {
  const [val, setVal] = useState<Vector3Data>(plug.getValue());
  const snapRef = useRef<{ oldT: Vector3Data; oldR: Vector3Data; oldS: Vector3Data } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setVal({ ...plug.getValue() }), 80);
    return () => clearInterval(id);
  }, [plug]);

  const lbl  = plug.name;
  const unit = AXIS_UNITS[lbl] ?? '';

  const startSnap = () => {
    if (!node || snapRef.current) return;
    snapRef.current = {
      oldT: { ...node.translate.getValue() },
      oldR: { ...node.rotate.getValue() },
      oldS: { ...node.scale.getValue() },
    };
  };

  const applyChange = (axis: 'x' | 'y' | 'z', v: number) => {
    startSnap();
    const next = { ...val, [axis]: isNaN(v) ? 0 : v };
    plug.setValue(next); setVal(next); onChange();
  };

  const commitChange = () => {
    if (!node || !recordTransform || !snapRef.current) { snapRef.current = null; return; }
    const { oldT, oldR, oldS } = snapRef.current;
    snapRef.current = null;
    recordTransform(oldT, oldR, oldS);
  };

  return (
    <>
      {AXIS_LABELS.map((ax, i) => {
        const axis = ax.toLowerCase() as 'x' | 'y' | 'z';
        return (
          <NumRow
            key={axis}
            label={`${lbl.charAt(0).toUpperCase() + lbl.slice(1)}  ${ax}`}
            value={val[axis] ?? 0}
            decimals={lbl === 'rotate' ? 2 : 3}
            axisColor={AXIS_COLORS[i]}
            unit={unit || undefined}
            onChange={v => applyChange(axis, v)}
            onCommit={commitChange}
          />
        );
      })}
    </>
  );
};

// ── Command History sub-panel ──────────────────────────────────────────────────
const HistoryPanel: React.FC<{ filterUuid?: string }> = ({ filterUuid }) => {
  const core = useAppStore(s => s.core);
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!core) return;
    core.commandHistory.onHistoryChanged = refresh;
    return () => { core.commandHistory.onHistoryChanged = undefined; };
  }, [core, refresh]);

  if (!core) return null;

  const filter = (cmds: ReadonlyArray<Command>): Command[] =>
    filterUuid ? [...cmds].filter(c => c.affectedNodeUuids?.has(filterUuid)) : [...cmds];

  const undos = filter(core.commandHistory.undoList).reverse();
  const redos = filter(core.commandHistory.redoList).reverse();

  if (undos.length === 0 && redos.length === 0) {
    return (
      <div style={{ padding: '6px 12px', color: C.dim, fontStyle: 'italic', fontSize: 10,
        fontFamily: '"Segoe UI",system-ui,sans-serif' }}>
        {filterUuid ? 'No history for this node' : 'No history'}
      </div>
    );
  }

  const btnBase: React.CSSProperties = {
    fontSize: 9, padding: '1px 5px', background: 'transparent',
    border: `1px solid ${C.border}`, borderRadius: 2,
    color: C.muted, cursor: 'pointer', flexShrink: 0,
  };

  return (
    <div style={{ fontSize: 10, fontFamily: '"Segoe UI",system-ui,sans-serif' }}>
      {undos.map((cmd: Command, i: number) => (
        <div key={`u${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6,
          padding: '2px 8px 2px 20px', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 9, width: 12, color: C.green }}>↩</span>
          <span style={{ color: C.text, flex: 1 }}>{cmd.description ?? 'command'}</span>
          <button style={btnBase}
            onClick={() => core.commandHistory.undoDownTo(cmd)}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
          >Z</button>
        </div>
      ))}
      {redos.map((cmd: Command, i: number) => (
        <div key={`r${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6,
          padding: '2px 8px 2px 20px', borderBottom: `1px solid ${C.border}`, opacity: 0.4 }}>
          <span style={{ fontSize: 9, width: 12, color: C.orange }}>↪</span>
          <span style={{ color: C.dim, flex: 1 }}>{cmd.description ?? 'command'}</span>
          <button style={btnBase}
            onClick={() => core.commandHistory.redoUpTo(cmd)}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.orange)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
          >⇧Z</button>
        </div>
      ))}
    </div>
  );
};

// ── Camera Section ─────────────────────────────────────────────────────────────
const CameraSection: React.FC<{ node: CameraNode; onChange: () => void }> = ({ node, onChange }) => {
  const [open, setOpen] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  const applyPreset = (name: string) => {
    setSelectedPreset(name);
    const p = CAMERA_PRESET_MAP[name];
    if (!p) return;
    node.horizontalFilmAperture.setValue(p.hAperture);
    node.verticalFilmAperture.setValue(p.vAperture);
    node.focalLength.setValue(p.focalLength);
    onChange();
  };

  const hInch  = node.horizontalFilmAperture.getValue();
  const vInch  = node.verticalFilmAperture.getValue();
  const hMm    = hInch * 25.4;
  const vMm    = vInch * 25.4;
  const aspect = vInch > 0 ? hInch / vInch : 0;

  return (
    <>
      <Sec title="Camera" tag="filmback" open={open} onToggle={() => setOpen(v => !v)} accent />
      {open && (
        <>
          <div style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.dim, marginBottom: 3,
              fontFamily: '"Segoe UI",system-ui,sans-serif',
              textTransform: 'uppercase', letterSpacing: '0.4px' }}>Film Back Preset</div>
            <select
              value={selectedPreset}
              onChange={e => applyPreset(e.target.value)}
              style={{ width: '100%', padding: '3px 6px', fontSize: 11,
                background: 'var(--maya-bg-input,#1a1a1a)', color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 2,
                fontFamily: '"Segoe UI",system-ui,sans-serif', cursor: 'pointer', outline: 'none' }}
            >
              <option value="">— Select preset —</option>
              {CAMERA_PRESET_GROUPS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.presets.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedPreset && CAMERA_PRESET_MAP[selectedPreset]?.notes && (
              <div style={{ marginTop: 3, fontSize: 9, color: C.dim,
                fontStyle: 'italic', fontFamily: '"Segoe UI",system-ui,sans-serif' }}>
                {CAMERA_PRESET_MAP[selectedPreset].notes}
              </div>
            )}
          </div>
          <SubSec label="Film Back" />
          <ReadRow label="H Aperture" value={+hMm.toFixed(3)} color={C.green} />
          <ReadRow label="V Aperture" value={+vMm.toFixed(3)} color={C.green} />
          <ReadRow label="Aspect" value={+aspect.toFixed(4)} color={C.orange} />
        </>
      )}
    </>
  );
};
// ── Light Section ──────────────────────────────────────────────────────────────
const LightSection: React.FC<{ node: LightNode; onChange: () => void }> = ({ node, onChange }) => {
  const [open, setOpen] = useState(true);
  const [color,     setColor]     = useState(node.color.getValue());
  const [intensity, setIntensity] = useState(node.intensity.getValue());
  const [coneAngle, setConeAngle] = useState(node.coneAngle.getValue());
  const [penumbra,  setPenumbra]  = useState(node.penumbra.getValue());
  const isSpot = node.lightType.getValue() === 'spot';

  const lightTypeLabels: Record<string, string> = {
    directional: 'Directional', point: 'Point', ambient: 'Ambient', spot: 'Spot',
  };

  useEffect(() => {
    const id = setInterval(() => {
      setColor(node.color.getValue());
      setIntensity(node.intensity.getValue());
      setConeAngle(node.coneAngle.getValue());
      setPenumbra(node.penumbra.getValue());
    }, 80);
    return () => clearInterval(id);
  }, [node]);

  return (
    <>
      <Sec title="Light" tag={lightTypeLabels[node.lightType.getValue()] ?? node.lightType.getValue()}
        open={open} onToggle={() => setOpen(v => !v)} accent />
      {open && (
        <>
          <ReadRow label="Type" value={node.lightType.getValue()} color={C.orange} />

          <AttrRow label="Color">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
              <input type="color" value={color}
                onChange={e => { setColor(e.target.value); node.color.setValue(e.target.value); onChange(); }}
                style={{ width: 26, height: 18, padding: 0, border: 'none',
                  background: 'transparent', cursor: 'pointer' }} />
              <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{color}</span>
            </div>
          </AttrRow>

          <NumRow label="Intensity" value={intensity} decimals={3} color={C.blue} unit="×"
            onChange={v => { setIntensity(v); node.intensity.setValue(Math.max(0, v)); onChange(); }}
            onCommit={v => { node.intensity.setValue(Math.max(0, v)); onChange(); }} />

          {isSpot && (
            <>
              <NumRow label="Cone Angle" value={coneAngle} decimals={1} unit="°" color={C.orange}
                onChange={v => { setConeAngle(v); node.coneAngle.setValue(Math.max(1, Math.min(89, v))); onChange(); }}
                onCommit={v => { node.coneAngle.setValue(Math.max(1, Math.min(89, v))); onChange(); }} />
              <NumRow label="Penumbra" value={penumbra} decimals={3} color={C.orange}
                onChange={v => { setPenumbra(v); node.penumbra.setValue(Math.max(0, Math.min(1, v))); onChange(); }}
                onCommit={v => { node.penumbra.setValue(Math.max(0, Math.min(1, v))); onChange(); }} />
            </>
          )}
        </>
      )}
    </>
  );
};
// ── Splat / Crop Volume section ───────────────────────────────────────────────
const SPLAT_CROP_PLUGS = new Set(['cropEnabled','cropMinX','cropMinY','cropMinZ','cropMaxX','cropMaxY','cropMaxZ']);

const SplatSection: React.FC<{ node: SplatNode; onChange: () => void }> = ({ node, onChange }) => {
  const [open, setOpen] = useState(true);
  const [enabled, setEnabled] = useState(node.cropEnabled.getValue());
  const [minX, setMinX] = useState(node.cropMinX.getValue());
  const [minY, setMinY] = useState(node.cropMinY.getValue());
  const [minZ, setMinZ] = useState(node.cropMinZ.getValue());
  const [maxX, setMaxX] = useState(node.cropMaxX.getValue());
  const [maxY, setMaxY] = useState(node.cropMaxY.getValue());
  const [maxZ, setMaxZ] = useState(node.cropMaxZ.getValue());

  useEffect(() => {
    const id = setInterval(() => {
      setEnabled(node.cropEnabled.getValue());
      setMinX(node.cropMinX.getValue()); setMinY(node.cropMinY.getValue()); setMinZ(node.cropMinZ.getValue());
      setMaxX(node.cropMaxX.getValue()); setMaxY(node.cropMaxY.getValue()); setMaxZ(node.cropMaxZ.getValue());
    }, 80);
    return () => clearInterval(id);
  }, [node]);

  return (
    <>
      <Sec title="Crop Volume" tag="splat" open={open} onToggle={() => setOpen(v => !v)} accent />
      {open && (
        <>
          <AttrRow label="Enabled">
            <div style={{ paddingLeft: 6 }}>
              <input type="checkbox" checked={enabled}
                onChange={e => { setEnabled(e.target.checked); node.cropEnabled.setValue(e.target.checked); onChange(); }}
                style={{ accentColor: C.accent, cursor: 'pointer' }} />
            </div>
          </AttrRow>

          <SubSec label="Min Corner" />
          {(['x','y','z'] as const).map((ax, i) => {
            const vals    = [minX, minY, minZ];
            const setters = [setMinX, setMinY, setMinZ];
            const plugs   = [node.cropMinX, node.cropMinY, node.cropMinZ];
            return (
              <NumRow key={ax} label={`Min ${ax.toUpperCase()}`}
                value={vals[i]} axisColor={[C.axisX, C.axisY, C.axisZ][i]}
                onChange={v => { setters[i](v); plugs[i].setValue(v); onChange(); }} />
            );
          })}

          <SubSec label="Max Corner" />
          {(['x','y','z'] as const).map((ax, i) => {
            const vals    = [maxX, maxY, maxZ];
            const setters = [setMaxX, setMaxY, setMaxZ];
            const plugs   = [node.cropMaxX, node.cropMaxY, node.cropMaxZ];
            return (
              <NumRow key={ax} label={`Max ${ax.toUpperCase()}`}
                value={vals[i]} axisColor={[C.axisX, C.axisY, C.axisZ][i]}
                onChange={v => { setters[i](v); plugs[i].setValue(v); onChange(); }} />
            );
          })}
        </>
      )}
    </>
  );
};
// ── Generic Node Attributes section ───────────────────────────────────────────
const NodeAttrs: React.FC<{ node: DAGNode; onChange: () => void; exclude?: Set<string> }> = ({ node, onChange, exclude }) => {
  const [open, setOpen] = useState(true);
  const plugs = Array.from(node.plugs.values()).filter(
    p => p.type !== PlugType.Vector3 && (!exclude || !exclude.has(p.name)),
  );
  if (plugs.length === 0) return null;
  return (
    <>
      <Sec title="Node Attributes" tag={node.nodeType} open={open} onToggle={() => setOpen(v => !v)} />
      {open && plugs.map(plug => {
        const label = plug.name.charAt(0).toUpperCase() + plug.name.slice(1);
        if (plug.type === PlugType.Float) {
          return (
            <NumRow key={plug.name} label={label} value={plug.getValue() as number}
              onChange={v => { plug.setValue(v); onChange(); }} />
          );
        }
        if (plug.type === PlugType.Boolean) {
          return (
            <AttrRow key={plug.name} label={label}>
              <div style={{ paddingLeft: 6 }}>
                <input type="checkbox" checked={plug.getValue() as boolean}
                  onChange={e => { plug.setValue(e.target.checked); onChange(); }}
                  style={{ accentColor: C.accent, cursor: 'pointer' }} />
              </div>
            </AttrRow>
          );
        }
        if (plug.type === PlugType.String) {
          return <ReadRow key={plug.name} label={label} value={plug.getValue() as string} color={C.orange} />;
        }
        return null;
      })}
    </>
  );
};

// ── Main panel ─────────────────────────────────────────────────────────────────
export const AttributeEditorPanel: React.FC = () => {
  const selectedNode   = useAppStore(s => s.leadSelection);
  const markSceneDirty = useAppStore(s => s.markSceneDirty);
  const core           = useAppStore(s => s.core);
  const [, setTick]    = useState(0);
  const [xformOpen,  setXformOpen]  = useState(true);
  const [histOpen,   setHistOpen]   = useState(true);

  const onChange = () => { markSceneDirty(); setTick(t => t + 1); };

  const makeRecordTransform = (n: DAGNode) =>
    (oldT: Vector3Data, oldR: Vector3Data, oldS: Vector3Data) => {
      if (!core) return;
      const newT = { ...n.translate.getValue() };
      const newR = { ...n.rotate.getValue() };
      const newS = { ...n.scale.getValue() };
      const moved =
        Math.abs(newT.x-oldT.x)>1e-5||Math.abs(newT.y-oldT.y)>1e-5||Math.abs(newT.z-oldT.z)>1e-5||
        Math.abs(newR.x-oldR.x)>1e-5||Math.abs(newR.y-oldR.y)>1e-5||Math.abs(newR.z-oldR.z)>1e-5||
        Math.abs(newS.x-oldS.x)>1e-5||Math.abs(newS.y-oldS.y)>1e-5||Math.abs(newS.z-oldS.z)>1e-5;
      if (!moved) return;
      const cmd = new TransformCommand([{
        node: n,
        oldTranslate: oldT, newTranslate: newT,
        oldRotate: oldR,    newRotate: newR,
        oldScale: oldS,     newScale: newS,
      }]);
      core.commandHistory.record(cmd);
      core.logger.log(cmd.description!, 'command');
    };

  if (!selectedNode) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ fontSize: 22, opacity: 0.12 }}>⬡</span>
          <span style={{ color: C.dim, fontSize: 11,
            fontFamily: '"Segoe UI",system-ui,sans-serif', fontStyle: 'italic' }}>Nothing selected</span>
        </div>
        <Sec title="History" open={histOpen} onToggle={() => setHistOpen(v => !v)} accent />
        {histOpen && <HistoryPanel />}
      </div>
    );
  }

  const vec3Plugs = Array.from(selectedNode.plugs.values()).filter(p => p.type === PlugType.Vector3);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg }}>

      {/* ── Node header ── */}
      <div style={{
        padding: '6px 10px 5px',
        background: 'linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%)',
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text,
          fontFamily: '"Segoe UI",system-ui,sans-serif',
          letterSpacing: '0.1px', marginBottom: 3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{selectedNode.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, background: C.accent, color: '#fff',
            padding: '1px 6px', borderRadius: 2, letterSpacing: '0.5px',
            textTransform: 'uppercase', fontFamily: 'monospace',
          }}>{selectedNode.nodeType}</span>
          <span style={{ fontSize: 9, color: C.dim, fontFamily: 'monospace', opacity: 0.6 }}>
            {selectedNode.uuid.slice(0, 8)}
          </span>
          <span style={{ fontSize: 9, color: 'rgba(153,200,240,0.25)',
            fontFamily: '"Segoe UI",system-ui,sans-serif', marginLeft: 'auto' }}>MMB drag = scrub</span>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        <Sec title="Transform" open={xformOpen} onToggle={() => setXformOpen(v => !v)} />
        {xformOpen && vec3Plugs.map(plug => (
          <Vec3Rows key={plug.name} plug={plug} onChange={onChange}
            node={selectedNode} recordTransform={makeRecordTransform(selectedNode)} />
        ))}

        {selectedNode instanceof CameraNode && (
          <CameraSection node={selectedNode} onChange={onChange} />
        )}
        {selectedNode instanceof LightNode && (
          <LightSection node={selectedNode} onChange={onChange} />
        )}
        {selectedNode instanceof SplatNode && (
          <SplatSection node={selectedNode} onChange={onChange} />
        )}

        <NodeAttrs
          node={selectedNode}
          onChange={onChange}
          exclude={
            selectedNode instanceof LightNode
              ? new Set(['lightType','color','intensity','coneAngle','penumbra'])
              : selectedNode instanceof GltfNode
                ? new Set(['fileName'])
                : selectedNode instanceof SplatNode
                  ? new Set(['fileName', ...SPLAT_CROP_PLUGS])
                  : undefined
          }
        />

        <Sec title="History" open={histOpen} onToggle={() => setHistOpen(v => !v)} accent />
        {histOpen && <HistoryPanel filterUuid={selectedNode.uuid} />}

      </div>
    </div>
  );
};

