/**
 * Shared inter-component event buses.
 * Components dispatch here; other components (e.g. ViewportPanel) subscribe and
 * forward the commands to the engine without creating direct import cycles.
 */

// ── Gaussian-Splat optimisation settings ──────────────────────────────────────
/** All fields that control real-time Gaussian Splat rendering quality vs speed. */
export interface SplatOptSettings {
  // ── Currently active optimizations ────────────────────────────────────────
  /** Run the depth sort in a Web Worker (off-main-thread). */
  workerSort:     boolean;
  /** Use 4-pass 8-bit LSD radix sort O(4n) instead of Array.sort O(n log n). */
  radixSort:      boolean;
  /** Skip re-sort when the camera view-row hasn't changed beyond a threshold. */
  lazyResort:     boolean;
  /** Allow at most one sort dispatched at a time; keep previous result visible. */
  throttle:       boolean;
  /** Discard fragments whose Gaussian alpha is below this value (0 = disabled). */
  alphaThreshold: number;
  // ── Planned / splatter.app-style — stub (UI only for now) ─────────────────
  /** Per-splat frustum culling against the camera view frustum. [PLANNED] */
  frustumCull:    boolean;
  /** GPU-side radix sort via transform feedback / compute shaders. [PLANNED] */
  gpuSort:        boolean;
  /** Tile-based streaming LOD; load only visible chunks. [PLANNED] */
  streamingLOD:   boolean;
}

export const DEFAULT_SPLAT_OPT: SplatOptSettings = {
  workerSort:     true,
  radixSort:      true,
  lazyResort:     true,
  throttle:       true,
  alphaThreshold: 0,
  frustumCull:    false,
  gpuSort:        false,
  streamingLOD:   false,
};

// ── Tool mode ──────────────────────────────────────────────────────────────────
export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export const toolBus = new EventTarget();
export const dispatchTool = (mode: ToolMode) =>
  toolBus.dispatchEvent(new CustomEvent<ToolMode>('tool', { detail: mode }));

// ── Viewport display commands ──────────────────────────────────────────────────
export type ShadingMode = 'smooth' | 'wireframe' | 'wireframe-on-shaded';
export const viewportBus = new EventTarget();
export const dispatchViewport = {
  setGridVisible:     (v: boolean)                  => viewportBus.dispatchEvent(new CustomEvent('setGridVisible',     { detail: v })),
  setShadingMode:     (m: ShadingMode)              => viewportBus.dispatchEvent(new CustomEvent('setShadingMode',     { detail: m })),
  setSnapGrid:        (snap: number | null)         => viewportBus.dispatchEvent(new CustomEvent('setSnapGrid',        { detail: snap })),
  setSnapVertex:      (v: boolean)                  => viewportBus.dispatchEvent(new CustomEvent('setSnapVertex',      { detail: v })),
  setLightingEnabled: (v: boolean)                  => viewportBus.dispatchEvent(new CustomEvent('setLightingEnabled', { detail: v })),
  setTransformSpace:  (s: 'world' | 'local')        => viewportBus.dispatchEvent(new CustomEvent('setTransformSpace',  { detail: s })),
  setGizmoSize:       (size: number)                 => viewportBus.dispatchEvent(new CustomEvent('setGizmoSize',       { detail: size })),
  setBgColor:         (color: string)                => viewportBus.dispatchEvent(new CustomEvent('setBgColor',         { detail: color })),
  setOutlineEnabled:  (v: boolean)                  => viewportBus.dispatchEvent(new CustomEvent('setOutlineEnabled',  { detail: v })),
  setOutlineColor:    (color: string)                => viewportBus.dispatchEvent(new CustomEvent('setOutlineColor',    { detail: color })),
  setOutlineWidth:    (px: number)                   => viewportBus.dispatchEvent(new CustomEvent('setOutlineWidth',    { detail: px })),
  setSplatOpt:        (s: SplatOptSettings)          => viewportBus.dispatchEvent(new CustomEvent('setSplatOpt',        { detail: s })),
};

// ── Scene creation commands ────────────────────────────────────────────────────
export type PrimitiveType = 'box' | 'sphere' | 'cone' | 'plane';
export type LightTypeEvent = 'directional' | 'point' | 'ambient' | 'spot';
export const sceneBus = new EventTarget();
export const dispatchScene = {
  createPrimitive: (type: PrimitiveType) =>
    sceneBus.dispatchEvent(new CustomEvent<PrimitiveType>('createPrimitive', { detail: type })),
  createCamera: () =>
    sceneBus.dispatchEvent(new CustomEvent('createCamera')),
  createLight: (type: LightTypeEvent) =>
    sceneBus.dispatchEvent(new CustomEvent<LightTypeEvent>('createLight', { detail: type })),
  importGltf: () =>
    sceneBus.dispatchEvent(new CustomEvent('importGltf')),
  importSplat: () =>
    sceneBus.dispatchEvent(new CustomEvent('importSplat')),
  groupSelected: () =>
    sceneBus.dispatchEvent(new CustomEvent('groupSelected')),
  ungroupSelected: () =>
    sceneBus.dispatchEvent(new CustomEvent('ungroupSelected')),
  reparentNode: (nodeUuid: string, newParentUuid: string) =>
    sceneBus.dispatchEvent(new CustomEvent('reparentNode', { detail: { nodeUuid, newParentUuid } })),
  reorderNode: (nodeUuid: string, newParentUuid: string, insertIndex: number) =>
    sceneBus.dispatchEvent(new CustomEvent('reorderNode', { detail: { nodeUuid, newParentUuid, insertIndex } })),
  lookThroughCamera: (uuid: string | null) =>
    sceneBus.dispatchEvent(new CustomEvent('lookThroughCamera', { detail: uuid })),
  deleteSelected: () =>
    sceneBus.dispatchEvent(new CustomEvent('deleteSelected')),
  duplicateSelected: () =>
    sceneBus.dispatchEvent(new CustomEvent('duplicateSelected')),
};
