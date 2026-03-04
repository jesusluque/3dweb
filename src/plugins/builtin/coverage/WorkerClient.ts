/**
 * WorkerClient — promise-based wrapper around coverageWorker.ts.
 *
 * Usage:
 * ```ts
 * const client = new WorkerClient();
 * await client.buildBVH(geometry);
 *
 * const hits = await client.castRays({
 *   cameraId: 'cam1',
 *   origin: new THREE.Vector3(0,5,10),
 *   directions: Float32Array — flattened [dx,dy,dz, …]
 * });
 *
 * client.dispose();
 * ```
 */

import * as THREE from 'three';
import type { ExtractedGeometry } from './GeometryExtractor';

// ── Result types ───────────────────────────────────────────────────────────

export interface CastResult {
  cameraId: string;
  rayCount: number;
  /** Hit triangle index per ray; −1 = miss. */
  triangleIndices: Int32Array;
  /** Hit distance per ray (0 for misses). */
  distances: Float32Array;
  /** Hit world-space points, flat [x,y,z,x,y,z,…]. */
  points: Float32Array;
  /** Hit face normals, flat [x,y,z,…]. */
  normals: Float32Array;
}

// ── Internal pending map ───────────────────────────────────────────────────

interface Pending {
  resolve: (value: any) => void;
  reject:  (reason: any) => void;
}

// ── WorkerClient ──────────────────────────────────────────────────────────

export class WorkerClient {
  private readonly _worker: Worker;
  private _pending: Map<number, Pending> = new Map();
  private _nextId = 1;

  constructor() {
    this._worker = new Worker(
      new URL('./coverageWorker.ts', import.meta.url),
      { type: 'module' },
    );
    this._worker.onmessage = (evt: MessageEvent) => this._handleMessage(evt.data);
    this._worker.onerror   = (e) => {
      console.error('[WorkerClient] Worker error:', e);
    };
  }

  /**
   * Send the merged world-space geometry to the worker and build the BVH.
   * The underlying TypedArrays are **transferred** (zero-copy) to the worker,
   * which means the geometry is consumed and should not be used afterwards
   * by the caller.
   */
  async buildBVH(extracted: ExtractedGeometry): Promise<void> {
    const geo = extracted.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;

    let indices: Uint32Array;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array as ArrayLike<number>);
    } else {
      // Non-indexed: create a sequential index
      const count = posAttr.count;
      indices = new Uint32Array(count);
      for (let i = 0; i < count; i++) indices[i] = i;
    }

    // Clone before transfer so the geometry is still usable on the main thread
    const posCopy = positions.slice();
    const idxCopy = indices;

    return this._call('BUILD', { positions: posCopy, indices: idxCopy },
      [posCopy.buffer, idxCopy.buffer]);
  }

  /**
   * Cast a batch of rays for one camera.
   *
   * @param cameraId   UUID of the camera (for attribution in results)
   * @param origin     Camera centre in world space
   * @param directions Flat Float32Array of normalised ray directions [dx,dy,dz, …]
   */
  async castRays(
    cameraId: string,
    origin: THREE.Vector3,
    directions: Float32Array,
  ): Promise<CastResult> {
    // Clone directions to transfer without losing the local copy
    const dirCopy = directions.slice();
    return this._call('CAST', {
      cameraId,
      rayOriginX: origin.x,
      rayOriginY: origin.y,
      rayOriginZ: origin.z,
      directions: dirCopy,
    }, [dirCopy.buffer]);
  }

  /** Terminate the worker. */
  dispose(): void {
    this._worker.terminate();
    this._pending.clear();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _call(
    type: string,
    payload: Record<string, any>,
    transferables: Transferable[] = [],
  ): Promise<any> {
    const id = this._nextId++;
    return new Promise<any>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ type, id, ...payload }, transferables);
    });
  }

  private _handleMessage(data: any): void {
    const { type, id } = data;
    const pending = this._pending.get(id);
    if (!pending) return;
    this._pending.delete(id);

    if (type === 'BUILD_OK') {
      pending.resolve(undefined);
    } else if (type === 'BUILD_ERR') {
      pending.reject(new Error(data.error));
    } else if (type === 'CAST_OK') {
      const result: CastResult = {
        cameraId:        data.cameraId,
        rayCount:        data.rayCount,
        triangleIndices: data.triangleIndices,
        distances:       data.distances,
        points:          data.points,
        normals:         data.normals,
      };
      pending.resolve(result);
    } else if (type === 'CAST_ERR') {
      pending.reject(new Error(data.error));
    }
  }
}
