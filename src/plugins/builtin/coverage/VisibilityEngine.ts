/**
 * VisibilityEngine — orchestrates geometry extraction → BVH build → ray casting
 * → metrics computation for a full photogrammetry coverage analysis.
 *
 * Runs the BVH build + ray casting inside a Web Worker (WorkerClient).
 * Metrics computation runs on the main thread after the worker results return.
 *
 * Usage:
 * ```ts
 * const engine = new VisibilityEngine(core, viewportManager, progressCallback);
 * const result = await engine.run(config);
 * engine.dispose();
 * ```
 */

import * as THREE from 'three';
import type { EngineCore }       from '../../../core/EngineCore';
import type { ViewportManager }  from '../../../core/viewport/ViewportManager';
import { CameraNode, FilmFit }   from '../../../core/dag/CameraNode';
import { buildIntrinsics, pixelToWorldRay } from '../../../core/math/CameraModel';
import { GeometryExtractor }     from './GeometryExtractor';
import { WorkerClient }          from './WorkerClient';
import {
  stratifiedSamplesBuffer,
  autoGridSize,
}                                from './RaySampler';
import {
  computePerCamera,
  computePerPair,
  computePerTriangle,
  computeGlobalResult,
}                                from './MetricsComputer';
import type {
  CoverageConfig,
  CoverageGlobalResult,
  CameraFrustum,
  AnalysisProgress,
}                                from './CoverageResults';

export type ProgressCallback = (progress: AnalysisProgress) => void;

export class VisibilityEngine {
  private readonly _core: EngineCore;
  private readonly _vm: ViewportManager;
  private readonly _onProgress?: ProgressCallback;
  private _worker: WorkerClient | null = null;

