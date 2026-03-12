import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore, ShadingModeType } from '../store/useAppStore';
import { dispatchScene, dispatchViewport } from '../buses';
import { CameraNode } from '../../core/dag/CameraNode';
import { DAGNode } from '../../core/dag/DAGNode';
import { RESOLUTION_PRESET_GROUPS } from '../data/resolutionPresets';

/* ═══════════════════════════════════════════════════════════════════════════════
   Menu data types
   ═══════════════════════════════════════════════════════════════════════════ */
interface MenuItem {
  label: string;
  shortcut?: string;
  divider?: boolean;
  action?: () => void;
  disabled?: boolean;
  /** Check-mark rendered on the left side. */
  checked?: boolean;
  /** Colour swatch (CSS hex) rendered before the label. */
  swatch?: string;
  /** Submenu items – when present the row becomes a sub-trigger. */
  submenu?: MenuItem[];
}

interface Menu {
  label: string;
  items: MenuItem[];
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Shared styles
   ═══════════════════════════════════════════════════════════════════════════ */
const menuFont: React.CSSProperties = { fontFamily: '"Segoe UI", system-ui, sans-serif' };
const monoFont: React.CSSProperties = { fontFamily: '"Consolas","Menlo",monospace' };

/* ═══════════════════════════════════════════════════════════════════════════════
   Recursive sub-menu panel
   ═══════════════════════════════════════════════════════════════════════════ */
const SubMenu: React.FC<{
  items: MenuItem[];
  onClose: () => void;
  onAction: (fn: (() => void) | undefined) => void;
}> = ({ items, onClose, onAction }) => {
  const [hoveredSub, setHoveredSub] = useState<string | null>(null);

  return (
    <div style={{
      minWidth: 210,
      background: 'var(--maya-bg-dark)',
      border: '1px solid var(--maya-border-light)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
      padding: '3px 0',
      ...menuFont,
    }}>
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} style={{ height: 1, background: 'var(--maya-border-light)', margin: '3px 0' }} />;
        }
        const hasSub = item.submenu && item.submenu.length > 0;
        return (
          <div
            key={i}
            style={{ position: 'relative' }}
            onMouseEnter={() => { if (hasSub) setHoveredSub(item.label); }}
            onMouseLeave={() => { if (hasSub) setHoveredSub(null); }}
          >
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                if (!item.disabled && !hasSub && item.action) onAction(item.action);
              }}
              style={{
                padding: '5px 28px 5px 24px',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: item.disabled ? 'var(--maya-text-dim)' : 'var(--maya-text)',
                cursor: item.disabled ? 'default' : 'pointer',
                userSelect: 'none',
                position: 'relative',
              }}
              onMouseEnter={e => {
                if (!item.disabled) (e.currentTarget as HTMLElement).style.background = 'var(--maya-accent)';
              }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {/* Check mark */}
              {item.checked !== undefined && (
                <span style={{
                  position: 'absolute', left: 7, fontSize: 12,
                  color: item.checked ? 'var(--maya-accent)' : 'transparent',
                }}>✓</span>
              )}
              {/* Colour swatch */}
              {item.swatch && (
                <span style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: 2,
                  background: item.swatch, border: '1px solid rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }} />
              )}
              <span style={{ flex: 1 }}>{item.label}</span>
              {hasSub && <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 'auto' }}>▶</span>}
              {item.shortcut && (
                <span style={{ color: 'var(--maya-text-muted)', fontSize: 11, ...monoFont }}>{item.shortcut}</span>
              )}
            </div>
            {/* Nested sub-menu */}
            {hasSub && hoveredSub === item.label && (
              <div style={{ position: 'absolute', top: -3, left: '100%', zIndex: 10000 }}>
                <SubMenu items={item.submenu!} onClose={onClose} onAction={onAction} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════════
   Top-level dropdown
   ═══════════════════════════════════════════════════════════════════════════ */
const DropdownMenu: React.FC<{
  menu: Menu;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}> = ({ menu, isOpen, onOpen, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  const handleAction = useCallback((fn: (() => void) | undefined) => {
    if (fn) fn();
    onClose();
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onMouseDown={(e) => { e.preventDefault(); isOpen ? onClose() : onOpen(); }}
        style={{
          padding: '0 10px',
          height: 'var(--maya-menubar-h)',
          display: 'flex',
          alignItems: 'center',
          cursor: 'default',
          fontSize: 12,
          color: isOpen ? '#fff' : 'var(--maya-text)',
          background: isOpen ? 'var(--maya-accent)' : 'transparent',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          ...menuFont,
        }}
      >
        {menu.label}
      </div>
      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 9999 }}>
          <SubMenu items={menu.items} onClose={onClose} onAction={handleAction} />
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════════
   MenuBar
   ═══════════════════════════════════════════════════════════════════════════ */
export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const core              = useAppStore(s => s.core);
  const vs                = useAppStore(s => s.viewportSettings);
  const updateVS          = useAppStore(s => s.updateViewportSettings);
  const openCameraView    = useAppStore(s => s.openCameraView);
  const floatingWindows   = useAppStore(s => s.floatingWindows);
  const closeFloatingWindow  = useAppStore(s => s.closeFloatingWindow);
  const restoreFloatingWindow = useAppStore(s => s.restoreFloatingWindow);
  const focusFloatingWindow   = useAppStore(s => s.focusFloatingWindow);
  const cameraMosaicMode  = useAppStore(s => s.cameraMosaicMode);
  const toggleCameraMosaic = useAppStore(s => s.toggleCameraMosaic);
  const sceneVersion      = useAppStore(s => s.sceneVersion); void sceneVersion;
  const currentFileName   = useAppStore(s => s.currentFileName);
  const newScene          = useAppStore(s => s.newScene);
  const saveScene         = useAppStore(s => s.saveScene);
  const saveSceneAs       = useAppStore(s => s.saveSceneAs);
  const openSceneFn       = useAppStore(s => s.openScene);

  /* Gather scene cameras */
  const sceneCameras: CameraNode[] = [];
  if (core) {
    for (const n of core.sceneGraph.getAllNodes()) {
      if (n instanceof CameraNode) sceneCameras.push(n as CameraNode);
    }
  }

  /* ── Setting helpers ─────────────────────────────────────────────────── */
  const setShading = (m: ShadingModeType) => { updateVS({ shadingMode: m }); dispatchViewport.setShadingMode(m); };
  const toggleGrid = () => { const n = !vs.showGrid; updateVS({ showGrid: n }); dispatchViewport.setGridVisible(n); };
  const toggleLighting = () => { const n = !vs.showLighting; updateVS({ showLighting: n }); dispatchViewport.setLightingEnabled(n); };
  const toggleGate = () => { updateVS({ showGateMask: !vs.showGateMask }); };
  const toggleSnap = () => { const n = !vs.snapGrid; updateVS({ snapGrid: n }); dispatchViewport.setSnapGrid(n ? 0.5 : null); };
  const toggleSnapV = () => { const n = !vs.snapVertex; updateVS({ snapVertex: n }); dispatchViewport.setSnapVertex(n); };
  const setSpace = (s: 'world' | 'local') => { updateVS({ transformSpace: s }); dispatchViewport.setTransformSpace(s); };
  const setBgColor = (c: string) => { updateVS({ bgColor: c }); dispatchViewport.setBgColor(c); };
  const setRes = (w: number, h: number, label: string) => {
    updateVS({ renderRes: { w, h, label } });
    const vm = useAppStore.getState().viewportManager;
    vm?.setRenderResolution(w, h);
  };
  const gizmoUp   = () => { const s = Math.min(5, vs.gizmoSize + 0.15); updateVS({ gizmoSize: s }); dispatchViewport.setGizmoSize(s); };
  const gizmoDown = () => { const s = Math.max(0.1, vs.gizmoSize - 0.15); updateVS({ gizmoSize: s }); dispatchViewport.setGizmoSize(s); };

  /* ── Selection helpers ──────────────────────────────────── */
  const selectAllNodes = () => {
    if (!core) return;
    const all = Array.from(core.sceneGraph.nodes.values()).filter(
      n => n !== core.sceneGraph.root,
    );
    core.selectionManager.selectMany(all);
  };
  const invertSelection = () => {
    if (!core) return;
    const all = Array.from(core.sceneGraph.nodes.values()).filter(
      n => n !== core.sceneGraph.root,
    );
    const current = new Set(core.selectionManager.getSelection().map(n => n.uuid));
    core.selectionManager.selectMany(all.filter(n => !current.has(n.uuid)));
  };

  const selectHierarchy = () => {
    if (!core) return;
    const roots = core.selectionManager.getSelection();
    if (roots.length === 0) return;
    const collected: DAGNode[] = [];
    const visit = (n: DAGNode) => { collected.push(n); n.children.forEach(visit); };
    roots.forEach(visit);
    core.selectionManager.selectMany(collected);
  };

  /* ── Resolution presets as sub-menu ── */
  const resolutionSubmenu: MenuItem[] = RESOLUTION_PRESET_GROUPS.flatMap(g => [
    { label: g.group, divider: false, disabled: true } as MenuItem,
    ...g.presets.map(p => ({
      label: `${p.label}${p.note ? `  (${p.note})` : ''}`,
      checked: vs.renderRes.label === p.label,
      action: () => setRes(p.w, p.h, p.label),
    } as MenuItem)),
    { divider: true } as MenuItem,
  ]);
  if (resolutionSubmenu.length > 0) resolutionSubmenu.pop();

  /* ── Background colour swatches ── */
  const bgColors: { label: string; color: string }[] = [
    { label: 'Dark (default)',  color: '#202020' },
    { label: 'Charcoal',       color: '#2a2a2a' },
    { label: 'Slate',          color: '#3a3a3a' },
    { label: 'Mid-Grey',       color: '#555555' },
    { label: 'Light Grey',     color: '#808080' },
    { label: 'White',          color: '#f0f0f0' },
    { label: 'Dark Blue',      color: '#1a1a2e' },
    { label: 'Dark Green',     color: '#1a2e1a' },
    { label: 'Warm Brown',     color: '#2e2218' },
  ];

  /* ══════════════════════════════════════════════════════════════════════════
     Menu definitions
     ══════════════════════════════════════════════════════════════════════ */
  const menus: Menu[] = [
    /* ────── FILE ────── */
    {
      label: 'File',
      items: [
        { label: 'New Scene',       shortcut: '⌘N',   action: () => newScene() },
        { label: 'Open Scene…',     shortcut: '⌘O',   action: () => { openSceneFn(); } },
        { label: 'Save Scene',      shortcut: '⌘S',   action: () => { saveScene(); } },
        { label: 'Save Scene As…',  shortcut: '⌘⇧S',  action: () => { saveSceneAs(); } },
        { divider: true } as MenuItem,
        { label: 'Import GLB / GLTF…',                  action: () => dispatchScene.importGltf() },
        { label: 'Import Gaussian Splat (.splat / .ply / .spz / .ksplat / .sog / .rad)…', action: () => dispatchScene.importSplat() },
        { label: 'Import Point Cloud / Mesh (.ply)…',      action: () => dispatchScene.importPly() },
        { label: 'Export All…',     disabled: true, action: () => {} },
      ],
    },

    /* ────── EDIT ────── */
    {
      label: 'Edit',
      items: [
        { label: 'Undo',   shortcut: '⌘Z',   action: () => core?.commandHistory.undo() },
        { label: 'Redo',   shortcut: '⌘⇧Z',  action: () => core?.commandHistory.redo() },
        { divider: true } as MenuItem,
        { label: 'Cut',    shortcut: '⌘X',   disabled: true, action: () => {} },
        { label: 'Copy',   shortcut: '⌘C',   disabled: true, action: () => {} },
        { label: 'Paste',  shortcut: '⌘V',   disabled: true, action: () => {} },
        { divider: true } as MenuItem,
        { label: 'Select All',      shortcut: '⌘A', action: selectAllNodes },
        { label: 'Deselect All',    shortcut: '⌘D', action: () => core?.selectionManager.clear() },
        { label: 'Invert Selection',                 action: invertSelection },
        { divider: true } as MenuItem,
        { label: 'Duplicate',  shortcut: '⌘D',  action: () => dispatchScene.duplicateSelected() },
        { label: 'Delete',     shortcut: 'Del',  action: () => dispatchScene.deleteSelected() },
      ],
    },

    /* ────── CREATE ────── */
    {
      label: 'Create',
      items: [
        { label: 'Cube',   action: () => dispatchScene.createPrimitive('box') },
        { label: 'Sphere', action: () => dispatchScene.createPrimitive('sphere') },
        { label: 'Cone',   action: () => dispatchScene.createPrimitive('cone') },
        { label: 'Plane',  action: () => dispatchScene.createPrimitive('plane') },
        { divider: true } as MenuItem,
        { label: 'Camera', action: () => dispatchScene.createCamera() },
        {
          label: 'Light',
          submenu: [
            { label: 'Directional Light', action: () => dispatchScene.createLight('directional') },
            { label: 'Point Light',       action: () => dispatchScene.createLight('point') },
            { label: 'Ambient Light',     action: () => dispatchScene.createLight('ambient') },
            { label: 'Spot Light',        action: () => dispatchScene.createLight('spot') },
          ],
        },
        { divider: true } as MenuItem,
        { label: 'Group Selected', shortcut: '⌘G',  action: () => dispatchScene.groupSelected() },
        { label: 'Ungroup',        shortcut: '⌘⇧G', action: () => dispatchScene.ungroupSelected() },
      ],
    },

    /* ────── SELECT ────── */
    {
      label: 'Select',
      items: [
        { label: 'All',       shortcut: '⌘A', action: selectAllNodes },
        { label: 'None',      shortcut: '⌘D', action: () => core?.selectionManager.clear() },
        { label: 'Invert',                     action: invertSelection },
        { divider: true } as MenuItem,
        { label: 'Hierarchy', action: selectHierarchy },
      ],
    },

    /* ────── DISPLAY ────── */
    {
      label: 'Display',
      items: [
        { label: 'Grid',           checked: vs.showGrid,     action: toggleGrid },
        { label: 'Film Gate Mask', checked: vs.showGateMask,  action: toggleGate },
        { label: 'Lighting',       checked: vs.showLighting,  action: toggleLighting },
        { divider: true } as MenuItem,
        {
          label: 'Shading Mode',
          submenu: [
            { label: 'Smooth Shaded',      checked: vs.shadingMode === 'smooth',              action: () => setShading('smooth') },
            { label: 'Wireframe on Shaded', checked: vs.shadingMode === 'wireframe-on-shaded', action: () => setShading('wireframe-on-shaded') },
            { label: 'Wireframe',           checked: vs.shadingMode === 'wireframe',            action: () => setShading('wireframe') },
          ],
        },
      ],
    },

    /* ────── WINDOW ────── */
    {
      label: 'Window',
      items: [
        { label: 'Outliner',          action: () => {} },
        { label: 'Attribute Editor',  action: () => {} },
        { label: 'Script Editor',     action: () => {} },
        { divider: true } as MenuItem,
        ...(sceneCameras.length > 0 ? [{
          label: 'Camera Views',
          submenu: sceneCameras.map(cam => ({
            label: cam.name,
            action: () => openCameraView(cam.uuid, cam.name),
          })),
        } as MenuItem, { divider: true } as MenuItem] : []),
        ...(floatingWindows.length > 0 ? [
          ...floatingWindows.map(w => ({
            label: w.minimised ? `(min) ${w.title}` : w.title,
            action: () => { if (w.minimised) restoreFloatingWindow(w.id); focusFloatingWindow(w.id); },
          } as MenuItem)),
          { divider: true } as MenuItem,
          { label: cameraMosaicMode ? '✓ Camera Mosaic' : 'Camera Mosaic', action: () => toggleCameraMosaic() } as MenuItem,
          { label: 'Close All Camera Views', action: () => { floatingWindows.forEach(w => closeFloatingWindow(w.id)); } } as MenuItem,
        ] : []),
      ],
    },

    /* ────── SETTINGS ────── */
    {
      label: 'Settings',
      items: [
        { label: 'Settings…', shortcut: '⌘,', action: () => useAppStore.getState().openSettingsPanel() },
        { divider: true } as MenuItem,
        {
          label: 'Viewport',
          submenu: [
            { label: 'Grid',           checked: vs.showGrid,     action: toggleGrid },
            { label: 'Lighting',       checked: vs.showLighting, action: toggleLighting },
            { label: 'Film Gate Mask', checked: vs.showGateMask,  action: toggleGate },
            { divider: true } as MenuItem,
            {
              label: 'Shading Mode',
              submenu: [
                { label: 'Smooth Shaded',      checked: vs.shadingMode === 'smooth',              action: () => setShading('smooth') },
                { label: 'Wireframe on Shaded', checked: vs.shadingMode === 'wireframe-on-shaded', action: () => setShading('wireframe-on-shaded') },
                { label: 'Wireframe',           checked: vs.shadingMode === 'wireframe',            action: () => setShading('wireframe') },
              ],
            },
            { divider: true } as MenuItem,
            {
              label: 'Background Color',
              submenu: bgColors.map(c => ({
                label: c.label,
                swatch: c.color,
                checked: vs.bgColor === c.color,
                action: () => setBgColor(c.color),
              })),
            },
          ],
        },
        { divider: true } as MenuItem,
        {
          label: 'Snapping',
          submenu: [
            { label: 'Snap to Grid',   checked: vs.snapGrid,   action: toggleSnap },
            { label: 'Snap to Vertex', checked: vs.snapVertex, action: toggleSnapV },
          ],
        },
        {
          label: 'Transform',
          submenu: [
            { label: 'World Space', checked: vs.transformSpace === 'world', action: () => setSpace('world') },
            { label: 'Local Space', checked: vs.transformSpace === 'local', action: () => setSpace('local') },
            { divider: true } as MenuItem,
            { label: 'Increase Gizmo Size', shortcut: '+', action: gizmoUp },
            { label: 'Decrease Gizmo Size', shortcut: '−', action: gizmoDown },
          ],
        },
        { divider: true } as MenuItem,
        {
          label: `Resolution  (${vs.renderRes.label})`,
          submenu: resolutionSubmenu,
        },
      ],
    },

    /* ────── HELP ────── */
    {
      label: 'Help',
      items: [
        { label: 'About…', action: () => alert('3D Web Simulator — Maya-inspired\nBuilt with Three.js + React') },
      ],
    },
  ];

  return (
    <div style={{
      height: 'var(--maya-menubar-h)',
      background: 'var(--maya-bg-dark)',
      borderBottom: '1px solid var(--maya-border)',
      display: 'flex',
      alignItems: 'stretch',
      flexShrink: 0,
      zIndex: 100,
      userSelect: 'none',
    }}>
      {/* App logo mark */}
      <div style={{
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        borderRight: '1px solid var(--maya-border)',
        marginRight: '4px',
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--maya-accent)',
        letterSpacing: '0.5px',
        ...menuFont,
      }}>
        3DW
      </div>

      {menus.map((menu) => (
        <DropdownMenu
          key={menu.label}
          menu={menu}
          isOpen={openMenu === menu.label}
          onOpen={() => setOpenMenu(menu.label)}
          onClose={() => setOpenMenu(null)}
        />
      ))}

      {/* Current file name indicator (right-aligned) */}
      <div style={{
        marginLeft: 'auto',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        fontSize: 11,
        color: 'var(--maya-text-dim)',
        ...menuFont,
      }}>
        {currentFileName}
      </div>
    </div>
  );
};
