/**
 * HeatmapApplier — renders per-POINT coverage quality as a smooth
 * Gaussian point-cloud overlay directly in the Three.js scene.
 *
 * ## How it works
 *
 *  1. Phase 1 — Traverse all visible scene meshes, collect every triangle's
 *     world-space vertices and compute its area.  All vertices are stored in
 *     a flat Float32Array (9 floats / triangle).
 *
 *  2. Phase 2 — Build a world-space MeshBVH from those triangles. This is
 *     the same approach the coverage worker uses; here we build it on the
 *     main thread purely for the heatmap shadow tests (no worker overhead).
 *
 *  3. Phase 3 — Area-proportional sample generation.
 *     Each triangle emits  `round(area × densityScale)` random points
 *     (minimum 1).  `densityScale` = (density × totalTriCount) / totalArea,
 *     so the average triangle always gets `density` samples while huge floor
 *     triangles get proportionally more.  Points are placed with a uniform
 *     barycentric distribution (fold method).
 *
 *  4. Phase 4 — Per-point visibility / shadow-ray test.
 *     For every sample point P and every camera centre C we cast a shadow
 *     ray from  P + dir*ε  toward C  through the BVH.  If no occluder is
 *     found before C (or the hit is past C), the camera can see P.
 *     score = visibleCameras / totalCameras → red (0) → yellow → green (1).
 *
 *  5. Phase 5 — Build THREE.Points with a Gaussian-disk GLSL shader.
 *
 * Because visibility is tested at each sample point rather than per-triangle,
 * the heatmap is spatially continuous and independent of mesh tessellation.
 * A floor with only 2 huge triangles will show a smooth gradient across its
 * surface anywhere cameras overlap.
 *
 * ## Live parameters (CoverageHeatmapNode plugs)
 *
 *   density   — samples per triangle (default 4). Changing this triggers a
 *               full point-cloud rebuild (debounced in CoveragePanel).
 *   pointSize — world-radius multiplier (default 1.0). Only updates the
 *               GLSL uniform — no rebuild needed.
 *   opacity   — alpha scale (default 0.9). Only updates the GLSL uniform.
 */

import * as THREE  from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshSourceRef, CameraFrustum } from './CoverageResults';

// ── GLSL ──────────────────────────────────────────────────────────────────────

const VERT_SHADER = /* glsl */`
  attribute vec3  aColor;
  varying   vec3  vColor;
  uniform   float uWorldSize;   // Gaussian disk world-space radius

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Perspective-correct screen size: larger closer, smaller farther.
    gl_PointSize = uWorldSize * projectionMatrix[0][0] * 300.0 / max(-mv.z, 0.001);
    gl_Position  = projectionMatrix * mv;
  }
`;

