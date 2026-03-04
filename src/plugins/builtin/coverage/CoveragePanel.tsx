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
} from './CoverageResults';

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
  onToggleHeatmap: () => void;
}

const CoverageMapTab: React.FC<CoverageMapTabProps> = ({
  result, heatmapActive, onToggleHeatmap,
}) => {
  const poorFrac   = result.perTriangle.filter(t => t.coverageScore < 0.4).length / result.totalTriangleCount;
  const medFrac    = result.perTriangle.filter(t => t.coverageScore >= 0.4 && t.coverageScore < 0.7).length / result.totalTriangleCount;
  const goodFrac   = result.perTriangle.filter(t => t.coverageScore >= 0.7).length / result.totalTriangleCount;

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
        {heatmapActive ? 'Clear Heatmap' : 'Apply Heatmap to Viewport'}
      </button>

      <div style={{ marginTop: 10, color: 'var(--maya-text-dim,#888)', fontSize: 11 }}>
        Quality score = 0.30·views + 0.35·triangulation + 0.25·incidence + 0.10·density<br />
        Triangulation score peaks at 25°. Incidence penalises angles &gt; 70°.
      </div>
    </div>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

export const CoveragePanel: React.FC = () => {
  const core            = useAppStore(s => s.core);
  const vm              = useAppStore(s => s.viewportManager);  const markSceneDirty   = useAppStore(s => s.markSceneDirty);  const vs              = useAppStore(s => s.viewportSettings);

  const [config, setConfig]       = useState<CoverageConfig>({ ...DEFAULT_COVERAGE_CONFIG });
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState<AnalysisProgress | null>(null);
  const [result, setResult]       = useState<CoverageGlobalResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [tab, setTab]             = useState<'summary'|'cameras'|'pairs'|'map'>('summary');
  const [heatmapActive, setHeatmap] = useState(false);

  const engineRef      = useRef<VisibilityEngine | null>(null);
  const heatmapRef     = useRef<HeatmapApplier>(new HeatmapApplier());
  const resultRef      = useRef<CoverageGlobalResult | null>(null);
  const heatmapNodeRef = useRef<CoverageHeatmapNode | null>(null);

  const patchConfig = useCallback((patch: Partial<CoverageConfig>) => {
    setConfig(c => ({ ...c, ...patch }));
  }, []);

  const handleRun = useCallback(async () => {
    if (!core || !vm) { setError('Engine not ready'); return; }
    setRunning(true);
    setError(null);
    setProgress({ fraction: 0, message: 'Starting…' });

    // Clear old heatmap + node
    heatmapRef.current.clear();
    if (heatmapNodeRef.current && core) {
      core.sceneGraph.removeNode(heatmapNodeRef.current);
      heatmapNodeRef.current = null;
      markSceneDirty();
    }
    setHeatmap(false);

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

  const handleToggleHeatmap = useCallback(() => {
    const res = resultRef.current;
    if (!res || !vm || !core) return;

    if (heatmapActive) {
      // ── Turn off ─────────────────────────────────────────────────────
      heatmapRef.current.clear();
      if (heatmapNodeRef.current) {
        core.sceneGraph.removeNode(heatmapNodeRef.current);
        heatmapNodeRef.current = null;
        markSceneDirty();
      }
      setHeatmap(false);
    } else {
      // ── Turn on ──────────────────────────────────────────────────────
      const scene: THREE.Scene | undefined = (vm as any).scene;
      if (!scene) return;

      // Create the heatmap DAG node (visible in Outliner + Attribute Editor)
      const hmNode = new CoverageHeatmapNode();
      core.sceneGraph.addNode(hmNode);
      heatmapNodeRef.current = hmNode;
      markSceneDirty();

      heatmapRef.current.apply(
        res.cameraCenters,
        scene,
        hmNode.density.getValue(),
        hmNode.pointSize.getValue(),
        hmNode.opacity.getValue(),
      );
      setHeatmap(true);
    }
  }, [heatmapActive, vm, core, markSceneDirty]);

  // ── Live plug polling — update heatmap when node params change ────────────
  useEffect(() => {
    if (!heatmapActive) return;
    const hmNode = heatmapNodeRef.current;
    if (!hmNode) return;

    let prevDensity   = hmNode.density.getValue();
    let prevPointSize = hmNode.pointSize.getValue();
    let prevOpacity   = hmNode.opacity.getValue();
    let densityTimer: ReturnType<typeof setTimeout> | null = null;

    const id = setInterval(() => {
      const newDensity   = hmNode.density.getValue();
      const newPointSize = hmNode.pointSize.getValue();
      const newOpacity   = hmNode.opacity.getValue();

      // pointSize → cheap uniform update
      if (Math.abs(newPointSize - prevPointSize) > 0.001) {
        prevPointSize = newPointSize;
        heatmapRef.current.updatePointSize(newPointSize);
      }
      // opacity → cheap uniform update
      if (Math.abs(newOpacity - prevOpacity) > 0.001) {
        prevOpacity = newOpacity;
        heatmapRef.current.updateOpacity(newOpacity);
      }
      // density → expensive rebuild, debounced 400 ms
      if (Math.abs(newDensity - prevDensity) > 0.05) {
        prevDensity = newDensity;
        if (densityTimer) clearTimeout(densityTimer);
        densityTimer = setTimeout(() => {
          heatmapRef.current.updateDensity(newDensity);
        }, 400);
      }
    }, 80);

    return () => {
      clearInterval(id);
      if (densityTimer) clearTimeout(densityTimer);
    };
  }, [heatmapActive]);

  const TABS = ['summary', 'cameras', 'pairs', 'map'] as const;
  const TAB_LABELS = { summary: 'Summary', cameras: 'Per Camera', pairs: 'Pairs', map: 'Coverage Map' };

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
