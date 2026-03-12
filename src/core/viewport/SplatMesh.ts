/**
 * SplatMesh — Spark 2.0 GPU-accelerated Gaussian Splatting wrapper.
 *
 * Wraps @sparkjsdev/spark to provide the same interface as the previous
 * CPU-based implementation so the rest of the codebase needs minimal changes.
 */

import * as THREE from 'three';
import {
  SplatMesh as SparkSplatMeshBase,
  SparkRenderer,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
} from '@sparkjsdev/spark';

// Re-export SparkRenderer so ViewportManager can import it from here.
export { SparkRenderer };

// ---------------------------------------------------------------------------
// Options interface  (kept identical to the old SplatOpts for UI compat)
// ---------------------------------------------------------------------------
export interface SplatOpts {
  workerSort:     boolean;
  radixSort:      boolean;
  lazyResort:     boolean;
  throttle:       boolean;
  alphaThreshold: number;
  frustumCull:    boolean;
  gpuIndirect:    boolean;
  lodFactor:      number;   // 0.05–1.0  → maps to Spark's lodScale
  streamingLOD:   boolean;
}

export const DEFAULT_SPLAT_OPTS: SplatOpts = {
  workerSort:     true,
  radixSort:      true,
  lazyResort:     true,
  throttle:       true,
  alphaThreshold: 0,
  frustumCull:    false,
  gpuIndirect:    false,
  lodFactor:      1.0,
  streamingLOD:   false,
};

// ---------------------------------------------------------------------------
// SplatMesh
// ---------------------------------------------------------------------------
export class SplatMesh extends SparkSplatMeshBase {
  private _cropEdit:    SplatEdit | null = null;
  private _cropSdf:     SplatEditSdf | null  = null;

  // ── Crop box ─────────────────────────────────────────────────────────────

  setCropBox(min: THREE.Vector3, max: THREE.Vector3): void {
    const center  = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const halfExt = new THREE.Vector3().subVectors(max, min).multiplyScalar(0.5);

    if (!this._cropEdit) {
      const sdf       = new SplatEditSdf({
        type:   SplatEditSdfType.BOX,
        invert: true,     // keep splats INSIDE the box
        opacity: 0,       // hidden outside
      });
      const edit = new SplatEdit({
        rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
      });
      edit.addSdf(sdf);
      this._cropSdf  = sdf;
      this._cropEdit = edit;
      this.add(edit);
    }

    const sdf = this._cropSdf!;
    sdf.position.copy(center);
    sdf.scale.copy(halfExt);
  }

  clearCropBox(): void {
    if (this._cropEdit) {
      this.remove(this._cropEdit);
      this._cropEdit = null;
      this._cropSdf  = null;
    }
  }

  // ── Options ───────────────────────────────────────────────────────────────

  setOptions(opts: SplatOpts): void {
    // Map UI lodFactor (0.05–1.0) → Spark's lodScale
    this.lodScale = Math.max(0.05, opts.lodFactor);
  }

  // ── No-ops (Spark handles automatically) ─────────────────────────────────

  setLinearOutput(_enabled: boolean): void { /* no-op */ }
  sort(_camera: THREE.PerspectiveCamera): void { /* no-op */ }
  updateUniforms(_camera: THREE.PerspectiveCamera, _w: number, _h: number): void { /* no-op */ }
}
