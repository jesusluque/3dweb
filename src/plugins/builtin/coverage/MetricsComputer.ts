/**
 * MetricsComputer — aggregates raw ray-cast hits into structured photogrammetry
 * quality metrics.
 *
 * All maths is pure TypeScript (no Three.js DOM dependency) so it can run in a
 * worker if needed.  THREE.Vector3 is used for geometry but not for rendering.
 */

import * as THREE from 'three';
import type { CastResult } from './WorkerClient';
import type { CameraIntrinsics } from '../../../core/math/CameraModel';
import type {
  PerCameraResult,
  PerPairResult,
  PerTriangleResult,
  CoverageGlobalResult,
  CoverageConfig,
} from './CoverageResults';

// ── Percentile helper ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
  return sorted[idx];
}

// ── Per-camera metrics ────────────────────────────────────────────────────────

/**
 * Build per-camera metrics from the raw cast result.
 *
 * @param result      Raw output from the coverage worker for one camera
 * @param cameraName  Human-readable label
 * @param positions   Position attribute of the merged geometry (world space)
 */
export function computePerCamera(
  result: CastResult,
  cameraName: string,
  positions: Float32Array,
  indices: Uint32Array | null,
): PerCameraResult {
  const { triangleIndices, distances, rayCount, cameraId } = result;

  const visSet = new Set<number>();
  const hitDistances: number[] = [];

  let visibleArea = 0;
  const measuredTris = new Set<number>();

  for (let i = 0; i < rayCount; i++) {
    const triIdx = triangleIndices[i];
    if (triIdx < 0) continue;
    visSet.add(triIdx);
    hitDistances.push(distances[i]);

    // Accumulate triangle area (only once per unique triangle)
    if (!measuredTris.has(triIdx)) {
      measuredTris.add(triIdx);
      visibleArea += triangleArea(triIdx, positions, indices);
    }
  }

  hitDistances.sort((a, b) => a - b);

  const missCount = rayCount - hitDistances.length;

  return {
    cameraId,
    cameraName,
    visibleTriangleIds: visSet,
    visibleArea,
    backgroundRatio: rayCount > 0 ? missCount / rayCount : 0,
    sampleCount: rayCount,
    depthP10:  percentile(hitDistances, 0.10),
    depthP50:  percentile(hitDistances, 0.50),
    depthP90:  percentile(hitDistances, 0.90),
  };
}

// ── Per-pair metrics ──────────────────────────────────────────────────────────

/**
 * Compute photogrammetric pair statistics between two cameras.
 *
 * @param rA          Per-camera result for camera A
 * @param rB          Per-camera result for camera B
 * @param centerA     World-space position of camera A
 * @param centerB     World-space position of camera B
 * @param positions   Position attribute of the merged geometry
 * @param indices     Index buffer of the merged geometry (or null for non-indexed)
 */
export function computePerPair(
  rA: PerCameraResult,
  rB: PerCameraResult,
  centerA: THREE.Vector3,
  centerB: THREE.Vector3,
  positions: Float32Array,
  indices: Uint32Array | null,
): PerPairResult {
  // Intersection and union
  const inter: number[] = [];
  for (const id of rA.visibleTriangleIds) {
    if (rB.visibleTriangleIds.has(id)) inter.push(id);
  }
  const unionSize = rA.visibleTriangleIds.size + rB.visibleTriangleIds.size - inter.length;
  const overlapFraction = unionSize > 0 ? inter.length / unionSize : 0;

  // Baseline length (world units)
  const baselineVec = centerB.clone().sub(centerA);
  const baselineLen = baselineVec.length();

  const bdRatios: number[] = [];
  const triAngles: number[] = [];

  const cA = centerA;
  const cB = centerB;

  for (const triIdx of inter) {
    const centroid = triangleCentroid(triIdx, positions, indices);
    const dA = centroid.distanceTo(cA);
    const dB = centroid.distanceTo(cB);
    const avgDepth = (dA + dB) / 2;
    if (avgDepth > 0) {
      bdRatios.push(baselineLen / avgDepth);
    }

    // Triangulation angle
    const vA = cA.clone().sub(centroid).normalize();
    const vB = cB.clone().sub(centroid).normalize();
    const cosAngle = Math.min(1, Math.max(-1, vA.dot(vB)));
    const angleDeg = Math.acos(cosAngle) * (180 / Math.PI);
    triAngles.push(angleDeg);
  }

  bdRatios.sort((a, b) => a - b);
  triAngles.sort((a, b) => a - b);

  return {
    camIdA: rA.cameraId,
    camIdB: rB.cameraId,
    overlapFraction,
    baselineDepthRatioP50: percentile(bdRatios, 0.50),
    triangulationAngleP50Deg: percentile(triAngles, 0.50),
    sharedTriangleCount: inter.length,
  };
}

