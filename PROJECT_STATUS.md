# 3D DCC Web Simulator — Project Status

> Last updated: after full Maya UI/UX overhaul, undo/redo engine, console logger, and popup-window bug fix.

---

## Milestones & Status

| Phase | Description | Status | Components |
| :--- | :--- | :--- | :--- |
| **MVP-1** | Viewport, Navigation, Minimal Scene | 🟢 **Complete** | `ViewportManager`, WebGPU + WebGL fallback, `OrbitControls`, grid, lights, resize |
| **MVP-2** | Outliner & Selection Sync | 🟢 **Complete** | `OutlinerPanel` (tree, type icons, filter, expand/collapse), `SelectionManager`, Zustand bridge, raycasting |
| **MVP-3** | Attribute Editor & Undo/Redo | 🟢 **Complete** | `AttributeEditorPanel` (Channel Box layout, double-click edit, Vec3 rows, collapsible sections), `CommandHistory`, `TransformCommand` |
| **MVP-4** | Dependency Graph Base | 🟢 **Complete** | `DGNode`, `Plug<T>` (typed, push-dirty, connect/disconnect), `DAGNode` hierarchy, `SceneGraph.getAllNodes()` |
| **MVP-5** | Viewport Manipulators | 🟢 **Complete** | `TransformControls` (W/E/R/T/Q, world/local toggle), drag-start TRS snapshot → `TransformCommand`, `setShadingMode`, `setGridVisible` |
| **MVP-6** | Cinematic Camera System | 🟡 **In Progress** | `CameraNode` (focalLength, filmAperture, nearClip/farClip, `FilmFit`), `GateMask` component — **missing:** live camera switching in viewport |
| **MVP-7** | JSON Interchange Format | 🟡 **In Progress** | `Serializer.serialize()` done (flat nodes, plug values, parent UUID) — **missing:** `deserialize()` / scene import |
| **MVP-8** | UI/UX Shell — Maya Theme | 🟢 **Complete** | `maya.css` (`--maya-*` props + flexlayout overrides), `MenuBar` (7 menus, shortcuts), `Toolbar` (transform tools, snap, display toggles, primitives, undo/redo), `StatusBar` (live selection, object count, undo depth, revision) |
| **MVP-9** | Console & Logging | 🟢 **Complete** | `ConsoleLogger` (info/warn/error/command, `onLogAdded`), `ConsolePanel` (color-coded, auto-scroll, clear) |
| **MVP-10** | Node Editor | 🔴 **Pending** | Placeholder tab only — graph canvas, node/wire rendering, `Plug` drag-connect UI |
| **MVP-11** | Render Settings | 🔴 **Pending** | Placeholder tab only — output resolution, background, export PNG |

---

## Pending / Known Issues

| # | Item | Priority | Notes |
| :--- | :--- | :--- | :--- |
| P1 | `Serializer.deserialize()` | High | `serialize()` works; scene import (JSON → SceneGraph rebuild) not implemented |
| P2 | Live camera switching | Medium | `CameraNode` math is complete; viewport always uses the default `PerspectiveCamera` |
| P3 | Plug cycle detection | Medium | `connectTo()` guards type mismatch only — **no upstream DFS traversal**; cyclic connections cause infinite dirty propagation |
| P4 | Primitive creation from toolbar | Medium | Create shelf buttons in `Toolbar.tsx` are scaffolded but not wired to `SceneGraph.addNode()` |
| P5 | Multi-select transform | Low | `SelectionManager` supports multi-select; `TransformCommand` only snapshots the single lead node |
| P6 | Undo for scene add/remove | Low | `CommandHistory` exists; Add/Remove node ops are not wrapped in commands yet |
| P7 | Node Editor canvas | Low | `PlaceholderPanel` in layout; needs graph canvas + Plug drag-wire UI |

---

## Architecture Overview

