# 3DW — Maya-inspired 3D DCC Web App

A browser-based 3D digital-content-creation (DCC) tool modelled after Autodesk Maya. Built with **React 19**, **TypeScript 5**, **Three.js r183** (WebGPU renderer with WebGL fallback), and **Vite 7**.

---

## Tech stack

| Layer | Library / version |
|---|---|
| UI framework | React 19 + TypeScript 5 |
| Build tool | Vite 7 |
| 3D renderer | Three.js r183 — WebGPU primary, WebGL fallback |
| State management | Zustand v5 |
| Layout | FlexLayout-React |
| Icons | Lucide-React |
| Test runner | Vitest 4 |

---

## Getting started

```bash
npm install
npm run dev        # start dev server (http://localhost:5173)
npm run build      # tsc + vite build → dist/
npm run preview    # preview the production build
npm run lint       # ESLint
```

> **Requirements:** Node 20+, a browser with WebGPU support (Chrome 113+, Edge 113+).  
> WebGL is used automatically when WebGPU is unavailable.

---

## Project layout

```
src/
├── App.tsx                        # Root component + global keyboard shortcuts
├── core/
│   ├── EngineCore.ts              # Aggregates SceneGraph, SelectionManager, CommandHistory, Logger
│   ├── dag/
│   │   ├── DAGNode.ts             # Base node (translate / rotate / scale / visibility plugs)
│   │   ├── SceneGraph.ts          # Tree of DAGNodes, root WorldNode
│   │   ├── MeshNode.ts            # Geometry + color plugs (box/sphere/cone/plane)
│   │   ├── CameraNode.ts          # Film-back, focal-length, near/far clip plugs
│   │   └── GroupNode.ts           # Grouping node
│   ├── dg/
│   │   ├── DGNode.ts              # Dependency-graph node base
│   │   └── Plug.ts                # Typed plug (value + dirty callbacks)
│   ├── system/
│   │   ├── CommandHistory.ts      # Undo / redo stack
│   │   ├── SelectionManager.ts    # Multi-select + lead-selection
│   │   ├── ConsoleLogger.ts       # Log levels: info / warn / error / command
│   │   ├── Serializer.ts          # JSON scene serialisation / deserialisation
│   │   └── commands/              # Undoable commands:
│   │       ├── CreateNodeCommand  #   create primitive / camera
│   │       ├── DeleteCommand      #   delete selected
│   │       ├── DuplicateCommand   #   duplicate selected
│   │       ├── TransformCommand   #   move / rotate / scale (multi-select)
│   │       ├── CreateGroupCommand #   group selected nodes
│   │       ├── UngroupCommand     #   flatten a group
│   │       ├── ReparentCommand    #   drag-reparent in Outliner
│   │       └── ReorderCommand     #   drag-reorder siblings
│   ├── viewport/
│   │   └── ViewportManager.ts     # Three.js scene, render loop, gizmos, outlines
│   └── tests/
│       ├── CameraMath.test.ts
│       └── DependencyGraph.test.ts
├── ui/
│   ├── Layout.tsx                 # FlexLayout panel arrangement
│   ├── buses.ts                   # Event buses (toolBus, viewportBus, sceneBus, dispatchScene)
│   ├── store/
│   │   └── useAppStore.ts         # Zustand store (core, VM, selection, viewport settings, scene I/O)
│   ├── components/
│   │   ├── MenuBar.tsx            # Full drop-down menu bar (File/Edit/Create/Select/Display/Window/Settings/Help)
│   │   ├── Toolbar.tsx            # Hotkey-mode toolbar (Q/W/E/R/T)
│   │   ├── FloatingWindow.tsx     # Draggable / resizable / minimisable window shell
│   │   ├── FloatingWindowManager  # Stacked floating windows (Camera Views)
│   │   ├── CameraMosaicOverlay    # Tiled camera view overlay
│   │   └── GateMask.tsx           # Film-gate crop mask overlay
│   ├── panels/
│   │   ├── ViewportPanel.tsx      # Main 3D view (camera picker, shading toggle, overlay toolbar)
│   │   ├── OutlinerPanel.tsx      # Scene hierarchy tree (drag-reparent, drag-reorder, visibility toggle)
│   │   ├── AttributeEditorPanel   # Numeric TRS inputs + node properties
│   │   ├── CameraViewPanel.tsx    # Floating camera look-through view
│   │   ├── SettingsPanelContent   # Preferences panel (viewport, effects, snapping, transform)
│   │   ├── ConsolePanel.tsx       # Live log output
│   │   └── StatusBar.tsx          # Bottom status / info bar
│   └── data/
│       ├── cameraPresets.ts       # Film-back presets (35 mm, APS-C, 4:3 …)
│       └── resolutionPresets.ts   # Render resolution presets (HD, 2K, 4K …)
└── styles/
    └── maya.css                   # CSS custom properties (Maya dark theme)
```

---

## Features

