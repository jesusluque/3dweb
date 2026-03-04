/**
 * CameraModel — pure mathematical camera intrinsics and projection helpers.
 *
 * All functions are deterministic and side-effect free — suitable for unit
 * testing without a DOM or WebGL context.
 *
 * ## Coordinate conventions
 * - World space: right-handed, +Y up (Three.js default)
 * - Camera space: +X right, +Y up, camera looks down **−Z**
 * - NDC: x ∈ [−1,1], y ∈ [−1,1] (OpenGL convention)
 *   (y NDC = +1 at top; pixel-space y = 0 at top, increases downward)
 *
 * ## Formulas used
 * See docs/CAMERA_MODEL.md for the full derivation.
 *
 * K matrix (column-major world convention):
 * ```
 *   K = | fx   0   cx |
 *       |  0  fy   cy |
 *       |  0   0    1 |
 * ```
 * where
 *   fx = focalMm * W / (sensorWidthMm)
 *   fy = focalMm * H / (sensorHeightMm)
 *   cx = W / 2   (principal point at image centre, no lens shift)
 *   cy = H / 2
 *
 * Back-projection from pixel (u,v) to a world-space ray:
 *   dir_cam = K⁻¹ · [u, v, 1]ᵀ   (unnormalised; z = 1 in camera space)
 *   dir_world = R · dir_cam        (R = upper-left 3×3 of the camera's world matrix)
 *   origin_world = translation column of worldMatrix
 */

import * as THREE from 'three';
import { FilmFit } from '../dag/CameraNode';

// ── Intrinsics record ────────────────────────────────────────────────────────

/** Camera intrinsics in pixel units. */
export interface CameraIntrinsics {
  /** Image width in pixels. */
  W: number;
  /** Image height in pixels. */
  H: number;
  /** Horizontal focal length in pixels: fx = focalMm * W / sensorWidthMm */
  fx: number;
  /** Vertical focal length in pixels: fy = focalMm * H / sensorHeightMm */
  fy: number;
  /** Principal point x (pixels, from left). Default = W/2. */
  cx: number;
  /** Principal point y (pixels, from top). Default = H/2. */
  cy: number;
  /** Vertical FOV in radians (derived from fy). */
  fovVRad: number;
  /** Horizontal FOV in radians (derived from fx). */
  fovHRad: number;
  /** Near clip plane distance (same units as scene). */
  near: number;
  /** Far clip plane distance. */
  far: number;
}

// ── Intrinsic construction ───────────────────────────────────────────────────

/**
 * Compute camera intrinsics from DCC-style filmback settings.
 *
 * Film-fit modes (matching CameraNode.getProjectionData exactly):
 *  - Horizontal: sensor width governs — scale filmback height to viewport aspect.
 *    fx = focalMm * W / hMm   (sensor width drives fx)
 *    fy = fx                  (square pixels, isotropic)
 *    Effective sensorH = hMm / viewportAspect
 *  - Vertical: sensor height governs.
 *    fy = focalMm * H / vMm
 *    fx = fy
 *  - Fill:  horizontal if viewportAspect > filmAspect, else vertical.
 *  - Overscan: vertical if viewportAspect >= filmAspect, else horizontal.
 *
 * @param focalMm        Focal length in mm
 * @param apertureInW    Sensor width in inches (CameraNode.horizontalFilmAperture)
 * @param apertureInH    Sensor height in inches (CameraNode.verticalFilmAperture)
 * @param fit            FilmFit enum value
 * @param W              Render width in pixels
 * @param H              Render height in pixels
 * @param near           Near clip distance
 * @param far            Far clip distance
 */