```
src/
├── core/
│   ├── EngineCore.ts                 # Root — SceneGraph, SelectionManager, CommandHistory, ConsoleLogger
│   ├── dag/
│   │   ├── DAGNode.ts                # Base node (name, uuid, parent/children, TRS plugs)
│   │   ├── MeshNode.ts               # Geometry + material plugs
│   │   ├── CameraNode.ts             # filmAperture, focalLength, filmFit, nearClip/farClip
│   │   └── SceneGraph.ts             # Node registry, addNode/removeNode, getAllNodes()
│   ├── dg/
│   │   ├── DGNode.ts                 # Plug container base
│   │   └── Plug.ts                   # PlugType enum, Plug<T>, connectTo/disconnectFrom, setDirty propagation
│   └── system/
│       ├── CommandHistory.ts         # execute/record/undo/redo, undoDepth/redoDepth getters
│       ├── ConsoleLogger.ts          # LogEntry (message/type/timestamp), onLogAdded callback
│       ├── SelectionManager.ts       # Selected node set, lead selection, onChanged callback
│       ├── Serializer.ts             # serialize() → JSON; deserialize() PENDING
│       └── commands/
│           └── TransformCommand.ts   # Old/new TRS snapshot per node, apply/undo via Plug.setValue()
├── viewport/
│   └── ViewportManager.ts           # Three.js WebGPU renderer, OrbitControls, TransformControls,
│                                    # raycasting, setShadingMode(), setGridVisible(), dispose()
├── styles/
│   └── maya.css                     # --maya-* custom properties, full flexlayout-react overrides
└── ui/
    ├── Layout.tsx                   # flexlayout-react shell (tabEnableFloat:false, tabSetEnableMaximize:true)
    ├── components/
    │   ├── MenuBar.tsx              # File/Edit/Create/Select/Display/Window/Help dropdowns
    │   ├── Toolbar.tsx              # Icon shelf (tools, snap, display, primitives, undo/redo)
    │   └── StatusBar.tsx            # Selection name, object count, undo/redo depth, revision, Three.js version
    └── panels/
        ├── ViewportPanel.tsx        # Canvas + overlay (shading cycle, grid/gate toggles, FPS, hotkey hints)
        ├── OutlinerPanel.tsx        # Hierarchy tree, type icons, filter input, Maya-accent selection
        ├── AttributeEditorPanel.tsx # Channel Box style — 2-col grid, double-click edit, Vec3 expand
        └── ConsolePanel.tsx         # LogEntry stream, color by type, auto-scroll, clear
```

---

## Technology Stack

| Library | Version | Role |
| :--- | :--- | :--- |
| React | 19 | UI runtime |
| TypeScript | 5 | Strict type safety |
| Vite | 7 | Dev server / build |
| Three.js | r183.2 | 3D renderer (WebGPU primary, WebGL fallback) |
| flexlayout-react | 0.8.18 | Dockable panel layout |
| Zustand | 5 | Global state bridge (core ↔ React) |
| lucide-react | 0.575.0 | SVG icon library |
| Vitest | latest | Unit tests — **3/3 passing** |

---

## Bug Prevention & Quality Assurance

### 1. Type Safety
- `npx tsc --noEmit` must exit 0 — currently **passing**.
- `src/core/**` is strict-mode: no `any`, no unused locals.

### 2. Unit Tests (Vitest)
- `CameraMath.test.ts` — validates FOV math with standard 35mm filmback across all four `FilmFit` modes.
- `DependencyGraph.test.ts` — validates `Plug<T>` dirty propagation and value caching.
- **Status:** 3/3 tests passing.

### 3. Cycle Detection in Dependency Graph ⚠️ PENDING
- `Plug.connectTo()` currently only guards against type mismatch.
- An upstream DFS traversal must be added before complex node graphs are wired; without it a cyclic connection causes infinite dirty propagation and a stack overflow.

### 4. Memory Management
- `ViewportManager.dispose()` is called in React `useEffect` cleanup — disposes renderer, geometries, and event listeners.
- `DAGNode` removal should call `.dispose()` on associated Three.js objects (partially enforced).

### 5. Undo Reversibility Contract
- Every `ICommand.execute()` must have a symmetrical `undo()`.
- `TransformCommand` stores old **and** new TRS snapshots per node.
- Add/Remove scene ops are not yet wrapped in commands — direct mutations are currently not undoable.

### 6. UI ↔ Engine Separation
- React panels never call `ViewportManager` methods directly on render; mutations go through stable refs (`vmRef`) or callbacks.
- `markSceneDirty()` is the only bridge from engine → React re-render; it does not trigger Three.js re-renders.

---

## Resolved Bugs

| Bug | Resolution |
| :--- | :--- |
| WebGPU init crash on first render | Deferred render loop until `renderer.init()` resolves |
| Gizmo reset on hotkey switch | Preserved `TransformControls` attachment between mode changes |
| Duplicate `public logger` field in `EngineCore.ts` | Bad heredoc sed left two declarations; removed with targeted `replace_string_in_file` |
| Popup window re-renders entire app | `tabEnableFloat: true` opened a real browser popup at the same URL, bootstrapping the full React app inside it; fixed by setting `tabEnableFloat: false` and using `tabSetEnableMaximize: true` (expand-in-place) |
| Old `AttributeEditorPanel` code appended below rewrite | First replacement only covered the top half; stale `FloatInput` + second export block remained; found and removed with targeted replacement |