  constructor(
    core: EngineCore,
    viewportManager: ViewportManager,
    onProgress?: ProgressCallback,
  ) {
    this._core = core;
    this._vm   = viewportManager;
    this._onProgress = onProgress;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Run a full coverage analysis.
   * Returns a GlobalResult when done, or throws on fatal error.
   */
  async run(
    config: CoverageConfig,
    renderW: number,
    renderH: number,
  ): Promise<CoverageGlobalResult> {
    const t0 = performance.now();
    this._report(0.0, 'Extracting scene geometry…');

    // 1. Extract geometry
    const extracted = GeometryExtractor.extract(
      this._core.sceneGraph,
      this._vm,
    );
    if (!extracted) {
      throw new Error('No visible mesh geometry found in the scene. Import a GLTF/GLB model first.');
    }

    this._report(0.05, `Merged ${extracted.triangleCount.toLocaleString()} triangles — building BVH…`);

    // 2. Build BVH in worker
    this._worker = new WorkerClient();
    await this._worker.buildBVH(extracted);

    this._report(0.15, 'BVH ready — collecting cameras…');

    // 3. Collect camera nodes from the scene graph
    const camerasNodes: CameraNode[] = [];
    for (const node of this._core.sceneGraph.getAllNodes()) {
      if (node instanceof CameraNode) {
        camerasNodes.push(node as CameraNode);
      }
    }

    if (camerasNodes.length === 0) {
      this._worker.dispose();
      throw new Error('No cameras found in the scene. Add at least one Camera node.');
    }

    // 4. Cast rays for each camera
    const perCameraResults = [];
    const cameraCenters: THREE.Vector3[]  = [];  // kept for MetricsComputer (needs Vector3)
    const cameraFrustums: CameraFrustum[] = [];  // kept for HeatmapApplier (needs full frustum)
    const posArray = (extracted.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const idxArray = extracted.geometry.index
      ? new Uint32Array(extracted.geometry.index.array as ArrayLike<number>)
      : null;
    const normArray = extracted.geometry.attributes.normal
      ? (extracted.geometry.attributes.normal as THREE.BufferAttribute).array as Float32Array
      : null;

    const cameraProgress = 0.80; // fraction of progress allocated to ray casting
    const progressPerCam = cameraProgress / camerasNodes.length;

    for (let ci = 0; ci < camerasNodes.length; ci++) {
      const camNode = camerasNodes[ci];
      this._report(0.15 + ci * progressPerCam, `Casting rays: ${camNode.name} (${ci + 1}/${camerasNodes.length})…`);

      // Get the Three.js camera world matrix via ViewportManager nodeMap
      const nodeMap: Map<string, THREE.Object3D> = (this._vm as any).nodeMap;
      const threeObj = nodeMap?.get(camNode.uuid);
      let worldMatrix = new THREE.Matrix4();

      if (threeObj) {
        threeObj.updateWorldMatrix(true, false);
        worldMatrix = threeObj.matrixWorld.clone();
      } else {
        // Fallback: build world matrix from DAG TRS plugs
        worldMatrix = dagNodeToWorldMatrix(camNode);
      }

      // Extract camera centre from world matrix
      const camCenter = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
      cameraCenters.push(camCenter);

      // Build intrinsics (resolution from viewport settings)
      const aspect = renderW / renderH;
      const projData = camNode.getProjectionData(aspect);

      // Build intrinsics using the full formula (consistent with CameraModel)
      const intrinsics = buildIntrinsics(
        camNode.focalLength.getValue(),
        camNode.horizontalFilmAperture.getValue(),
        camNode.verticalFilmAperture.getValue(),
        camNode.filmFit.getValue() as FilmFit,
        renderW,
        renderH,
        camNode.nearClip.getValue(),
        camNode.farClip.getValue(),
      );
      void projData; // projData used for Three.js PerspectiveCamera; we use our own intrinsics

      // Build full frustum descriptor for HeatmapApplier.
      // extractBasis gives: col0=right(+X), col1=up(+Y), col2=back(+Z)
      // (Three.js cameras look down -Z in local space, so col2 is the
      //  world-space BACKWARD direction — negate it to get forward).
      {
        const right = new THREE.Vector3();
        const up    = new THREE.Vector3();
        const back  = new THREE.Vector3();
        worldMatrix.extractBasis(right, up, back);
        right.normalize(); up.normalize(); back.normalize();
        cameraFrustums.push({
          x: camCenter.x, y: camCenter.y, z: camCenter.z,
          rightX: right.x, rightY: right.y, rightZ: right.z,
          upX:    up.x,    upY:    up.y,    upZ:    up.z,
          backX:  back.x,  backY:  back.y,  backZ:  back.z,
          tanHalfFovH: Math.tan(intrinsics.fovHRad / 2),
          tanHalfFovV: Math.tan(intrinsics.fovVRad / 2),
          nearClip: camNode.nearClip.getValue(),
          farClip:  camNode.farClip.getValue(),
        });
      }

      // Determine sample grid
      const cols = config.gridCols ?? autoGridSize(renderW, renderH).cols;
      const rows = config.gridRows ?? autoGridSize(renderW, renderH).rows;
      const seed = config.seed + ci; // different seed per camera

      const pixelSamples = stratifiedSamplesBuffer(renderW, renderH, cols, rows, seed);
      const sampleCount  = cols * rows;

      // Build ray directions for each sample
      const directions = new Float32Array(sampleCount * 3);
      for (let s = 0; s < sampleCount; s++) {
        const u = pixelSamples[s * 2];
        const v = pixelSamples[s * 2 + 1];
        const { direction } = pixelToWorldRay(u, v, intrinsics, worldMatrix);
        directions[s * 3]     = direction.x;
        directions[s * 3 + 1] = direction.y;
        directions[s * 3 + 2] = direction.z;
      }

      // Cast in worker
      const castResult = await this._worker.castRays(camNode.uuid, camCenter, directions);

      // Debug: log hit statistics
      const hitCount = castResult.triangleIndices.reduce((n, t) => n + (t >= 0 ? 1 : 0), 0);
      const uniqueTris = new Set(castResult.triangleIndices.filter(t => t >= 0)).size;
      console.debug(
        `[Coverage] ${camNode.name}: ${hitCount}/${sampleCount} rays hit,`,
        `${uniqueTris} unique triangles,`,
        `origin=(${camCenter.x.toFixed(2)},${camCenter.y.toFixed(2)},${camCenter.z.toFixed(2)})`,
        `fovH=${(intrinsics.fovHRad * 180 / Math.PI).toFixed(1)}° fovV=${(intrinsics.fovVRad * 180 / Math.PI).toFixed(1)}°`,
      );

      // Compute per-camera metrics
      const camMetrics = computePerCamera(castResult, camNode.name, posArray, idxArray);
      perCameraResults.push({ castResult, camMetrics });
    }

    this._report(0.95, 'Computing pair and triangle metrics…');

    // 5. Per-pair metrics
    const perPair = [];
    for (let a = 0; a < perCameraResults.length; a++) {
      for (let b = a + 1; b < perCameraResults.length; b++) {
        perPair.push(computePerPair(
          perCameraResults[a].camMetrics,
          perCameraResults[b].camMetrics,
          cameraCenters[a],
          cameraCenters[b],
          posArray,
          idxArray,
        ));
      }
    }

    // 6. Per-triangle quality scores
    const allCastResults = perCameraResults.map(r => r.castResult);
    const perTriangle = computePerTriangle(
      allCastResults,
      cameraCenters,
      posArray,
      idxArray,
      normArray,
      extracted.triangleCount,
      config,
    );

    // 7. Assemble global result
    // Save source refs BEFORE disposing extracted geometry
    const sourceMeshes = extracted.sourceMeshes.map(s => ({
      dagNodeId: s.dagNodeId,
      meshName:  s.meshName,
      triOffset: s.triOffset,
      triCount:  s.triCount,
    }));

    const perCamera = perCameraResults.map(r => r.camMetrics);
    const global = computeGlobalResult(
      perCamera,
      perPair,
      perTriangle,
      extracted.triangleCount,
      performance.now() - t0,
    );

    // Clean up
    this._worker.dispose();
    this._worker = null;
    extracted.geometry.dispose();

    this._report(1.0, `Done — ${global.coveragePercent.toFixed(1)}% coverage in ${global.elapsedMs.toFixed(0)} ms`);
    return {
      ...global,
      sourceMeshes,
      cameraCenters: cameraFrustums,
    };
  }

  /** Call to release resources if run() is not completed. */
  dispose(): void {
    this._worker?.dispose();
    this._worker = null;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _report(fraction: number, message: string): void {
    this._onProgress?.({ fraction, message });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a world matrix from a DAG node's TRS plugs (fallback when nodeMap has no entry). */
function dagNodeToWorldMatrix(node: CameraNode): THREE.Matrix4 {
  const t = node.translate.getValue();
  const r = node.rotate.getValue();
  const s = node.scale.getValue();

  const euler = new THREE.Euler(
    r.x * (Math.PI / 180),
    r.y * (Math.PI / 180),
    r.z * (Math.PI / 180),
    'XYZ',
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);

  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(t.x, t.y, t.z),
    quat,
    new THREE.Vector3(s.x, s.y, s.z),
  );
  return m;
}
