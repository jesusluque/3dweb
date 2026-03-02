import { create } from 'zustand';
import { EngineCore } from '../../core/EngineCore';
import { DAGNode } from '../../core/dag/DAGNode';
import { ViewportManager } from '../../core/viewport/ViewportManager';
import { Serializer, SerializedScene } from '../../core/system/Serializer';

// ── Floating window state ───────────────────────────────────────────────
export interface FloatingWindowState {
  id: string;
  title: string;
  type: 'camera_view';
  payload?: Record<string, any>;
  rect: { x: number; y: number; w: number; h: number };
  minimised: boolean;
  zOrder: number;
}

// ── Viewport settings (shared between MenuBar, Toolbar, ViewportPanel) ──
export type ShadingModeType = 'smooth' | 'wireframe' | 'wireframe-on-shaded';

export interface ViewportSettings {
  showGrid: boolean;
  showLighting: boolean;
  shadingMode: ShadingModeType;
  snapGrid: boolean;
  snapVertex: boolean;
  transformSpace: 'world' | 'local';
  gizmoSize: number;
  showGateMask: boolean;
  renderRes: { w: number; h: number; label: string };
  bgColor: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;
  anaglyphEnabled: boolean;
  anaglyphIPD: number;            // Inter-Pupillary Distance in metres (default 0.064)
}

const DEFAULT_VIEWPORT_SETTINGS: ViewportSettings = {
  showGrid: true,
  showLighting: true,
  shadingMode: 'smooth',
  snapGrid: false,
  snapVertex: false,
  transformSpace: 'world',
  gizmoSize: 1,
  showGateMask: true,
  renderRes: { w: 1920, h: 1080, label: 'FHD 1920×1080' },
  bgColor: '#202020',
  outlineEnabled: true,
  outlineColor: '#d4aa30',
  outlineWidth: 2.5,
  anaglyphEnabled: false,
  anaglyphIPD: 0.064,
};

interface AppState {
  core: EngineCore | null;
  viewportManager: ViewportManager | null;
  selectedNodes: DAGNode[];
  leadSelection: DAGNode | null;
  sceneVersion: number;
  floatingWindows: FloatingWindowState[];
  /** When true, all camera windows are shown in a single mosaic grid overlay. */
  cameraMosaicMode: boolean;
  viewportSettings: ViewportSettings;
  /** File handle returned by showSaveFilePicker (if supported). */
  currentFileHandle: FileSystemFileHandle | null;
  /** Name displayed in title / shown to user. */
  currentFileName: string;
  
  initCore: () => void;
  syncSelection: () => void;
  markSceneDirty: () => void;
  setViewportManager: (vm: ViewportManager | null) => void;
  updateViewportSettings: (patch: Partial<ViewportSettings>) => void;
  /** Open a floating Camera View window for a specific CameraNode. */
  openCameraView: (cameraUuid: string, cameraName: string) => void;
  closeFloatingWindow: (id: string) => void;
  focusFloatingWindow: (id: string) => void;
  minimiseFloatingWindow: (id: string) => void;
  restoreFloatingWindow: (id: string) => void;
  /** Toggle the mosaic grid overlay for all camera views. */
  toggleCameraMosaic: () => void;
  /** Whether the Settings floating panel is open. */
  settingsPanelOpen: boolean;
  openSettingsPanel: () => void;
  closeSettingsPanel: () => void;
  /** Scene file operations */
  newScene: () => void;
  saveScene: () => Promise<void>;
  saveSceneAs: () => Promise<void>;
  openScene: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  core: null,
  viewportManager: null,
  selectedNodes: [],
  leadSelection: null,
  sceneVersion: 0,
  floatingWindows: [],
  cameraMosaicMode: false,
  settingsPanelOpen: false,
  viewportSettings: { ...DEFAULT_VIEWPORT_SETTINGS },
  currentFileHandle: null,
  currentFileName: 'untitled',

  initCore: () => {
    const core = new EngineCore();
    core.initDefaultScene();
    
    // Bind selection events using event array
    core.selectionManager.addListener(() => {
      get().syncSelection();
    });

    set({ core });
  },

