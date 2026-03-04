/**
 * Unit tests for the CameraModel math module.
 * Run with: npx vitest run src/core/tests/CameraModel.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildIntrinsics,
  pixelToWorldRay,
  projectToPixel,
  viewMatrixFromWorld,
  angularResolutionRad,
  groundSamplingDistance,
  buildProjectionMatrix,
} from '../math/CameraModel';
import { FilmFit } from '../dag/CameraNode';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build an identity-positioned camera world matrix (camera at origin, no rotation). */
function identityWorld(): THREE.Matrix4 {
  return new THREE.Matrix4().identity();
}

/** Standard 35mm full-frame camera, 1920×1080. */
function std35mm(fit: FilmFit = FilmFit.Horizontal) {
  return buildIntrinsics(35, 1.417, 0.945, fit, 1920, 1080, 0.1, 10000);
}

// ── Intrinsic construction ─────────────────────────────────────────────────

describe('buildIntrinsics — Horizontal fit', () => {
  const intr = std35mm(FilmFit.Horizontal);

  it('principal point is at image centre', () => {
    expect(intr.cx).toBeCloseTo(960, 2);
    expect(intr.cy).toBeCloseTo(540, 2);
  });

  it('fx matches formula: focalMm * W / hMm', () => {
    const hMm = 1.417 * 25.4; // ≈ 36.0 mm
    const expected = 35 * 1920 / hMm;
    expect(intr.fx).toBeCloseTo(expected, 3);
  });

  it('produces a positive, non-zero fy', () => {
    expect(intr.fy).toBeGreaterThan(0);
  });

  it('fovH and fovV are consistent with fx/fy', () => {
    const expectedFovH = 2 * Math.atan(1920 / (2 * intr.fx));
    const expectedFovV = 2 * Math.atan(1080 / (2 * intr.fy));
    expect(intr.fovHRad).toBeCloseTo(expectedFovH, 6);
    expect(intr.fovVRad).toBeCloseTo(expectedFovV, 6);
  });

  it('35mm horizontal FOV is approximately 54°', () => {
    expect(intr.fovHRad * (180 / Math.PI)).toBeCloseTo(54.4, 0);
  });
});

describe('buildIntrinsics — Vertical fit', () => {
  const intr = buildIntrinsics(35, 1.417, 0.945, FilmFit.Vertical, 1920, 1080, 0.1, 10000);

  it('fy matches formula: focalMm * H / vMm', () => {
    const vMm = 0.945 * 25.4; // ≈ 24.0 mm
    const expected = 35 * 1080 / vMm;
    expect(intr.fy).toBeCloseTo(expected, 3);
  });
});

describe('buildIntrinsics — square sensor', () => {
  it('fx === fy when sensor aspect === viewport aspect', () => {
    // 36×36mm sensor (square), 1080×1080 render (square) → fx = fy
    const intr = buildIntrinsics(50, 36/25.4, 36/25.4, FilmFit.Horizontal, 1080, 1080, 0.1, 10000);
    expect(intr.fx).toBeCloseTo(intr.fy, 5);
  });
});

// ── Projection matrix ──────────────────────────────────────────────────────

describe('buildProjectionMatrix', () => {
  it('is a 4×4 matrix', () => {
    const P = buildProjectionMatrix(std35mm());
    expect(P.elements).toHaveLength(16);
  });

  it('element [11] (row3 col2) equals -1 (perspective divide)', () => {
    const P = buildProjectionMatrix(std35mm());
    // THREE.Matrix4 is column-major: element[11] = row 3, col 2 = m23
    expect(P.elements[11]).toBeCloseTo(-1, 6);
  });
});

// ── Back-projection ────────────────────────────────────────────────────────

