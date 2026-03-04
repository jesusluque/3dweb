/**
 * coverageWorker — BVH build + ray casting in a Web Worker.
 *
 * ## Message protocol
 *
 * ### Main → Worker
 *
 * `BUILD` — Build the BVH from serialised geometry.
 * ```json
 * { type: "BUILD", id: number,
 *   positions: Float32Array,   // transferable
 *   indices:   Uint32Array     // transferable (may be empty = non-indexed)
 * }
 * ```
 *
 * `CAST` — Cast a batch of rays for one camera.
 * ```json
 * { type: "CAST", id: number, cameraId: string,
 *   rayOriginX: number, rayOriginY: number, rayOriginZ: number,
 *   // Flattened ray directions: [dx0, dy0, dz0, dx1, dy1, dz1, …]
 *   directions: Float32Array,  // transferable
 * }
 * ```
 *
 * `RESET` — Dispose the current BVH (ready to build a new one).
 * ```json
 * { type: "RESET" }
 * ```
 *
 * ### Worker → Main
 *
 * `BUILD_OK` / `BUILD_ERR`
 * `CAST_OK`  → includes compact result arrays (transferable)
 * `CAST_ERR`
 *
 * `CAST_OK` payload:
 * ```json
 * { type: "CAST_OK", id: number, cameraId: string,
 *   // Per-ray: triangleIndex (int32, −1 = miss), hit distance (float32)
 *   triangleIndices: Int32Array,  // length = ray count
 *   distances:       Float32Array,
 *   // Hit points [x,y,z,x,y,z,…] length = ray count × 3
 *   points:   Float32Array,
 *   // Face normals [x,y,z,…] length = ray count × 3
 *   normals:  Float32Array,
 * }
 * ```
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Current BVH state
let bvh: MeshBVH | null = null;
let bvhGeometry: THREE.BufferGeometry | null = null;

// ── Message handler ────────────────────────────────────────────────────────

self.onmessage = (evt: MessageEvent) => {
  const msg = evt.data as WorkerMessage;

  switch (msg.type) {
    case 'BUILD':  handleBuild(msg as BuildMessage);  break;
    case 'CAST':   handleCast(msg as CastMessage);    break;
    case 'RESET':  handleReset();                     break;
    default:
      console.warn('[coverageWorker] Unknown message type:', (msg as any).type);
  }
};

// ── Types (duplicated here to avoid worker importing from the main src tree) ──

interface WorkerMessage { type: string; id?: number; }

interface BuildMessage extends WorkerMessage {
  type: 'BUILD';
  positions: Float32Array;
  indices: Uint32Array;
}

interface CastMessage extends WorkerMessage {
  type: 'CAST';
  cameraId: string;
  rayOriginX: number;
  rayOriginY: number;
  rayOriginZ: number;
  directions: Float32Array; // [dx0,dy0,dz0, dx1,dy1,dz1, …]
}

// ── Handlers ──────────────────────────────────────────────────────────────

function handleReset(): void {
  if (bvhGeometry) { bvhGeometry.dispose(); }
  bvh = null;
  bvhGeometry = null;
}

function handleBuild(msg: BuildMessage): void {
  try {
    handleReset();

    const { positions, indices, id } = msg;

    // Build a BufferGeometry from the raw arrays
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (indices && indices.length > 0) {
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
    }

    // Build the BVH (SAH for best ray-cast performance)
    const built = new MeshBVH(geo, { strategy: 0 /* SAH */ });

    bvh = built;
    bvhGeometry = geo;

    self.postMessage({ type: 'BUILD_OK', id });
  } catch (e: any) {
    self.postMessage({ type: 'BUILD_ERR', id: msg.id, error: String(e) });
  }
}

function handleCast(msg: CastMessage): void {
  if (!bvh) {
    self.postMessage({ type: 'CAST_ERR', id: msg.id, cameraId: msg.cameraId, error: 'BVH not built' });
    return;
  }

  try {
    const { directions, rayOriginX, rayOriginY, rayOriginZ, cameraId, id } = msg;
    const rayCount = Math.floor(directions.length / 3);

    const triangleIndices = new Int32Array(rayCount).fill(-1); // -1 = miss
    const distances       = new Float32Array(rayCount);
    const points          = new Float32Array(rayCount * 3);
    const normals         = new Float32Array(rayCount * 3);

    const origin = new THREE.Vector3(rayOriginX, rayOriginY, rayOriginZ);
    const ray    = new THREE.Ray();
    ray.origin.copy(origin);

    for (let i = 0; i < rayCount; i++) {
      const di = i * 3;
      ray.direction.set(directions[di], directions[di + 1], directions[di + 2]);

      // DoubleSide = 2 in Three.js (check both front and back faces)
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide);

      if (hit) {
        triangleIndices[i] = hit.faceIndex ?? -1;
        distances[i]       = hit.distance;
        const pi = i * 3;
        points[pi]     = hit.point.x;
        points[pi + 1] = hit.point.y;
        points[pi + 2] = hit.point.z;
        if (hit.face) {
          normals[pi]     = hit.face.normal.x;
          normals[pi + 1] = hit.face.normal.y;
          normals[pi + 2] = hit.face.normal.z;
        }
      } else {
        triangleIndices[i] = -1;
        distances[i]       = 0;
      }
    }

    // Transfer ownership of the typed arrays back to the main thread
    const transferables: Transferable[] = [
      triangleIndices.buffer,
      distances.buffer,
      points.buffer,
      normals.buffer,
    ] as Transferable[];

    self.postMessage(
      { type: 'CAST_OK', id, cameraId, triangleIndices, distances, points, normals, rayCount },
      transferables,
    );
  } catch (e: any) {
    self.postMessage({ type: 'CAST_ERR', id: msg.id, cameraId: msg.cameraId, error: String(e) });
  }
}