export function buildIntrinsics(
  focalMm: number,
  apertureInW: number,
  apertureInH: number,
  fit: FilmFit,
  W: number,
  H: number,
  near: number,
  far: number,
): CameraIntrinsics {
  const hMm = apertureInW * 25.4;  // inches → mm
  const vMm = apertureInH * 25.4;
  const filmAspect = hMm / vMm;
  const viewportAspect = W / H;

  // Determine effective sensor dimensions for the viewport aspect
  let effectiveHMm: number;
  let effectiveVMm: number;

  if (
    fit === FilmFit.Horizontal ||
    (fit === FilmFit.Fill && viewportAspect > filmAspect)
  ) {
    // Horizontal fit: full sensor width, sensor height adapts
    effectiveHMm = hMm;
    effectiveVMm = hMm / viewportAspect;
  } else if (
    fit === FilmFit.Vertical ||
    (fit === FilmFit.Fill && viewportAspect <= filmAspect)
  ) {
    // Vertical fit: full sensor height, sensor width adapts
    effectiveVMm = vMm;
    effectiveHMm = vMm * viewportAspect;
  } else {
    // Overscan
    if (viewportAspect >= filmAspect) {
      // Show full film height — overscan horizontally
      effectiveVMm = vMm;
      effectiveHMm = vMm * viewportAspect;
    } else {
      // Show full film width — overscan vertically
      effectiveHMm = hMm;
      effectiveVMm = hMm / viewportAspect;
    }
  }

  // Pixel focal lengths
  //   fx = focal_mm * W / sensor_width_mm
  //   fy = focal_mm * H / sensor_height_mm
  const fx = focalMm * W / effectiveHMm;
  const fy = focalMm * H / effectiveVMm;
  const cx = W / 2;
  const cy = H / 2;

  const fovHRad = 2 * Math.atan(W / (2 * fx));
  const fovVRad = 2 * Math.atan(H / (2 * fy));

  return { W, H, fx, fy, cx, cy, fovHRad, fovVRad, near, far };
}

// ── Back-projection ──────────────────────────────────────────────────────────

/**
 * Back-project a pixel coordinate to a world-space ray.
 *
 * Derivation:
 *   1. Image coords → camera-space direction:
 *        d_cam = [(u - cx)/fx, -(v - cy)/fy, -1]ᵀ
 *      (note the sign flips: pixel y increases downward, camera +Y is up;
 *       camera looks -Z so we set z = -1)
 *   2. Camera → world:
 *        d_world = R * d_cam   where R = upper-left 3×3 of worldMatrix
 *        origin  = worldMatrix translation column
 *   3. Normalise d_world.
 *
 * @param u            Pixel x coordinate (0 = left edge, W = right edge)
 * @param v            Pixel y coordinate (0 = top edge, H = bottom edge)
 * @param intrinsics   Output of buildIntrinsics()
 * @param worldMatrix  Camera's world transform (THREE.Matrix4)
 * @returns { origin, direction } — direction is unit length
 */
export function pixelToWorldRay(
  u: number,
  v: number,
  intrinsics: CameraIntrinsics,
  worldMatrix: THREE.Matrix4,
): { origin: THREE.Vector3; direction: THREE.Vector3 } {
  const { fx, fy, cx, cy } = intrinsics;

  // Camera-space direction (z = -1 → looks down −Z)
  const dx = (u - cx) / fx;
  const dy = -(v - cy) / fy; // flip y: pixel y ↓ but camera y ↑
  const dz = -1.0;

  // Extract rotation (upper-left 3×3) from worldMatrix and apply
  const me = worldMatrix.elements; // column-major
  // Column vectors of rotation block
  const r0x = me[0], r0y = me[1], r0z = me[2];   // first column
  const r1x = me[4], r1y = me[5], r1z = me[6];   // second column
  const r2x = me[8], r2y = me[9], r2z = me[10];  // third column

  const wx = r0x * dx + r1x * dy + r2x * dz;
  const wy = r0y * dx + r1y * dy + r2y * dz;
  const wz = r0z * dx + r1z * dy + r2z * dz;

  const direction = new THREE.Vector3(wx, wy, wz).normalize();

  // Camera centre is the translation column (elements 12,13,14)
  const origin = new THREE.Vector3(me[12], me[13], me[14]);

  return { origin, direction };
}

// ── Projection (world → pixel) ───────────────────────────────────────────────

/**
 * Project a world-space point onto the image plane.
 *
 *   X_cam = V * X_world           (V = worldMatrix⁻¹)
 *   x = fx * (X_cam.x / -X_cam.z) + cx
 *   y = fy * (-X_cam.y / -X_cam.z) + cy   (flip y back to pixel convention)
 *
 * Returns null if the point is behind the camera (depth ≤ 0).
 *
 * @param worldPoint   3-D point in world space
 * @param intrinsics   Camera intrinsics
 * @param viewMatrix   Inverse of camera world matrix (V = worldMatrix⁻¹)
 * @returns Pixel coords { u, v, depth } or null if behind camera
 */
