/**
 * CropGizmo — interactive AABB crop-volume manipulator for SplatNode.
 *
 * Rendered as an orange wire-box with:
 *   • 8 white corner spheres  (move corner → changes 3 planes simultaneously)
 *   • 6 coloured face-center spheres  (move face → changes 1 plane)
 *       Red   = X faces   Green = Y faces   Blue = Z faces
 *
 * All positions are in the parent Object3D's LOCAL space (== the SplatNode
 * group, which equals the SplatMesh model space where the crop box is defined).
 *
 * Usage (from ViewportManager):
 *   const gizmo = new CropGizmo(min, max);
 *   splatGroup.add(gizmo);
 *   // each frame in render loop:
 *   gizmo.updateHandleScale(camera);
 *   gizmo.onHover(raycaster);
 *   // on pointerdown:
 *   const hit = gizmo.hitTest(raycaster);
 *   if (hit) gizmo.startDrag(hit.handle, hit.worldPoint, camera);
 *   // on pointermove:
 *   const result = gizmo.moveDrag(raycaster);  // → {min, max} or null
 *   // on pointerup:
 *   const info = gizmo.endDrag();  // → startMin/Max, endMin/Max for undo
 */

import * as THREE from 'three';

// ── Handle colours ──────────────────────────────────────────────────────────
const C_CORNER  = 0xeeeeee;
const C_FACE_X  = 0xff4040;
const C_FACE_Y  = 0x40dd55;
const C_FACE_Z  = 0x4488ff;
const C_HOVER   = 0xffff44;
const C_ACTIVE  = 0xffffff;
const C_EDGES   = 0xff9900;

// ── Corner index packing (bit 0=X, bit 1=Y, bit 2=Z; 0=min,1=max) ──────────
// Corner 0=(mnX,mnY,mnZ)  1=(mxX,mnY,mnZ)  2=(mnX,mxY,mnZ)  3=(mxX,mxY,mnZ)
// Corner 4=(mnX,mnY,mxZ)  5=(mxX,mnY,mxZ)  6=(mnX,mxY,mxZ)  7=(mxX,mxY,mxZ)

// 12 box edges as pairs of corner indices
const EDGES = [
  0,1, 2,3, 4,5, 6,7,   // X-parallel
  0,2, 1,3, 4,6, 5,7,   // Y-parallel
  0,4, 1,5, 2,6, 3,7,   // Z-parallel
] as const;

// Face-handle defs: axis (0=X,1=Y,2=Z) + dir (-1=min,+1=max) + default colour
const FACE_DEFS: Array<{ axis: 0|1|2; dir: -1|1; color: number }> = [
  { axis: 0, dir: -1, color: C_FACE_X },
  { axis: 0, dir:  1, color: C_FACE_X },
  { axis: 1, dir: -1, color: C_FACE_Y },
  { axis: 1, dir:  1, color: C_FACE_Y },
  { axis: 2, dir: -1, color: C_FACE_Z },
  { axis: 2, dir:  1, color: C_FACE_Z },
];

// ── Public types ─────────────────────────────────────────────────────────────
export interface CropHandle {
  id: string;
  mesh: THREE.Mesh;
  type: 'corner' | 'face';
  cornerIdx?: number;   // 0-7
  faceAxis?:  0|1|2;
  faceDir?:   -1|1;
  defaultColor: number;
}

export class CropGizmo extends THREE.Object3D {
  public cropMin = new THREE.Vector3();
  public cropMax = new THREE.Vector3();

  private readonly _handles: CropHandle[] = [];
  private _lineMesh!: THREE.LineSegments;

  // ── Drag state ─────────────────────────────────────────────────────────────
  private _activeHandle: CropHandle | null = null;
  private _isDragging = false;
  private _dragPlane   = new THREE.Plane();
  private _startLocalHit  = new THREE.Vector3();  // initial click in local space
  private _startHandlePos = new THREE.Vector3();  // handle position at drag start
  private _startMin = new THREE.Vector3();
  private _startMax = new THREE.Vector3();

  constructor(min: THREE.Vector3, max: THREE.Vector3) {
    super();
    this.cropMin.copy(min);
    this.cropMax.copy(max);
    this._buildVisuals();
    this._updatePositions();
  }

