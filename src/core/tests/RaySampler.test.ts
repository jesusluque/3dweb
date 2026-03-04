/**
 * Unit tests for RaySampler (stratified sampling + XorShift32 PRNG).
 */

import { describe, it, expect } from 'vitest';
import {
  XorShift32,
  stratifiedSamples,
  stratifiedSamplesBuffer,
  uniformGridSamples,
  autoGridSize,
} from '../../plugins/builtin/coverage/RaySampler';

// ── XorShift32 ─────────────────────────────────────────────────────────────

describe('XorShift32', () => {
  it('produces values in [0, 1)', () => {
    const rng = new XorShift32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed → same sequence', () => {
    const a = new XorShift32(12345);
    const b = new XorShift32(12345);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds → different sequences', () => {
    const a = new XorShift32(1);
    const b = new XorShift32(2);
    const valuesA = Array.from({ length: 10 }, () => a.next());
    const valuesB = Array.from({ length: 10 }, () => b.next());
    expect(valuesA).not.toEqual(valuesB);
  });
});

// ── stratifiedSamples ─────────────────────────────────────────────────────

describe('stratifiedSamples', () => {
  const W = 1920, H = 1080, cols = 16, rows = 9;

  it('returns exactly cols * rows samples', () => {
    const s = stratifiedSamples(W, H, cols, rows);
    expect(s).toHaveLength(cols * rows);
  });

  it('all samples are within image bounds', () => {
    const s = stratifiedSamples(W, H, cols, rows);
    for (const { u, v } of s) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(W);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(H);
    }
  });

  it('is deterministic: same seed → same samples', () => {
    const a = stratifiedSamples(W, H, cols, rows, 99);
    const b = stratifiedSamples(W, H, cols, rows, 99);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].u).toBe(b[i].u);
      expect(a[i].v).toBe(b[i].v);
    }
  });

  it('different seed → different samples', () => {
    const a = stratifiedSamples(W, H, cols, rows, 1);
    const b = stratifiedSamples(W, H, cols, rows, 2);
    let differ = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].u !== b[i].u) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });

  it('each cell gets exactly one sample', () => {
    const s = stratifiedSamples(W, H, cols, rows);
    const cellW = W / cols;
    const cellH = H / rows;
    // Build grid occupancy
    const occupied = new Set<string>();
    for (const { u, v } of s) {
      const col = Math.floor(u / cellW);
      const row = Math.floor(v / cellH);
      const key = `${col},${row}`;
      expect(occupied.has(key)).toBe(false); // no duplicate cell
      occupied.add(key);
    }
    expect(occupied.size).toBe(cols * rows);
  });
});

// ── stratifiedSamplesBuffer ───────────────────────────────────────────────

describe('stratifiedSamplesBuffer', () => {
  it('returns Float32Array of length cols * rows * 2', () => {
    const buf = stratifiedSamplesBuffer(1920, 1080, 8, 4);
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf.length).toBe(8 * 4 * 2);
  });

  it('is consistent with stratifiedSamples for same seed', () => {
    const arr = stratifiedSamples(1920, 1080, 8, 4, 7);
    const buf  = stratifiedSamplesBuffer(1920, 1080, 8, 4, 7);
    // buf is Float32Array so values are truncated to float32 precision;
    // compare against Math.fround(float64) to match the stored representation.
    for (let i = 0; i < arr.length; i++) {
      expect(buf[i * 2]).toBeCloseTo(Math.fround(arr[i].u), 5);
      expect(buf[i * 2 + 1]).toBeCloseTo(Math.fround(arr[i].v), 5);
    }
  });
});

// ── uniformGridSamples ────────────────────────────────────────────────────

describe('uniformGridSamples', () => {
  it('places samples at cell centres', () => {
    const W = 100, H = 50, cols = 5, rows = 5;
    const s = uniformGridSamples(W, H, cols, rows);
    const cellW = W / cols;
    const cellH = H / rows;
    for (const { u, v } of s) {
      // Each u should be (col + 0.5) * cellW for some col
      const col = Math.round(u / cellW - 0.5);
      expect(u).toBeCloseTo((col + 0.5) * cellW, 6);
      const row = Math.round(v / cellH - 0.5);
      expect(v).toBeCloseTo((row + 0.5) * cellH, 6);
    }
  });
});

// ── autoGridSize ──────────────────────────────────────────────────────────

describe('autoGridSize', () => {
  it('1080p → 128 cols', () => {
    const { cols } = autoGridSize(1920, 1080);
    expect(cols).toBe(128);
  });

  it('4K → 256 cols', () => {
    const { cols } = autoGridSize(3840, 2160);
    expect(cols).toBe(256);
  });

  it('8K → 512 cols', () => {
    const { cols } = autoGridSize(7680, 4320);
    expect(cols).toBe(512);
  });

  it('rows match image aspect', () => {
    const { cols, rows } = autoGridSize(1920, 1080);
    // rows should be approximately cols * H/W = 128 * 9/16 = 72
    expect(rows).toBe(72);
  });
});
