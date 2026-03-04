import React, { useState, useEffect, useCallback } from 'react';
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
};

// ── Single channel row ─────────────────────────────────────────────────────────
const CRow: React.FC<{
  label: string; value: string | number;
  readOnly?: boolean; color?: string;
  onChange?: (v: string) => void;
}> = ({ label, value, readOnly, color, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [local,   setLocal]   = useState(String(value));

  useEffect(() => { if (!editing) setLocal(String(value)); }, [value, editing]);

  const commit = () => { onChange?.(local); setEditing(false); };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '42% 1fr', borderBottom: `1px solid ${C.border}` }}>
      <div style={{
        padding: '2px 8px', fontSize: 11, color: C.muted,
        fontFamily: '"Segoe UI",system-ui,sans-serif',
        display: 'flex', alignItems: 'center',
        borderRight: `1px solid ${C.border}`, userSelect: 'none',
      }}>{label}</div>

      <div style={{ padding: '1px 4px', display: 'flex', alignItems: 'center' }}>
        {editing && !readOnly ? (
          <input
            autoFocus type="number" step="0.001" value={local}
            onChange={e => setLocal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            style={{
              width: '100%', background: C.accent, color: '#fff', border: 'none',
              outline: 'none', fontSize: 11, padding: '1px 4px',
              fontFamily: '"Consolas","Menlo",monospace',
            }}
          />
        ) : (
          <div
            onDoubleClick={() => { if (!readOnly && onChange) setEditing(true); }}
            style={{
              width: '100%', fontSize: 11, padding: '2px 4px',
              color: readOnly ? C.dim : (color ?? C.blue),
              fontFamily: '"Consolas","Menlo",monospace',
              cursor: readOnly ? 'default' : 'text',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {typeof value === 'number' ? value.toFixed(3) : value}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Section header ─────────────────────────────────────────────────────────────
const Sec: React.FC<{
  title: string; tag?: string;
  open: boolean; onToggle: () => void;
  accent?: boolean;
}> = ({ title, tag, open, onToggle, accent }) => (
  <div
    onClick={onToggle}
    style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
      background: C.strip, borderBottom: `1px solid ${C.border}`,
      borderTop: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
    }}
  >
    <span style={{ color: C.dim, fontSize: 9, width: 8 }}>{open ? '▼' : '▶'}</span>
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.3px',
      color: accent ? C.accent : C.text,
      fontFamily: '"Segoe UI",system-ui,sans-serif', textTransform: 'uppercase',
    }}>{title}</span>
    {tag && <span style={{ fontSize: 9, color: C.dim, marginLeft: 'auto', fontFamily: 'monospace' }}>{tag}</span>}
  </div>
);

// ── Vec3 channel rows  ─────────────────────────────────────────────────────────
type Vec3RowsProps = {
  plug: Plug<any>;
  onChange: () => void;
  /** When provided, a TransformCommand is recorded in history on each commit. */
  node?: DAGNode;
  recordTransform?: (oldT: Vector3Data, oldR: Vector3Data, oldS: Vector3Data) => void;
};
const Vec3Rows: React.FC<Vec3RowsProps> = ({ plug, onChange, node, recordTransform }) => {
  const [val, setVal] = useState(plug.getValue());
  useEffect(() => {
    const id = setInterval(() => setVal({ ...plug.getValue() }), 100);
    return () => clearInterval(id);
  }, [plug]);

  const up = (axis: 'x' | 'y' | 'z', raw: string) => {
    // Snapshot full TRS before the change so we can record an undoable command
    const oldT: Vector3Data = node ? { ...node.translate.getValue() } : { x: 0, y: 0, z: 0 };
    const oldR: Vector3Data = node ? { ...node.rotate.getValue()    } : { x: 0, y: 0, z: 0 };
    const oldS: Vector3Data = node ? { ...node.scale.getValue()     } : { x: 1, y: 1, z: 1 };

    const n = parseFloat(raw);
    const next = { ...val, [axis]: isNaN(n) ? 0 : n };
    plug.setValue(next); setVal(next); onChange();

    // Record a TransformCommand so this edit appears in history
    if (recordTransform) recordTransform(oldT, oldR, oldS);
  };
  const lbl = plug.name.charAt(0).toUpperCase() + plug.name.slice(1);
  return (
    <>
      <CRow label={`${lbl} X`} value={val.x} onChange={v => up('x', v)} />
      <CRow label={`${lbl} Y`} value={val.y} onChange={v => up('y', v)} />
      <CRow label={`${lbl} Z`} value={val.z} onChange={v => up('z', v)} />
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

  const filter = (cmds: ReadonlyArray<Command>) =>
    filterUuid
      ? cmds.filter(c => c.affectedNodeUuids?.has(filterUuid))
      : cmds;

  const undos = filter([...core.commandHistory.undoList]).reverse(); // newest first
  const redos = filter([...core.commandHistory.redoList]).reverse();

  const rowStyle = (faded?: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 20px',
    borderBottom: `1px solid ${C.border}`,
    opacity: faded ? 0.35 : 1,
  });
  const iconStyle: React.CSSProperties = { fontSize: 9, width: 12, textAlign: 'center', flexShrink: 0 };

  return (
    <div style={{ fontSize: 10, fontFamily: '"Segoe UI",system-ui,sans-serif' }}>
      {undos.length === 0 && redos.length === 0 && (
        <div style={{ padding: '6px 12px', color: C.dim, fontStyle: 'italic', fontSize: 10 }}>
          {filterUuid ? 'No history for this node' : 'No history'}
        </div>
      )}
      {undos.map((cmd, i) => (
        <div key={`u${i}`} style={rowStyle()}>
          <span style={{ ...iconStyle, color: C.green }}>↩</span>
          <span style={{ color: C.text, flex: 1 }}>{cmd.description ?? 'command'}</span>
          <button
            title="Undo to this point"
            onClick={() => { core.commandHistory.undoDownTo(cmd); }}
            style={{
              fontSize: 9, padding: '1px 5px', background: 'transparent',
              border: `1px solid ${C.border}`, borderRadius: 2,
              color: C.muted, cursor: 'pointer', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
          >Z</button>
        </div>
      ))}
      {redos.map((cmd, i) => (
        <div key={`r${i}`} style={rowStyle(true)}>
          <span style={{ ...iconStyle, color: C.orange }}>↪</span>
          <span style={{ color: C.dim, flex: 1 }}>{cmd.description ?? 'command'}</span>
          <button
            title="Redo to this point"
            onClick={() => { core.commandHistory.redoUpTo(cmd); }}
            style={{
              fontSize: 9, padding: '1px 5px', background: 'transparent',
              border: `1px solid ${C.border}`, borderRadius: 2,
              color: C.muted, cursor: 'pointer', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.orange)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
          >⇧Z</button>
        </div>
      ))}
    </div>
  );
};

// ── Camera Preset Section ──────────────────────────────────────────────────────
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

  // Derived display values (mm and aspect ratio)
  const hInch = node.horizontalFilmAperture.getValue();
  const vInch = node.verticalFilmAperture.getValue();
  const hMm   = hInch * 25.4;
  const vMm   = vInch * 25.4;
  const aspect = vInch > 0 ? (hInch / vInch) : 0;

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '3px 6px', fontSize: 11,
    background: 'var(--maya-bg-input, #1a1a1a)',
    color: C.text, border: `1px solid ${C.border}`, borderRadius: 2,
    fontFamily: '"Segoe UI",system-ui,sans-serif', cursor: 'pointer',
    outline: 'none',
  };

  return (
    <>
      <Sec title="Camera Preset" tag="filmback" open={open} onToggle={() => setOpen(v => !v)} accent />
      {open && (
        <>
          {/* Preset dropdown */}
          <div style={{
            padding: '5px 8px', borderBottom: `1px solid ${C.border}`,
            background: C.bg,
          }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4,
              fontFamily: '"Segoe UI",system-ui,sans-serif', userSelect: 'none' }}>
              Camera / Film Back
            </div>
            <select
              value={selectedPreset}
              onChange={e => applyPreset(e.target.value)}
              style={selectStyle}
            >
              <option value="">— Select a preset —</option>
              {CAMERA_PRESET_GROUPS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.presets.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedPreset && CAMERA_PRESET_MAP[selectedPreset]?.notes && (
              <div style={{ marginTop: 4, fontSize: 9, color: C.dim,
                fontFamily: '"Segoe UI",system-ui,sans-serif', fontStyle: 'italic' }}>
                {CAMERA_PRESET_MAP[selectedPreset].notes}
              </div>
            )}
          </div>

          {/* Derived read-only info */}
          <CRow label="H Aperture (mm)"  value={+hMm.toFixed(3)}  readOnly color={C.green} />
          <CRow label="V Aperture (mm)"  value={+vMm.toFixed(3)}  readOnly color={C.green} />
          <CRow label="Aspect Ratio"     value={+aspect.toFixed(4)} readOnly color={C.orange} />
        </>
      )}
    </>
  );
};
// ── Light attributes section ──────────────────────────────────────────────────
const LightSection: React.FC<{ node: LightNode; onChange: () => void }> = ({ node, onChange }) => {
  const [open, setOpen] = useState(true);
  const [color,     setColor]     = useState(node.color.getValue());
  const [intensity, setIntensity] = useState(node.intensity.getValue());
  const [coneAngle, setConeAngle] = useState(node.coneAngle.getValue());
  const [penumbra,  setPenumbra]  = useState(node.penumbra.getValue());
  const isSpot = node.lightType.getValue() === 'spot';

  // Poll in case values change elsewhere
  useEffect(() => {
    const id = setInterval(() => {
      setColor(node.color.getValue());
      setIntensity(node.intensity.getValue());
      setConeAngle(node.coneAngle.getValue());
      setPenumbra(node.penumbra.getValue());
    }, 100);
    return () => clearInterval(id);
  }, [node]);

  const lightTypeLabels: Record<string, string> = {
    directional: 'Directional', point: 'Point', ambient: 'Ambient', spot: 'Spot',
  };

  return (
    <>
      <Sec title="Light" tag={lightTypeLabels[node.lightType.getValue()] ?? node.lightType.getValue()}
           open={open} onToggle={() => setOpen(v => !v)} accent />
      {open && (
        <>
          {/* Type — read-only */}
          <CRow label="Type" value={node.lightType.getValue()} readOnly color={C.orange} />

          {/* Color — native colour picker */}
          <div style={{ display: 'grid', gridTemplateColumns: '42% 1fr', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ padding: '3px 8px', fontSize: 11, color: C.muted,
              borderRight: `1px solid ${C.border}`, fontFamily: '"Segoe UI",sans-serif',
              display: 'flex', alignItems: 'center' }}>Color</div>
            <div style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="color" value={color}
                onChange={e => {
                  setColor(e.target.value);
                  node.color.setValue(e.target.value);
                  onChange();
                }}
                style={{ width: 28, height: 20, padding: 0, border: 'none',
                  background: 'transparent', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{color}</span>
            </div>
          </div>

          {/* Intensity */}
          <CRow
            label="Intensity"
            value={+intensity.toFixed(3)}
            onChange={raw => {
              const n = parseFloat(raw);
              if (!isNaN(n)) {
                setIntensity(n);
                node.intensity.setValue(n);
                onChange();
              }
            }}
          />

          {/* Spot-only: cone angle + penumbra */}
          {isSpot && (
            <>
              <CRow
                label="Cone Angle (°)"
                value={+coneAngle.toFixed(1)}
                onChange={raw => {
                  const n = parseFloat(raw);
                  if (!isNaN(n)) {
                    setConeAngle(n);
                    node.coneAngle.setValue(Math.max(1, Math.min(89, n)));
                    onChange();
                  }
                }}
              />
              <CRow
                label="Penumbra"
                value={+penumbra.toFixed(3)}
                onChange={raw => {
                  const n = parseFloat(raw);
                  if (!isNaN(n)) {
                    setPenumbra(n);
                    node.penumbra.setValue(Math.max(0, Math.min(1, n)));
                    onChange();
                  }
                }}
              />
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
    }, 100);
    return () => clearInterval(id);
  }, [node]);

  const setFloat = (setter: (v: number) => void, setValue: (v: number) => void) =>
    (raw: string) => { const n = parseFloat(raw); if (!isNaN(n)) { setValue(n); setter(n); onChange(); } };

  const subHeader = (label: string) => (
    <div style={{
      padding: '2px 8px', fontSize: 10, color: C.dim,
      borderBottom: `1px solid ${C.border}`,
      fontFamily: '"Segoe UI",sans-serif',
      textTransform: 'uppercase', letterSpacing: '0.4px',
      background: C.strip,
    }}>{label}</div>
  );

  return (
    <>
      <Sec title="Crop Volume" tag="splat" open={open} onToggle={() => setOpen(v => !v)} accent />
      {open && (
        <>
          {/* Enable toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '42% 1fr', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ padding: '3px 8px', fontSize: 11, color: C.muted, borderRight: `1px solid ${C.border}`,
              fontFamily: '"Segoe UI",sans-serif', display: 'flex', alignItems: 'center' }}>Enabled</div>
            <div style={{ padding: '3px 8px', display: 'flex', alignItems: 'center' }}>
              <input type="checkbox" checked={enabled} onChange={e => {
                setEnabled(e.target.checked);
                node.cropEnabled.setValue(e.target.checked);
                onChange();
              }} />
            </div>
          </div>
          {/* Min corner */}
          {subHeader('Min Corner')}
          <CRow label="Min X" value={+minX.toFixed(3)}
            onChange={setFloat(v => node.cropMinX.setValue(v), setMinX)} />
          <CRow label="Min Y" value={+minY.toFixed(3)}
            onChange={setFloat(v => node.cropMinY.setValue(v), setMinY)} />
          <CRow label="Min Z" value={+minZ.toFixed(3)}
            onChange={setFloat(v => node.cropMinZ.setValue(v), setMinZ)} />
          {/* Max corner */}
          {subHeader('Max Corner')}
          <CRow label="Max X" value={+maxX.toFixed(3)}
            onChange={setFloat(v => node.cropMaxX.setValue(v), setMaxX)} />
          <CRow label="Max Y" value={+maxY.toFixed(3)}
            onChange={setFloat(v => node.cropMaxY.setValue(v), setMaxY)} />
          <CRow label="Max Z" value={+maxZ.toFixed(3)}
            onChange={setFloat(v => node.cropMaxZ.setValue(v), setMaxZ)} />
        </>
      )}
    </>
  );
};
// ── Node attributes section ───────────────────────────────────────────────────
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
        if (plug.type === PlugType.Float) {
          const v = plug.getValue() as number;
          return (
            <CRow key={plug.name}
              label={plug.name.charAt(0).toUpperCase() + plug.name.slice(1)}
              value={v}
              onChange={raw => { const n = parseFloat(raw); if (!isNaN(n)) { plug.setValue(n); onChange(); } }}
            />
          );
        }
        if (plug.type === PlugType.Boolean) {
          return (
            <div key={plug.name} style={{ display: 'grid', gridTemplateColumns: '42% 1fr', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ padding: '3px 8px', fontSize: 11, color: C.muted, borderRight: `1px solid ${C.border}`, fontFamily: '"Segoe UI",sans-serif' }}>
                {plug.name.charAt(0).toUpperCase() + plug.name.slice(1)}
              </div>
              <div style={{ padding: '3px 8px' }}>
                <input type="checkbox" checked={plug.getValue() as boolean}
                  onChange={e => { plug.setValue(e.target.checked); onChange(); }} />
              </div>
            </div>
          );
        }
        if (plug.type === PlugType.String) {
          const v = plug.getValue() as string;
          return (
            <CRow key={plug.name}
              label={plug.name.charAt(0).toUpperCase() + plug.name.slice(1)}
              value={v} readOnly color={C.orange}
            />
          );
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
  const [, setTick]  = useState(0);
  const [xformOpen,  setXformOpen]  = useState(true);
  const [histOpen,   setHistOpen]   = useState(true);

  const onChange = () => { markSceneDirty(); setTick(t => t + 1); };

  /** Build a recordTransform callback bound to the current lead node. */
  const makeRecordTransform = (n: DAGNode) =>
    (oldT: Vector3Data, oldR: Vector3Data, oldS: Vector3Data) => {
      if (!core) return;
      const newT = { ...n.translate.getValue() };
      const newR = { ...n.rotate.getValue() };
      const newS = { ...n.scale.getValue() };
      const moved =
        Math.abs(newT.x-oldT.x)>1e-5 || Math.abs(newT.y-oldT.y)>1e-5 || Math.abs(newT.z-oldT.z)>1e-5 ||
        Math.abs(newR.x-oldR.x)>1e-5 || Math.abs(newR.y-oldR.y)>1e-5 || Math.abs(newR.z-oldR.z)>1e-5 ||
        Math.abs(newS.x-oldS.x)>1e-5 || Math.abs(newS.y-oldS.y)>1e-5 || Math.abs(newS.z-oldS.z)>1e-5;
      if (!moved) return;
      const cmd = new TransformCommand([{ node: n, oldTranslate: oldT, newTranslate: newT, oldRotate: oldR, newRotate: newR, oldScale: oldS, newScale: newS }]);
      core.commandHistory.record(cmd);
      core.logger.log(cmd.description!, 'command');
    };

  if (!selectedNode) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: C.bg,
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.dim, fontSize: 12, fontFamily: '"Segoe UI",system-ui,sans-serif', fontStyle: 'italic',
        }}>Nothing selected</div>
        {/* Show all history when no node is selected */}
        <Sec title="History (All)" open={histOpen} onToggle={() => setHistOpen(v => !v)} accent />
        {histOpen && <HistoryPanel />}
      </div>
    );
  }

  const vec3Plugs  = Array.from(selectedNode.plugs.values()).filter(p => p.type === PlugType.Vector3);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg }}>

      {/* ── Node header ── */}
      <div style={{
        padding: '7px 10px 5px', borderBottom: `1px solid ${C.border}`,
        background: C.strip, flexShrink: 0,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: C.text,
          fontFamily: '"Segoe UI",system-ui,sans-serif', marginBottom: 2,
        }}>{selectedNode.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, background: C.accent, color: '#fff',
            padding: '1px 5px', borderRadius: 2, letterSpacing: '0.4px',
            textTransform: 'uppercase', fontFamily: 'monospace',
          }}>{selectedNode.nodeType}</span>
          <span style={{ fontSize: 9, color: C.dim, fontFamily: 'monospace' }}>
            {selectedNode.uuid.slice(0, 8)}…
          </span>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Transform section */}
        <Sec title="Transform" tag="transform" open={xformOpen} onToggle={() => setXformOpen(v => !v)} />
        {xformOpen && vec3Plugs.map(plug => (
          <Vec3Rows key={plug.name} plug={plug} onChange={onChange}
            node={selectedNode} recordTransform={makeRecordTransform(selectedNode)} />
        ))}

        {/* Camera-specific preset picker — only for CameraNode */}
        {selectedNode instanceof CameraNode && (
          <CameraSection node={selectedNode} onChange={onChange} />
        )}

        {/* Light-specific controls — only for LightNode */}
        {selectedNode instanceof LightNode && (
          <LightSection node={selectedNode} onChange={onChange} />
        )}

        {/* Splat crop volume — only for SplatNode */}
        {selectedNode instanceof SplatNode && (
          <SplatSection node={selectedNode} onChange={onChange} />
        )}

        {/* Node-type-specific attributes (skip plugs already shown in dedicated sections) */}
        <NodeAttrs
          node={selectedNode}
          onChange={onChange}
          exclude={selectedNode instanceof LightNode
            ? new Set(['lightType', 'color', 'intensity'])
            : selectedNode instanceof GltfNode
              ? new Set(['fileName'])
              : selectedNode instanceof SplatNode
                ? new Set(['fileName', ...SPLAT_CROP_PLUGS])
                : undefined
          }
        />

        {/* Command history — filtered to this node */}
        <Sec title="History" open={histOpen} onToggle={() => setHistOpen(v => !v)} accent />
        {histOpen && <HistoryPanel filterUuid={selectedNode.uuid} />}

      </div>
    </div>
  );
};

