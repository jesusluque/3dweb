/**
 * Shared inter-component event buses.
 * Components dispatch here; other components (e.g. ViewportPanel) subscribe and
 * forward the commands to the engine without creating direct import cycles.
 */

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
