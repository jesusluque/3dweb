/**
 * CoveragePanel — floating window content for the coverage analysis plugin.
 *
 * Layout:
 *   ┌─ Config ─────────────────────────────────────────────────────────┐
 *   │  Sampling: [uniform|adaptive]  Grid: [auto|custom]  Seed: [42]  │
 *   │  Target views: [3]  Weights: v[.30] t[.35] i[.25] d[.10]        │
 *   └────────────────────────────────────────────────────────────────┘
 *   [ Run Analysis ]       [progress bar]
 *
 *   Tabs: Summary | Per Camera | Pairs | Coverage Map
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useAppStore } from '../../../ui/store/useAppStore';
import { VisibilityEngine }         from './VisibilityEngine';
import { HeatmapApplier }           from './HeatmapApplier';
import { CoverageHeatmapNode }      from './CoverageHeatmapNode';
import { DEFAULT_COVERAGE_CONFIG }  from './CoverageResults';
import type {
  CoverageConfig,
  CoverageGlobalResult,
  AnalysisProgress,
  PerCameraResult,
  PerPairResult,
  PerTriangleResult,
  CameraFrustum,
} from './CoverageResults';

// ── Module-level singleton map ─────────────────────────────────────────────────────────────
// HeatmapApplier instances keyed by CoverageHeatmapNode UUID.
// Living outside React means they survive when the panel window is closed
// and can be reconnected when it is reopened, without re-running the analysis.
const _appliers = new Map<string, HeatmapApplier>();

// ── Styles ────────────────────────────────────────────────────────────────────

const ss = {
  root: {
    display: 'flex', flexDirection: 'column' as const,
    height: '100%', overflow: 'hidden',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    fontSize: 12,
    color: 'var(--maya-text, #ccc)',
    background: 'var(--maya-bg-dark, #1e1e1e)',
  },
  section: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--maya-border, #444)',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    marginBottom: 5,
  },
  label: { color: 'var(--maya-text-dim, #888)', minWidth: 90 },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: 'var(--maya-text, #ccc)',
    borderRadius: 3, padding: '2px 6px', fontSize: 12, width: 60,
  },
  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: 'var(--maya-text, #ccc)',
    borderRadius: 3, padding: '2px 6px', fontSize: 12,
  },
  btn: (accent?: boolean): React.CSSProperties => ({
    background: accent ? 'var(--maya-accent, #2a8cff)' : 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: accent ? '#fff' : 'var(--maya-text, #ccc)',
    borderRadius: 3, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
    fontFamily: 'inherit',
  }),
  progressBar: (pct: number): React.CSSProperties => ({
    height: 4,
    background: `linear-gradient(to right, var(--maya-accent, #2a8cff) ${pct * 100}%, rgba(255,255,255,0.1) ${pct * 100}%)`,
    borderRadius: 2,
    margin: '4px 0',
  }),
  tabs: {
    display: 'flex', borderBottom: '1px solid var(--maya-border, #444)',
    flexShrink: 0,
  },
  tab: (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', cursor: 'pointer', fontSize: 11,
    borderBottom: active ? '2px solid var(--maya-accent, #2a8cff)' : '2px solid transparent',
    color: active ? 'var(--maya-accent, #2a8cff)' : 'var(--maya-text-dim, #888)',
    userSelect: 'none',
    transition: 'color 0.1s',
  }),
  scrollBody: {
    flex: 1, overflowY: 'auto' as const, padding: '8px 10px',
  },
  table: {
    width: '100%', borderCollapse: 'collapse' as const, fontSize: 11,
  },
  th: {
    textAlign: 'left' as const, padding: '3px 6px',
    color: 'var(--maya-text-dim, #888)',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '2px 6px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    whiteSpace: 'nowrap' as const,
  },
  badge: (score: number): React.CSSProperties => ({
    display: 'inline-block', padding: '1px 6px', borderRadius: 10,
    background: scoreColor(score), color: '#fff', fontSize: 10, fontWeight: 700,
  }),
};

// ── Score colour helper ────────────────────────────────────────────────────────

function scoreColor(s: number): string {
  if (s >= 0.7) return '#27ae60';
  if (s >= 0.4) return '#f39c12';
  return '#e74c3c';
}

function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function fmt2(n: number): string { return n.toFixed(2); }
function fmtDeg(n: number): string { return `${n.toFixed(1)}°`; }

// ── Config form ──────────────────────────────────────────────────────────────

interface ConfigFormProps {
  config: CoverageConfig;
  onChange: (patch: Partial<CoverageConfig>) => void;
}

const ConfigForm: React.FC<ConfigFormProps> = ({ config, onChange }) => (
  <div style={ss.section}>
    <div style={ss.row}>
      <span style={ss.label}>Sampling</span>
      <select
        style={ss.select}
        value={config.samplingMode}
        onChange={e => onChange({ samplingMode: e.target.value as any })}
      >
        <option value="uniform">Uniform stratified</option>
        <option value="adaptive">Adaptive (depth variance)</option>
      </select>
    </div>
    <div style={ss.row}>
      <span style={ss.label}>Grid (cols)</span>
      <input
        style={ss.input} type="number" min={4} max={512}
        value={config.gridCols ?? ''}
        placeholder="auto"
        onChange={e => onChange({ gridCols: e.target.value ? parseInt(e.target.value) : undefined })}
      />
      <span style={ss.label}>rows</span>
      <input
        style={ss.input} type="number" min={4} max={256}
        value={config.gridRows ?? ''}
        placeholder="auto"
        onChange={e => onChange({ gridRows: e.target.value ? parseInt(e.target.value) : undefined })}
      />
    </div>
    <div style={ss.row}>
      <span style={ss.label}>Seed</span>
      <input
        style={ss.input} type="number"
        value={config.seed}
        onChange={e => onChange({ seed: parseInt(e.target.value) || 42 })}
      />
      <span style={ss.label}>Target views</span>
      <input
        style={ss.input} type="number" min={1} max={20}
        value={config.targetViewCount}
        onChange={e => onChange({ targetViewCount: parseInt(e.target.value) || 3 })}
      />
    </div>
  </div>
);

// ── Summary tab ──────────────────────────────────────────────────────────────

const SummaryTab: React.FC<{ result: CoverageGlobalResult }> = ({ result }) => (
  <div style={ss.scrollBody}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
      {[
        ['Coverage',        `${result.coveragePercent.toFixed(1)}%`],
        ['Stereo coverage', `${result.stereoCoveragePercent.toFixed(1)}%`],
        ['Quality P50 (seen)', fmt2(result.qualityScoreP50)],
        ['Quality P25 (seen)', fmt2(result.qualityScoreP25)],
        ['Total triangles', result.totalTriangleCount.toLocaleString()],
        ['Elapsed',         `${result.elapsedMs.toFixed(0)} ms`],
      ].map(([k, v]) => (
        <div key={k as string} style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '6px 10px',
        }}>
          <div style={{ color: 'var(--maya-text-dim,#888)', fontSize: 10 }}>{k}</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{v}</div>
        </div>
      ))}
    </div>
    <div style={{ color: 'var(--maya-text-dim,#888)', marginBottom: 4 }}>Score distribution</div>
    <ScoreDistribution results={result.perTriangle} />
  </div>
);

const ScoreDistribution: React.FC<{ results: PerTriangleResult[] }> = ({ results }) => {
  const N = 20;
  // Only include SEEN triangles in the distribution — unseen ones (score=0)
  // are shown as a separate count so the histogram is readable.
  const seen   = results.filter(t => t.viewCount > 0);
  const unseen = results.length - seen.length;

  const counts = new Array(N).fill(0);
  for (const t of seen) {
    const bin = Math.min(N - 1, Math.floor(t.coverageScore * N));
    counts[bin]++;
  }
  const max = Math.max(...counts, 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 50 }}>
        {counts.map((c, i) => {
          const score = i / N;
          return (
            <div
              key={i}
              title={`${(score * 100).toFixed(0)}–${((score + 1 / N) * 100).toFixed(0)}%: ${c} tris`}
              style={{
                flex: 1, height: `${(c / max) * 100}%`,
                background: scoreColor(score + 0.5 / N),
                borderRadius: 2,
                minHeight: c > 0 ? 2 : 0,
              }}
            />
          );
        })}
      </div>
      {unseen > 0 && (
        <div style={{ color: 'var(--maya-text-dim,#888)', fontSize: 10, marginTop: 4 }}>
          {unseen.toLocaleString()} unseen triangles not shown (score = 0)
        </div>
      )}
    </div>
  );
};

// ── Per Camera tab ────────────────────────────────────────────────────────────

const PerCameraTab: React.FC<{ cameras: PerCameraResult[] }> = ({ cameras }) => (
  <div style={ss.scrollBody}>
    <table style={ss.table}>
      <thead>
        <tr>
          {['Camera', 'Visible tris', 'Area', 'BG%', 'Depth P50', 'Samples'].map(h => (
            <th key={h} style={ss.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cameras.map(c => (
          <tr key={c.cameraId}>
            <td style={ss.td}>{c.cameraName}</td>
            <td style={ss.td}>{c.visibleTriangleIds.size.toLocaleString()}</td>
            <td style={ss.td}>{c.visibleArea.toFixed(2)}</td>
            <td style={ss.td}>{pct(c.backgroundRatio)}</td>
            <td style={ss.td}>{c.depthP50.toFixed(2)}</td>
            <td style={ss.td}>{c.sampleCount.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ── Pair tab ──────────────────────────────────────────────────────────────────

const PairsTab: React.FC<{ pairs: PerPairResult[] }> = ({ pairs }) => (
  <div style={ss.scrollBody}>
    {pairs.length === 0 ? (
      <div style={{ color: 'var(--maya-text-dim,#888)', padding: 10 }}>
        Need ≥2 cameras for pair analysis.
      </div>
    ) : (
      <table style={ss.table}>
        <thead>
          <tr>
            {['Camera A', 'Camera B', 'Overlap', 'B/D ratio', 'Tri angle', 'Shared'].map(h => (
              <th key={h} style={ss.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i}>
              <td style={ss.td}>{p.camIdA.slice(0, 8)}</td>
              <td style={ss.td}>{p.camIdB.slice(0, 8)}</td>
              <td style={ss.td}>
                <span style={ss.badge(p.overlapFraction)}>{pct(p.overlapFraction)}</span>
              </td>
              <td style={ss.td}>{fmt2(p.baselineDepthRatioP50)}</td>
              <td style={ss.td}>{fmtDeg(p.triangulationAngleP50Deg)}</td>
              <td style={ss.td}>{p.sharedTriangleCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

// ── Coverage Map tab ──────────────────────────────────────────────────────────

interface CoverageMapTabProps {
  result: CoverageGlobalResult;
  heatmapActive: boolean;
  mapCount: number;       // total frozen maps already in scene
  onToggleHeatmap: () => void;
}

const CoverageMapTab: React.FC<CoverageMapTabProps> = ({
  result, heatmapActive, mapCount, onToggleHeatmap,
}) => {
  const poorFrac   = result.perTriangle.filter(t => t.coverageScore < 0.4).length / result.totalTriangleCount;
  const medFrac    = result.perTriangle.filter(t => t.coverageScore >= 0.4 && t.coverageScore < 0.7).length / result.totalTriangleCount;
  const goodFrac   = result.perTriangle.filter(t => t.coverageScore >= 0.7).length / result.totalTriangleCount;

  const applyLabel = mapCount > 0
    ? `Apply as Coverage Map ${mapCount + 1}`
    : 'Apply Coverage Map to Viewport';

  return (
    <div style={ss.scrollBody}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        {[['Poor (< 0.4)', '#e74c3c', poorFrac], ['Medium (0.4–0.7)', '#f39c12', medFrac], ['Good (≥ 0.7)', '#27ae60', goodFrac]].map(([label, color, frac]) => (
          <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: color as string }} />
            <span>{label as string}</span>
            <span style={{ color: 'var(--maya-text-dim,#888)' }}>{pct(frac as number)}</span>
          </div>
        ))}
      </div>

      {/* Heatmap toggle */}
      <button style={ss.btn(heatmapActive)} onClick={onToggleHeatmap}>
        {heatmapActive ? 'Clear This Coverage Map' : applyLabel}
      </button>

      {mapCount > 0 && !heatmapActive && (
        <div style={{ marginTop: 6, color: 'var(--maya-text-dim,#888)', fontSize: 11 }}>
          {mapCount} frozen map{mapCount !== 1 ? 's' : ''} already in scene.
        </div>
      )}

      <div style={{ marginTop: 10, color: 'var(--maya-text-dim,#888)', fontSize: 11 }}>
        Quality score = 0.30·views + 0.35·triangulation + 0.25·incidence + 0.10·density<br />
        Triangulation score peaks at 25°. Incidence penalises angles &gt; 70°.
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

