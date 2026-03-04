import * as THREE from 'three';
// @ts-ignore
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
// @ts-ignore
import { texture as tslTexture, vec4, float } from 'three/tsl';
import * as SPLAT from 'gsplat';
import { SplatMesh, type SplatOpts, DEFAULT_SPLAT_OPTS } from './SplatMesh';
import { EngineCore } from '../EngineCore';
import { CameraNode } from '../dag/CameraNode';
import { DAGNode } from '../dag/DAGNode';
import { Vector3Data } from '../dag/DAGNode';
import { MeshNode } from '../dag/MeshNode';
import { LightNode, LightType } from '../dag/LightNode';
import { GltfNode } from '../dag/GltfNode';
import { SplatNode } from '../dag/SplatNode';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

/** Walk up the parent chain to check if `obj` is a descendant of `ancestor`. */
function isDescendantOf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let cur = obj.parent;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}
import { TransformCommand } from '../system/commands/TransformCommand';
import { CropVolumeCommand } from '../system/commands/CropVolumeCommand';
import { CropGizmo } from './CropGizmo';
import { CreateNodeCommand } from '../system/commands/CreateNodeCommand';
import { CreateGroupCommand } from '../system/commands/CreateGroupCommand';
import { UngroupCommand } from '../system/commands/UngroupCommand';
import { DuplicateCommand } from '../system/commands/DuplicateCommand';
import { DeleteCommand } from '../system/commands/DeleteCommand';
import { GroupNode } from '../dag/GroupNode';

/** Maximum cosmetic far distance for the camera frustum helper — keeps the
 *  frustum a reasonable size regardless of the camera's actual far-clip value. */
const VISUAL_FRUSTUM_FAR = 3.0;