const FRAG_SHADER = /* glsl */`
  varying   vec3  vColor;
  uniform   float uOpacity;

  void main() {
    vec2  uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;
    float alpha = exp(-r2 * 3.0) * uOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Score [0,1] → sRGB (red → yellow → green). */
function scoreToRGB(score: number): [number, number, number] {
  const c = new THREE.Color().setHSL(
    Math.min(1, Math.max(0, score)) * (120 / 360),
    1.0,
    0.5,
  );
  return [c.r, c.g, c.b];
}

/**
 * Mulberry32 — fast deterministic PRNG seeded per-triangle.
 * Returns a closure that yields floats ∈ [0, 1).
 */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Args / state types ────────────────────────────────────────────────────────

/** Re-exported for consumers. */
export type { CameraFrustum };

/** Captured call args so updateDensity() can trigger a full rebuild. */
interface ApplyArgs {
  cameraCenters: CameraFrustum[];
  sources:       MeshSourceRef[];
  nodeMap:       Map<string, THREE.Object3D>;
  scene:         THREE.Scene;
  density:       number;
  pointSizeMult: number;
  opacity:       number;
}

interface DimmedMesh {
  mesh:                THREE.Mesh;
  matIndex:            number;
  originalOpacity:     number;
  originalTransparent: boolean;
}

// ── Main export ───────────────────────────────────────────────────────────────

export class HeatmapApplier {
  private _points:   THREE.Points | null = null;
  private _scene:    THREE.Scene  | null = null;
  private _dimmed:   DimmedMesh[] = [];
  private _active    = false;
  private _lastArgs: ApplyArgs | null = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  apply(
    cameraCenters: CameraFrustum[],
    sources:       MeshSourceRef[],
    nodeMap:       Map<string, THREE.Object3D>,
    scene:         THREE.Scene,
    density       = 4,
    pointSizeMult = 1.0,
    opacity       = 0.9,
  ): void {
    this._lastArgs = { cameraCenters, sources, nodeMap, scene, density, pointSizeMult, opacity };
    this._rebuild(this._lastArgs);
  }

  /** Cheap update — only changes the GLSL uniform, no point rebuild. */
  updatePointSize(mult: number): void {
    if (!this._points) return;
    const mat = this._points.material as THREE.ShaderMaterial;
    const base = mat.userData._baseWorldSize as number;
    mat.uniforms.uWorldSize.value = base * Math.max(0.01, mult);
    if (this._lastArgs) this._lastArgs.pointSizeMult = mult;
  }

  /** Cheap update — only changes the alpha uniform. */
  updateOpacity(opacity: number): void {
    if (!this._points) return;
    const mat = this._points.material as THREE.ShaderMaterial;
    mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, opacity));
    if (this._lastArgs) this._lastArgs.opacity = opacity;
  }

  /** Full point-cloud rebuild (use when density changes). */
  updateDensity(density: number): void {
    if (!this._lastArgs) return;
    this._lastArgs.density = Math.max(1, density);
    this._rebuild(this._lastArgs);
  }

  /** Remove overlay and restore original mesh materials. */
  clear(): void {
    if (this._points) {
      this._scene?.remove(this._points);
      this._points.geometry.dispose();
      (this._points.material as THREE.Material).dispose();
      this._points = null;
    }
    for (const d of this._dimmed) {
      const mats = Array.isArray(d.mesh.material)
        ? d.mesh.material as THREE.Material[]
        : [d.mesh.material as THREE.Material];
      const m = d.matIndex >= 0 ? mats[d.matIndex] : mats[0];
      if (m?.isMaterial) {
        const sm = m as THREE.MeshStandardMaterial;
        sm.opacity     = d.originalOpacity;
        sm.transparent = d.originalTransparent;
        sm.needsUpdate = true;
      }
    }
    this._dimmed   = [];
    this._scene    = null;
    this._active   = false;
    this._lastArgs = null;
  }

  get isActive(): boolean { return this._active; }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _rebuild(args: ApplyArgs): void {
    const { cameraCenters, sources, nodeMap, scene, density, pointSizeMult, opacity } = args;

    // Remove old Points
    if (this._points) {
      this._scene?.remove(this._points);
      this._points.geometry.dispose();
      (this._points.material as THREE.Material).dispose();
      this._points = null;
    }
    if (!this._active) {
      this._dimmed = [];
    }
    this._scene  = scene;
    this._active = false;

    const nCams = cameraCenters.length;

    // ── Phase 1: collect all world-space triangle vertices ────────────────
    // triVerts: flat [ax,ay,az, bx,by,bz, cx,cy,cz, ...] — 9 floats / tri
    const triVerts: number[] = [];
    const triAreas: number[] = [];
    let   totalArea   = 0;
    let   edgeLenSum  = 0;
    let   edgeSamples = 0;
    const MAX_EDGE_SAMPLES = 600;

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const AB = new THREE.Vector3();
    const AC = new THREE.Vector3();

    const byNode = new Map<string, MeshSourceRef[]>();
    for (const src of sources) {
      let arr = byNode.get(src.dagNodeId);
      if (!arr) { arr = []; byNode.set(src.dagNodeId, arr); }
      arr.push(src);
    }

    const isFirstBuild = this._dimmed.length === 0;

    for (const [dagNodeId, nodeSources] of byNode) {
      const root = nodeMap.get(dagNodeId);
      if (!root) continue;

      const byName = new Map<string, MeshSourceRef>();
      for (const s of nodeSources) byName.set(s.meshName, s);

      const unnamedSources = nodeSources.filter(
        s => s.meshName === '(mesh)' || s.meshName === '(primitive)',
      );
      let unnamedIdx = 0;

      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!obj.visible) return;
        const mat = obj.material;
        const isWireframe = Array.isArray(mat)
          ? mat.every((m: THREE.Material) => (m as any).wireframe === true)
          : (mat as any).wireframe === true;
        if (isWireframe) return;

        const src = byName.get(obj.name) ?? unnamedSources[unnamedIdx++];
        if (!src) return;

        obj.updateWorldMatrix(true, false);
        const world = obj.matrixWorld;

        const origGeo     = obj.geometry as THREE.BufferGeometry;
        const geo         = origGeo.index !== null ? origGeo.toNonIndexed() : origGeo;
        const posAttr     = geo.attributes.position as THREE.BufferAttribute;
        const localTriCount = Math.floor(posAttr.count / 3);

        for (let t = 0; t < localTriCount; t++) {
          vA.fromBufferAttribute(posAttr, t * 3 + 0).applyMatrix4(world);
          vB.fromBufferAttribute(posAttr, t * 3 + 1).applyMatrix4(world);
          vC.fromBufferAttribute(posAttr, t * 3 + 2).applyMatrix4(world);

          AB.subVectors(vB, vA);
          AC.subVectors(vC, vA);
          const area = AB.clone().cross(AC).length() * 0.5;

          triVerts.push(
            vA.x, vA.y, vA.z,
            vB.x, vB.y, vB.z,
            vC.x, vC.y, vC.z,
          );
          triAreas.push(area);
          totalArea += area;

          if (edgeSamples < MAX_EDGE_SAMPLES) {
            edgeLenSum += AB.length();
            edgeSamples++;
          }
        }

        if (geo !== origGeo) geo.dispose();

        // Dim the underlying mesh (first build only)
        if (isFirstBuild) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m: THREE.Material, mi: number) => {
            if (!m.isMaterial) return;
            const sm = m as THREE.MeshStandardMaterial;
            this._dimmed.push({
              mesh:                obj,
              matIndex:            Array.isArray(obj.material) ? mi : -1,
              originalOpacity:     sm.opacity     ?? 1,
              originalTransparent: sm.transparent ?? false,
            });
            sm.transparent = true;
            sm.opacity     = 0.18;
            sm.needsUpdate = true;
          });
        }
      });
    }

    const totalTriCount = triAreas.length;
    if (totalTriCount === 0) return;

    // ── Phase 2: build world-space MeshBVH for per-point shadow testing ───
    //
    // The geometry is world-space non-indexed — same format used in the
    // coverage worker.  We build it on the main thread and dispose it after
    // all points have been assigned a score.
    const bvhGeo = new THREE.BufferGeometry();
    bvhGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(triVerts), 3),
    );
    const bvh = new MeshBVH(bvhGeo, { strategy: 0 /* SAH */ });

    // ── Phase 3: area-proportional density scale ──────────────────────────
    const densityScale = totalArea > 0
      ? (density * totalTriCount) / totalArea
      : density;

    // ── Phase 4: generate points + per-point shadow-ray visibility ────────
    const positions: number[] = [];
    const colors:    number[] = [];

    const SHADOW_EPS = 1e-3;
    const tempRay    = new THREE.Ray();
    const tempDir    = new THREE.Vector3();
    const tempOrigin = new THREE.Vector3();

    for (let t = 0; t < totalTriCount; t++) {
      const b  = t * 9;
      const ax = triVerts[b],     ay = triVerts[b + 1], az = triVerts[b + 2];
      const bx = triVerts[b + 3], by = triVerts[b + 4], bz = triVerts[b + 5];
      const cx = triVerts[b + 6], cy = triVerts[b + 7], cz = triVerts[b + 8];

      const samplesPerTri = Math.max(1, Math.round(triAreas[t] * densityScale));
      const rng = makePrng(t * 2654435761);

      for (let s = 0; s < samplesPerTri; s++) {
        // Uniform barycentric distribution via fold method
        let u = rng();
        let v = rng();
        if (u + v > 1.0) { u = 1.0 - u; v = 1.0 - v; }
        const w = 1.0 - u - v;

        const px = ax * w + bx * u + cx * v;
        const py = ay * w + by * u + cy * v;
        const pz = az * w + bz * u + cz * v;

        // ── Per-camera frustum + shadow-ray visibility test ─────────────
        //
        // For each camera:
        //   1. Frustum check: is P inside the camera's field of view gate?
        //      - compute d = P − camPos (vector from camera to P)
        //      - depth = −dot(d, back)   (positive = in front of camera)
        //      - cx    =  dot(d, right)  horizontal projection
        //      - cy    =  dot(d, up)     vertical projection
        //      Reject if depth outside [nearClip, farClip] or
        //      |cx/depth| > tanHalfFovH or |cy/depth| > tanHalfFovV.
        //   2. Shadow ray from P toward the camera centre to check occlusion.
        //
        let visible = 0;
        for (let ci = 0; ci < nCams; ci++) {
          const cam = cameraCenters[ci];

          // d = P − camPos  (camera-to-point vector)
          const d_x = px - cam.x;
          const d_y = py - cam.y;
          const d_z = pz - cam.z;

          // Camera-local depth (positive when P is in front)
          // depth = −dot(d, back)  because camera looks down −Z = −back
          const depth = -(d_x * cam.backX + d_y * cam.backY + d_z * cam.backZ);

          // Near/far clip check
          if (depth < cam.nearClip || depth > cam.farClip) continue;

          // Rectangular gate (FOV) check
          const cx = d_x * cam.rightX + d_y * cam.rightY + d_z * cam.rightZ;
          const cy = d_x * cam.upX    + d_y * cam.upY    + d_z * cam.upZ;
          if (Math.abs(cx) > depth * cam.tanHalfFovH) continue;
          if (Math.abs(cy) > depth * cam.tanHalfFovV) continue;

          // Euclidean distance for shadow ray termination
          const distToCam = Math.sqrt(d_x * d_x + d_y * d_y + d_z * d_z);
          if (distToCam < 0.001) { visible++; continue; }

          // Direction from P toward camera = −d / |d|
          const invDist = 1.0 / distToCam;
          tempDir.set(-d_x * invDist, -d_y * invDist, -d_z * invDist);

          // Offset origin to avoid self-intersection
          tempOrigin.set(
            px + tempDir.x * SHADOW_EPS,
            py + tempDir.y * SHADOW_EPS,
            pz + tempDir.z * SHADOW_EPS,
          );
          tempRay.set(tempOrigin, tempDir);

          const hit = bvh.raycastFirst(tempRay, THREE.DoubleSide as THREE.Side);
          // No hit → unoccluded.  Hit past camera → not blocked.
          if (!hit || hit.distance >= distToCam - SHADOW_EPS) {
            visible++;
          }
        }

        const score = nCams > 0 ? visible / nCams : 0;
        const [r, g, bl] = scoreToRGB(score);

        positions.push(px, py, pz);
        colors.push(r, g, bl);
      }
    }

    // Free the temporary BVH geometry
    bvhGeo.dispose();

    if (positions.length === 0) return;

    // ── Phase 5: auto world-point-size + build THREE.Points ──────────────
    const avgEdge       = edgeSamples > 0 ? edgeLenSum / edgeSamples : 0.05;
    const baseWorldSize = Math.max(avgEdge * 2.2, 0.01);
    const worldSize     = baseWorldSize * Math.max(0.01, pointSizeMult);

    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    ptGeo.setAttribute('aColor',   new THREE.BufferAttribute(new Float32Array(colors),    3));

    const ptMat = new THREE.ShaderMaterial({
      vertexShader:   VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms:       {
        uWorldSize: { value: worldSize },
        uOpacity:   { value: Math.max(0, Math.min(1, opacity)) },
      },
      transparent: true,
      depthTest:   true,
      depthWrite:  false,
      blending:    THREE.NormalBlending,
    });
    ptMat.userData._baseWorldSize = baseWorldSize;

    this._points = new THREE.Points(ptGeo, ptMat);
    this._points.renderOrder = 999;
    scene.add(this._points);

    this._active = true;
  }
}


