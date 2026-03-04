/**
 * RaySampler — deterministic stratified pixel sampling for coverage analysis.
 *
 * ## Strategy
 * The image is divided into a coarse grid of (cols × rows) cells.
 * Within each cell, one sample is drawn at a jittered position:
 *   u = (col + rng()) * (W / cols)
 *   v = (row + rng()) * (H / rows)
 *
 * This gives uniform-density coverage of the image while avoiding the aliasing
 * of a pure regular grid and the clustering of pure random sampling.
 *
 * ## Seeding
 * A XorShift32 PRNG is used for reproducibility.  The same seed always
 * produces the same sample pattern, enabling deterministic comparisons.
 *
 * ## Recommended grid sizes
 * | Resolution | cols × rows | Rays/camera |
 * |------------|-------------|-------------|
 * | 1080p      | 64 × 36     | 2 304       |
 * | 4K         | 128 × 72    | 9 216       |
 * | 8K         | 256 × 144   | 36 864      |
 */

// ── XorShift32 PRNG ────────────────────────────────────────────────────────

/** Deterministic 32-bit XorShift PRNG. Returns a value in [0, 1). */
export class XorShift32 {
  private state: number;

  constructor(seed: number) {
    // Guarantee a non-zero state
    this.state = (seed | 0) || 0xdeadbeef;
  }

  /** Advance and return a pseudo-random float in [0, 1). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    // Map unsigned 32-bit int [0, 2³²) to [0, 1)
    return (x >>> 0) / 0x100000000;
  }
}

// ── Grid-size auto-selection ───────────────────────────────────────────────

/**
 * Choose a sensible (cols, rows) grid for the given image resolution.
 * The grid aspect matches the image so cells are approximately square.
 *
 * Benchmarked budgets:
 *   ≤ 1080p  → 64 × 36
 *   ≤ 4K     → 128 × 72
 *   ≤ 8K     → 256 × 144
 *   huge     → 512 × 288
 */
export function autoGridSize(W: number, H: number): { cols: number; rows: number } {
  const megapixels = (W * H) / 1_000_000;
  let cols: number;
  // Generous defaults: more rays → higher per-triangle hit probability.
  // A model with ~3 K triangles needs ~10 K rays to achieve reliable coverage.
  if (megapixels <= 2.2)       cols = 128;   // 1080p  → 128 × 72  = 9 216
  else if (megapixels <= 8.8)  cols = 256;   // 4K     → 256 × 144 = 36 864
  else if (megapixels <= 35)   cols = 512;   // 8K     → 512 × 288 = 147 456
  else                         cols = 1024;  // >8K    → 1024 × 576 = 589 824

  // Maintain image aspect to keep cells square
  const rows = Math.max(1, Math.round(cols * H / W));
  return { cols, rows };
}

// ── Stratified sampling ────────────────────────────────────────────────────

export interface SamplePixel {
  /** Pixel x coordinate (0 = left edge) */
  u: number;
  /** Pixel y coordinate (0 = top edge) */
  v: number;
}

/**
 * Generate `cols * rows` jittered stratified pixel samples over an image
 * of dimensions (W × H).
 *
 * @param W     Image width in pixels
 * @param H     Image height in pixels
 * @param cols  Number of grid columns
 * @param rows  Number of grid rows
 * @param seed  PRNG seed (default 42)
 * @returns     Array of (cols * rows) pixel coordinates
 */
export function stratifiedSamples(
  W: number,
  H: number,
  cols: number,
  rows: number,
  seed = 42,
): SamplePixel[] {
  const rng = new XorShift32(seed);
  const cellW = W / cols;
  const cellH = H / rows;
  const samples: SamplePixel[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col + rng.next()) * cellW;
      const v = (row + rng.next()) * cellH;
      samples.push({ u, v });
    }
  }

  return samples;
}

/**
 * Generate a flat Float32Array of (u, v) pairs — more efficient for
 * transferring to / from a Web Worker.
 *
 * Layout: [u0, v0, u1, v1, …]  length = cols * rows * 2
 */
export function stratifiedSamplesBuffer(
  W: number,
  H: number,
  cols: number,
  rows: number,
  seed = 42,
): Float32Array {
  const rng = new XorShift32(seed);
  const cellW = W / cols;
  const cellH = H / rows;
  const count = cols * rows;
  const buf = new Float32Array(count * 2);
  let i = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      buf[i++] = (col + rng.next()) * cellW;
      buf[i++] = (row + rng.next()) * cellH;
    }
  }

  return buf;
}

/**
 * Generate pixel-centre samples on a regular (unjittered) grid.
 * Useful for debugging and for reference comparisons.
 */
export function uniformGridSamples(W: number, H: number, cols: number, rows: number): SamplePixel[] {
  const cellW = W / cols;
  const cellH = H / rows;
  const samples: SamplePixel[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      samples.push({
        u: (col + 0.5) * cellW,
        v: (row + 0.5) * cellH,
      });
    }
  }

  return samples;
}