  syncSelection: () => {
    const core = get().core;
    if (!core) return;
    set({
      selectedNodes: core.selectionManager.getSelection(),
      leadSelection: core.selectionManager.getLeadSelection()
    });
  },

  markSceneDirty: () => set((state) => ({ sceneVersion: state.sceneVersion + 1 })),
  setViewportManager: (vm) => set({ viewportManager: vm }),
  updateViewportSettings: (patch) => set(s => ({ viewportSettings: { ...s.viewportSettings, ...patch } })),

  // ── Floating windows ─────────────────────────────────────────────────
  openCameraView: (cameraUuid: string, cameraName: string) => {
    const wins = get().floatingWindows;

    // Always open a new window — camera views are stackable
    const offset = (wins.length % 6) * 30;
    const maxZ = wins.reduce((m, w) => Math.max(m, w.zOrder), 0);

    const newWin: FloatingWindowState = {
      id: `camview_${cameraUuid}_${Date.now()}`,
      title: `${cameraName}`,
      type: 'camera_view',
      payload: { cameraUuid },
      rect: { x: 120 + offset, y: 60 + offset, w: 480, h: 340 },
      minimised: false,
      zOrder: maxZ + 1,
    };
    set({ floatingWindows: [...wins, newWin] });
  },

  closeFloatingWindow: (id: string) => {
    set(s => ({ floatingWindows: s.floatingWindows.filter(w => w.id !== id) }));
  },

  focusFloatingWindow: (id: string) => {
    set(s => {
      const maxZ = s.floatingWindows.reduce((m, w) => Math.max(m, w.zOrder), 0);
      return {
        floatingWindows: s.floatingWindows.map(w =>
          w.id === id ? { ...w, zOrder: maxZ + 1 } : w,
        ),
      };
    });
  },

  minimiseFloatingWindow: (id: string) => {
    set(s => ({
      floatingWindows: s.floatingWindows.map(w =>
        w.id === id ? { ...w, minimised: true } : w,
      ),
    }));
  },

  restoreFloatingWindow: (id: string) => {
    set(s => {
      const maxZ = s.floatingWindows.reduce((m, w) => Math.max(m, w.zOrder), 0);
      return {
        floatingWindows: s.floatingWindows.map(w =>
          w.id === id ? { ...w, minimised: false, zOrder: maxZ + 1 } : w,
        ),
      };
    });
  },

  toggleCameraMosaic: () => {
    set(s => ({ cameraMosaicMode: !s.cameraMosaicMode }));
  },

  openSettingsPanel:  () => set({ settingsPanelOpen: true }),
  closeSettingsPanel: () => set({ settingsPanelOpen: false }),

  /* ════════════════════════════════════════════════════════════════════════
     Scene file operations
     ════════════════════════════════════════════════════════════════════ */

  newScene: () => {
    const { core, viewportManager: vm } = get();
    if (!core || !vm) return;

    // Clear viewport objects, then scene graph, then command history/selection
    vm.clearAllNodesFromView();
    core.sceneGraph.clear();
    core.selectionManager.clear();
    core.commandHistory.clear();

    // Reset viewport settings to defaults
    set({
      viewportSettings: { ...DEFAULT_VIEWPORT_SETTINGS },
      floatingWindows: [],
      currentFileHandle: null,
      currentFileName: 'untitled',
      sceneVersion: 0,
    });

    vm.setBackgroundColor(DEFAULT_VIEWPORT_SETTINGS.bgColor);
    vm.setGridVisible(DEFAULT_VIEWPORT_SETTINGS.showGrid);
    vm.setLightingEnabled(DEFAULT_VIEWPORT_SETTINGS.showLighting);
    vm.setShadingMode(DEFAULT_VIEWPORT_SETTINGS.shadingMode);

    core.logger.log('New scene created.', 'info');
    get().markSceneDirty();
  },

  saveScene: async () => {
    const { core, currentFileHandle } = get();
    if (!core) return;

    if (currentFileHandle) {
      // We already have a file handle — overwrite
      const json = _buildSceneJson(get);
      try {
        const w = await currentFileHandle.createWritable();
        await w.write(json);
        await w.close();
        core.logger.log(`Scene saved to "${currentFileHandle.name}"`, 'info');
      } catch (e: any) {
        core.logger.log(`Save failed: ${e.message}`, 'error');
      }
    } else {
      // No handle yet — delegate to Save As
      await get().saveSceneAs();
    }
  },