describe('pixelToWorldRay', () => {
  const intr = std35mm();
  const world = identityWorld(); // camera at origin

  it('principal point (cx, cy) → direction is (0, 0, -1)', () => {
    const { direction } = pixelToWorldRay(intr.cx, intr.cy, intr, world);
    expect(direction.x).toBeCloseTo(0, 5);
    expect(direction.y).toBeCloseTo(0, 5);
    expect(direction.z).toBeCloseTo(-1, 5);
  });

  it('top-left corner → z is negative (in front)', () => {
    const { direction } = pixelToWorldRay(0, 0, intr, world);
    expect(direction.z).toBeLessThan(0);
  });

  it('direction is unit length', () => {
    const { direction } = pixelToWorldRay(100, 200, intr, world);
    expect(direction.length()).toBeCloseTo(1, 6);
  });

  it('origin is at camera position (0,0,0 for identity world)', () => {
    const { origin } = pixelToWorldRay(intr.cx, intr.cy, intr, world);
    expect(origin.x).toBeCloseTo(0, 6);
    expect(origin.y).toBeCloseTo(0, 6);
    expect(origin.z).toBeCloseTo(0, 6);
  });
});

// ── Round-trip pixel → ray → pixel ────────────────────────────────────────

describe('Round-trip: pixel → world ray → pixel', () => {
  const intr  = std35mm();
  const world = identityWorld();
  const viewM = viewMatrixFromWorld(world);

  function roundTrip(u: number, v: number, depth: number): { u: number; v: number } {
    // Back-project pixel to ray
    const { origin, direction } = pixelToWorldRay(u, v, intr, world);
    // Walk along ray to the given depth
    const point = origin.clone().addScaledVector(direction, depth / Math.abs(direction.z));
    // Re-project
    const proj = projectToPixel(point, intr, viewM);
    if (!proj) throw new Error('projectToPixel returned null');
    return { u: proj.u, v: proj.v };
  }

  it('principal point round-trips at depth 10', () => {
    const { u, v } = roundTrip(intr.cx, intr.cy, 10);
    expect(u).toBeCloseTo(intr.cx, 2);
    expect(v).toBeCloseTo(intr.cy, 2);
  });

  it('corner pixel (0, 0) round-trips at depth 5', () => {
    const { u, v } = roundTrip(0, 0, 5);
    expect(u).toBeCloseTo(0, 1);
    expect(v).toBeCloseTo(0, 1);
  });

  it('arbitrary pixel (640, 360) round-trips at depth 20', () => {
    const { u, v } = roundTrip(640, 360, 20);
    expect(u).toBeCloseTo(640, 1);
    expect(v).toBeCloseTo(360, 1);
  });
});

// ── Angular resolution ─────────────────────────────────────────────────────

describe('angularResolutionRad', () => {
  it('is positive', () => {
    const intr = std35mm();
    expect(angularResolutionRad(intr)).toBeGreaterThan(0);
  });

  it('equals 1/fx', () => {
    const intr = std35mm();
    expect(angularResolutionRad(intr)).toBeCloseTo(1 / intr.fx, 8);
  });
});

// ── GSD ───────────────────────────────────────────────────────────────────

describe('groundSamplingDistance', () => {
  it('GSD at depth 10 = 10 / fx', () => {
    const intr = std35mm();
    expect(groundSamplingDistance(intr, 10)).toBeCloseTo(10 / intr.fx, 8);
  });

  it('GSD doubles when depth doubles', () => {
    const intr = std35mm();
    const g1 = groundSamplingDistance(intr, 5);
    const g2 = groundSamplingDistance(intr, 10);
    expect(g2).toBeCloseTo(2 * g1, 8);
  });
});

// ── Translated camera ──────────────────────────────────────────────────────

describe('pixelToWorldRay — translated camera', () => {
  const intr  = std35mm();
  // Camera at (0, 5, 10), looking -Z
  const pos   = new THREE.Vector3(0, 5, 10);
  const world = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);

  it('origin is at camera translation', () => {
    const { origin } = pixelToWorldRay(intr.cx, intr.cy, intr, world);
    expect(origin.x).toBeCloseTo(0, 5);
    expect(origin.y).toBeCloseTo(5, 5);
    expect(origin.z).toBeCloseTo(10, 5);
  });

  it('principal point still points in (0, 0, -1)', () => {
    const { direction } = pixelToWorldRay(intr.cx, intr.cy, intr, world);
    expect(direction.x).toBeCloseTo(0, 4);
    expect(direction.y).toBeCloseTo(0, 4);
    expect(direction.z).toBeCloseTo(-1, 4);
  });
});
