/**
 * CoverageResults — data types for all photogrammetry coverage outputs.
 *
 * This file is intentionally free of heavy dependencies so it can be
 * imported in both the main thread and inside Web Workers.
 */

// ── Per-camera ───────────────────────────────────────────────────────────────

/** Summary statistics for a single camera after ray casting. */
export interface PerCameraResult {
  /** UUID of the CameraNode. */
  cameraId: string;
  /** Friendly display name. */
  cameraName: string;
  /** Set of triangle indices (into the merged geometry) that were hit. */
  visibleTriangleIds: Set<number>;
  /** Estimated visible surface area in scene units² (sum of hit triangle areas). */
  visibleArea: number;
  /** Fraction of cast rays that hit nothing [0, 1]. Proxy for sky/background fraction. */
  backgroundRatio: number;
  /** Number of rays that were cast (samples). */
  sampleCount: number;
  /** Depth statistics across visible hits (in scene units). */
  depthP10: number;
  depthP50: number;
  depthP90: number;
}

// ── Per camera-pair ──────────────────────────────────────────────────────────

/** Photogrammetric relationship between two cameras. */
export interface PerPairResult {
  camIdA: string;
  camIdB: string;
  /** Jaccard overlap: |A ∩ B| / |A ∪ B| ∈ [0, 1] */
  overlapFraction: number;
  /**
   * Median baseline-to-depth ratio: B/D = |C_B − C_A| / avg_depth.
   * Reliable reconstruction: B/D ∈ [0.1, 0.6].
   */
  baselineDepthRatioP50: number;
  /**
   * Median triangulation angle across shared visible triangles (degrees).
   * Ideal: 20–30°.
   */
  triangulationAngleP50Deg: number;
  /** Number of shared visible triangles. */
  sharedTriangleCount: number;
}

// ── Per-triangle ─────────────────────────────────────────────────────────────

/** Per-triangle coverage assessment (aggregated across all cameras). */
export interface PerTriangleResult {
  /** Index into the merged geometry's triangle list. */
  triangleIndex: number;
  /** How many cameras saw this triangle. */
  viewCount: number;
  /**
   * Best (minimum) incidence angle across all viewing cameras (degrees).
   * Lower is better (0° = perpendicular).
   */
  bestIncidenceAngleDeg: number;
  /**
   * Best triangulation angle among all camera pairs observing this triangle (deg).
   * Ideal: ~25°.
   */
  bestTriangulationAngleDeg: number;
  /**
   * Combined coverage quality score in [0, 1].
   * Q = 0.30·s_v + 0.35·s_t + 0.25·s_i + 0.10·s_d
   */
  coverageScore: number;
}

// ── Global result ────────────────────────────────────────────────────────────

/**
 * Full camera frustum data needed by HeatmapApplier for per-point
 * visibility tests that respect the camera gate, FOV and clip planes.
 */
export interface CameraFrustum {
  /** Camera position in world space. */
  x: number; y: number; z: number;
  /**
   * Unit-vector axes extracted from the camera's world matrix.
   * Three.js convention: camera looks down −Z local → column 2 of the
   * world matrix is the world-space BACKWARD (+Z) direction.
   */
  rightX: number; rightY: number; rightZ: number;
  upX:    number; upY:    number; upZ:    number;
  backX:  number; backY:  number; backZ:  number;
  /** tan(halfFovH) and tan(halfFovV) — used for fast rectangular gate test. */
  tanHalfFovH: number;
  tanHalfFovV: number;
  /** Near and far clip distances (scene units). */
  nearClip: number;
  farClip:  number;
}

/**
 * Minimal mesh attribution info needed by HeatmapApplier.
 * Mirrors SourceMeshInfo from GeometryExtractor but lives here so
 * CoverageGlobalResult can carry it without a Three.js dependency.
 */
export interface MeshSourceRef {
  /** UUID of the DAG node that owns this mesh. */
  dagNodeId: string;
  /** Name of the Three.js mesh inside the loaded scene. */
  meshName: string;
  /** First triangle index in the merged geometry. */
  triOffset: number;
  /** Number of triangles this mesh contributes. */
  triCount: number;
}

/** Top-level output of a single coverage analysis run. */
export interface CoverageGlobalResult {
  /** Fraction of scene triangles seen by ≥1 camera. */
  coveragePercent: number;
  /** Fraction of scene triangles seen by ≥2 cameras (stereo coverage). */
  stereoCoveragePercent: number;
  /** P50 coverage quality score across all triangles. */
  qualityScoreP50: number;
  /** P25 coverage quality score (robust lower-bound). */
  qualityScoreP25: number;
  /** Per-camera results in the order cameras were processed. */
  perCamera: PerCameraResult[];
  /** All N*(N-1)/2 camera-pair results. */
  perPair: PerPairResult[];
  /** Ordered by triangleIndex. Length = total triangle count. */
  perTriangle: PerTriangleResult[];
  /** Total number of triangles in the merged scene geometry. */
  totalTriangleCount: number;
  /** Wall-clock milliseconds for the full analysis. */
  elapsedMs: number;
  /** Source mesh info needed by HeatmapApplier to apply colours. */
  sourceMeshes: MeshSourceRef[];
  /**
   * Full frustum data for each camera that was analysed.
   * Used by HeatmapApplier for per-point frustum + shadow-ray visibility
   * tests that respect each camera's gate, FOV and clip planes.
   */
  cameraCenters: CameraFrustum[];
}

// ── Progress updates ─────────────────────────────────────────────────────────

export interface AnalysisProgress {
  /** 0.0 – 1.0 */
  fraction: number;
  message: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

/** User-configurable parameters for a coverage run. */
export interface CoverageConfig {
  /** Horizontal sample grid size (number of columns). Default: auto from resolution. */
  gridCols?: number;
  /** Vertical sample grid size (number of rows). Default: auto from resolution. */
  gridRows?: number;
  /** Sampling mode. */
  samplingMode: 'uniform' | 'adaptive';
  /** PRNG seed for deterministic jitter. */
  seed: number;
  /** Target number of views for full s_v score. Default: 3. */
  targetViewCount: number;
  /** Scoring weights (must sum to 1). */
  weights?: {
    viewCount: number;       // default 0.30
    triangulation: number;   // default 0.35
    incidence: number;       // default 0.25
    density: number;         // default 0.10
  };
}

export const DEFAULT_COVERAGE_CONFIG: CoverageConfig = {
  samplingMode: 'uniform',
  seed: 42,
  targetViewCount: 3,
  weights: { viewCount: 0.30, triangulation: 0.35, incidence: 0.25, density: 0.10 },
};

// ── Serialisable ray hit (for Worker → main thread transfer) ─────────────────

/** Compact ray-hit record returned from the coverage worker. */
export interface RayHit {
  /** Sample index within the batch (≥0). −1 means no hit (background). */
  sampleIndex: number;
  /** Hit triangle index in the merged geometry; −1 if no hit. */
  triangleIndex: number;
  /** Hit distance along the ray (t). 0 if no hit. */
  t: number;
  /** Hit point in world space. Zero vector if no hit. */
  pointX: number;
  pointY: number;
  pointZ: number;
  /** Surface normal at hit point (face normal). Zero if no hit. */
  normalX: number;
  normalY: number;
  normalZ: number;
}