export const CoveragePanel: React.FC = () => {
  const core                   = useAppStore(s => s.core);
  const vm                     = useAppStore(s => s.viewportManager);
  const markSceneDirty         = useAppStore(s => s.markSceneDirty);
  const vs                     = useAppStore(s => s.viewportSettings);
  const updateViewportSettings = useAppStore(s => s.updateViewportSettings);

  const [config, setConfig]       = useState<CoverageConfig>({ ...DEFAULT_COVERAGE_CONFIG });
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState<AnalysisProgress | null>(null);
  const [result, setResult]       = useState<CoverageGlobalResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [tab, setTab]             = useState<'summary'|'cameras'|'pairs'|'map'>('summary');
  // UUID of the heatmap node currently managed by this panel instance.
  // A panel can only "own" one node at a time (the one from the latest result).
  const [activeHeatmapUuid, setActiveHeatmapUuid] = useState<string | null>(null);

  const engineRef      = useRef<VisibilityEngine | null>(null);
  const resultRef      = useRef<CoverageGlobalResult | null>(null);
  // Ref to the DAGNode for the currently active heatmap
  const heatmapNodeRef = useRef<CoverageHeatmapNode | null>(null);

  const patchConfig = useCallback((patch: Partial<CoverageConfig>) => {
    setConfig(c => ({ ...c, ...patch }));
  }, []);

  const handleRun = useCallback(async () => {
    if (!core || !vm) { setError('Engine not ready'); return; }
    setRunning(true);
    setError(null);
    setProgress({ fraction: 0, message: 'Starting…' });

    // Detach from the previous result's heatmap without destroying it.
    // The old node stays frozen in the scene as "Coverage Heatmap N".
    setActiveHeatmapUuid(null);
    heatmapNodeRef.current = null;

    const engine = new VisibilityEngine(core, vm, (p) => setProgress(p));
    engineRef.current = engine;

    try {
      const res = await engine.run(config, vs.renderRes.w, vs.renderRes.h);
      setResult(res);
      resultRef.current = res;
      setTab('summary');
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      engineRef.current = null;
      setRunning(false);
    }
  }, [core, vm, config, vs.renderRes]);

  const handleCancel = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setRunning(false);
    setProgress(null);
  }, []);

  // Reset panel's active-map state when coverageHeatmaps is cleared
  // (e.g. after File > New or File > Open which wipes viewport settings).
  useEffect(() => {
    const maps = vs.coverageHeatmaps ?? [];
    if (maps.length === 0) {
      // Prune stale module-level appliers too (Three.js objects already gone)
      _appliers.clear();
      setActiveHeatmapUuid(null);
      heatmapNodeRef.current = null;
    }
  }, [vs.coverageHeatmaps]);

  // ── Internal helper: create + register a new heatmap ───────────────────
  /**
   * Creates a new CoverageHeatmapNode with a consecutive name, builds the
   * THREE.Points cloud, registers it in the module-level `_appliers` map and
   * appends an entry to the persisted `coverageHeatmaps` array.
   */
  const _applyHeatmap = useCallback((
    cameraCenters: CameraFrustum[],
    density: number,
    pointSizeMult: number,
    opacity: number,
    existingUuid?: string,   // set when reconnecting to an already-live node
  ) => {
    if (!vm || !core) return;
    const scene: THREE.Scene | undefined = (vm as any).scene;
    if (!scene) return;

    // Prune stale applier entries (e.g. after scene clear)
    for (const [uuid] of _appliers) {
      if (!core.sceneGraph.getNodeById(uuid)) _appliers.delete(uuid);
    }

    if (existingUuid && _appliers.has(existingUuid)) {
      // ── Reconnect to an already-live node (panel was closed and reopened) ──
      const hmNode = core.sceneGraph.getNodeById(existingUuid) as CoverageHeatmapNode | undefined;
      if (hmNode) {
        heatmapNodeRef.current = hmNode;
        setActiveHeatmapUuid(existingUuid);
        return;
      }
    }

    // ── Create a brand-new node ─────────────────────────────────────────────────────
    const counter  = (useAppStore.getState().viewportSettings.heatmapCounter ?? 0) + 1;
    const mapName  = `Coverage Heatmap ${counter}`;
    const hmNode   = new CoverageHeatmapNode();
    hmNode.name    = mapName;
    hmNode.density.setValue(density);
    hmNode.pointSize.setValue(pointSizeMult);
    hmNode.opacity.setValue(opacity);

    core.sceneGraph.addNode(hmNode);
    vm.addNodeToView(hmNode);
    const group = vm.getNodeObject(hmNode.uuid);
    heatmapNodeRef.current = hmNode;

    const applier = new HeatmapApplier();
    applier.apply(cameraCenters, scene, density, pointSizeMult, opacity, group);
    _appliers.set(hmNode.uuid, applier);

    // Persist snapshot entry (includes current transform — identity at creation time)
    const currentMaps = useAppStore.getState().viewportSettings.coverageHeatmaps ?? [];
    updateViewportSettings({
      heatmapCounter: counter,
      coverageHeatmaps: [
        ...currentMaps,
        {
          nodeUuid:      hmNode.uuid,
          name:          mapName,
          cameraCenters,
          density,
          pointSize: pointSizeMult,
          opacity,
          translate: { ...hmNode.translate.getValue() },
          rotate:    { ...hmNode.rotate.getValue() },
          scale:     { ...hmNode.scale.getValue() },
        },
      ],
    });

    setActiveHeatmapUuid(hmNode.uuid);
    markSceneDirty();
  }, [vm, core, markSceneDirty, updateViewportSettings]);

  // ── Restore a single heatmap entry from saved data (replaces the uuid in the store) ──
  // Used during mount-restore. Does NOT append a new entry (unlike _applyHeatmap),
  // it REPLACES the existing entry's nodeUuid with the newly created node's uuid.
  const _restoreHeatmapFromEntry = useCallback((entry: {
    nodeUuid: string; name: string;
    cameraCenters: CameraFrustum[];
    density: number; pointSize: number; opacity: number;
  }) => {
    if (!vm || !core) return;
    const scene: THREE.Scene | undefined = (vm as any).scene;
    if (!scene) return;

    const hmNode = new CoverageHeatmapNode();
    hmNode.name = entry.name;
    hmNode.density.setValue(entry.density);
    hmNode.pointSize.setValue(entry.pointSize);
    hmNode.opacity.setValue(entry.opacity);
    if (entry.translate) hmNode.translate.setValue(entry.translate);
    if (entry.rotate)    hmNode.rotate.setValue(entry.rotate);
    if (entry.scale)     hmNode.scale.setValue(entry.scale);

    core.sceneGraph.addNode(hmNode);
    vm.addNodeToView(hmNode);
    const group = vm.getNodeObject(hmNode.uuid);

    const applier = new HeatmapApplier();
    applier.apply(entry.cameraCenters, scene, entry.density, entry.pointSize, entry.opacity, group);
    _appliers.set(hmNode.uuid, applier);

    // Replace the stale uuid with the new one — never append
    const all = useAppStore.getState().viewportSettings.coverageHeatmaps ?? [];
    const updated = all.map(e =>
      e.nodeUuid === entry.nodeUuid ? { ...e, nodeUuid: hmNode.uuid } : e,
    );
    updateViewportSettings({ coverageHeatmaps: updated });

    heatmapNodeRef.current = hmNode;
    setActiveHeatmapUuid(hmNode.uuid);
  }, [vm, core, updateViewportSettings]);

  // ── Auto-restore heatmaps when panel mounts (or engine becomes available) ──
  useEffect(() => {
    if (!vm || !core) return;
    const maps = useAppStore.getState().viewportSettings.coverageHeatmaps ?? [];
    if (maps.length === 0) return;

    for (const entry of maps) {
      if (_appliers.has(entry.nodeUuid)) {
        // Applier already live (panel was just closed/reopened in same session)
        // — reconnect the most-recent one as the active node
        const hmNode = core.sceneGraph.getNodeById(entry.nodeUuid) as CoverageHeatmapNode | undefined;
        if (hmNode) {
          heatmapNodeRef.current = hmNode;
          setActiveHeatmapUuid(entry.nodeUuid);
        }
      } else {
        // Node was lost (scene loaded from file, or page refreshed) — recreate
        // and REPLACE the existing entry (not append) to prevent duplication.
        _restoreHeatmapFromEntry(entry);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm, core]);

  const handleToggleHeatmap = useCallback(() => {
    const res = resultRef.current;
    if (!vm || !core) return;

    if (activeHeatmapUuid) {
      // ── Turn off: remove the current result’s heatmap from scene ──
      const applier = _appliers.get(activeHeatmapUuid);
      if (applier) {
        applier.clear();
        _appliers.delete(activeHeatmapUuid);
      }
      const hmNode = heatmapNodeRef.current;
      if (hmNode) {
        vm.removeNodeFromView(hmNode.uuid);
        core.sceneGraph.removeNode(hmNode);
        heatmapNodeRef.current = null;
      }
      // Remove from persisted array
      const remaining = (useAppStore.getState().viewportSettings.coverageHeatmaps ?? [])
        .filter(e => e.nodeUuid !== activeHeatmapUuid);
      updateViewportSettings({ coverageHeatmaps: remaining });
      setActiveHeatmapUuid(null);
      markSceneDirty();
    } else {
      // ── Turn on: apply a new heatmap for the current analysis result ──
      if (!res) return;
      _applyHeatmap(res.cameraCenters, 4, 1.0, 0.9);
    }
  }, [activeHeatmapUuid, vm, core, markSceneDirty, updateViewportSettings, _applyHeatmap]);

  // ── Live plug polling — update heatmap when node params change ────────────
  useEffect(() => {
    if (!activeHeatmapUuid) return;
    const hmNode = heatmapNodeRef.current;
    const applier = _appliers.get(activeHeatmapUuid);
    if (!hmNode || !applier) return;

    let prevDensity   = hmNode.density.getValue();
    let prevPointSize = hmNode.pointSize.getValue();
    let prevOpacity   = hmNode.opacity.getValue();
    let densityTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
    const uuid = activeHeatmapUuid;

    const persistSnapshot = () => {
      if (snapshotTimer) clearTimeout(snapshotTimer);
      snapshotTimer = setTimeout(() => {
        const all = useAppStore.getState().viewportSettings.coverageHeatmaps ?? [];
        const updated = all.map(e =>
          e.nodeUuid === uuid
            ? { ...e,
                density:   hmNode.density.getValue(),
                pointSize: hmNode.pointSize.getValue(),
                opacity:   hmNode.opacity.getValue(),
                translate: { ...hmNode.translate.getValue() },
                rotate:    { ...hmNode.rotate.getValue() },
                scale:     { ...hmNode.scale.getValue() },
              }
            : e,
        );
        useAppStore.getState().updateViewportSettings({ coverageHeatmaps: updated });
      }, 600);
    };

    let prevTranslate = { ...hmNode.translate.getValue() };
    let prevRotate    = { ...hmNode.rotate.getValue() };
    let prevScale     = { ...hmNode.scale.getValue() };

    const id = setInterval(() => {
      const newDensity   = hmNode.density.getValue();
      const newPointSize = hmNode.pointSize.getValue();
      const newOpacity   = hmNode.opacity.getValue();
      const newT = hmNode.translate.getValue();
      const newR = hmNode.rotate.getValue();
      const newSc = hmNode.scale.getValue();

      if (Math.abs(newPointSize - prevPointSize) > 0.001) {
        prevPointSize = newPointSize;
        applier.updatePointSize(newPointSize);
        persistSnapshot();
      }
      if (Math.abs(newOpacity - prevOpacity) > 0.001) {
        prevOpacity = newOpacity;
        applier.updateOpacity(newOpacity);
        persistSnapshot();
      }
      if (Math.abs(newDensity - prevDensity) > 0.05) {
        prevDensity = newDensity;
        if (densityTimer) clearTimeout(densityTimer);
        densityTimer = setTimeout(() => applier.updateDensity(newDensity), 400);
        persistSnapshot();
      }
      // Persist transform changes
      if (
        Math.abs(newT.x - prevTranslate.x) > 0.0001 ||
        Math.abs(newT.y - prevTranslate.y) > 0.0001 ||
        Math.abs(newT.z - prevTranslate.z) > 0.0001 ||
        Math.abs(newR.x - prevRotate.x) > 0.0001 ||
        Math.abs(newR.y - prevRotate.y) > 0.0001 ||
        Math.abs(newR.z - prevRotate.z) > 0.0001 ||
        Math.abs(newSc.x - prevScale.x) > 0.0001 ||
        Math.abs(newSc.y - prevScale.y) > 0.0001 ||
        Math.abs(newSc.z - prevScale.z) > 0.0001
      ) {
        prevTranslate = { ...newT };
        prevRotate    = { ...newR };
        prevScale     = { ...newSc };
        persistSnapshot();
      }
    }, 80);

    return () => {
      clearInterval(id);
      if (densityTimer) clearTimeout(densityTimer);
      if (snapshotTimer) clearTimeout(snapshotTimer);
    };
  }, [activeHeatmapUuid]);

  const TABS = ['summary', 'cameras', 'pairs', 'map'] as const;
  const TAB_LABELS = { summary: 'Summary', cameras: 'Per Camera', pairs: 'Pairs', map: 'Coverage Map' };
  const heatmapActive = activeHeatmapUuid !== null;

  return (
    <div style={ss.root}>
      {/* Config */}
      <ConfigForm config={config} onChange={patchConfig} />

      {/* Run button + progress */}
      <div style={{ ...ss.section }}>
        <div style={ss.row}>
          {!running ? (
            <button style={ss.btn(true)} onClick={handleRun}>▶ Run Analysis</button>
          ) : (
            <>
              <button style={ss.btn()} onClick={handleCancel}>✕ Cancel</button>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--maya-text-dim,#888)' }}>
                {progress?.message}
              </span>
            </>
          )}
        </div>
        {running && progress && (
          <div style={ss.progressBar(progress.fraction)} />
        )}
        {error && (
          <div style={{ color: '#e74c3c', fontSize: 11, marginTop: 4 }}>{error}</div>
        )}
      </div>

      {/* Results */}
      {result && (
        <>
          <div style={ss.tabs}>
            {TABS.map(t => (
              <div key={t} style={ss.tab(tab === t)} onClick={() => setTab(t)}>
                {TAB_LABELS[t]}
              </div>
            ))}
          </div>

          {tab === 'summary'  && <SummaryTab    result={result} />}
          {tab === 'cameras'  && <PerCameraTab  cameras={result.perCamera} />}
          {tab === 'pairs'    && <PairsTab      pairs={result.perPair} />}
          {tab === 'map'      && (
            <CoverageMapTab
              result={result}
              heatmapActive={heatmapActive}
              mapCount={(vs.coverageHeatmaps ?? []).length}
              onToggleHeatmap={handleToggleHeatmap}
            />
          )}
        </>
      )}

      {!result && !running && (
        <div style={{ ...ss.scrollBody, color: 'var(--maya-text-dim,#888)', fontSize: 11 }}>
          Configure sampling above and click <strong>Run Analysis</strong>.
          <div style={{ marginTop: 8 }}>
            Requires: at least one <strong>Camera</strong> and one imported <strong>GLTF/GLB</strong> mesh.
          </div>
        </div>
      )}
    </div>
  );
};
