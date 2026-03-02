import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ViewportManager } from '../../core/viewport/ViewportManager';
import { GateMask } from '../components/GateMask';
import { ChevronDown, Settings } from 'lucide-react';
import { toolBus, viewportBus, sceneBus, dispatchScene } from '../buses';
import { ReparentCommand } from '../../core/system/commands/ReparentCommand';
import { ReorderCommand } from '../../core/system/commands/ReorderCommand';
import { CameraNode } from '../../core/dag/CameraNode';
import { RESOLUTION_PRESET_GROUPS, DEFAULT_RESOLUTION } from '../data/resolutionPresets';

type ShadingMode = 'smooth' | 'wireframe' | 'wireframe-on-shaded';

const OverlayBtn: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}> = ({ children, onClick, active, title }) => (
  <button
    title={title}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '3px',
      padding: '2px 7px',
      fontSize: '11px',
      background: active ? 'rgba(82,133,166,0.55)' : 'rgba(28,28,28,0.78)',
      border: `1px solid ${active ? 'var(--maya-accent)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: '3px',
      color: 'var(--maya-text)',
      cursor: 'pointer',
      userSelect: 'none',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </button>
);

export const ViewportPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const core           = useAppStore(state => state.core);
  const sceneVersion   = useAppStore(state => state.sceneVersion); void sceneVersion;
  const markSceneDirty = useAppStore(state => state.markSceneDirty);
  const setViewportManager = useAppStore(state => state.setViewportManager);
  const vs             = useAppStore(state => state.viewportSettings);
  const updateVS       = useAppStore(state => state.updateViewportSettings);
  const vmRef          = useRef<ViewportManager | null>(null);

  const [fps,           setFps]           = useState(0);
  const [camDropOpen,   setCamDropOpen]   = useState(false);
  const [activeCamLabel, setActiveCamLabel] = useState('Perspective');
  const camDropRef = useRef<HTMLDivElement>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const applyResolution = (w: number, h: number, label: string) => {
    updateVS({ renderRes: { w, h, label } });
    vmRef.current?.setRenderResolution(w, h);
    setSettingsOpen(false);
  };

  // Close settings when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  // Close camera dropdown when clicking outside
  useEffect(() => {
    if (!camDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (camDropRef.current && !camDropRef.current.contains(e.target as Node)) {
        setCamDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [camDropOpen]);

  // Collect all CameraNodes from the current scene
  const sceneCameras: CameraNode[] = [];
  if (core) {
    for (const node of core.sceneGraph.getAllNodes()) {
      if (node instanceof CameraNode) sceneCameras.push(node as CameraNode);
    }
  }

  // FPS counter
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf: number;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round(frames * 1000 / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !core) return;
    const vm = new ViewportManager(containerRef.current, core);
    vmRef.current = vm;
    vm.onSceneChanged = markSceneDirty;
    // Register in store so CameraViewPanel can subscribe to frame events
    setViewportManager(vm);
    vm.setRenderResolution(vs.renderRes.w, vs.renderRes.h);

    // ── Connect toolbar buses → ViewportManager ──────────────────────────
    const onTool        = (e: Event) => vm.setTransformMode((e as CustomEvent).detail);

    const onGridVisible = (e: Event) => {
      const v = (e as CustomEvent<boolean>).detail;
      vm.setGridVisible(v);
    };
    const onShading     = (e: Event) => {
      const m = (e as CustomEvent).detail as ShadingMode;
      vm.setShadingMode(m);
    };
    const onSnapGrid    = (e: Event) => vm.setTranslationSnap((e as CustomEvent).detail);
    const onSnapVertex  = (e: Event) => vm.setRotationSnap((e as CustomEvent<boolean>).detail ? 15 : null);
    const onLighting    = (e: Event) => vm.setLightingEnabled((e as CustomEvent<boolean>).detail);
    const onSpace       = (e: Event) => vm.setTransformSpace((e as CustomEvent).detail);
    const onGizmoSize   = (e: Event) => vm.setGizmoSize((e as CustomEvent<number>).detail);
    const onBgColor     = (e: Event) => vm.setBackgroundColor((e as CustomEvent<string>).detail);
    const onCreate      = (e: Event) => {
      vm.createPrimitive((e as CustomEvent).detail);
      markSceneDirty();
    };
    const onGroupSelected = () => {
      vm.createGroup();
      markSceneDirty();
    };
    const onUngroupSelected = () => {
      vm.ungroupSelected();
      markSceneDirty();
    };
    const onReparentNode = (e: Event) => {
      const { nodeUuid, newParentUuid } = (e as CustomEvent).detail as { nodeUuid: string; newParentUuid: string };
      const node = core.sceneGraph.getNodeById(nodeUuid);
      const newParent = core.sceneGraph.getNodeById(newParentUuid);
      if (!node || !newParent) return;
      if (node === newParent) return;
      let cursor = newParent.parent;
      while (cursor) { if (cursor === node) return; cursor = cursor.parent; }
      const cmd = new ReparentCommand(node, newParent, core.sceneGraph, (nu, pu) => vm.reparentInView(nu, pu));
      core.commandHistory.execute(cmd);
      core.logger.log(cmd.description!, 'command');
      markSceneDirty();
    };
    const onReorderNode = (e: Event) => {
      const { nodeUuid, newParentUuid, insertIndex } = (e as CustomEvent).detail as { nodeUuid: string; newParentUuid: string; insertIndex: number };
      const node = core.sceneGraph.getNodeById(nodeUuid);
      const newParent = core.sceneGraph.getNodeById(newParentUuid);
      if (!node || !newParent) return;
      if (node === newParent) return;
      let cursor = newParent.parent;
      while (cursor) { if (cursor === node) return; cursor = cursor.parent; }
      const cmd = new ReorderCommand(node, newParent, insertIndex, core.sceneGraph, (nu, pu) => vm.reparentInView(nu, pu));
      core.commandHistory.execute(cmd);
      core.logger.log(cmd.description!, 'command');
      markSceneDirty();
    };

    const onCreateCamera = () => {
      vm.createCamera();
      markSceneDirty();
    };
    const onLookThroughCamera = (e: Event) => {
      const uuid = (e as CustomEvent<string | null>).detail;
      vm.lookThroughCamera(uuid);
    };
    const onDeleteSelected = () => {
      vm.deleteSelected();
      markSceneDirty();
    };
    const onDuplicateSelected = () => {
      vm.duplicateSelected();
      markSceneDirty();
    };

    toolBus    .addEventListener('tool',             onTool);
    viewportBus.addEventListener('setGridVisible',    onGridVisible);
    viewportBus.addEventListener('setShadingMode',    onShading);
    viewportBus.addEventListener('setSnapGrid',       onSnapGrid);
    viewportBus.addEventListener('setSnapVertex',     onSnapVertex);
    viewportBus.addEventListener('setLightingEnabled',onLighting);
    viewportBus.addEventListener('setTransformSpace', onSpace);
    viewportBus.addEventListener('setGizmoSize',      onGizmoSize);
    viewportBus.addEventListener('setBgColor',         onBgColor);
    viewportBus.addEventListener('setOutlineEnabled', (e: Event) => vm.setOutlineEnabled((e as CustomEvent<boolean>).detail));
    viewportBus.addEventListener('setOutlineColor',   (e: Event) => vm.setOutlineColor((e as CustomEvent<string>).detail));
    viewportBus.addEventListener('setOutlineWidth',   (e: Event) => vm.setOutlineWidth((e as CustomEvent<number>).detail));
    sceneBus   .addEventListener('createPrimitive',   onCreate);
    sceneBus   .addEventListener('createCamera',      onCreateCamera);
    sceneBus   .addEventListener('groupSelected',      onGroupSelected);
    sceneBus   .addEventListener('ungroupSelected',    onUngroupSelected);
    sceneBus   .addEventListener('reparentNode',       onReparentNode);
    sceneBus   .addEventListener('reorderNode',        onReorderNode);
    sceneBus   .addEventListener('lookThroughCamera',  onLookThroughCamera);
    sceneBus   .addEventListener('deleteSelected',     onDeleteSelected);
    sceneBus   .addEventListener('duplicateSelected',  onDuplicateSelected);

    return () => {
      toolBus    .removeEventListener('tool',             onTool);
      viewportBus.removeEventListener('setGridVisible',    onGridVisible);
      viewportBus.removeEventListener('setShadingMode',    onShading);
      viewportBus.removeEventListener('setSnapGrid',       onSnapGrid);
      viewportBus.removeEventListener('setSnapVertex',     onSnapVertex);
      viewportBus.removeEventListener('setLightingEnabled',onLighting);
      viewportBus.removeEventListener('setTransformSpace', onSpace);
      viewportBus.removeEventListener('setGizmoSize',      onGizmoSize);
      viewportBus.removeEventListener('setBgColor',         onBgColor);
      // outline listeners are anonymous — they auto-clean when vm is disposed
      sceneBus   .removeEventListener('createPrimitive',   onCreate);
      sceneBus   .removeEventListener('createCamera',      onCreateCamera);
      sceneBus   .removeEventListener('groupSelected',     onGroupSelected);
      sceneBus   .removeEventListener('ungroupSelected',   onUngroupSelected);
      sceneBus   .removeEventListener('reparentNode',      onReparentNode);
      sceneBus   .removeEventListener('reorderNode',        onReorderNode);
      sceneBus   .removeEventListener('lookThroughCamera',  onLookThroughCamera);
      sceneBus   .removeEventListener('deleteSelected',     onDeleteSelected);
      sceneBus   .removeEventListener('duplicateSelected',  onDuplicateSelected);
      vm.dispose();
      setViewportManager(null);
    };
  }, [core]);

  const cycleShadingMode = () => {
    const prev = vs.shadingMode;
    const next = prev === 'smooth' ? 'wireframe-on-shaded'
               : prev === 'wireframe-on-shaded' ? 'wireframe' : 'smooth';
    updateVS({ shadingMode: next });
    vmRef.current?.setShadingMode(next);
  };

  const toggleGrid = () => {
    const next = !vs.showGrid;
    updateVS({ showGrid: next });
    vmRef.current?.setGridVisible(next);
  };

  const shadingLabel =
    vs.shadingMode === 'smooth'                ? 'Smooth Shaded'
  : vs.shadingMode === 'wireframe-on-shaded'   ? 'Wires on Shaded'
  :                                              'Wireframe';

  return (
    <div
      className="w-full h-full relative outline-none"
      tabIndex={0}
      ref={containerRef}
      style={{ background: '#202020' }}
    >
      {vs.showGateMask && (
        <GateMask
          containerRef={containerRef}
          renderWidth={vs.renderRes.w}
          renderHeight={vs.renderRes.h}
          activeCamName={activeCamLabel !== 'Perspective' ? activeCamLabel : null}
        />
      )}

      {/* Top overlay toolbar */}
      <div style={{
        position: 'absolute',
        top: '8px',
        left: '8px',
        right: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        zIndex: 20,
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'all', display: 'flex', gap: '4px' }}>
          {/* Camera picker dropdown */}
          <div ref={camDropRef} style={{ position: 'relative' }}>
            <OverlayBtn title="Look through camera" onClick={() => setCamDropOpen(v => !v)}>
              {activeCamLabel} <ChevronDown size={10} />
            </OverlayBtn>
            {camDropOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                minWidth: '180px', background: 'var(--maya-bg-dark)',
                border: '1px solid var(--maya-border-light)',
                boxShadow: '0 6px 20px rgba(0,0,0,0.65)',
                borderRadius: '3px', zIndex: 999, padding: '3px 0',
              }}>
                {/* Default perspective */}
                <div
                  onMouseDown={() => {
                    dispatchScene.lookThroughCamera(null);
                    setActiveCamLabel('Perspective');
                    setCamDropOpen(false);
                  }}
                  style={{
                    padding: '5px 14px', fontSize: '11px', cursor: 'pointer',
                    color: activeCamLabel === 'Perspective' ? 'var(--maya-accent)' : 'var(--maya-text)',
                    fontFamily: '"Segoe UI",system-ui,sans-serif',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--maya-accent)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Perspective
                </div>
                {sceneCameras.length > 0 && (
                  <div style={{ height: 1, background: 'var(--maya-border-light)', margin: '3px 0' }} />
                )}
                {sceneCameras.map(cam => (
                  <div
                    key={cam.uuid}
                    onMouseDown={() => {
                      dispatchScene.lookThroughCamera(cam.uuid);
                      setActiveCamLabel(cam.name);
                      setCamDropOpen(false);
                    }}
                    style={{
                      padding: '5px 14px', fontSize: '11px', cursor: 'pointer',
                      color: activeCamLabel === cam.name ? 'var(--maya-accent)' : 'var(--maya-text)',
                      fontFamily: '"Segoe UI",system-ui,sans-serif',
                      background: 'transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--maya-accent)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {cam.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <OverlayBtn title="Cycle shading (4=Wireframe / 5=Shaded)" onClick={cycleShadingMode}>
            {shadingLabel}
          </OverlayBtn>
          <OverlayBtn title="Toggle grid" active={vs.showGrid} onClick={toggleGrid}>
            Grid
          </OverlayBtn>
          <OverlayBtn title="Toggle film gate mask" active={vs.showGateMask} onClick={() => updateVS({ showGateMask: !vs.showGateMask })}>
            Gate
          </OverlayBtn>
          {/* Settings gear */}
          <div ref={settingsRef} style={{ position: 'relative' }}>
            <OverlayBtn title="Render settings" active={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>
              <Settings size={11} />
            </OverlayBtn>
            {settingsOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                minWidth: '220px', background: 'var(--maya-bg-dark)',
                border: '1px solid var(--maya-border-light)',
                boxShadow: '0 6px 20px rgba(0,0,0,0.65)',
                borderRadius: '3px', zIndex: 999, padding: '3px 0',
                maxHeight: '60vh', overflowY: 'auto',
              }}>
                {/* Custom W×H */}
                <div style={{
                  padding: '6px 12px 4px', fontSize: '10px',
                  color: 'var(--maya-text-muted)', fontFamily: '"Segoe UI",system-ui,sans-serif',
                  borderBottom: '1px solid var(--maya-border)', marginBottom: '2px',
                }}>
                  RENDER RESOLUTION
                </div>
                {/* Custom input row */}
                <div style={{ padding: '4px 12px', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type="number" defaultValue={vs.renderRes.w} min={1} max={16384}
                    id="vp-res-w"
                    style={{
                      width: 56, padding: '2px 4px', fontSize: '11px',
                      background: 'var(--maya-bg-input)', border: '1px solid var(--maya-border)',
                      borderRadius: 2, color: 'var(--maya-text)', fontFamily: '"Segoe UI",system-ui,sans-serif',
                    }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--maya-text-muted)' }}>×</span>
                  <input
                    type="number" defaultValue={vs.renderRes.h} min={1} max={16384}
                    id="vp-res-h"
                    style={{
                      width: 56, padding: '2px 4px', fontSize: '11px',
                      background: 'var(--maya-bg-input)', border: '1px solid var(--maya-border)',
                      borderRadius: 2, color: 'var(--maya-text)', fontFamily: '"Segoe UI",system-ui,sans-serif',
                    }}
                  />
                  <button
                    onClick={() => {
                      const w = parseInt((document.getElementById('vp-res-w') as HTMLInputElement)?.value ?? '1920');
                      const h = parseInt((document.getElementById('vp-res-h') as HTMLInputElement)?.value ?? '1080');
                      if (w > 0 && h > 0) applyResolution(w, h, `${w}×${h}`);
                    }}
                    style={{
                      padding: '2px 8px', fontSize: '10px', cursor: 'pointer',
                      background: 'var(--maya-accent)', border: 'none', borderRadius: 2,
                      color: '#fff', fontFamily: '"Segoe UI",system-ui,sans-serif',
                    }}
                  >
                    Apply
                  </button>
                </div>
                {/* Active preset indicator */}
                <div style={{ padding: '2px 12px 4px', fontSize: '10px',
                  color: 'var(--maya-accent)', fontFamily: '"Consolas",monospace', }}>
                  {vs.renderRes.label}
                </div>
                <div style={{ height: 1, background: 'var(--maya-border)', margin: '2px 0 4px' }} />
                {/* Preset groups */}
                {RESOLUTION_PRESET_GROUPS.map(group => (
                  <div key={group.group}>
                    <div style={{
                      padding: '4px 12px 2px', fontSize: '10px',
                      color: 'var(--maya-text-muted)', fontFamily: '"Segoe UI",system-ui,sans-serif',
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                    }}>
                      {group.group}
                    </div>
                    {group.presets.map(p => (
                      <div
                        key={p.label}
                        onMouseDown={() => applyResolution(p.w, p.h, p.label)}
                        style={{
                          padding: '4px 12px', fontSize: '11px', cursor: 'pointer',
                          fontFamily: '"Segoe UI",system-ui,sans-serif',
                          color: vs.renderRes.label === p.label ? 'var(--maya-accent)' : 'var(--maya-text)',
                          background: 'transparent',
                          display: 'flex', justifyContent: 'space-between', gap: 8,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--maya-accent)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span>{p.label}</span>
                        {p.note && <span style={{ opacity: 0.5, fontSize: '10px' }}>{p.note}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* FPS indicator */}
        <div style={{
          pointerEvents: 'none',
          fontSize: '10px',
          color: fps >= 50 ? '#7ec89c' : fps >= 25 ? '#cca700' : '#f48771',
          background: 'rgba(0,0,0,0.55)',
          padding: '2px 7px',
          borderRadius: '3px',
          fontFamily: '"Consolas","Menlo",monospace',
        }}>
          {fps} fps
        </div>
      </div>

      {/* Bottom-left hints */}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '10px',
        pointerEvents: 'none',
        fontSize: '10px',
        color: 'rgba(200,200,200,0.3)',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        zIndex: 20,
      }}>
        W=Move &nbsp;·&nbsp; E=Rotate &nbsp;·&nbsp; R=Scale &nbsp;·&nbsp; T=Space &nbsp;·&nbsp; Q=Detach
      </div>
    </div>
  );
};