  saveSceneAs: async () => {
    const { core } = get();
    if (!core) return;
    const json = _buildSceneJson(get);

    // Try File System Access API (Chrome / Edge)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: get().currentFileName.endsWith('.json')
            ? get().currentFileName
            : `${get().currentFileName}.json`,
          types: [{
            description: '3DW Scene',
            accept: { 'application/json': ['.json'] },
          }],
        }) as FileSystemFileHandle;
        const w = await handle.createWritable();
        await w.write(json);
        await w.close();
        set({ currentFileHandle: handle, currentFileName: handle.name });
        core.logger.log(`Scene saved as "${handle.name}"`, 'info');
        return;
      } catch (e: any) {
        if (e.name === 'AbortError') return; // user cancelled
        core.logger.log(`Save failed: ${e.message}`, 'error');
        // Fall through to download fallback
      }
    }

    // Fallback: trigger a browser download
    _downloadJson(json, get().currentFileName.endsWith('.json')
      ? get().currentFileName
      : `${get().currentFileName}.json`);
    core.logger.log('Scene downloaded.', 'info');
  },

  openScene: async () => {
    const { core, viewportManager: vm } = get();
    if (!core || !vm) return;

    let json: string;
    let fileName = 'untitled.json';
    let fileHandle: FileSystemFileHandle | null = null;

    // Try File System Access API
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{
            description: '3DW Scene',
            accept: { 'application/json': ['.json'] },
          }],
          multiple: false,
        }) as FileSystemFileHandle[];
        fileHandle = handle;
        fileName = handle.name;
        const file = await handle.getFile();
        json = await file.text();
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        core.logger.log(`Open failed: ${e.message}`, 'error');
        return;
      }
    } else {
      // Fallback: use hidden <input type="file">
      const result = await _pickFileViaInput();
      if (!result) return;
      json = result.text;
      fileName = result.name;
    }

    // Parse
    let data: SerializedScene;
    try {
      data = Serializer.parse(json);
    } catch (e: any) {
      core.logger.log(`Invalid scene file: ${e.message}`, 'error');
      return;
    }

    // Clear current scene
    vm.clearAllNodesFromView();
    core.sceneGraph.clear();
    core.selectionManager.clear();
    core.commandHistory.clear();

    // Close floating windows
    set({ floatingWindows: [] });

    // Deserialize nodes
    const serializer = new Serializer(core);
    const nodes = serializer.deserialize(data);
    vm.loadNodes(nodes);

    // Restore viewport settings if present
    const vs: Partial<ViewportSettings> = data.viewportSettings
      ? data.viewportSettings as Partial<ViewportSettings>
      : {};
    const merged: ViewportSettings = { ...DEFAULT_VIEWPORT_SETTINGS, ...vs };
    set({
      viewportSettings: merged,
      currentFileHandle: fileHandle,
      currentFileName: fileName,
      sceneVersion: 0,
    });

    // Apply restored settings to viewport
    vm.setBackgroundColor(merged.bgColor);
    vm.setGridVisible(merged.showGrid);
    vm.setLightingEnabled(merged.showLighting);
    vm.setShadingMode(merged.shadingMode);
    vm.setRenderResolution(merged.renderRes.w, merged.renderRes.h);

    core.logger.log(`Opened "${fileName}" — ${nodes.length} nodes loaded.`, 'info');
    get().markSceneDirty();
  },
}));

/* ══════════════════════════════════════════════════════════════════════════
   Private helpers (outside the store)
   ══════════════════════════════════════════════════════════════════════ */

/** Build the scene JSON string from current state. */
function _buildSceneJson(get: () => AppState): string {
  const { core, viewportSettings } = get();
  if (!core) return '{}';
  const serializer = new Serializer(core);
  return serializer.serialize({ ...viewportSettings });
}

/** Trigger a browser download for the JSON string. */
function _downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/** Fallback file picker using <input type="file">. */
function _pickFileViaInput(): Promise<{ text: string; name: string } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const text = await file.text();
      resolve({ text, name: file.name });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