export function projectToPixel(
  worldPoint: THREE.Vector3,
  intrinsics: CameraIntrinsics,
  viewMatrix: THREE.Matrix4,
): { u: number; v: number; depth: number } | null {
  const cam = worldPoint.clone().applyMatrix4(viewMatrix);
  const depth = -cam.z; // camera looks −Z so depth = −z_cam
  if (depth <= 0) return null;

  const { fx, fy, cx, cy } = intrinsics;
  const u = fx * (cam.x / depth) + cx;
  const v = fy * (-cam.y / depth) + cy; // flip y

  return { u, v, depth };
}

// ── Pixel-validity check ──────────────────────────────────────────────────────

/** Returns true if (u,v) lies within the image rectangle. */
export function isInImage(u: number, v: number, intrinsics: CameraIntrinsics): boolean {
  return u >= 0 && u < intrinsics.W && v >= 0 && v < intrinsics.H;
}

// ── Angular resolution ────────────────────────────────────────────────────────

/**
 * Angular resolution in radians per pixel (horizontal).
 *
 *   Δθ = 1 / fx   [rad / pixel]
 *
 * For a point at distance d metres, the ground-sampling distance is:
 *   GSD = d * Δθ = d / fx   [scene units / pixel]
 */
export function angularResolutionRad(intrinsics: CameraIntrinsics): number {
  return 1.0 / intrinsics.fx;
}

/**
 * Approximate ground sampling distance (GSD) — the scene-unit footprint
 * of a single pixel at a given perpendicular distance from the camera.
 *
 *   GSD = depth / fx
 *
 * This is exact for fronto-parallel surfaces and approximate otherwise.
 */
export function groundSamplingDistance(intrinsics: CameraIntrinsics, depth: number): number {
  return depth / intrinsics.fx;
}

// ── View matrix helpers ───────────────────────────────────────────────────────

/**
 * Compute the view matrix (V = worldMatrix⁻¹) from a camera's world transform.
 * Mutates and returns the passed-in matrix for efficiency; create a new one if needed.
 */
export function viewMatrixFromWorld(worldMatrix: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().copy(worldMatrix).invert();
}

// ── OpenGL-style projection matrix ───────────────────────────────────────────

/**
 * Build a column-major OpenGL projection matrix from intrinsics.
 * Maps camera space (−Z forward) → NDC cube [−1,1]³.
 *
 * The standard pinhole projection matrix for OpenGL is:
 *
 *   n = near, f = far
 *   P = | 2n/(r-l)     0      (r+l)/(r-l)      0     |
 *       |     0     2n/(t-b)  (t+b)/(t-b)      0     |
 *       |     0        0     -(f+n)/(f-n)  -2fn/(f-n) |
 *       |     0        0          -1            0     |
 *
 * where l = -n*cx/fx, r = n*(W-cx)/fx, b = -n*cy/fy, t = n*(H-cy)/fy
 *
 * This encodes principal-point offset, non-square pixels, etc.
 */
export function buildProjectionMatrix(intrinsics: CameraIntrinsics): THREE.Matrix4 {
  const { fx, fy, cx, cy, W, H, near: n, far: f } = intrinsics;

  const l = -n * cx / fx;
  const r =  n * (W - cx) / fx;
  const b = -n * cy / fy;
  const t =  n * (H - cy) / fy;

  // THREE.Matrix4 stores column-major
  const P = new THREE.Matrix4();
  // Row 0
  P.elements[0]  = 2 * n / (r - l);
  P.elements[4]  = 0;
  P.elements[8]  = (r + l) / (r - l);
  P.elements[12] = 0;
  // Row 1
  P.elements[1]  = 0;
  P.elements[5]  = 2 * n / (t - b);
  P.elements[9]  = (t + b) / (t - b);
  P.elements[13] = 0;
  // Row 2
  P.elements[2]  = 0;
  P.elements[6]  = 0;
  P.elements[10] = -(f + n) / (f - n);
  P.elements[14] = -2 * f * n / (f - n);
  // Row 3
  P.elements[3]  = 0;
  P.elements[7]  = 0;
  P.elements[11] = -1;
  P.elements[15] = 0;

  return P;
}