### Viewport
- **WebGPU renderer** (three/webgpu) with automatic WebGL fallback
- **Orbit controls** — LMB-drag to orbit, RMB to pan, scroll to zoom
- **Transform gizmo** — translate / rotate / scale with `W` / `E` / `R`; world / local space toggle with `T`; detach with `Q`
- **Multi-select transforms** — gizmo delta is propagated to all selected nodes simultaneously
- **Frame selected** — `F` to fit the camera to the current selection
- **Shading modes** — Smooth Shaded, Wireframe on Shaded, Wireframe
- **Grid** — toggleable ground-plane grid helper
- **Lighting toggle** — enable / disable scene lights
- **Film Gate Mask** — renders a crop overlay at the chosen render resolution
- **Camera picker** — switch the active camera from a drop-down overlay in the viewport
- **Selection outlines** — view-independent gold outlines on selected meshes (configurable colour, thickness, on/off)
- **Plugin render hook** — `renderOverride` slot on `ViewportManager` allows plugins to replace the default render call

### Scene graph
- DAG (directed acyclic graph) with `WorldRoot` → `DAGNode` hierarchy
- Node types: **MeshNode** (box / sphere / cone / plane), **CameraNode**, **GroupNode**
- Typed plugs with `onDirty` callbacks for live Two.js sync
- **Visibility plug** — toggle object visibility per-node (synced to Three.js `visible`)

### Commands & undo/redo
All destructive operations push to `CommandHistory`:
- Create primitive, Create camera
- Delete, Duplicate
- Transform (move / rotate / scale — multi-node)
- Group selected (`⌘G`), Ungroup (`⌘⇧G`)
- Reparent (Outliner drag-drop)
- Reorder siblings (Outliner drag-drop)

Undo: `⌘Z` / `Ctrl+Z` — Redo: `⌘⇧Z` / `Ctrl+⇧Z`

### Camera system
- Arbitrary number of **CameraNodes** in the scene
- Film-back plugs: focal length, horizontal / vertical aperture, near / far clip
- **Look-through** — any camera can be used as the active viewport camera
- **Camera frustum helper** auto-updates when film-back changes
- **Floating camera view windows** — independent look-through views per camera, draggable / resizable / minimisable
- **Camera Mosaic** — tile all camera views in a fullscreen overlay
- **Camera presets**: 35 mm, APS-C, 4/3, 1-inch, 16 mm …
- **Film Gate Mask** renders the crop box at the chosen render resolution

### Outliner
- Full scene-hierarchy tree with expand / collapse
- **Drag-to-reparent** nodes (with undo)
- **Drag-to-reorder** siblings (with undo)
- **Visibility toggle** per node
- Double-click to rename

### Attribute Editor
- Numeric inputs for Translate / Rotate / Scale (X Y Z)
- Camera-specific: focal length, film aperture, clip planes
- Color picker for mesh colour

### Scene I/O (File System Access API)
- **New Scene** `⌘N` — reset to default scene
- **Open Scene** `⌘O` — load `.3dw.json` from disk
- **Save Scene** `⌘S` — save in place (or "Save As" on first save)
- **Save Scene As** `⌘⇧S` — pick file name

Scene format is plain JSON (`formatVersion`, `metadata`, `nodes[]`, `viewportSettings`).

### Menu bar
| Menu | Key items |
|---|---|
| **File** | New, Open, Save, Save As |
| **Edit** | Undo, Redo, Duplicate, Delete |
| **Create** | Cube, Sphere, Cone, Plane, Camera, Group/Ungroup |
| **Select** | All, None, Invert |
| **Display** | Grid, Film Gate, Lighting, Shading Mode |
| **Window** | Camera Views, Camera Mosaic, floating-window list |
| **Settings** | Viewport, Snapping, Transform, Resolution, Settings panel |
| **Help** | About |

### Settings / Preferences panel
- **Viewport** — grid, lighting, shading mode, background colour (9 presets)
- **Effects** — selection outline toggle, colour picker, width slider
- **Snapping** — snap-to-grid, snap-to-vertex
- **Transform** — world / local space, gizmo size
- **Render Resolution** — HD 720p / 1080p, 2K, 4K, and custom presets

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `W` | Translate gizmo |
| `E` | Rotate gizmo |
| `R` | Scale gizmo |
| `Q` | Detach gizmo |
| `T` | Toggle world / local transform space |
| `F` | Frame selected object |
| `+` / `=` | Increase gizmo size |
| `-` | Decrease gizmo size |
| `Del` / `Backspace` | Delete selected |
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |
| `⌘D` | Duplicate selected |
| `⌘G` | Group selected |
| `⌘⇧G` | Ungroup |
| `⌘N` | New scene |
| `⌘O` | Open scene |
| `⌘S` | Save scene |
| `⌘⇧S` | Save scene as… |
| `⌘,` | Open Settings panel |

---

## Tests

```bash
npx vitest run
```

| File | Tests |
|---|---|
| `CameraMath.test.ts` | Focal-length ↔ FOV conversion, aspect ratio |
| `DependencyGraph.test.ts` | Plug dirty propagation |