  // ── Build geometry & handles ───────────────────────────────────────────────
  private _buildVisuals() {
    // Box edge lines — 12 edges × 2 verts = 24 positions
    const lineBuf = new THREE.BufferAttribute(new Float32Array(24 * 3), 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', lineBuf);
    const lineMat = new THREE.LineBasicMaterial({
      color: C_EDGES, depthTest: false, transparent: true, opacity: 0.85,
    });
    this._lineMesh = new THREE.LineSegments(lineGeo, lineMat);
    this._lineMesh.renderOrder = 998;
    this.add(this._lineMesh);

    // Corner handles (8)
    const cornerGeo = new THREE.SphereGeometry(1, 7, 5); // scaled per-frame
    for (let c = 0; c < 8; c++) {
      const mat  = new THREE.MeshBasicMaterial({ color: C_CORNER, depthTest: false });
      const mesh = new THREE.Mesh(cornerGeo, mat);
      mesh.renderOrder = 1001;
      this.add(mesh);
      this._handles.push({ id: `c${c}`, mesh, type: 'corner', cornerIdx: c, defaultColor: C_CORNER });
    }

    // Face-center handles (6)
    const faceGeo = new THREE.SphereGeometry(1.3, 8, 6); // slightly bigger
    for (const def of FACE_DEFS) {
      const mat  = new THREE.MeshBasicMaterial({ color: def.color, depthTest: false });
      const mesh = new THREE.Mesh(faceGeo, mat);
      mesh.renderOrder = 1001;
      this.add(mesh);
      this._handles.push({
        id: `f${def.axis}${def.dir > 0 ? '+' : '-'}`,
        mesh, type: 'face',
        faceAxis: def.axis, faceDir: def.dir,
        defaultColor: def.color,
      });
    }
  }

  // ── Update visual positions from current cropMin/Max ─────────────────────
  private _updatePositions() {
    const mn = this.cropMin;
    const mx = this.cropMax;

    // Build the 8 corner world positions
    const corners: [number, number, number][] = [];
    for (let c = 0; c < 8; c++) {
      corners.push([
        (c & 1) ? mx.x : mn.x,
        (c & 2) ? mx.y : mn.y,
        (c & 4) ? mx.z : mn.z,
      ]);
    }

    // Update edge line buffer
    const pos = this._lineMesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let e = 0; e < EDGES.length; e++) {
      const c = corners[EDGES[e]];
      pos.setXYZ(e, c[0], c[1], c[2]);
    }
    pos.needsUpdate = true;
    this._lineMesh.geometry.computeBoundingSphere();

    // Corner handle positions
    for (let c = 0; c < 8; c++) {
      const cv = corners[c];
      this._handles[c].mesh.position.set(cv[0], cv[1], cv[2]);
    }

    // Face-center handle positions
    const cx = (mn.x + mx.x) / 2;
    const cy = (mn.y + mx.y) / 2;
    const cz = (mn.z + mx.z) / 2;
    this._handles[8 ].mesh.position.set(mn.x, cy,   cz  ); // X-
    this._handles[9 ].mesh.position.set(mx.x, cy,   cz  ); // X+
    this._handles[10].mesh.position.set(cx,   mn.y, cz  ); // Y-
    this._handles[11].mesh.position.set(cx,   mx.y, cz  ); // Y+
    this._handles[12].mesh.position.set(cx,   cy,   mn.z); // Z-
    this._handles[13].mesh.position.set(cx,   cy,   mx.z); // Z+
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Sync gizmo visuals from external plug changes. */
  setBounds(min: THREE.Vector3, max: THREE.Vector3) {
    this.cropMin.copy(min);
    this.cropMax.copy(max);
    this._updatePositions();
  }

  /**
   * Scale all handles so they remain constant-size on screen.
   * Call this once per frame in the render loop.
   */
  updateHandleScale(camera: THREE.Camera) {
    // World-space center of the box
    const wc = new THREE.Vector3(
      (this.cropMin.x + this.cropMax.x) / 2,
      (this.cropMin.y + this.cropMax.y) / 2,
      (this.cropMin.z + this.cropMax.z) / 2,
    ).applyMatrix4(this.matrixWorld);

    const dist = camera.position.distanceTo(wc);
    const scl  = Math.max(0.005, dist * 0.022);
    for (const h of this._handles) h.mesh.scale.setScalar(scl);
  }

  /**
   * Update hover highlight.  Called every pointermove when crop gizmo is active.
   * Returns the hovered handle or null.
   */
  onHover(raycaster: THREE.Raycaster): CropHandle | null {
    const hits = raycaster.intersectObjects(this._handles.map(h => h.mesh), false);
    const hitMesh = hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
    let hovered: CropHandle | null = null;

    for (const h of this._handles) {
      const mat = h.mesh.material as THREE.MeshBasicMaterial;
      if (h === this._activeHandle) {
        mat.color.setHex(C_ACTIVE);
      } else if (h.mesh === hitMesh) {
        mat.color.setHex(C_HOVER);
        hovered = h;
      } else {
        mat.color.setHex(h.defaultColor);
      }
    }
    return hovered;
  }

  /**
   * Hit test: returns handle + world intersection point, or null.
   */
  hitTest(raycaster: THREE.Raycaster): { handle: CropHandle; worldPoint: THREE.Vector3 } | null {
    const hits = raycaster.intersectObjects(this._handles.map(h => h.mesh), false);
    if (hits.length === 0) return null;
    const hitMesh = hits[0].object as THREE.Mesh;
    const handle  = this._handles.find(h => h.mesh === hitMesh) ?? null;
    return handle ? { handle, worldPoint: hits[0].point.clone() } : null;
  }

  /**
   * Begin dragging a handle.
   * @param handle      From hitTest()
   * @param worldPoint  World-space intersection on the handle mesh
   * @param camera      Used to build a camera-facing drag plane
   */
  startDrag(handle: CropHandle, worldPoint: THREE.Vector3, camera: THREE.Camera) {
    this._activeHandle = handle;
    this._isDragging   = true;
    this._startMin.copy(this.cropMin);
    this._startMax.copy(this.cropMax);
    this._startHandlePos.copy(handle.mesh.position);

    // Drag plane: camera-facing through the hit point
    const camFwd = camera.getWorldDirection(new THREE.Vector3());
    this._dragPlane.setFromNormalAndCoplanarPoint(camFwd, worldPoint);

    // Record the initial hit point in LOCAL space of this gizmo's parent
    const parentInv = this.parent!.matrixWorld.clone().invert();
    this._startLocalHit.copy(worldPoint).applyMatrix4(parentInv);

    // Highlight active handle
    (handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(C_ACTIVE);
  }

  /**
   * Update handle position during an active drag.
   * @returns new {min, max} in local space, or null on degenerate ray-plane intersection.
   */
  moveDrag(raycaster: THREE.Raycaster): { min: THREE.Vector3; max: THREE.Vector3 } | null {
    if (!this._isDragging || !this._activeHandle) return null;

    const worldHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(this._dragPlane, worldHit)) return null;

    // Convert to parent local space
    const parentInv = this.parent!.matrixWorld.clone().invert();
    const localHit  = worldHit.clone().applyMatrix4(parentInv);

    // Delta from the initial click → new handle position
    const delta  = localHit.clone().sub(this._startLocalHit);
    const newPos = this._startHandlePos.clone().add(delta);

    const newMin = this._startMin.clone();
    const newMax = this._startMax.clone();
    const EPS = 0.02; // minimum box size

    if (this._activeHandle.type === 'corner') {
      const c = this._activeHandle.cornerIdx!;
      // X
      if (c & 1) { newMax.x = newPos.x; if (newMax.x < newMin.x + EPS) newMax.x = newMin.x + EPS; }
      else        { newMin.x = newPos.x; if (newMin.x > newMax.x - EPS) newMin.x = newMax.x - EPS; }
      // Y
      if (c & 2) { newMax.y = newPos.y; if (newMax.y < newMin.y + EPS) newMax.y = newMin.y + EPS; }
      else        { newMin.y = newPos.y; if (newMin.y > newMax.y - EPS) newMin.y = newMax.y - EPS; }
      // Z
      if (c & 4) { newMax.z = newPos.z; if (newMax.z < newMin.z + EPS) newMax.z = newMin.z + EPS; }
      else        { newMin.z = newPos.z; if (newMin.z > newMax.z - EPS) newMin.z = newMax.z - EPS; }
    } else {
      // Face handle — only ONE axis component is used
      const axis = this._activeHandle.faceAxis!;
      const dir  = this._activeHandle.faceDir!;
      const a    = (['x', 'y', 'z'] as const)[axis];
      if (dir === -1) {
        newMin[a] = newPos[a];
        if (newMin[a] > newMax[a] - EPS) newMin[a] = newMax[a] - EPS;
      } else {
        newMax[a] = newPos[a];
        if (newMax[a] < newMin[a] + EPS) newMax[a] = newMin[a] + EPS;
      }
    }

    this.cropMin.copy(newMin);
    this.cropMax.copy(newMax);
    this._updatePositions();
    return { min: newMin.clone(), max: newMax.clone() };
  }

  /**
   * Finish an active drag.
   * @returns Start/end bounds (for undo recording), or null if no drag was active.
   */
  endDrag(): { startMin: THREE.Vector3; startMax: THREE.Vector3; endMin: THREE.Vector3; endMax: THREE.Vector3 } | null {
    if (!this._isDragging) return null;

    const result = {
      startMin: this._startMin.clone(),
      startMax: this._startMax.clone(),
      endMin:   this.cropMin.clone(),
      endMax:   this.cropMax.clone(),
    };

    this._isDragging = false;
    if (this._activeHandle) {
      (this._activeHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(this._activeHandle.defaultColor);
    }
    this._activeHandle = null;
    return result;
  }

  get isDragging() { return this._isDragging; }

  /** Call when removing the gizmo to free GPU resources. */
  dispose() {
    this._lineMesh.geometry.dispose();
    (this._lineMesh.material as THREE.Material).dispose();
    for (const h of this._handles) {
      // Only dispose the material; geometry (SphereGeometry) is shared
      (h.mesh.material as THREE.Material).dispose();
    }
    // Dispose shared geometries once
    if (this._handles.length > 0) {
      this._handles[0].mesh.geometry.dispose(); // corner geo
      if (this._handles.length > 8) this._handles[8].mesh.geometry.dispose(); // face geo
    }
  }
}