// ── Per-triangle metrics ──────────────────────────────────────────────────────

/**
 * Compute per-triangle coverage quality scores.
 *
 * Quality score formula:
 *   Q = w_v·s_v + w_t·s_t + w_i·s_i + w_d·s_d
 *
 * where:
 *   s_v = min(viewCount / targetViewCount, 1)                        [view count score]
 *   s_i = max(0, cos(bestIncidenceAngle))                            [incidence score]
 *   s_t = exp(-(bestTriangulationAngle − 25)² / 200)                 [triangulation score]
 *   s_d = constant 1.0 (density bundled into sample count; extend if needed)
 *
 * Aggregation: robust P25 across per-camera incidence angles to resist outliers.
 */
export function computePerTriangle(
  castResults: CastResult[],
  cameraCenters: THREE.Vector3[],
  positions: Float32Array,
  indices: Uint32Array | null,
  normals: Float32Array | null,
  totalTriCount: number,
  config: CoverageConfig,
): PerTriangleResult[] {
  const w = config.weights ?? { viewCount: 0.30, triangulation: 0.35, incidence: 0.25, density: 0.10 };
  const targetViews = config.targetViewCount;

  // --- Collect per-triangle data ---
  // viewCount, list of incidence angles, list of triangulation angles
  type TriData = {
    viewCount: number;
    incidenceAngles: number[];     // per-camera incidence angle (degrees)
    triangulationAngles: number[]; // per-camera-pair best triangulation angle
  };

  const triData: TriData[] = Array.from({ length: totalTriCount }, () => ({
    viewCount: 0,
    incidenceAngles: [],
    triangulationAngles: [],
  }));

  // Pass 1: collect per-triangle visible camera list + incidence angles
  for (let ci = 0; ci < castResults.length; ci++) {
    const castResult = castResults[ci];
    const camCenter  = cameraCenters[ci];
    const { triangleIndices, rayCount } = castResult;
    const seenThisCamera = new Set<number>();

    for (let r = 0; r < rayCount; r++) {
      const triIdx = triangleIndices[r];
      if (triIdx < 0 || triIdx >= totalTriCount) continue;
      if (seenThisCamera.has(triIdx)) continue;
      seenThisCamera.add(triIdx);

      const td = triData[triIdx];
      td.viewCount++;

      // Incidence angle: angle between viewing direction and face normal
      const centroid = triangleCentroid(triIdx, positions, indices);
      const viewVec  = camCenter.clone().sub(centroid).normalize();
      const normal   = getFaceNormal(triIdx, positions, indices, normals);
      const cosInc   = Math.min(1, Math.max(-1, viewVec.dot(normal)));
      const incDeg   = Math.acos(Math.abs(cosInc)) * (180 / Math.PI); // use abs for double-sided
      td.incidenceAngles.push(incDeg);
    }
  }

  // Pass 2: compute triangulation angles for all pairs of cameras that see each triangle
  // Build per-triangle "which cameras see it" map
  const triCams: number[][] = Array.from({ length: totalTriCount }, () => []);
  for (let ci = 0; ci < castResults.length; ci++) {
    const { triangleIndices, rayCount } = castResults[ci];
    const seen = new Set<number>();
    for (let r = 0; r < rayCount; r++) {
      const triIdx = triangleIndices[r];
      if (triIdx >= 0 && triIdx < totalTriCount && !seen.has(triIdx)) {
        seen.add(triIdx);
        triCams[triIdx].push(ci);
      }
    }
  }

  for (let triIdx = 0; triIdx < totalTriCount; triIdx++) {
    const cams = triCams[triIdx];
    if (cams.length < 2) continue;
    const centroid = triangleCentroid(triIdx, positions, indices);
    const td = triData[triIdx];

    // For efficiency, only consider the best (largest) triangulation angle
    let bestAngle = 0;
    for (let a = 0; a < cams.length; a++) {
      for (let b = a + 1; b < cams.length; b++) {
        const vA = cameraCenters[cams[a]].clone().sub(centroid).normalize();
        const vB = cameraCenters[cams[b]].clone().sub(centroid).normalize();
        const cos = Math.min(1, Math.max(-1, vA.dot(vB)));
        const angleDeg = Math.acos(cos) * (180 / Math.PI);
        if (angleDeg > bestAngle) bestAngle = angleDeg;
      }
    }
    td.triangulationAngles.push(bestAngle);
  }

  // Pass 3: compute per-triangle scores
  const results: PerTriangleResult[] = [];

  for (let triIdx = 0; triIdx < totalTriCount; triIdx++) {
    const td = triData[triIdx];

    // s_v: view count score
    const sv = Math.min(td.viewCount / targetViews, 1.0);

    // s_i: best incidence score — use P25 (robust lower quartile)
    let bestIncDeg = 90;
    if (td.incidenceAngles.length > 0) {
      const sorted = td.incidenceAngles.slice().sort((a, b) => a - b);
      bestIncDeg = percentile(sorted, 0.25); // P25 = robust best
    }
    const si = Math.max(0, Math.cos(bestIncDeg * (Math.PI / 180)));

    // s_t: triangulation score — Gaussian peaked at 25°
    let st = 0;
    if (td.triangulationAngles.length > 0) {
      const bestTri = Math.max(...td.triangulationAngles);
      st = Math.exp(-Math.pow(bestTri - 25, 2) / 200);
    }

    // s_d: density (simplified — 1 if seen at all, 0 if not)
    const sd = td.viewCount > 0 ? 1.0 : 0.0;

    const q = w.viewCount * sv + w.triangulation * st + w.incidence * si + w.density * sd;

    results.push({
      triangleIndex: triIdx,
      viewCount: td.viewCount,
      bestIncidenceAngleDeg: bestIncDeg,
      bestTriangulationAngleDeg: td.triangulationAngles.length > 0
        ? Math.max(...td.triangulationAngles)
        : 0,
      coverageScore: Math.min(1, Math.max(0, q)),
    });
  }

  return results;
}