export class ViewportManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer | any;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private nodeMap: Map<string, THREE.Object3D> = new Map();
  private core: EngineCore;
  private controls: OrbitControls;
  private transformControls: TransformControls;
  
  private isRendering = false;
  private isTransforming = false;
  private gridHelper: THREE.GridHelper | null = null;
  private lights: THREE.Light[] = [];
  /** Map of LightNode UUID → { Three.js light, optional scene-space helper }. */
  private lightHelperMap: Map<string, { light: THREE.Light; helper: THREE.Object3D | null }> = new Map();
  /** UUID of the CameraNode currently being looked through, or null = default persp cam. */
  private activeCamUuid: string | null = null;
  private lightingEnabled = true;
  /** Whether editor gizmos/helpers are currently visible (toggleable via G key). */
  private _editorsVisible = true;
  private currentShadingMode: 'smooth' | 'wireframe' | 'wireframe-on-shaded' = 'smooth';
  private wireframeOverlays: Map<string, THREE.LineSegments> = new Map();
  /** Selection outline meshes keyed by the selected MeshNode UUID. */
  private outlineMap: Map<string, THREE.Mesh> = new Map();
  /** Bounding-sphere radius for each outline mesh, used for view-independent scaling. */
  private outlineBoundingRadius: Map<string, number> = new Map();
  /** Reusable vector to avoid per-frame allocations in the render loop. */
  private _outlineTmpPos = new THREE.Vector3();
  // Outline effect settings (mutable, exposed via public setters)
  private outlineEnabled = true;
  private outlineColorHex = '#d4aa30';   // maya-gold
  private outlinePixels   = 2.5;         // desired screen-space thickness in px
  // ── Anaglyph 3D stereo effect ────────────────────────────────────────────
  private _anaglyphEnabled = false;
  private _stereo:     THREE.StereoCamera | null = null;
  private _leftRT:     THREE.WebGLRenderTarget | null = null;
  private _rightRT:    THREE.WebGLRenderTarget | null = null;
  private _quadScene:  THREE.Scene | null = null;
  private _quadCamera: THREE.OrthographicCamera | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _compMat:    any = null;  // MeshBasicNodeMaterial (three/webgpu)
  /** Set when the RT dimensions are stale (e.g. after a resize) so the rebuild
   *  is deferred to the start of the NEXT renderLoop tick, never mid-frame. */
  private _anaglyphRTDirty = false;
  /** True once the compositor shader pipeline has been compiled and the
   *  composite pass is safe to run.  Set to false whenever resources are
   *  rebuilt; set to true after renderer.compileAsync() resolves so the
   *  first composite frame is never fed an uncompiled WebGPU pipeline. */
  private _anaglyphReady = false;
  /** requestAnimationFrame handle — kept so dispose() can cancel a pending tick. */
  private _rafHandle = 0;
  /** The active renderer back-end type for this viewport instance. */
  private _rendererType: 'webgpu' | 'webgl' = 'webgpu';
  /** Expose renderer type so consumers can inspect it. */
  public get rendererType(): 'webgpu' | 'webgl' { return this._rendererType; }
  /** ResizeObserver watches the container so we resize exactly when the DOM
   *  element changes size (after flexlayout reflow), not on window.resize. */
  private _resizeObserver: ResizeObserver | null = null;

  // ── Native Gaussian Splatting (SplatMesh – shares three.js depth buffer) ────
  /** Maps SplatNode UUID → the SplatMesh currently in the three.js scene. */
  private _splatMeshMap: Map<string, SplatMesh> = new Map();
  /** Maps SplatNode UUID → its Box3Helper crop visualisation. */
  private _splatCropHelperMap: Map<string, THREE.Box3Helper> = new Map();
  /** Current splat optimisation options applied to every SplatMesh. */
  private _splatOpts: SplatOpts = { ...DEFAULT_SPLAT_OPTS };

  // ── Interactive Crop Gizmo (T key when SplatNode is selected) ─────────────
  private _cropGizmo:         CropGizmo  | null = null;
  private _cropGizmoNode:     SplatNode  | null = null;
  private _cropGizmoActive  = false;

  /** Per-CameraNode helper state for frustum display. */
  private cameraHelperMap: Map<string, { helperCam: THREE.PerspectiveCamera; helper: THREE.CameraHelper }> = new Map();

  // ── HDRI environment lighting ─────────────────────────────────────────────
  /** The PMREM-processed environment map currently applied to the scene. */
  private _hdriEnvMap: THREE.Texture | null = null;
  /** Whether the HDRI environment is currently contributing to scene lighting. */
  private _hdriEnabled = false;
  /** Intensity multiplier for the HDRI environment light (scene.environmentIntensity). */
  private _hdriIntensity = 1.0;
  /** Intensity multiplier for the HDRI background sphere (scene.backgroundIntensity). */
  private _hdriBackgroundIntensity = 1.0;
  /** Y-axis rotation of the HDRI environment in degrees. */
  private _hdriRotation = 0;
  /** When true the HDRI is also used as the visible scene background. */
  private _hdriAsBackground = false;
  /** Original solid-colour background kept so we can restore it when HDRI background is toggled off. */
  private _savedBgColor: THREE.Color = new THREE.Color(0x202020);

  // Per-drag TRS snapshots for ALL selected nodes (multi-select transform support)
  private dragSnapshots: Array<{
    node: DAGNode;
    oldTranslate: Vector3Data; oldRotate: Vector3Data; oldScale: Vector3Data;
    initPosition: THREE.Vector3; initEuler: THREE.Euler; initScale: THREE.Vector3;
  }> = [];

  /** Called whenever nodes are created, deleted, grouped, or reparented.
   *  Set by ViewportPanel to trigger a Zustand sceneVersion bump so the
   *  Outliner re-renders even when the action comes from a global hotkey. */
  public onSceneChanged?: () => void;
  /** Fired when the crop-gizmo mode is toggled on or off (for UI indicators). */
  public onCropModeChanged?: (active: boolean) => void;

  /** Pixel resolution used for the gate mask and CameraViewPanel crop. */
  private renderResolution: { w: number; h: number } = { w: 1920, h: 1080 };

  /**
   * Listeners called AFTER each frame render with the renderer's canvas.
   * CameraViewPanel subscribes here to copy the live frame at camera aspect.
   */
  private frameListeners: Set<(src: HTMLCanvasElement) => void> = new Set();
  public addFrameListener(cb: (src: HTMLCanvasElement) => void): void    { this.frameListeners.add(cb);    }
  public removeFrameListener(cb: (src: HTMLCanvasElement) => void): void { this.frameListeners.delete(cb); }

  /**
   * Per-camera frame listeners.  Each entry is keyed by the CameraNode UUID.
   * After the main render the loop does an extra render pass per camera that
   * has listeners, configuring the render camera from the CameraNode filmback.
   */
  private cameraFrameListeners: Map<string, Set<(src: HTMLCanvasElement) => void>> = new Map();
  public addCameraFrameListener(cameraUuid: string, cb: (src: HTMLCanvasElement) => void): void {
    let s = this.cameraFrameListeners.get(cameraUuid);
    if (!s) { s = new Set(); this.cameraFrameListeners.set(cameraUuid, s); }
    s.add(cb);
  }
  public removeCameraFrameListener(cameraUuid: string, cb: (src: HTMLCanvasElement) => void): void {
    const s = this.cameraFrameListeners.get(cameraUuid);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) this.cameraFrameListeners.delete(cameraUuid);
  }
  public getRendererCanvas(): HTMLCanvasElement { return this.renderer.domElement as HTMLCanvasElement; }
  public setRenderResolution(w: number, h: number): void {
    this.renderResolution = { w, h };
    // Re-lock the camera aspect to the new render ratio
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Refresh all camera helpers so the frustum reflects the new render aspect
    for (const [uuid, _] of this.cameraHelperMap) {
      const camNode = this.core.sceneGraph.getNodeById(uuid);
      if (camNode instanceof CameraNode) this.refreshCameraHelper(camNode);
    }
  }
  public getRenderResolution(): { w: number; h: number } { return this.renderResolution; }

  constructor(container: HTMLElement, core: EngineCore, options?: { rendererType?: 'webgpu' | 'webgl' }) {
    this.container = container;
    this.core = core;
    this._rendererType = options?.rendererType ?? 'webgpu';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202020);

    // Initial camera (will be overridden by DAG camera later)
    this.camera = new THREE.PerspectiveCamera(50, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    // Setup renderer based on selected back-end type
    if (this._rendererType === 'webgl') {
      // Force classic WebGL renderer — maximum hardware compatibility, no TSL/WebGPU features
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      console.log('Classic WebGL Renderer initialized');
    } else {
      // WebGPU mode (with automatic WebGL2 fallback inside WebGPURenderer)
      try {
        this.renderer = new WebGPURenderer({ antialias: true });
        console.log('WebGPU Renderer initialized');
      } catch (e) {
        console.warn('WebGPU not supported, falling back to WebGLRenderer');
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
      }
    }
    
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // Grid
    this.gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
    this.scene.add(this.gridHelper);
    // Default lights are created as LightNode DAG objects so they
    // appear in the outliner.  They are added after syncInit().

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    
    // Transform controls for Gizmos (W/E/R)
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      // Disable orbit controls while dragging gizmo
      this.controls.enabled = !event.value;

      if (event.value) {
        // ── Drag START: snapshot ALL selected nodes ──────────────────────────
        this.isTransforming = true;
        this.dragSnapshots = [];
        const allSelected = this.core.selectionManager.getSelection();
        for (const node of allSelected) {
          const obj3d = this.nodeMap.get(node.uuid);
          if (obj3d) {
            this.dragSnapshots.push({
              node,
              oldTranslate: { ...node.translate.getValue() },
              oldRotate:    { ...node.rotate.getValue() },
              oldScale:     { ...node.scale.getValue() },
              initPosition: obj3d.position.clone(),
              initEuler:    obj3d.rotation.clone(),
              initScale:    obj3d.scale.clone(),
            });
          }
        }
      } else {
        // ── Drag END: commit TransformCommand for all moved nodes ────────────
        this.isTransforming = false;
        if (this.dragSnapshots.length > 0) {
          const entries: import('../system/commands/TransformCommand').NodeTransformEntry[] = [];
          for (const snap of this.dragSnapshots) {
            const newT = snap.node.translate.getValue();
            const newR = snap.node.rotate.getValue();
            const newS = snap.node.scale.getValue();
            const moved =
              Math.abs(newT.x - snap.oldTranslate.x) > 0.0001 ||
              Math.abs(newT.y - snap.oldTranslate.y) > 0.0001 ||
              Math.abs(newT.z - snap.oldTranslate.z) > 0.0001 ||
              Math.abs(newR.x - snap.oldRotate.x) > 0.0001 ||
              Math.abs(newR.y - snap.oldRotate.y) > 0.0001 ||
              Math.abs(newR.z - snap.oldRotate.z) > 0.0001 ||
              Math.abs(newS.x - snap.oldScale.x) > 0.0001 ||
              Math.abs(newS.y - snap.oldScale.y) > 0.0001 ||
              Math.abs(newS.z - snap.oldScale.z) > 0.0001;
            if (moved) entries.push({
              node: snap.node,
              oldTranslate: snap.oldTranslate, newTranslate: newT,
              oldRotate:    snap.oldRotate,    newRotate:    newR,
              oldScale:     snap.oldScale,     newScale:     newS,
            });
          }
          if (entries.length > 0) {
            const cmd = new TransformCommand(entries);
            this.core.commandHistory.record(cmd);
            this.core.logger.log(cmd.description!, 'command');
          }
          this.dragSnapshots = [];
        }
      }
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.isTransforming) return;
      const leadObj = this.transformControls.object;
      if (!leadObj) return;

      // Push lead node TRS → DAG
      for (const [uuid, nodeObject] of this.nodeMap.entries()) {
        if (nodeObject !== leadObj) continue;
        const node = this.core.sceneGraph.getNodeById(uuid);
        if (node) {
          node.translate.setValue({ x: leadObj.position.x, y: leadObj.position.y, z: leadObj.position.z });
          node.rotate.setValue({
            x: THREE.MathUtils.radToDeg(leadObj.rotation.x),
            y: THREE.MathUtils.radToDeg(leadObj.rotation.y),
            z: THREE.MathUtils.radToDeg(leadObj.rotation.z),
          });
          node.scale.setValue({ x: leadObj.scale.x, y: leadObj.scale.y, z: leadObj.scale.z });
        }
        break;
      }

      // Translate mode: propagate same delta to all other selected nodes
      if (this.transformControls.getMode() === 'translate') {
        const leadSnap = this.dragSnapshots.find(s => this.nodeMap.get(s.node.uuid) === leadObj);
        if (leadSnap) {
          const dx = leadObj.position.x - leadSnap.initPosition.x;
          const dy = leadObj.position.y - leadSnap.initPosition.y;
          const dz = leadObj.position.z - leadSnap.initPosition.z;
          for (const snap of this.dragSnapshots) {
            if (snap.node.uuid === leadSnap.node.uuid) continue;
            const otherObj = this.nodeMap.get(snap.node.uuid);
            if (otherObj) {
              otherObj.position.set(
                snap.initPosition.x + dx,
                snap.initPosition.y + dy,
                snap.initPosition.z + dz,
              );
              snap.node.translate.setValue({ x: otherObj.position.x, y: otherObj.position.y, z: otherObj.position.z });
            }
          }
        }
      }
    });

    this.scene.add(this.transformControls.getHelper());

    // ⌘G / Ctrl+G must be caught at window level so the browser's
    // "Find Next" shortcut is suppressed before reaching the container.
    window.addEventListener('keydown', this.onWindowKeyDown);
    // Watch the container element for size changes (fires after flexlayout reflow,
    // unlike window 'resize' which fires before panels have been laid out).
    this._resizeObserver = new ResizeObserver(() => this.onResize());
    this._resizeObserver.observe(this.container);
    this.container.tabIndex = 0;
    this.container.addEventListener('keydown', this.onKeyDown);
    
    // Clicking empty space selection logic
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMoveCrop);
    this.renderer.domElement.addEventListener('pointerup',   this.onPointerUpCrop);

    this.onResize(); // trigger initial resize to fix aspect

    // Sync DAG
    this.syncInit();
    // Populate default lights only when opening a completely empty scene
    // (syncInit may have already loaded saved lights from a prior serialise).
    const hasAnyLight = Array.from(this.core.sceneGraph.nodes.values()).some(
      n => n instanceof LightNode,
    );
    if (!hasAnyLight) this.createDefaultLights();

    // Bind Core selection events to view
    this.core.selectionManager.addListener(() => this.syncSelection());

    // Defer the start of the render loop until the renderer backend is ready
    if (this._rendererType !== 'webgl' && this.renderer.init) {
      this.renderer.init().then(() => {
        this.core.logger.log('WebGPU renderer initialized successfully.', 'info');
        this.isRendering = true;
        this.renderLoop();
      });
    } else {
      this.core.logger.log(
        this._rendererType === 'webgl'
          ? 'Classic WebGL renderer initialized.'
          : 'WebGL renderer initialized (WebGPU fallback).',
        this._rendererType === 'webgl' ? 'info' : 'warn',
      );
      this.isRendering = true;
      this.renderLoop();
    }
  }

  /** Build a Raycaster from a PointerEvent's canvas position. */
  private _buildRaycaster(e: PointerEvent): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
    const y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(x, y), this.camera);
    return rc;
  }

  /** Pointer-move handler: drives hover highlight + active handle drag. */
  private onPointerMoveCrop = (e: PointerEvent) => {
    if (!this._cropGizmoActive || !this._cropGizmo) return;
    const rc = this._buildRaycaster(e);
    if (this._cropGizmo.isDragging) {
      const result = this._cropGizmo.moveDrag(rc);
      if (result && this._cropGizmoNode) {
        // Push to SplatMesh directly for live preview (skips plug overhead)
        const mesh   = this._splatMeshMap.get(this._cropGizmoNode.uuid);
        const helper = this._splatCropHelperMap.get(this._cropGizmoNode.uuid);
        if (mesh) mesh.setCropBox(result.min, result.max);
        if (helper) { helper.box.set(result.min, result.max); helper.visible = true; }
      }
    } else {
      this._cropGizmo.onHover(rc);
    }
  };

  /** Pointer-up handler: commits drag to undo stack. */
  private onPointerUpCrop = (e: PointerEvent) => {
    if (!this._cropGizmoActive || !this._cropGizmo || !this._cropGizmo.isDragging) return;
    const result = this._cropGizmo.endDrag();
    this.controls.enabled = true;
    this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (result && this._cropGizmoNode) {
      const node    = this._cropGizmoNode;
      const changed = !result.startMin.equals(result.endMin) || !result.startMax.equals(result.endMax);
      // Commit plug values (fires applyCrop once per plug via onDirty)
      node.cropMinX.setValue(result.endMin.x);
      node.cropMinY.setValue(result.endMin.y);
      node.cropMinZ.setValue(result.endMin.z);
      node.cropMaxX.setValue(result.endMax.x);
      node.cropMaxY.setValue(result.endMax.y);
      node.cropMaxZ.setValue(result.endMax.z);
      if (changed) {
        const cmd = new CropVolumeCommand(node, result.startMin, result.startMax, result.endMin, result.endMax);
        this.core.commandHistory.record(cmd);
        this.core.logger.log(cmd.description!, 'command');
      }
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    // Focus the container so hotkeys work
    this.container.focus();

    // Prevent raycasting behind the gizmos themselves or the orbit controls
    if (this.transformControls.dragging) return;
    
    // We only raycast on primary mouse button (left)
    if (e.button !== 0) return;

    // ── Crop gizmo: check handles before selection ───────────────────────────
    if (this._cropGizmoActive && this._cropGizmo) {
      const rc  = this._buildRaycaster(e);
      const hit = this._cropGizmo.hitTest(rc);
      if (hit) {
        this._cropGizmo.startDrag(hit.handle, hit.worldPoint, this.camera);
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        return; // handle consumed the event
      }
      // Gizmo active but no handle hit — allow orbit, don't change selection
      return;
    }

    // Quick raycast
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

    // Filter out helper lines and grid explicitly
    const targets = Array.from(this.nodeMap.values()).filter(obj => obj.type !== 'GridHelper' && obj.type !== 'TransformControls');
    const intersects = raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
      let hitObj = intersects[0].object;
      
      // Traverse up in case we hit geometry inside a group
      while (hitObj.parent && hitObj.parent.type !== 'Scene' && !Array.from(this.nodeMap.values()).includes(hitObj)) {
        hitObj = hitObj.parent;
      }

      for (const [uuid, obj] of this.nodeMap.entries()) {
        if (obj === hitObj) {
          const node = this.core.sceneGraph.getNodeById(uuid);
          if (node) {
            this.core.selectionManager.select(node, e.shiftKey);
          }
          return;
        }
      }
    } else {
      // Clicked empty space
      this.core.selectionManager.clear();
    }
  };

  /** Window-level handler — intercepts hotkeys regardless of which panel has focus. */
  private onWindowKeyDown = (e: KeyboardEvent) => {
    // Skip when the user is typing in an input / textarea
    const tag = (e.target as HTMLElement)?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

    // ⌘G / Ctrl+G — group / ungroup
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) {
        this.ungroupSelected();
      } else {
        this.createGroup();
      }
      return;
    }

    // ⌘D / Ctrl+D — duplicate selected
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }

    // Delete / Backspace — delete selected (skip when typing in inputs)
    if (!isInput && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      this.deleteSelected();
      return;
    }

    // W / E / R / Q / T / F — gizmo modes + frame selected (skip when typing in inputs)
    if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!this.transformControls) return;
      switch (e.key.toLowerCase()) {
        case 'w': this.setTransformMode('translate'); break;
        case 'e': this.setTransformMode('rotate');    break;
        case 'r': this.setTransformMode('scale');     break;
        case 't': {
          const _lead = this.core.selectionManager.getLeadSelection();
          if (_lead instanceof SplatNode) {
            this.toggleCropGizmo(_lead);
          } else {
            this.transformControls.setSpace(this.transformControls.space === 'local' ? 'world' : 'local');
          }
          break;
        }
        case 'escape':
          if (this._cropGizmoActive) { this.disableCropGizmo(); }
          break;
        case 'q': this.setTransformMode('select'); break;
        case 'f': this.frameSelected(); break;
        case '+': case '=': this.setGizmoSize(this.getGizmoSize() + 0.15); break;
        case '-': case '_': this.setGizmoSize(this.getGizmoSize() - 0.15); break;
        case 'g': this.toggleEditorGizmos(); break;
      }
    }
  };

  /** Toggle all editor gizmos and helpers (G key — Unreal-Engine style). */
  toggleEditorGizmos(): void {
    this._editorsVisible = !this._editorsVisible;
    const v = this._editorsVisible;
    this.core.logger.log(
      v ? 'Gizmos visible' : 'Gizmos hidden — press G to restore',
      v ? 'info' : 'warn',
    );

    // Transform-controls handle
    if (this.transformControls) {
      this.transformControls.visible = v;
      if (!v) {
        // Detach so the draggable axes don't intercept mouse events while hidden
        this.transformControls.detach();
      } else {
        // Re-attach to the current lead selection (mirrors syncSelection logic)
        const lead = this.core.selectionManager.getLeadSelection();
        if (lead && this.nodeMap.has(lead.uuid)) {
          this.transformControls.enabled = true;
          this.transformControls.attach(this.nodeMap.get(lead.uuid)!);
        }
      }
    }

    // Grid
    if (this.gridHelper) {
      this.gridHelper.visible = v;
    }

    // Camera body Groups + frustum helpers (skip the active look-through camera which is already hidden)
    for (const [uuid, ch] of this.cameraHelperMap) {
      ch.helper.visible = v && uuid !== this.activeCamUuid;
      const bodyObj = this.nodeMap.get(uuid);
      if (bodyObj) bodyObj.visible = v && uuid !== this.activeCamUuid;
    }

    // Light indicators (helper objects — NOT the actual lights, which affect rendering)
    for (const [, entry] of this.lightHelperMap) {
      if (entry.helper) entry.helper.visible = v;
    }

    // Crop gizmo + crop box helpers
    if (!v && this._cropGizmoActive) {
      this._deactivateCropGizmo();
    }
    this._syncCropHelpers();
  }

  /** Sync crop Box3Helper visibility: only shown when cropEnabled + selected + editors visible. */
  private _syncCropHelpers(): void {
    const selSet = new Set(this.core.selectionManager.getSelection().map(n => n.uuid));
    for (const [uuid, helper] of this._splatCropHelperMap) {
      const node = this.core.sceneGraph.getNodeById(uuid);
      if (!(node instanceof SplatNode)) continue;
      helper.visible = node.cropEnabled.getValue() && selSet.has(uuid) && this._editorsVisible;
    }
  }

  /** Whether editor gizmos/helpers are currently shown. */
  get editorsVisible(): boolean { return this._editorsVisible; }

  private onKeyDown = (e: KeyboardEvent) => {
    // All relevant keys are now handled by onWindowKeyDown.
    // This handler is kept for any future container-specific needs.
    void e;
  };

  private syncSelection() {
    const lead = this.core.selectionManager.getLeadSelection();

    // Deactivate crop gizmo when selection moves away from the gizmo node
    if (this._cropGizmoActive && this._cropGizmoNode && lead !== this._cropGizmoNode) {
      this._deactivateCropGizmo();
    }

    if (lead && this.nodeMap.has(lead.uuid)) {
      // Don't re-attach transform controls while crop gizmo is active
      if (!this._cropGizmoActive) {
        this.transformControls.enabled = true;
        // Don't re-show the gizmo if editor gizmos are currently hidden (G key)
        if (this._editorsVisible) {
          this.transformControls.attach(this.nodeMap.get(lead.uuid)!);
        }
      }
    } else {
      this.transformControls.detach();
      this.transformControls.enabled = false;
    }
    this.updateOutlines();
    // Show crop box only for selected SplatNodes
    this._syncCropHelpers();
  }

  // ── Crop Gizmo public API ────────────────────────────────────────────────

  /** Toggle the crop gizmo for a SplatNode (bound to T key when a splat is selected). */
  public toggleCropGizmo(node: SplatNode) {
    if (this._cropGizmoActive && this._cropGizmoNode === node) {
      this.disableCropGizmo();
    } else {
      this._activateCropGizmo(node);
    }
  }

  private _activateCropGizmo(node: SplatNode) {
    // Tear down any existing gizmo first
    if (this._cropGizmo) this._deactivateCropGizmo();

    const obj = this.nodeMap.get(node.uuid);
    if (!obj) return;

    // Auto-enable crop so the effect is immediately visible
    if (!node.cropEnabled.getValue()) node.cropEnabled.setValue(true);

    const min = new THREE.Vector3(node.cropMinX.getValue(), node.cropMinY.getValue(), node.cropMinZ.getValue());
    const max = new THREE.Vector3(node.cropMaxX.getValue(), node.cropMaxY.getValue(), node.cropMaxZ.getValue());

    const gizmo = new CropGizmo(min, max);
    obj.add(gizmo);

    this._cropGizmo     = gizmo;
    this._cropGizmoNode = node;
    this._cropGizmoActive = true;

    // Hide transform controls while crop mode is active
    this.transformControls.detach();

    this.core.logger.log(`Crop volume active on "${node.name}" — Esc to exit`, 'warn');
    this.onCropModeChanged?.(true);
  }

  private _deactivateCropGizmo() {
    if (!this._cropGizmo || !this._cropGizmoNode) return;

    const prevNode = this._cropGizmoNode;
    const obj      = this.nodeMap.get(prevNode.uuid);
    if (obj) obj.remove(this._cropGizmo);
    this._cropGizmo.dispose();
    this._cropGizmo     = null;
    this._cropGizmoNode = null;
    this._cropGizmoActive = false;
    this.controls.enabled = true;

    // Re-attach TransformControls if the same node is still selected
    const lead = this.core.selectionManager.getLeadSelection();
    if (lead && lead.uuid === prevNode.uuid && this._editorsVisible) {
      this.transformControls.enabled = true;
      this.transformControls.attach(this.nodeMap.get(lead.uuid)!);
    }

    this.core.logger.log('Crop volume mode exited', 'info');
    this.onCropModeChanged?.(false);
  }

  /** Deactivate crop gizmo (can be called from outside, e.g. Escape or toolbar). */
  public disableCropGizmo() {
    this._deactivateCropGizmo();
  }

  /** Returns true if the crop gizmo is currently active. */
  public get cropGizmoActive() { return this._cropGizmoActive; }

  /** Rebuild selection outlines to match the current selection set. */
  private updateOutlines() {
    const selected = new Set(
      this.core.selectionManager.getSelection().map(n => n.uuid),
    );

    // Remove outlines for nodes that are no longer selected
    for (const [uuid, outlineMesh] of [...this.outlineMap]) {
      if (!selected.has(uuid)) {
        outlineMesh.parent?.remove(outlineMesh);
        outlineMesh.geometry.dispose();
        (outlineMesh.material as THREE.Material).dispose();
        this.outlineMap.delete(uuid);
        this.outlineBoundingRadius.delete(uuid);
      }
    }

    // If outlines are disabled don't create new ones (existing ones were just pruned above)
    if (!this.outlineEnabled) return;

    // Add outlines for newly selected MeshNode objects
    for (const uuid of selected) {
      if (this.outlineMap.has(uuid)) continue;          // already outlined
      const obj = this.nodeMap.get(uuid);
      if (!(obj instanceof THREE.Mesh)) continue;        // cameras / groups skipped

      const outlineGeo = obj.geometry.clone();
      // Compute bounding sphere once so per-frame scale can normalise by object size
      outlineGeo.computeBoundingSphere();
      const br = outlineGeo.boundingSphere?.radius ?? 1;

      const outlineMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(this.outlineColorHex),
        side:  THREE.BackSide,
        depthWrite: false,
      });
      const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
      // Scale starts at 1; the render loop updates it each frame for view-independence
      outlineMesh.scale.setScalar(1);
      outlineMesh.name = `__outline_${uuid}`;
      obj.add(outlineMesh);
      this.outlineMap.set(uuid, outlineMesh);
      this.outlineBoundingRadius.set(uuid, br);
    }
  }

  /** Toggle selection outlines on / off. */
  public setOutlineEnabled(v: boolean): void {
    this.outlineEnabled = v;
    if (!v) {
      // Remove all current outline meshes immediately
      for (const [uuid, outlineMesh] of [...this.outlineMap]) {
        outlineMesh.parent?.remove(outlineMesh);
        outlineMesh.geometry.dispose();
        (outlineMesh.material as THREE.Material).dispose();
        this.outlineMap.delete(uuid);
        this.outlineBoundingRadius.delete(uuid);
      }
    } else {
      // Rebuild outlines for the current selection
      this.updateOutlines();
    }
  }

  /** Change the outline colour (CSS hex string, e.g. '#d4aa30'). */
  public setOutlineColor(hex: string): void {
    this.outlineColorHex = hex;
    const col = new THREE.Color(hex);
    for (const [, outlineMesh] of this.outlineMap) {
      (outlineMesh.material as THREE.MeshBasicMaterial).color.copy(col);
    }
  }

  /** Set the desired screen-space thickness of the outline in pixels. */
  public setOutlineWidth(px: number): void {
    this.outlinePixels = Math.max(0.1, px);
  }

  // ── Gaussian Splat optimisations ────────────────────────────────────────

  /** Apply splat optimisation options to all active and future SplatMesh instances. */
  public setSplatOpt(opts: SplatOpts): void {
    this._splatOpts = { ...opts };
    for (const mesh of this._splatMeshMap.values()) {
      mesh.setOptions(this._splatOpts);
    }
  }

  // ── Anaglyph 3D ─────────────────────────────────────────────────────────

  /** Enable / disable anaglyph stereo mode. `ipd` is Inter-Pupillary Distance in metres. */
  public setAnaglyphEnabled(enabled: boolean, ipd: number): void {
    this._anaglyphEnabled = enabled;
    for (const mesh of this._splatMeshMap.values()) mesh.setLinearOutput(enabled);
    if (enabled) {
      // Initialise the StereoCamera here so IPD is ready, but defer actual
      // RT/compositor creation to the start of the next renderLoop tick.
      // This avoids WebGPU "texture already initialised" mid-frame errors and
      // prevents reading uncleared GPU memory on the very first anaglyph frame.
      if (!this._stereo) this._stereo = new THREE.StereoCamera();
      this._stereo.eyeSep = ipd;
      this._anaglyphRTDirty = true;
    } else {
      this._anaglyphRTDirty = false;
      this._destroyAnaglyphResources();
    }
  }

  /** Update IPD live without rebuilding resources. */
  public setAnaglyphIPD(ipd: number): void {
    if (this._stereo) this._stereo.eyeSep = ipd;
  }

  private onResize = () => {
    if (!this.container) return;
    const width  = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    // Camera aspect is always the RENDER resolution ratio, not the panel ratio.
    this.camera.aspect = this.renderResolution.w / this.renderResolution.h;
    this.camera.updateProjectionMatrix();
    // RTs must match the new gate size so the compositor has no distortion.
    if (this._anaglyphEnabled && this._stereo) {
      this._anaglyphRTDirty = true;
    }
  };

  private syncInit() {
    for (const [uuid, node] of this.core.sceneGraph.nodes.entries()) {
      if (node.uuid === this.core.sceneGraph.root.uuid) continue;
      this.addNodeToView(node);
    }
  }

  public addNodeToView(node: DAGNode) {
    let obj: THREE.Object3D;
    
    if (node instanceof MeshNode) {
      const geoType = node.geometryType.getValue();
      let geometry: THREE.BufferGeometry;
      if      (geoType === 'sphere') geometry = new THREE.SphereGeometry(0.5, 16, 12);
      else if (geoType === 'cone')   geometry = new THREE.ConeGeometry(0.5, 1, 16);
      else if (geoType === 'plane')  geometry = new THREE.PlaneGeometry(2, 2);
      else                           geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ color: node.color.getValue() });
      obj = new THREE.Mesh(geometry, material);
    } else if (node instanceof CameraNode) {
      // Build a PerspectiveCamera with a capped cosmetic far so the frustum
      // helper stays a reasonable size in the viewport.
      const renderAspect = this.renderResolution.w / this.renderResolution.h;
      const { fovV } = node.getProjectionData(renderAspect);
      const helperCam = new THREE.PerspectiveCamera(
        fovV,
        renderAspect,
        node.nearClip.getValue(),
        Math.min(node.farClip.getValue(), VISUAL_FRUSTUM_FAR),
      );
      helperCam.updateProjectionMatrix();

      // ── Camera body indicator ───────────────────────────────────────────────────
      // Invisible solid Mesh → raycaster hits it so the camera is clickable.
      // Gold LineSegments edges → wireframe visual (no filled volume).
      // Lens bump points along camera -Z (forward into the scene).
      const camColor = 0xffdd00;
      const edgeMat  = new THREE.LineBasicMaterial({ color: camColor });

      const bodyGeo  = new THREE.BoxGeometry(0.42, 0.26, 0.30);
      const bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ visible: false }));
      bodyMesh.position.z = 0.22;   // shift body back so lens centre sits at camera origin
      const bodyEdge = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo), edgeMat);
      bodyEdge.position.z = 0.22;

      const lensGeo  = new THREE.CylinderGeometry(0.06, 0.09, 0.16, 8);
      lensGeo.rotateX(Math.PI / 2);
      const lensMesh = new THREE.Mesh(lensGeo, new THREE.MeshBasicMaterial({ visible: false }));
      // lens centre now at z=0 — the camera's optical axis origin
      const lensEdge = new THREE.LineSegments(new THREE.EdgesGeometry(lensGeo), edgeMat);

      obj = new THREE.Group();
      // helperCam lives INSIDE the group so it inherits the group’s world matrix
      obj.add(helperCam, bodyMesh, bodyEdge, lensMesh, lensEdge);

      // CameraHelper is added directly to the scene so the group transform
      // is NOT applied a second time to the already–world–space frustum lines
      const helper = new THREE.CameraHelper(helperCam);
      this.scene.add(helper);

      this.cameraHelperMap.set(node.uuid, { helperCam, helper });

      // Wire filmback / clip plugs → live helper update
      const refresh = () => this.refreshCameraHelper(node);
      node.focalLength.onDirty              = refresh;
      node.horizontalFilmAperture.onDirty   = refresh;
      node.verticalFilmAperture.onDirty     = refresh;
      node.nearClip.onDirty                 = refresh;
      node.farClip.onDirty                  = refresh;
    } else if (node instanceof LightNode) {
      // ── Light node ────────────────────────────────────────────────────────
      const type      = node.lightType.getValue() as LightType;
      const colorHex  = node.color.getValue();
      const intensity = node.intensity.getValue();

      let light: THREE.Light;
      let sceneHelper: THREE.Object3D | null = null;

      if (type === 'point') {
        const pl = new THREE.PointLight(colorHex, intensity);
        sceneHelper = new THREE.PointLightHelper(pl, 0.35);
        light = pl;
      } else if (type === 'ambient') {
        light = new THREE.AmbientLight(colorHex, intensity);
        // Discrete ambient indicator: small wireframe octahedron at half opacity
        const ambGeo = new THREE.OctahedronGeometry(0.12);
        const ambMat = new THREE.MeshBasicMaterial({
          color: colorHex, wireframe: true, transparent: true, opacity: 0.45,
        });
        obj = new THREE.Group();
        obj.add(light, new THREE.Mesh(ambGeo, ambMat));
        this.lightHelperMap.set(node.uuid, { light, helper: null });
        this.lights.push(light);
        const refreshAmbient = () => {
          const c = node.color.getValue();
          (light as any).color?.set(c);
          light.intensity = node.intensity.getValue();
          ambMat.color.set(c);
        };
        node.color.onDirty     = refreshAmbient;
        node.intensity.onDirty = refreshAmbient;
      } else if (type === 'spot') {
        const sl = new THREE.SpotLight(colorHex, intensity);
        sl.angle = Math.PI / 6;
        sceneHelper = new THREE.SpotLightHelper(sl);
        light = sl;
      } else {
        // directional (default)
        const dl = new THREE.DirectionalLight(colorHex, intensity);
        sceneHelper = new THREE.DirectionalLightHelper(dl, 0.8);
        light = dl;
      }

      if (sceneHelper) this.scene.add(sceneHelper);

      // Visible indicator: small emissive sphere so you can click/see the light
      // (ambient lights use an OctahedronGeometry and are handled above)
      if (type === 'ambient') {
        // already fully handled in the ambient branch above
      } else {
        const indicator = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: colorHex }),
        );

      obj = new THREE.Group();
        obj.add(light, indicator);

        // Track for setLightingEnabled / removeNodeFromView
        this.lightHelperMap.set(node.uuid, { light, helper: sceneHelper });
        this.lights.push(light); // also register in legacy array for setLightingEnabled

        // Wire plug changes → live light update
        const refreshLight = () => {
          const c = node.color.getValue();
          (light as any).color?.set(c);
          light.intensity = node.intensity.getValue();
          (indicator.material as THREE.MeshBasicMaterial).color.set(c);
          (sceneHelper as any)?.update?.();
        };
        node.color.onDirty     = refreshLight;
        node.intensity.onDirty = refreshLight;
      }

    } else if (node instanceof GltfNode) {
      // ── GLTF imported model ───────────────────────────────────────────────
      if (node._loadedScene) {
        obj = node._loadedScene;
      } else if (node.fileData) {
        // Re-parse from embedded base64 (e.g. after loading a saved scene)
        obj = new THREE.Group(); // placeholder until async parse finishes
        const binary = Uint8Array.from(atob(node.fileData), c => c.charCodeAt(0));
        new GLTFLoader().parse(binary.buffer, '', (gltf) => {
          node._loadedScene = gltf.scene;
          const placeholder = this.nodeMap.get(node.uuid);
          if (placeholder) {
            // Swap placeholder with real content
            gltf.scene.position.copy(placeholder.position);
            gltf.scene.rotation.copy(placeholder.rotation);
            gltf.scene.scale.copy(placeholder.scale);
            this.scene.remove(placeholder);
            this.scene.add(gltf.scene);
            this.nodeMap.set(node.uuid, gltf.scene);

            // Rebind onDirty callbacks so they reference the real scene
            // instead of the now-removed placeholder (needed for undo/redo
            // and AE edits to visually update the correct Three.js object).
            node.translate.onDirty   = () => this.updateNodeTRS(node, gltf.scene);
            node.rotate.onDirty      = () => this.updateNodeTRS(node, gltf.scene);
            node.scale.onDirty       = () => this.updateNodeTRS(node, gltf.scene);
            node.visibility.onDirty  = () => { gltf.scene.visible = node.visibility.getValue(); };
          }
        }, () => {
          this.core.logger.log(`Could not re-parse GLTF for "${node.name}"`, 'error');
        });
      } else {
        obj = new THREE.Group();
      }

    } else if (node instanceof SplatNode) {
      // ── Gaussian Splat (native three.js renderer — shares depth buffer) ──
      obj = new THREE.Group();

      const loadSplat = (fileData: string, fileFormat: 'splat' | 'ply') => {
        try {
          const binary = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
          const tmpScene = new SPLAT.Scene();
          const splatObj: SPLAT.Splat = fileFormat === 'ply'
            ? SPLAT.PLYLoader.LoadFromArrayBuffer(binary.buffer, tmpScene)
            : SPLAT.Loader.LoadFromArrayBuffer(binary.buffer, tmpScene);
          const mesh = new SplatMesh();
          mesh.updateFromData(splatObj.data);
          mesh.setOptions(this._splatOpts);
          if (this._anaglyphEnabled) mesh.setLinearOutput(true);
          node._splatObject = mesh;
          obj.add(mesh);
          this._splatMeshMap.set(node.uuid, mesh);
        } catch (e) {
          this.core.logger.log(
            `Splat load failed for "${node.name}": ${(e as any)?.message ?? e}`,
            'error',
          );
        }
      };

      if (node._splatObject) {
        // Already has a SplatMesh (e.g. redo) — re-attach to scene.
        const mesh = node._splatObject as SplatMesh;
        mesh.setOptions(this._splatOpts);
        obj.add(mesh);
        this._splatMeshMap.set(node.uuid, mesh);
      } else if (node.fileData) {
        loadSplat(node.fileData, node.fileFormat);
      }

      // ── Crop volume: Box3Helper + plug wiring ─────────────────────────────
      const applyCrop = () => {
        const mesh = this._splatMeshMap.get(node.uuid);
        const enabled = node.cropEnabled.getValue();
        const cMin = new THREE.Vector3(
          node.cropMinX.getValue(), node.cropMinY.getValue(), node.cropMinZ.getValue(),
        );
        const cMax = new THREE.Vector3(
          node.cropMaxX.getValue(), node.cropMaxY.getValue(), node.cropMaxZ.getValue(),
        );
        if (mesh) {
          if (enabled) mesh.setCropBox(cMin, cMax);
          else mesh.clearCropBox();
        }
        const helper = this._splatCropHelperMap.get(node.uuid);
        if (helper) {
          const selected = this.core.selectionManager.getSelection().some(n => n.uuid === node.uuid);
          helper.visible = enabled && selected && this._editorsVisible;
          helper.box.set(cMin, cMax);
        }
      };

      // Box3Helper lives as a child of the node group → inherits TRS automatically
      const cropBox = new THREE.Box3(
        new THREE.Vector3(node.cropMinX.getValue(), node.cropMinY.getValue(), node.cropMinZ.getValue()),
        new THREE.Vector3(node.cropMaxX.getValue(), node.cropMaxY.getValue(), node.cropMaxZ.getValue()),
      );
      const cropHelper = new THREE.Box3Helper(cropBox, new THREE.Color(0xffaa00));
      cropHelper.visible = false; // shown only when selected + cropEnabled
      obj.add(cropHelper);
      this._splatCropHelperMap.set(node.uuid, cropHelper);

      // Wire all crop plugs
      node.cropEnabled.onDirty = applyCrop;
      node.cropMinX.onDirty   = applyCrop;
      node.cropMinY.onDirty   = applyCrop;
      node.cropMinZ.onDirty   = applyCrop;
      node.cropMaxX.onDirty   = applyCrop;
      node.cropMaxY.onDirty   = applyCrop;
      node.cropMaxZ.onDirty   = applyCrop;

    } else {
      obj = new THREE.Group();
    }

    // Apply TRS
    const t = node.translate.getValue();
    const r = node.rotate.getValue();
    const s = node.scale.getValue();
    
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.set(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z));
    obj.scale.set(s.x, s.y, s.z);

    this.nodeMap.set(node.uuid, obj);
    this.scene.add(obj);

    // Apply current shading mode to new meshes
    if (obj instanceof THREE.Mesh && this.currentShadingMode !== 'smooth') {
      this.applyShadingToMesh(obj);
    }

    // Bind dirty events
    node.translate.onDirty = () => this.updateNodeTRS(node, obj);
    node.rotate.onDirty = () => this.updateNodeTRS(node, obj);
    node.scale.onDirty = () => this.updateNodeTRS(node, obj);

    // SplatNode TRS is inherited automatically by the SplatMesh child via the
    // three.js scene graph — no extra dirty callbacks needed here.

    // Wire visibility plug → Three.js visible flag
    obj.visible = node.visibility.getValue();
    node.visibility.onDirty = () => { obj.visible = node.visibility.getValue(); };
  }

  private updateNodeTRS(node: DAGNode, obj: THREE.Object3D) {
    // Don't overwrite any node currently being transformed by the gizmo (prevent Euler jitter)
    if (this.isTransforming && this.dragSnapshots.some(s => s.node.uuid === node.uuid)) return;
    const t = node.translate.getValue();
    const r = node.rotate.getValue();
    const s = node.scale.getValue();
    
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.set(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z));
    obj.scale.set(s.x, s.y, s.z);
  }

  public renderLoop = () => {
    // Stop immediately if dispose() has been called — the renderer is already gone.
    if (!this.isRendering) return;
    this._rafHandle = requestAnimationFrame(this.renderLoop);
    this.controls.update();

    // Flush deferred anaglyph RT rebuild BEFORE any rendering starts.
    // This avoids mutating WebGPU textures mid-frame ("Texture already initialized").
    if (this._anaglyphRTDirty && this._anaglyphEnabled && this._stereo) {
      this._anaglyphRTDirty = false;
      this._buildAnaglyphResources(this._stereo.eyeSep);
    }

    // When looking through a CameraNode, sync the render camera each frame
    if (this.activeCamUuid) {
      const camNode = this.core.sceneGraph.getNodeById(this.activeCamUuid);
      const camObj  = this.nodeMap.get(this.activeCamUuid);
      if (camNode instanceof CameraNode && camObj) {
        const { fovV } = camNode.getProjectionData(this.camera.aspect);
        this.camera.fov  = fovV;
        this.camera.near = camNode.nearClip.getValue();
        this.camera.far  = camNode.farClip.getValue();
        this.camera.updateProjectionMatrix();
        camObj.getWorldPosition(this.camera.position);
        camObj.getWorldQuaternion(this.camera.quaternion);
      }
    }

    // Update world matrices so helperCam.matrixWorld is current, then refresh frustum lines
    this.scene.updateMatrixWorld();

    // ── View-independent outline scaling ─────────────────────────────────────
    // Scale each outline mesh each frame so its screen-space thickness stays
    // constant regardless of zoom / camera distance.
    //   targetWorldOffset = OUTLINE_PIXELS * dist / focalLength
    //   scale = 1 + targetWorldOffset / boundingRadius
    if (this.outlineMap.size > 0) {
      const fovRad  = THREE.MathUtils.degToRad(this.camera.fov);
      const gate    = this._gateViewport();
      const focalPx = (gate.h / 2) / Math.tan(fovRad / 2);
      for (const [uuid, outlineMesh] of this.outlineMap) {
        outlineMesh.getWorldPosition(this._outlineTmpPos);
        const dist = this.camera.position.distanceTo(this._outlineTmpPos);
        const br = this.outlineBoundingRadius.get(uuid) ?? 1;
        outlineMesh.scale.setScalar(
          1 + (this.outlinePixels * dist) / (focalPx * Math.max(br, 0.001)),
        );
      }
    }

    // Sync wireframe overlay transforms (they live at scene root, not as mesh children)
    for (const [meshUuid, ls] of this.wireframeOverlays) {
      const meshObj = this.scene.getObjectByProperty('uuid', meshUuid);
      if (meshObj) {
        ls.matrix.copy(meshObj.matrixWorld);
        ls.matrixWorld.copy(meshObj.matrixWorld);
      }
    }

    for (const [, ch] of this.cameraHelperMap) {
      if (ch.helper.visible) ch.helper.update();
    }

    // ── Crop gizmo: constant-size handles + hover ───────────────────────────
    if (this._cropGizmo) this._cropGizmo.updateHandleScale(this.camera);

    // ── Per-frame splat sort + uniform update (before draw) ────────────────
    this._updateSplats();
    this._renderMain();
    // Notify frame listeners (CameraViewPanel etc.)
    if (this.frameListeners.size > 0) {
      const src = this.renderer.domElement as HTMLCanvasElement;
      for (const cb of this.frameListeners) cb(src);
    }

    // ── Extra render passes for per-camera view panels ───────────────────
    if (this.cameraFrameListeners.size > 0) {
      // Save current render camera state so we can restore after extra passes
      const savedFov  = this.camera.fov;
      const savedNear = this.camera.near;
      const savedFar  = this.camera.far;
      const savedPos  = this.camera.position.clone();
      const savedQuat = this.camera.quaternion.clone();

      // Hide gizmo / helpers during camera passes so they don't appear in previews
      const gizmoWasVisible = this.transformControls.visible;
      this.transformControls.visible = false;
      const hiddenHelpers: THREE.CameraHelper[] = [];
      for (const [, ch] of this.cameraHelperMap) {
        if (ch.helper.visible) { ch.helper.visible = false; hiddenHelpers.push(ch.helper); }
      }
      const gridWasVisible = this.gridHelper?.visible ?? false;
      if (this.gridHelper) this.gridHelper.visible = false;

      for (const [uuid, listeners] of this.cameraFrameListeners) {
        const camNode = this.core.sceneGraph.getNodeById(uuid);
        const camObj  = this.nodeMap.get(uuid);
        if (!(camNode instanceof CameraNode) || !camObj) continue;

        // Hide this camera's own body so it doesn't appear in its own preview
        const wasVisible = camObj.visible;
        camObj.visible = false;

        const { fovV } = camNode.getProjectionData(this.camera.aspect);
        this.camera.fov  = fovV;
        this.camera.near = camNode.nearClip.getValue();
        this.camera.far  = camNode.farClip.getValue();
        this.camera.updateProjectionMatrix();
        camObj.getWorldPosition(this.camera.position);
        camObj.getWorldQuaternion(this.camera.quaternion);

        // Render into the gate rect so the aspect ratio exactly matches the
        // render resolution.  Without the gate constraint, the scene is
        // stretched across the full (panel-sized) canvas and the crop that
        // CameraViewPanel/CameraMosaicOverlay extracts will be geometrically
        // distorted whenever the panel aspect ≠ render-resolution aspect.
        const camGate = this._gateViewport();
        this.renderer.setScissorTest(true);
        this.renderer.setScissor(camGate.x, camGate.y, camGate.w, camGate.h);
        this.renderer.setViewport(camGate.x, camGate.y, camGate.w, camGate.h);
        this.renderer.autoClear = true;
        this.renderer.render(this.scene, this.camera);
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);

        const src = this.renderer.domElement as HTMLCanvasElement;
        for (const cb of listeners) cb(src);

        camObj.visible = wasVisible;
      }

      // Restore main camera state and re-render the main viewport
      this.camera.fov  = savedFov;
      this.camera.near = savedNear;
      this.camera.far  = savedFar;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(savedPos);
      this.camera.quaternion.copy(savedQuat);

      this.transformControls.visible = gizmoWasVisible;
      for (const h of hiddenHelpers) h.visible = true;
      if (this.gridHelper) this.gridHelper.visible = gridWasVisible;

      this._renderMain();
    }
  };

  /** Gate rect in Three.js viewport coordinates (CSS logical pixels, y from BOTTOM of canvas). */
  private _gateViewport(): { x: number; y: number; w: number; h: number } {
    const vpW = this.container.clientWidth;
    const vpH = this.container.clientHeight;
    const rA  = this.renderResolution.w / this.renderResolution.h;
    const vA  = vpW / vpH;
    let gW: number, gH: number, bX: number, bY: number;
    if (vA > rA) {
      gH = vpH; gW = gH * rA;  bX = (vpW - gW) / 2; bY = 0;
    } else {
      gW = vpW; gH = gW / rA;  bX = 0; bY = (vpH - gH) / 2;
    }
    // Three.js setViewport/setScissor measure y from the bottom of the canvas
    return { x: bX, y: vpH - bY - gH, w: gW, h: gH };
  }

  /** Render the main viewport — stereo anaglyph (RT composite) or normal.
   *  Always clips to the gate rect so the 3D image is never stretched
   *  when the panel aspect differs from the render resolution aspect. */
  private _renderMain(): void {
    const gate = this._gateViewport();

    if (
      this._anaglyphEnabled && this._stereo &&
      this._leftRT && this._rightRT && this._quadScene && this._quadCamera
    ) {
      // ── Anaglyph via render-target composite ─────────────────────────
      // Guard: if the panel was laid out after setAnaglyphEnabled fired (e.g.
      // React useEffect before flexlayout settles), the RT pixel dimensions may
      // not match the current gate. Schedule a rebuild for the next tick and
      // skip the anaglyph pass this frame to avoid mid-frame WebGPU mutations.
      const dpr = window.devicePixelRatio;
      const gPW = Math.max(1, Math.round(gate.w * dpr));
      const gPH = Math.max(1, Math.round(gate.h * dpr));
      if (this._leftRT.width !== gPW || this._leftRT.height !== gPH) {
        this._anaglyphRTDirty = true;
        // Fall through to normal render for this frame
      } else if (!this._anaglyphReady) {
        // Pipeline not compiled yet — fall through to normal render this frame.
        // (_anaglyphReady is set by compileAsync after _buildAnaglyphResources)
      } else {
        this._stereo.update(this.camera);

        const prevAutoClear  = this.renderer.autoClear;
        const prevColorSpace = this.renderer.outputColorSpace ?? null;

        // Eye renders: use LinearSRGBColorSpace so materials write linear values
        // into the RTs (no sRGB encoding). The composite's colorspace_fragment
        // then applies a single sRGB encode → correct brightness for all geometry,
        // background, and grid. GS pre-decodes its sRGB file colours to linear
        // (via uLinearOutput uniform) so the composite re-encodes them back to
        // the original values — identical brightness to normal rendering.
        if (prevColorSpace !== null) {
          this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        }
        this.renderer.autoClear = true;

        // Render each eye into its own RT.
        // GS uses custom shader uniforms (viewMatrix, projectionMatrix, uFocal)
        // that must be refreshed per eye — not auto-updated by Three.js.
        this._refreshSplatUniforms(this._stereo.cameraL);
        this.renderer.setRenderTarget(this._leftRT);
        this.renderer.render(this.scene, this._stereo.cameraL);

        this._refreshSplatUniforms(this._stereo.cameraR);
        this.renderer.setRenderTarget(this._rightRT);
        this.renderer.render(this.scene, this._stereo.cameraR);

        // Restore uniforms and color space before the composite pass.
        this._refreshSplatUniforms(this.camera);
        if (prevColorSpace !== null) {
          this.renderer.outputColorSpace = prevColorSpace;
        }

        // Back to screen — clear canvas then composite quad into gate area.
        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = false;
        this.renderer.clear(true, true, true);   // clears full canvas (bars → bg colour)

        this.renderer.setScissorTest(true);
        this.renderer.setScissor(gate.x, gate.y, gate.w, gate.h);
        this.renderer.setViewport(gate.x, gate.y, gate.w, gate.h);
        this.renderer.render(this._quadScene, this._quadCamera);

        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
        this.renderer.autoClear = prevAutoClear;
        return;
      }
    }

    // Normal render — clip to gate so nothing outside is drawn
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(gate.x, gate.y, gate.w, gate.h);
    this.renderer.setViewport(gate.x, gate.y, gate.w, gate.h);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  private _buildAnaglyphResources(ipd: number): void {
    // StereoCamera
    if (!this._stereo) this._stereo = new THREE.StereoCamera();
    this._stereo.eyeSep = ipd;

    // Size RTs to the gate at current DPR — must share the renderRes aspect ratio.
    // IMPORTANT: always recreate RTs and the compositor so texture references stay fresh.
    const gate = this._gateViewport();
    const dpr  = window.devicePixelRatio;
    const w    = Math.max(1, Math.round(gate.w * dpr));
    const h    = Math.max(1, Math.round(gate.h * dpr));

    this._leftRT?.dispose();
    this._rightRT?.dispose();
    (this._compMat as THREE.Material | null)?.dispose();

    // HalfFloatType preserves linear values from the eye renders without 8-bit
    // quantization. UnsignedByteType (default) loses precision on dark linear
    // values: e.g. sRGB 0.1 → linear 0.010 → stored as 3/255 → re-encodes to
    // 0.110, brightening dark areas in anaglyph vs normal mode.
    const rtOpts = { type: THREE.HalfFloatType };
    this._leftRT  = new THREE.WebGLRenderTarget(w, h, rtOpts);
    this._rightRT = new THREE.WebGLRenderTarget(w, h, rtOpts);

    if (this._rendererType === 'webgl') {
      // Eye RTs hold linear values (rendered with LinearSRGBColorSpace).
      // The composite applies #include <colorspace_fragment> which encodes the
      // linear values to sRGB exactly once — identical to a normal single render.
      // GS pre-decodes its sRGB file colours via uLinearOutput so the final
      // encoded result matches normal mode.
      this._compMat = new THREE.ShaderMaterial({
        uniforms: {
          mapLeft:  { value: this._leftRT.texture  },
          mapRight: { value: this._rightRT.texture },
        },
        vertexShader: [
          'varying vec2 vUv;',
          'void main() {',
          '  vUv = uv;',
          '  gl_Position = vec4(position, 1.0);',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D mapLeft;',
          'uniform sampler2D mapRight;',
          'varying vec2 vUv;',
          'void main() {',
          '  vec4 l = texture2D(mapLeft,  vUv);',
          '  vec4 r = texture2D(mapRight, vUv);',
          '  gl_FragColor = vec4(l.r, r.g, r.b, 1.0);',
          '  #include <colorspace_fragment>',
          '}',
        ].join('\n'),
        depthTest: false,
        depthWrite: false,
      });
    } else {
      // WebGPU: TSL node material
      const leftTex  = tslTexture(this._leftRT.texture);
      const rightTex = tslTexture(this._rightRT.texture);
      this._compMat  = new MeshBasicNodeMaterial();
      this._compMat.colorNode = vec4(leftTex.r, rightTex.g, rightTex.b, float(1));
    }

    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quadScene  = new THREE.Scene();
    // WebGPU stores render-target texels with Y=0 at the top (NDC origin differs
    // from OpenGL/WebGL where Y=0 is at the bottom). Flip UV.y on the quad
    // geometry so the composite reads rows in the correct order.
    // WebGL uses the same convention as PlaneGeometry UVs (no flip needed).
    const geo = new THREE.PlaneGeometry(2, 2);
    if (this._rendererType !== 'webgl') {
      const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, 1 - uvAttr.getY(i));
    }
    this._quadScene.add(new THREE.Mesh(geo, this._compMat));

    // Pre-compile the compositor shader pipeline so the very first composite
    // frame is never rendered with an unfinished (crushed/blank) WebGPU pipeline.
    // Falls through to normal render until compilation completes.
    // NOTE: compileAsync is only called for WebGPU — WebGL ShaderMaterial
    // compiles synchronously and WebGLRenderer.compileAsync has known
    // incompatibilities with ShaderMaterial (crashes on isReady check).
    this._anaglyphReady = false;
    if (this._rendererType !== 'webgl' && this._quadScene && this._quadCamera) {
      this.renderer.compileAsync(this._quadScene, this._quadCamera)
        .then(() => { this._anaglyphReady = true; })
        .catch(() => { this._anaglyphReady = true; }); // best-effort fallback
    } else {
      // WebGL ShaderMaterial is ready synchronously
      this._anaglyphReady = true;
    }
  }

  private _destroyAnaglyphResources(): void {
    this._leftRT?.dispose();
    this._rightRT?.dispose();
    (this._compMat as THREE.Material | null)?.dispose();
    this._leftRT     = null;
    this._rightRT    = null;
    this._compMat    = null;
    this._quadScene  = null;
    this._quadCamera = null;
    this._anaglyphReady = false;
    // _stereo is lightweight — keep for reuse
  }

  // ── Native Gaussian Splatting helpers ──────────────────────────────────────

  /**
   * Sort all SplatMesh instances front-to-back and update their per-frame
   * uniforms (camera matrices, focal length, viewport size).
   * Called once per frame BEFORE the main three.js render pass so that
   * depth compositing with geometry works correctly.
   */
  private _updateSplats(): void {
    if (this._splatMeshMap.size === 0) return;
    // Use gate dimensions, not canvas clientWidth/clientHeight.
    // The gate.w/gate.h ratio always equals camera.aspect (renderResolution ratio),
    // which is required by the GS vertex shader: uViewport.x/uViewport.y must
    // equal camera.aspect for splats to project as circles instead of ovals.
    const gate = this._gateViewport();
    const w = gate.w;
    const h = gate.h;
    if (w <= 0 || h <= 0) return;
    for (const mesh of this._splatMeshMap.values()) {
      mesh.sort(this.camera);
      mesh.updateUniforms(this.camera, w, h);
    }
  }

  /** Update GS shader uniforms for a specific camera (used per-eye in anaglyph mode). */
  private _refreshSplatUniforms(camera: THREE.PerspectiveCamera): void {
    if (this._splatMeshMap.size === 0) return;
    // Gate dimensions ensure uViewport.x/uViewport.y = camera.aspect → round splats.
    const gate = this._gateViewport();
    for (const mesh of this._splatMeshMap.values()) {
      mesh.updateUniforms(camera, gate.w, gate.h);
    }
  }

  // ── Public control API ─────────────────────────────────────────────────────

  public setTransformMode(mode: 'select' | 'translate' | 'rotate' | 'scale') {
    if (mode === 'select') {
      this.transformControls.detach();
    } else {
      this.transformControls.setMode(mode as 'translate' | 'rotate' | 'scale');
      // Only attach (show handle) when editor gizmos are visible
      if (this._editorsVisible) {
        const lead = this.core.selectionManager.getLeadSelection();
        if (lead && this.nodeMap.has(lead.uuid)) {
          this.transformControls.attach(this.nodeMap.get(lead.uuid)!);
        }
      }
    }
  }

  public setGizmoSize(size: number): void {
    this.transformControls.setSize(Math.max(0.1, Math.min(5, size)));
  }

  public getGizmoSize(): number {
    return this.transformControls.size;
  }

  public setTranslationSnap(snap: number | null) {
    // Use direct property assignment — setTranslationSnap() may not exist in all Three.js builds
    (this.transformControls as any).translationSnap = snap;
  }

  public setRotationSnap(degrees: number | null) {
    (this.transformControls as any).rotationSnap =
      degrees != null ? THREE.MathUtils.degToRad(degrees) : null;
  }

  public setTransformSpace(space: 'world' | 'local') {
    this.transformControls.setSpace(space);
  }

  public setLightingEnabled(enabled: boolean) {
    this.lightingEnabled = enabled;
    // Legacy direct lights (none now — kept in case future code adds some)
    this.lights.forEach(l => { l.visible = enabled; });
    // LightNode lights + their helpers
    for (const [, entry] of this.lightHelperMap) {
      entry.light.visible = enabled;
      if (entry.helper) entry.helper.visible = enabled;
    }
  }

  public removeNodeFromView(uuid: string) {
    const obj = this.nodeMap.get(uuid);
    if (!obj) return;
    this.nodeMap.delete(uuid);
    this.scene.remove(obj);
    // Clean up wireframe overlay (lives at scene root, not as mesh child)
    const wf = this.wireframeOverlays.get(uuid);
    if (wf) {
      this.scene.remove(wf);
      wf.geometry.dispose();
      (wf.material as THREE.Material).dispose();
      this.wireframeOverlays.delete(uuid);
    }
    // Clean up selection outline (lives as a child of the mesh, removed with it)
    const ol = this.outlineMap.get(uuid);
    if (ol) {
      ol.geometry.dispose();
      (ol.material as THREE.Material).dispose();
      this.outlineMap.delete(uuid);
      this.outlineBoundingRadius.delete(uuid);
    }
    // Clean up camera helper
    const ch = this.cameraHelperMap.get(uuid);
    if (ch) {
      this.scene.remove(ch.helper);
      ch.helper.dispose();
      this.cameraHelperMap.delete(uuid);
    }
    // Clean up light helper
    const lh = this.lightHelperMap.get(uuid);
    if (lh) {
      if (lh.helper) this.scene.remove(lh.helper);
      const idx = this.lights.indexOf(lh.light);
      if (idx !== -1) this.lights.splice(idx, 1);
      this.lightHelperMap.delete(uuid);
    }
    // Clean up native SplatMesh
    const splatMesh = this._splatMeshMap.get(uuid);
    if (splatMesh) {
      splatMesh.dispose();
      this._splatMeshMap.delete(uuid);
    }
    // Clean up crop helper (child of the node group, removed with scene.remove(obj))
    this._splatCropHelperMap.delete(uuid);
    // Deactivate crop gizmo if it belongs to the node being removed
    if (this._cropGizmoNode?.uuid === uuid) {
      this._cropGizmo     = null;
      this._cropGizmoNode = null;
      this._cropGizmoActive = false;
      this.controls.enabled = true;
      this.onCropModeChanged?.(false);
    }
  }

  /**
   * Recompute a CameraNode's frustum helper from its current plugs + render resolution.
   * Called whenever filmback / clip plugs change or render resolution is updated.
   */
  private refreshCameraHelper(node: CameraNode): void {
    const entry = this.cameraHelperMap.get(node.uuid);
    if (!entry) return;
    const { helperCam, helper } = entry;
    const renderAspect = this.renderResolution.w / this.renderResolution.h;
    const { fovV } = node.getProjectionData(renderAspect);
    helperCam.fov    = fovV;
    helperCam.aspect = renderAspect;
    helperCam.near   = node.nearClip.getValue();
    // Keep the visual frustum capped so it never becomes an enormous cone.
    helperCam.far    = Math.min(node.farClip.getValue(), VISUAL_FRUSTUM_FAR);
    helperCam.updateProjectionMatrix();
    helper.update();
  }

  /** Group all currently selected nodes under a new GroupNode (Ctrl/⌘+G). */
  public createGroup(): void {
    const selected = this.core.selectionManager.getSelection();
    if (selected.length === 0) return;
    const existing = this.core.sceneGraph.getAllNodes().filter(n => n.nodeType === 'GroupNode').length;
    const groupName = `group${existing + 1}`;
    const cmd = new CreateGroupCommand(
      groupName, [...selected],
      this.core.sceneGraph, this.core.selectionManager,
      (n) => this.addNodeToView(n),
      (id) => this.removeNodeFromView(id),
      (nu, pu) => this.reparentObj(nu, pu),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Grouped ${selected.length} object(s) into "${groupName}"`, 'command');
    this.onSceneChanged?.();
  }

  // ── Frame Selected (F) ───────────────────────────────────────────────────────
  public frameSelected(): void {
    const sel = this.core.selectionManager.getSelection();
    const targets = sel.length > 0
      ? sel.map(n => this.nodeMap.get(n.uuid)).filter(Boolean) as THREE.Object3D[]
      : Array.from(this.nodeMap.values()).filter(o => o.type !== 'GridHelper');
    if (targets.length === 0) return;

    const box = new THREE.Box3();
    for (const obj of targets) box.expandByObject(obj);
    if (box.isEmpty()) {
      // Fall back to bounding sphere from object positions
      for (const obj of targets) box.expandByPoint(obj.getWorldPosition(new THREE.Vector3()));
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.75 + 0.5;
    // Keep same view direction, just move camera closer/farther
    const dir = this.camera.position.clone().sub(center).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, radius * 2.5);
    this.controls.update();
  }

  // ── Delete Selected (Delete / Backspace) ─────────────────────────────────────
  public deleteSelected(): void {
    const selected = this.core.selectionManager.getSelection();
    if (selected.length === 0) return;

    // Filter out the WorldRoot just in case
    const roots = selected.filter(n => n.uuid !== this.core.sceneGraph.root.uuid);
    if (roots.length === 0) return;

    const cmd = new DeleteCommand(
      roots,
      this.core.sceneGraph,
      this.core.selectionManager,
      (n) => this.addNodeToView(n),
      (id) => this.removeNodeFromView(id),
      (nu, pu) => this.reparentObj(nu, pu),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Deleted ${roots.length} object(s)`, 'command');
    this.onSceneChanged?.();
  }

  // ── Duplicate Selected (Ctrl/⌘+D) ────────────────────────────────────────────
  public duplicateSelected(): void {
    const selected = this.core.selectionManager.getSelection();
    if (selected.length === 0) return;

    const allClones: DAGNode[] = [];
    const rootClones: DAGNode[] = [];

    for (const src of selected) {
      const parentNode = src.parent ?? this.core.sceneGraph.root;
      const clone = this.deepCloneSubtree(src, parentNode, allClones);
      if (clone) {
        rootClones.push(clone);
      }
    }
    if (rootClones.length === 0) return;

    const cmd = new DuplicateCommand(
      allClones, rootClones, [...selected],
      this.core.sceneGraph, this.core.selectionManager,
      (id) => this.removeNodeFromView(id),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Duplicated ${rootClones.length} object(s)`, 'command');
    this.onSceneChanged?.();
  }

  /**
   * Recursively clones a DAGNode subtree; registers each clone in sceneGraph + view.
   * Returns the root clone, or null for unsupported node types (cameras etc.).
   */
  private deepCloneSubtree(src: DAGNode, destParent: DAGNode, allClones: DAGNode[]): DAGNode | null {
    let clone: DAGNode;

    if (src instanceof MeshNode) {
      const m = new MeshNode(this.nextAvailableName(src.name));
      m.geometryType.setValue(src.geometryType.getValue());
      m.color.setValue(src.color.getValue());
      m.translate.setValue({ ...src.translate.getValue() });
      m.rotate.setValue({ ...src.rotate.getValue() });
      m.scale.setValue({ ...src.scale.getValue() });
      m.visibility.setValue(src.visibility.getValue());
      clone = m;
    } else if (src instanceof CameraNode) {
      const c = new CameraNode(this.nextAvailableName(src.name));
      c.focalLength.setValue(src.focalLength.getValue());
      c.horizontalFilmAperture.setValue(src.horizontalFilmAperture.getValue());
      c.verticalFilmAperture.setValue(src.verticalFilmAperture.getValue());
      c.nearClip.setValue(src.nearClip.getValue());
      c.farClip.setValue(src.farClip.getValue());
      c.filmFit.setValue(src.filmFit.getValue());
      c.translate.setValue({ ...src.translate.getValue() });
      c.rotate.setValue({ ...src.rotate.getValue() });
      c.scale.setValue({ ...src.scale.getValue() });
      c.visibility.setValue(src.visibility.getValue());
      clone = c;
    } else if (src instanceof GroupNode) {
      const g = new GroupNode(this.nextAvailableName(src.name));
      g.translate.setValue({ ...src.translate.getValue() });
      g.rotate.setValue({ ...src.rotate.getValue() });
      g.scale.setValue({ ...src.scale.getValue() });
      g.visibility.setValue(src.visibility.getValue());
      clone = g;
    } else if (src instanceof LightNode) {
      const l = new LightNode(this.nextAvailableName(src.name));
      l.lightType.setValue(src.lightType.getValue());
      l.color.setValue(src.color.getValue());
      l.intensity.setValue(src.intensity.getValue());
      l.translate.setValue({ ...src.translate.getValue() });
      l.rotate.setValue({ ...src.rotate.getValue() });
      l.scale.setValue({ ...src.scale.getValue() });
      l.visibility.setValue(src.visibility.getValue());
      clone = l;
    } else if (src instanceof GltfNode) {
      const gn = new GltfNode(this.nextAvailableName(src.name));
      gn.fileName.setValue(src.fileName.getValue());
      gn.fileData = src.fileData;
      gn._loadedScene = src._loadedScene ? src._loadedScene.clone() : null;
      gn.translate.setValue({ ...src.translate.getValue() });
      gn.rotate.setValue({ ...src.rotate.getValue() });
      gn.scale.setValue({ ...src.scale.getValue() });
      gn.visibility.setValue(src.visibility.getValue());
      clone = gn;
    } else if (src instanceof SplatNode) {
      const sn = new SplatNode(this.nextAvailableName(src.name));
      sn.fileName.setValue(src.fileName.getValue());
      sn.fileData   = src.fileData;
      sn.fileFormat = src.fileFormat;
      // _splatObject is left null — addNodeToView will recreate a SplatMesh
      // from fileData when the clone is registered in the scene graph.
      sn.translate.setValue({ ...src.translate.getValue() });
      sn.rotate.setValue({ ...src.rotate.getValue() });
      sn.scale.setValue({ ...src.scale.getValue() });
      sn.visibility.setValue(src.visibility.getValue());
      clone = sn;
    } else {
      return null;
    }

    // Register in graph + view (adds flat to scene)
    this.core.sceneGraph.addNode(clone, destParent);
    this.addNodeToView(clone);
    allClones.push(clone);

    // If destParent has a Three.js representation, reparent clone's object under it
    if (destParent.uuid !== this.core.sceneGraph.root.uuid) {
      this.reparentObj(clone.uuid, destParent.uuid);
    }

    // Recurse into children
    for (const child of src.children) {
      this.deepCloneSubtree(child, clone, allClones);
    }

    return clone;
  }

  /**
   * Given a source name like "pCone1", find the next available name.
   * Strips trailing digits to get the base prefix, then searches all scene
   * nodes for the highest existing number with that prefix, and returns
   * prefix + (max + 1).  E.g. if pCone1, pCone2, pCone4 exist and the
   * source is "pCone1", returns "pCone5".
   */
  private nextAvailableName(sourceName: string): string {
    // Split name into prefix + trailing number
    const match = sourceName.match(/^(.*?)(\d+)$/);
    const prefix = match ? match[1] : sourceName;

    // Collect all existing numbers for this prefix
    const existing = new Set<number>();
    for (const node of this.core.sceneGraph.getAllNodes()) {
      const m = node.name.match(/^(.*?)(\d+)$/);
      if (m && m[1] === prefix) {
        existing.add(parseInt(m[2], 10));
      }
    }

    // Find next available number starting from 1
    let num = 1;
    while (existing.has(num)) num++;
    return `${prefix}${num}`;
  }

  /** Dissolve all selected GroupNodes (Ctrl/⌘+Shift+G). */
  public ungroupSelected(): void {
    const groups = this.core.selectionManager.getSelection()
      .filter((n): n is GroupNode => n instanceof GroupNode);
    if (groups.length === 0) return;
    for (const g of groups) {
      const cmd = new UngroupCommand(
        g, this.core.sceneGraph, this.core.selectionManager,
        (n) => this.addNodeToView(n),
        (id) => this.removeNodeFromView(id),
        (nu, pu) => this.reparentObj(nu, pu),
      );
      this.core.commandHistory.execute(cmd);
      this.core.logger.log(`Ungrouped "${g.name}"`, 'command');
    }
    this.onSceneChanged?.();
  }

  /** Internal: reparents a Three.js object without firing onSceneChanged.
   *  Three.js attach() preserves world-space transform; we sync the new local
   *  TRS back to the DAG node's plugs so the AttributeEditor stays accurate.
   *
   *  We SILENCE all three onDirty callbacks before any setValue call.
   *  Without this, the first setValue (translate) fires updateNodeTRS, which
   *  reads the still-stale rotate/scale plugs and resets the Three.js object's
   *  rotation and scale to the old (pre-ungroup) values, corrupting the result. */
  private reparentObj(nodeUuid: string, newParentUuid: string): void {
    const childObj = this.nodeMap.get(nodeUuid);
    if (!childObj) return;
    const newParentObj = this.nodeMap.get(newParentUuid);
    if (newParentObj) {
      newParentObj.attach(childObj);
    } else {
      this.scene.attach(childObj);
    }
    // Snapshot the new local TRS from Three.js BEFORE touching any DAG plug
    const pos = childObj.position.clone();
    const rot = childObj.rotation.clone();
    const scl = childObj.scale.clone();

    const node = this.core.sceneGraph.getNodeById(nodeUuid);
    if (node) {
      // Silence onDirty so no intermediate updateNodeTRS fires during the 3 setValues
      const prevT = node.translate.onDirty;
      const prevR = node.rotate.onDirty;
      const prevS = node.scale.onDirty;
      node.translate.onDirty = undefined;
      node.rotate.onDirty    = undefined;
      node.scale.onDirty     = undefined;

      node.translate.setValue({ x: pos.x, y: pos.y, z: pos.z });
      node.rotate.setValue({
        x: THREE.MathUtils.radToDeg(rot.x),
        y: THREE.MathUtils.radToDeg(rot.y),
        z: THREE.MathUtils.radToDeg(rot.z),
      });
      node.scale.setValue({ x: scl.x, y: scl.y, z: scl.z });

      node.translate.onDirty = prevT;
      node.rotate.onDirty    = prevR;
      node.scale.onDirty     = prevS;
    }
    // Apply final TRS directly — guarantees correct Three.js state regardless of any prior drift
    childObj.position.copy(pos);
    childObj.rotation.copy(rot);
    childObj.scale.copy(scl);
  }

  /**
   * Public: reparents a Three.js Object3D and fires onSceneChanged.
   * Used by the bus-dispatched drag-to-reparent path.
   */
  public reparentInView(nodeUuid: string, newParentUuid: string): void {
    this.reparentObj(nodeUuid, newParentUuid);
    this.onSceneChanged?.();
  }

  public createCamera() {
    const name = this.nextAvailableName('camera1');
    const node = new CameraNode(name);
    // Sensible default position: slightly above and in front of origin
    node.translate.setValue({ x: 0, y: 2, z: 10 });
    node.rotate.setValue({ x: -10, y: 0, z: 0 });
    const cmd = new CreateNodeCommand(
      node, undefined,
      this.core.sceneGraph, this.core.selectionManager,
      (n) => this.addNodeToView(n),
      (id) => this.removeNodeFromView(id),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Created camera "${name}"`, 'command');
    this.onSceneChanged?.();
  }

  /** Create a light of the given type and add it as an undoable command. */
  public createLight(type: LightType = 'directional'): void {
    const prefixes: Record<LightType, string> = {
      directional: 'directionalLight',
      point:       'pointLight',
      ambient:     'ambientLight',
      spot:        'spotLight',
    };
    const name = this.nextAvailableName(`${prefixes[type]}1`);
    const node = new LightNode(name);
    node.lightType.setValue(type);
    if (type === 'directional') {
      node.translate.setValue({ x: 5, y: 10, z: 7 });
    } else if (type === 'point') {
      node.translate.setValue({ x: 0, y: 3, z: 0 });
    } else if (type === 'spot') {
      node.translate.setValue({ x: 0, y: 5, z: 0 });
      node.rotate.setValue({ x: -90, y: 0, z: 0 });
    }
    const cmd = new CreateNodeCommand(
      node, undefined,
      this.core.sceneGraph, this.core.selectionManager,
      (n) => this.addNodeToView(n),
      (id) => this.removeNodeFromView(id),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Created ${type} light "${name}"`, 'command');
    this.onSceneChanged?.();
  }

  /** Open the system file picker and import a GLB/GLTF as a single scene node. */
  public async importGltf(): Promise<void> {
    let file: File;
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'GLTF / GLB 3D Models',
          accept: { 'model/gltf-binary': ['.glb'], 'model/gltf+json': ['.gltf'] },
        }],
        multiple: false,
      });
      file = await handle.getFile();
    } catch {
      return; // user cancelled
    }

    const buffer = await file.arrayBuffer();
    const loader = new GLTFLoader();

    loader.parse(buffer, '', (gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);

      const baseName = file.name.replace(/\.[^.]+$/, '');
      const name = this.nextAvailableName(baseName || 'import');
      const node = new GltfNode(name);
      node.fileName.setValue(file.name);
      node._loadedScene = root;

      // Embed binary as base64 for scene serialisation
      const bytes = new Uint8Array(buffer);
      let bin = '';
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      node.fileData = btoa(bin);

      const cmd = new CreateNodeCommand(
        node, undefined,
        this.core.sceneGraph, this.core.selectionManager,
        (n) => this.addNodeToView(n),
        (id) => this.removeNodeFromView(id),
      );
      this.core.commandHistory.execute(cmd);
      this.core.logger.log(`Imported "${file.name}" as "${name}"`, 'info');
      this.onSceneChanged?.();
    }, (err) => {
      this.core.logger.log(`GLTF import failed: ${(err as any)?.message ?? err}`, 'error');
    });
  }

  /** Open the system file picker and import a .splat or .ply Gaussian Splat file. */
  public async importSplat(): Promise<void> {
    let file: File;
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'Gaussian Splat Files',
          accept: { 'application/octet-stream': ['.splat', '.ply'] },
        }],
        multiple: false,
      });
      file = await handle.getFile();
    } catch {
      return; // user cancelled
    }

    const buffer = await file.arrayBuffer();
    const ext    = (file.name.split('.').pop() ?? 'splat').toLowerCase() as 'splat' | 'ply';

    // Load into a temp scene so the Splat is NOT yet in _splatScene;
    // addNodeToView will register it properly (supports undo / redo too).
    const tmpScene = new SPLAT.Scene();
    let splatObj: SPLAT.Splat;
    try {
      splatObj = ext === 'ply'
        ? SPLAT.PLYLoader.LoadFromArrayBuffer(buffer, tmpScene)
        : SPLAT.Loader.LoadFromArrayBuffer(buffer, tmpScene);
    } catch (e) {
      this.core.logger.log(`Splat import failed: ${(e as any)?.message ?? e}`, 'error');
      return;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '');
    const name     = this.nextAvailableName(baseName || 'splat');

    const node = new SplatNode(name);
    node.fileName.setValue(file.name);
    node.fileFormat  = ext;
    // GSplat convention: Y-up world but data is stored Y-down → flip 180° on X
    node.rotate.setValue({ x: 180, y: 0, z: 0 });

    // Pre-build SplatMesh from the already-decoded data (avoids a second decode
    // from base64 when addNodeToView is called immediately after).
    const mesh = new SplatMesh();
    mesh.updateFromData(splatObj.data);
    node._splatObject = mesh;

    // Embed raw bytes as base64 for scene serialisation
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    node.fileData = btoa(bin);

    const cmd = new CreateNodeCommand(
      node, undefined,
      this.core.sceneGraph, this.core.selectionManager,
      (n) => this.addNodeToView(n),
      (id) => this.removeNodeFromView(id),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Imported splat "${file.name}" as "${name}"`, 'info');
    this.onSceneChanged?.();
  }

  /**
   * Create default directional + ambient lights as proper LightNode DAG objects.
   * Called on new scene and on first construction when no lights exist.
   * Does NOT add commands to history.
   */
  public createDefaultLights(): void {
    const dir = new LightNode('directionalLight1');
    dir.lightType.setValue('directional');
    dir.color.setValue('#ffffff');
    dir.intensity.setValue(1.0);
    dir.translate.setValue({ x: 5, y: 10, z: 7 });
    this.core.sceneGraph.addNode(dir);
    this.addNodeToView(dir);

    const amb = new LightNode('ambientLight1');
    amb.lightType.setValue('ambient');
    amb.color.setValue('#ffffff');
    amb.intensity.setValue(0.2);
    this.core.sceneGraph.addNode(amb);
    this.addNodeToView(amb);

    this.onSceneChanged?.();
  }

  /** Look through a CameraNode (pass null to return to default Perspective). */
  public lookThroughCamera(cameraNodeUuid: string | null) {
    // Restore previous camera's body + frustum lines
    if (this.activeCamUuid) {
      const prevCh  = this.cameraHelperMap.get(this.activeCamUuid);
      if (prevCh) prevCh.helper.visible = true;
      const prevObj = this.nodeMap.get(this.activeCamUuid);
      if (prevObj) prevObj.visible = true;
    }
    this.activeCamUuid = cameraNodeUuid;
    if (!cameraNodeUuid) {
      // Restore default perspective camera position + re-enable orbit
      this.controls.enabled = true;
      this.camera.fov = 50;
      this.camera.near = 0.1;
      this.camera.far = 1000;
      this.camera.updateProjectionMatrix();
    } else {
      // Disable orbit when looking through a scene camera
      this.controls.enabled = false;
      // Hide this camera's frustum lines AND body while looking through it
      const ch = this.cameraHelperMap.get(cameraNodeUuid);
      if (ch) ch.helper.visible = false;
      const bodyObj = this.nodeMap.get(cameraNodeUuid);
      if (bodyObj) bodyObj.visible = false;
    }
    this.onSceneChanged?.();
  }

  public getActiveCameraUuid(): string | null { return this.activeCamUuid; }

  public createPrimitive(geoType: 'box' | 'sphere' | 'cone' | 'plane') {
    const prefixes: Record<string, string> = { box: 'pCube', sphere: 'pSphere', cone: 'pCone', plane: 'pPlane' };
    const prefix = prefixes[geoType] ?? 'pObject';
    const name = this.nextAvailableName(`${prefix}1`);
    const node = new MeshNode(name);
    node.geometryType.setValue(geoType);

    const cmd = new CreateNodeCommand(
      node,
      undefined,
      this.core.sceneGraph,
      this.core.selectionManager,
      (n) => this.addNodeToView(n),
      (id) => this.removeNodeFromView(id),
    );
    this.core.commandHistory.execute(cmd);
    this.core.logger.log(`Created "${name}"`, 'command');
    this.onSceneChanged?.();
  }

  public getShadingMode() { return this.currentShadingMode; }

  private applyShadingToMesh(mesh: THREE.Mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    // NEVER set mat.wireframe = true — WebGPU crashes on setIndexBuffer.
    // Instead we always use a WireframeGeometry LineSegments overlay added
    // as a sibling in the scene (not a child of the mesh) so visibility and
    // material flags on the mesh don't interfere.
    mats.forEach((mat: THREE.Material) => { mat.wireframe = false; });

    if (this.currentShadingMode === 'wireframe') {
      // Pure wireframe: hide the solid mesh, show wireframe lines only
      mesh.visible = false;
      const wfGeo = new THREE.WireframeGeometry(mesh.geometry);
      const wfMat = new THREE.LineBasicMaterial({ color: 0x999999 });
      const ls = new THREE.LineSegments(wfGeo, wfMat);
      // Copy the mesh's world transform so the wireframe sits in the same place
      ls.matrixAutoUpdate = false;
      mesh.updateWorldMatrix(true, false);
      ls.matrix.copy(mesh.matrixWorld);
      ls.matrixWorld.copy(mesh.matrixWorld);
      this.scene.add(ls);
      this.wireframeOverlays.set(mesh.uuid, ls);
    } else if (this.currentShadingMode === 'wireframe-on-shaded') {
      mesh.visible = true;
      const wfGeo = new THREE.WireframeGeometry(mesh.geometry);
      const wfMat = new THREE.LineBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.5 });
      const ls = new THREE.LineSegments(wfGeo, wfMat);
      ls.matrixAutoUpdate = false;
      mesh.updateWorldMatrix(true, false);
      ls.matrix.copy(mesh.matrixWorld);
      ls.matrixWorld.copy(mesh.matrixWorld);
      this.scene.add(ls);
      this.wireframeOverlays.set(mesh.uuid, ls);
    } else {
      // smooth — just make sure mesh is visible
      mesh.visible = true;
    }
  }

  public setShadingMode(mode: 'smooth' | 'wireframe' | 'wireframe-on-shaded') {
    this.currentShadingMode = mode;

    // Remove stale wireframe overlays (they live in the scene, not as mesh children)
    for (const [, ls] of this.wireframeOverlays.entries()) {
      this.scene.remove(ls);
      ls.geometry.dispose();
      (ls.material as THREE.Material).dispose();
    }
    this.wireframeOverlays.clear();

    // Apply to all DAG meshes only (skip gizmo, helpers, lights, grid, etc.)
    const dagObjects = new Set(this.nodeMap.values());
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      // Only process objects that belong to our DAG node map
      if (!dagObjects.has(obj)) {
        // Check if it's a child of a DAG object (e.g. mesh inside a group)
        let parent = obj.parent;
        let isDag = false;
        while (parent) {
          if (dagObjects.has(parent)) { isDag = true; break; }
          parent = parent.parent;
        }
        if (!isDag) return;
      }
      this.applyShadingToMesh(obj);
    });
  }

  public setGridVisible(visible: boolean) {
    if (this.gridHelper) this.gridHelper.visible = visible;
  }

  /**
   * Remove ALL DAG-created objects from the Three.js scene.
   * Does NOT touch camera, grid, lights or controls — just user content.
   */
  public clearAllNodesFromView(): void {
    // Detach gizmo first
    this.transformControls.detach();
    this.transformControls.enabled = false;

    // Remove every nodeMap entry + its helpers / overlays
    for (const uuid of Array.from(this.nodeMap.keys())) {
      this.removeNodeFromView(uuid);
    }
  }

  /**
   * Add an array of already-constructed DAGNodes to the 3-D view.
   * Typically called after `Serializer.deserialize()` has created the nodes.
   */
  public loadNodes(nodes: DAGNode[]): void {
    for (const node of nodes) {
      this.addNodeToView(node);
    }
  }

  /** Change the scene background colour. */
  public setBackgroundColor(hex: string): void {
    this._savedBgColor = new THREE.Color(hex);
    // Only overwrite the visible background if HDRI-as-background is off
    if (!this._hdriAsBackground || !this._hdriEnabled || !this._hdriEnvMap) {
      this.scene.background = new THREE.Color(hex);
    }
  }

  // ── HDRI helpers ────────────────────────────────────────────────────────────

  /**
   * Load an HDR or EXR texture from `url` and apply it as the scene environment.
   * Uses PMREMGenerator so the texture works correctly with PBR materials.
   * Returns a promise that resolves with the processed texture.
   */
  public async loadHdri(url: string, fileExtension: string = 'hdr'): Promise<THREE.Texture> {
    const generator = new THREE.PMREMGenerator(this.renderer);
    generator.compileEquirectangularShader();

    let rawTexture: THREE.Texture;
    if (fileExtension.toLowerCase() === 'exr') {
      const loader = new EXRLoader();
      rawTexture = await new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
    } else {
      const loader = new HDRLoader();
      rawTexture = await new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
    }

    const envMap = generator.fromEquirectangular(rawTexture).texture;
    rawTexture.dispose();
    generator.dispose();

    // Store and apply
    if (this._hdriEnvMap) this._hdriEnvMap.dispose();
    this._hdriEnvMap = envMap;

    this._applyHdriState();
    return envMap;
  }

  /**
   * Open a native file picker for .hdr / .exr files, load the selection,
   * and apply it as the HDRI environment.  Returns the chosen filename (or null
   * if the user cancelled).
   */
  public async importHdri(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.hdr,.exr';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const ext = file.name.split('.').pop() ?? 'hdr';
        const url = URL.createObjectURL(file);
        try {
          await this.loadHdri(url, ext);
          this._hdriEnabled = true;
          this._applyHdriState();
          resolve(file.name);
        } catch (err) {
          console.error('HDRI import failed:', err);
          resolve(null);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      input.click();
    });
  }

  /** Enable or disable HDRI contribution to lighting (does not unload the texture). */
  public setHdriEnabled(enabled: boolean): void {
    this._hdriEnabled = enabled;
    this._applyHdriState();
  }

  /** Set the HDRI intensity (scene.environmentIntensity). */
  public setHdriIntensity(v: number): void {
    this._hdriIntensity = v;
    if (this._hdriEnabled && this._hdriEnvMap) {
      (this.scene as any).environmentIntensity = v;
    }
  }

  /** Rotate the HDRI environment around the Y axis (degrees). */
  public setHdriRotation(deg: number): void {
    this._hdriRotation = deg;
    if (this._hdriEnabled && this._hdriEnvMap) {
      // Use .set() on the existing Euler so Three.js dirty-tracking fires correctly.
      const rad = THREE.MathUtils.degToRad(deg);
      (this.scene as any).environmentRotation.set(0, rad, 0);
      if (this._hdriAsBackground) {
        (this.scene as any).backgroundRotation.set(0, rad, 0);
      }
    }
  }

  /** Set the background-sphere intensity independently from the lighting intensity. */
  public setHdriBackgroundIntensity(v: number): void {
    this._hdriBackgroundIntensity = v;
    if (this._hdriEnabled && this._hdriEnvMap && this._hdriAsBackground) {
      (this.scene as any).backgroundIntensity = v;
    }
  }

  /** When true the HDRI is shown as the scene background; when false the solid bg colour is restored. */
  public setHdriAsBackground(v: boolean): void {
    this._hdriAsBackground = v;
    this._applyHdriState();
  }

  /** Unload the current HDRI and restore the solid background colour. */
  public clearHdri(): void {
    if (this._hdriEnvMap) {
      this._hdriEnvMap.dispose();
      this._hdriEnvMap = null;
    }
    this._hdriEnabled = false;
    this.scene.environment = null;
    this.scene.background  = this._savedBgColor.clone();
  }

  /** Internal: push all HDRI state fields to the three.js scene. */
  private _applyHdriState(): void {
    const rad = THREE.MathUtils.degToRad(this._hdriRotation);
    if (!this._hdriEnvMap || !this._hdriEnabled) {
      this.scene.environment = null;
      this.scene.background  = this._savedBgColor.clone();
      (this.scene as any).environmentIntensity = 1.0;
      (this.scene as any).backgroundIntensity  = 1.0;
      return;
    }
    this.scene.environment = this._hdriEnvMap;
    (this.scene as any).environmentIntensity = this._hdriIntensity;
    // .set() mutates the existing Euler so Three.js dirty-tracking fires correctly.
    (this.scene as any).environmentRotation.set(0, rad, 0);

    if (this._hdriAsBackground) {
      this.scene.background = this._hdriEnvMap;
      (this.scene as any).backgroundRotation.set(0, rad, 0);
      (this.scene as any).backgroundIntensity = this._hdriBackgroundIntensity;
    } else {
      this.scene.background = this._savedBgColor.clone();
      (this.scene as any).backgroundIntensity = 1.0;
    }
  }

  public dispose() {
    this.isRendering = false;
    cancelAnimationFrame(this._rafHandle);
    this.frameListeners.clear();
    this.cameraFrameListeners.clear();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.container.removeEventListener('keydown', this.onKeyDown);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMoveCrop);
    this.renderer.domElement.removeEventListener('pointerup',   this.onPointerUpCrop);
    if (this._cropGizmo) { this._cropGizmo.dispose(); this._cropGizmo = null; }
    this.transformControls.dispose();
    this.controls.dispose();
    this._destroyAnaglyphResources();
    this.container.removeChild(this.renderer.domElement);
    this.renderer.dispose();

    // ── Dispose native SplatMesh objects ────────────────────────────────────
    for (const mesh of this._splatMeshMap.values()) {
      mesh.dispose();
    }
    this._splatMeshMap.clear();
  }
}
