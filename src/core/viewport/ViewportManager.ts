import * as THREE from 'three';
// @ts-ignore
import { WebGPURenderer } from 'three/webgpu';
import { EngineCore } from '../EngineCore';
import { CameraNode } from '../dag/CameraNode';
import { DAGNode } from '../dag/DAGNode';
import { Vector3Data } from '../dag/DAGNode';
import { MeshNode } from '../dag/MeshNode';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

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
import { CreateNodeCommand } from '../system/commands/CreateNodeCommand';
import { CreateGroupCommand } from '../system/commands/CreateGroupCommand';
import { UngroupCommand } from '../system/commands/UngroupCommand';
import { DuplicateCommand } from '../system/commands/DuplicateCommand';
import { DeleteCommand } from '../system/commands/DeleteCommand';
import { GroupNode } from '../dag/GroupNode';

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
  /** UUID of the CameraNode currently being looked through, or null = default persp cam. */
  private activeCamUuid: string | null = null;
  private lightingEnabled = true;
  private currentShadingMode: 'smooth' | 'wireframe' | 'wireframe-on-shaded' = 'smooth';
  private wireframeOverlays: Map<string, THREE.LineSegments> = new Map();
  /** Per-CameraNode helper state for frustum display. */
  private cameraHelperMap: Map<string, { helperCam: THREE.PerspectiveCamera; helper: THREE.CameraHelper }> = new Map();

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
    // Refresh all camera helpers so the frustum reflects the new render aspect
    for (const [uuid, _] of this.cameraHelperMap) {
      const camNode = this.core.sceneGraph.getNodeById(uuid);
      if (camNode instanceof CameraNode) this.refreshCameraHelper(camNode);
    }
  }
  public getRenderResolution(): { w: number; h: number } { return this.renderResolution; }

  constructor(container: HTMLElement, core: EngineCore) {
    this.container = container;
    this.core = core;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202020);

    // Initial camera (will be overridden by DAG camera later)
    this.camera = new THREE.PerspectiveCamera(50, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    // Setup WebGPURenderer with fallback
    try {
      this.renderer = new WebGPURenderer({ antialias: true });
      console.log('WebGPU Renderer initialized');
    } catch (e) {
      console.warn('WebGPU not supported, falling back to WebGLRenderer');
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    }
    
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // Grid and lights
    this.gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
    this.scene.add(this.gridHelper);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);
    const ambLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambLight);
    this.lights = [dirLight, ambLight];

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

    window.addEventListener('resize', this.onResize);
    // ⌘G / Ctrl+G must be caught at window level so the browser's
    // "Find Next" shortcut is suppressed before reaching the container.
    window.addEventListener('keydown', this.onWindowKeyDown);

    // Ensure the container handles keyboard inputs for Hotkeys
    this.container.tabIndex = 0;
    this.container.addEventListener('keydown', this.onKeyDown);
    
    // Clicking empty space selection logic
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    this.onResize(); // trigger initial resize to fix aspect

    // Sync DAG
    this.syncInit();

    // Bind Core selection events to view
    this.core.selectionManager.addListener(() => this.syncSelection());

    // Defer the start of the render loop until the WebGPU backend is initialized
    if (this.renderer.init) {
      this.renderer.init().then(() => {
        this.core.logger.log('WebGPU renderer initialized successfully.', 'info');
        this.renderLoop();
      });
    } else {
      this.core.logger.log('WebGL renderer initialized (WebGPU fallback).', 'warn');
      this.renderLoop(); // WebGL fallback
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    // Focus the container so hotkeys work
    this.container.focus();

    // Prevent raycasting behind the gizmos themselves or the orbit controls
    if (this.transformControls.dragging) return;
    
    // We only raycast on primary mouse button (left)
    if (e.button !== 0) return;

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
        case 't':
          this.transformControls.setSpace(this.transformControls.space === 'local' ? 'world' : 'local');
          break;
        case 'q': this.setTransformMode('select'); break;
        case 'f': this.frameSelected(); break;
        case '+': case '=': this.setGizmoSize(this.getGizmoSize() + 0.15); break;
        case '-': case '_': this.setGizmoSize(this.getGizmoSize() - 0.15); break;
      }
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // All relevant keys are now handled by onWindowKeyDown.
    // This handler is kept for any future container-specific needs.
    void e;
  };

  private syncSelection() {
    const lead = this.core.selectionManager.getLeadSelection();
    if (lead && this.nodeMap.has(lead.uuid)) {
      this.transformControls.enabled = true;
      this.transformControls.attach(this.nodeMap.get(lead.uuid)!);
    } else {
      this.transformControls.detach();
      this.transformControls.enabled = false;
    }
  }

  private onResize = () => {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Also update any DAG Cinematic cameras
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
      // Build a PerspectiveCamera properly configured from the node's plugs
      const renderAspect = this.renderResolution.w / this.renderResolution.h;
      const { fovV } = node.getProjectionData(renderAspect);
      const helperCam = new THREE.PerspectiveCamera(
        fovV,
        renderAspect,
        node.nearClip.getValue(),
        node.farClip.getValue(),
      );
      helperCam.updateProjectionMatrix();

      obj = new THREE.Group();
      // helperCam lives INSIDE the group so it inherits the group’s world matrix
      obj.add(helperCam);

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
    } else {
      // Basic transform
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
    this.isRendering = true;
    requestAnimationFrame(this.renderLoop);
    this.controls.update();

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

    this.renderer.render(this.scene, this.camera);
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

        const { fovV } = camNode.getProjectionData(this.camera.aspect);
        this.camera.fov  = fovV;
        this.camera.near = camNode.nearClip.getValue();
        this.camera.far  = camNode.farClip.getValue();
        this.camera.updateProjectionMatrix();
        camObj.getWorldPosition(this.camera.position);
        camObj.getWorldQuaternion(this.camera.quaternion);

        this.renderer.render(this.scene, this.camera);
        const src = this.renderer.domElement as HTMLCanvasElement;
        for (const cb of listeners) cb(src);
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

      this.renderer.render(this.scene, this.camera);
    }
  };

  // ── Public control API ─────────────────────────────────────────────────────

  public setTransformMode(mode: 'select' | 'translate' | 'rotate' | 'scale') {
    if (mode === 'select') {
      this.transformControls.detach();
    } else {
      this.transformControls.setMode(mode as 'translate' | 'rotate' | 'scale');
      const lead = this.core.selectionManager.getLeadSelection();
      if (lead && this.nodeMap.has(lead.uuid)) {
        this.transformControls.attach(this.nodeMap.get(lead.uuid)!);
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
    this.lights.forEach(l => { l.visible = enabled; });
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
    // Clean up camera helper
    const ch = this.cameraHelperMap.get(uuid);
    if (ch) {
      // The helper was added directly to the scene (not as child of obj)
      this.scene.remove(ch.helper);
      ch.helper.dispose();
      this.cameraHelperMap.delete(uuid);
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
    helperCam.far    = node.farClip.getValue();
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

  /** Look through a CameraNode (pass null to return to default Perspective). */
  public lookThroughCamera(cameraNodeUuid: string | null) {
    // Toggle helper visibility: hide when looking through its own camera
    if (this.activeCamUuid) {
      const prevCh = this.cameraHelperMap.get(this.activeCamUuid);
      if (prevCh) prevCh.helper.visible = true;
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
      // Hide this camera's own frustum helper while we're looking through it
      const ch = this.cameraHelperMap.get(cameraNodeUuid);
      if (ch) ch.helper.visible = false;
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
    this.scene.background = new THREE.Color(hex);
  }

  public dispose() {
    this.isRendering = false;
    this.frameListeners.clear();
    this.cameraFrameListeners.clear();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.container.removeEventListener('keydown', this.onKeyDown);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.transformControls.dispose();
    this.controls.dispose();
    this.container.removeChild(this.renderer.domElement);
    this.renderer.dispose();
  }
}