// ── Global summary ────────────────────────────────────────────────────────────

export function computeGlobalResult(
  perCamera: PerCameraResult[],
  perPair: PerPairResult[],
  perTriangle: PerTriangleResult[],
  totalTriCount: number,
  elapsedMs: number,
): CoverageGlobalResult {
  const seen1 = perTriangle.filter(t => t.viewCount >= 1).length;
  const seen2 = perTriangle.filter(t => t.viewCount >= 2).length;

  // Quality percentiles computed over SEEN triangles only.
  // Including unseen triangles (score = 0) would make P50 always 0 when
  // coverage < 50 %, which is correct mathematically but useless as a metric.
  const seenScores = perTriangle
    .filter(t => t.viewCount >= 1)
    .map(t => t.coverageScore)
    .sort((a, b) => a - b);
  const qP50 = percentile(seenScores, 0.50);
  const qP25 = percentile(seenScores, 0.25);

  return {
    coveragePercent:       totalTriCount > 0 ? (seen1 / totalTriCount) * 100 : 0,
    stereoCoveragePercent: totalTriCount > 0 ? (seen2 / totalTriCount) * 100 : 0,
    qualityScoreP50:       qP50,
    qualityScoreP25:       qP25,
    perCamera,
    perPair,
    perTriangle,
    totalTriangleCount: totalTriCount,
    elapsedMs,
  };
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function getTriangleVertexIndices(
  triIdx: number,
  indices: Uint32Array | null,
): [number, number, number] {
  if (indices) {
    const base = triIdx * 3;
    return [indices[base], indices[base + 1], indices[base + 2]];
  }
  // Non-indexed
  const base = triIdx * 3;
  return [base, base + 1, base + 2];
}

function triangleArea(
  triIdx: number,
  positions: Float32Array,
  indices: Uint32Array | null,
): number {
  const [a, b, c] = getTriangleVertexIndices(triIdx, indices);
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
  const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  // Cross product magnitude / 2
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  return 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
}

function triangleCentroid(
  triIdx: number,
  positions: Float32Array,
  indices: Uint32Array | null,
): THREE.Vector3 {
  const [a, b, c] = getTriangleVertexIndices(triIdx, indices);
  return new THREE.Vector3(
    (positions[a * 3]     + positions[b * 3]     + positions[c * 3])     / 3,
    (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3,
    (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3,
  );
}

function getFaceNormal(
  triIdx: number,
  positions: Float32Array,
  indices: Uint32Array | null,
  normals: Float32Array | null,
): THREE.Vector3 {
  // If we have normals buffer, average the vertex normals
  if (normals) {
    const [a, b, c] = getTriangleVertexIndices(triIdx, indices);
    return new THREE.Vector3(
      (normals[a * 3]     + normals[b * 3]     + normals[c * 3])     / 3,
      (normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1]) / 3,
      (normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2]) / 3,
    ).normalize();
  }
  // Compute geometric face normal from positions
  const [a, b, c] = getTriangleVertexIndices(triIdx, indices);
  const pA = new THREE.Vector3(positions[a*3], positions[a*3+1], positions[a*3+2]);
  const pB = new THREE.Vector3(positions[b*3], positions[b*3+1], positions[b*3+2]);
  const pC = new THREE.Vector3(positions[c*3], positions[c*3+1], positions[c*3+2]);
  const ab = pB.clone().sub(pA);
  const ac = pC.clone().sub(pA);
  return ab.cross(ac).normalize();
}
