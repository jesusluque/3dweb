/**
 * GeometryExtractor
 *
 * Collects all renderable triangle meshes from the DAG scene graph and merges
 * them into a single world-space BufferGeometry that can be handed to the BVH
 * builder.
 *
 * Important: the merged geometry is in **world space** — all node transforms
 * are baked in.  This avoids the need for any instance transform inside the
 * BVH worker.
 *
 * Only visible GltfNodes with a loaded `_loadedScene` are included; MeshNodes
 * (primitives) are also included if they're represented in the ViewportManager
 * nodeMap.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneGraph } from '../../../core/dag/SceneGraph';
import { GltfNode } from '../../../core/dag/GltfNode';
import { MeshNode } from '../../../core/dag/MeshNode';
import type { ViewportManager } from '../../../core/viewport/ViewportManager';

/** Result of geometry extraction. */
export interface ExtractedGeometry {
  /** Merged, world-space, indexed BufferGeometry. Only `position` attribute. */
  geometry: THREE.BufferGeometry;
  /**
   * For each triangle index in the merged geometry, which source mesh it came
   * from (index into `sourceMeshes`).
   */
  triangleToSource: Uint32Array;
  /** Source meshes in merge order (for attribution in results). */
  sourceMeshes: SourceMeshInfo[];
  /** Total triangle count. */
  triangleCount: number;
}

export interface SourceMeshInfo {
  /** DAG node UUID (GltfNode or MeshNode). */
  dagNodeId: string;
  /** Name of the DAG node. */
  dagNodeName: string;
  /** Name of the THREE.Mesh inside the loaded scene. */
  meshName: string;
  /** Start triangle index in the merged geometry. */
  triOffset: number;
  /** Number of triangles this mesh contributes. */
  triCount: number;
}

// ── Main extractor ────────────────────────────────────────────────────────────

export class GeometryExtractor {
  /**
   * Extract and merge all visible mesh geometry from the scene into a single
   * world-space geometry.
   *
   * @param sceneGraph      The DAG scene graph
   * @param viewportManager The viewport manager (to look up Three.js objects)
   * @returns               The merged result, or null if no meshes found
   */
  static extract(
    sceneGraph: SceneGraph,
    viewportManager: ViewportManager,
  ): ExtractedGeometry | null {
    const vm = viewportManager as any;
    // Use the correct property name: ViewportManager declares `private scene`
    const threeScene = vm.scene as THREE.Scene | undefined;
    if (threeScene) threeScene.updateWorldMatrix(true, true);

    const nodeMap: Map<string, THREE.Object3D> = vm.nodeMap;

    const geometries: THREE.BufferGeometry[] = [];
    const sources: SourceMeshInfo[] = [];

    for (const dagNode of sceneGraph.getAllNodes()) {
      // Use the correct visibility plug name (dagNode.visibility, not dagNode.visible)
      if (!dagNode.visibility.getValue()) continue;

      // ── GltfNode: traverse _loadedScene directly (no nodeMap lookup needed) ──
      if (dagNode instanceof GltfNode) {
        const gltfRoot = dagNode._loadedScene;
        if (!gltfRoot) continue;         // still loading (async re-parse)
        gltfRoot.updateWorldMatrix(true, true);

        gltfRoot.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          if (!child.visible) return;
          // Skip wireframe / editor overlay meshes
          if (Array.isArray(child.material)
            ? child.material.every((m: THREE.Material) => (m as any).wireframe)
            : (child.material as any).wireframe) return;

          const geo = GeometryExtractor._extractWorldSpaceGeo(child);
          if (!geo) return;

          const triCount = GeometryExtractor._triCount(geo);
          sources.push({
            dagNodeId:   dagNode.uuid,
            dagNodeName: dagNode.name,
            meshName:    child.name || '(mesh)',
            triOffset:   0,
            triCount,
          });
          geometries.push(geo);
        });

        continue; // GltfNode handled — don't fall through to nodeMap path
      }

      // ── MeshNode only — skip CameraNode / LightNode / SplatNode / GroupNode ───
      if (!(dagNode instanceof MeshNode)) continue;
      const threeObj = nodeMap?.get(dagNode.uuid);
      if (!threeObj) continue;
      threeObj.updateWorldMatrix(true, true);

      threeObj.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (!child.visible) return;
        if (Array.isArray(child.material)
          ? child.material.every((m: THREE.Material) => (m as any).wireframe)
          : (child.material as any).wireframe) return;

        const geo = GeometryExtractor._extractWorldSpaceGeo(child);
        if (!geo) return;

        const triCount = GeometryExtractor._triCount(geo);
        sources.push({
          dagNodeId:   dagNode.uuid,
          dagNodeName: dagNode.name,
          meshName:    child.name || '(primitive)',
          triOffset:   0,
          triCount,
        });
        geometries.push(geo);
      });
    }

    if (geometries.length === 0) return null;

    // ── Normalise: strip index from all geometries before merging ────────────
    // mergeGeometries requires ALL geometries to be uniformly indexed or
    // non-indexed.  Converting everything to non-indexed is the simplest path.
    const nonIndexed = geometries.map((g) =>
      g.index !== null ? g.toNonIndexed() : g,
    );
    // Dispose per-mesh clones that were already de-indexed (avoid double-free)
    for (let i = 0; i < geometries.length; i++) {
      if (geometries[i] !== nonIndexed[i]) geometries[i].dispose();
    }

    // Merge into one flat non-indexed geometry.
    // IMPORTANT: do NOT call mergeVertices() here.  That function silently
    // drops degenerate triangles (any two vertices that hash to the same position),
    // which changes the triangle count and breaks the faceIndex → source-triangle
    // mapping used by the BVH ray caster and the heatmap applier.
    // A plain non-indexed merge guarantees: triangle i in merged = triangle i
    // from the concatenated per-source list, so faceIndex is always correct.
    const merged = mergeGeometries(nonIndexed, false);
    for (const g of nonIndexed) g.dispose();
    if (!merged) return null;

    // Ensure normals exist for incidence-angle computation in MetricsComputer
    if (!merged.attributes.normal) {
      merged.computeVertexNormals();
    }
    // Compute per-triangle source attribution (based on non-indexed tri counts)
    let runningOffset = 0;
    const updatedSources: SourceMeshInfo[] = [];
    for (const src of sources) {
      updatedSources.push({ ...src, triOffset: runningOffset });
      runningOffset += src.triCount;
    }

    const totalTris = runningOffset;
    const triangleToSource = new Uint32Array(totalTris);
    for (let s = 0; s < updatedSources.length; s++) {
      const { triOffset, triCount } = updatedSources[s];
      triangleToSource.fill(s, triOffset, triOffset + triCount);
    }

    return {
      geometry:       merged,
      triangleToSource,
      sourceMeshes:   updatedSources,
      triangleCount:  totalTris,
    };
  }

  /** Number of triangles in a geometry (handles indexed and non-indexed). */
  private static _triCount(geo: THREE.BufferGeometry): number {
    const count = geo.index
      ? geo.index.count
      : (geo.attributes.position as THREE.BufferAttribute).count;
    return Math.floor(count / 3);
  }
  /**
   * Clone a mesh's geometry into world space (bakes matrixWorld into positions).
   * Returns a new, non-indexed BufferGeometry with only `position` and `normal`.
   * Handles interleaved buffer attributes (common in GLB files).
   */
  private static _extractWorldSpaceGeo(mesh: THREE.Mesh): THREE.BufferGeometry | null {
    const srcGeo = mesh.geometry as THREE.BufferGeometry;
    if (!srcGeo || !srcGeo.attributes.position) return null;

    // toNonIndexed() also resolves InterleavedBufferAttributes into plain ones
    const base = srcGeo.index !== null ? srcGeo.toNonIndexed() : srcGeo.clone();

    // Strip everything except position + normal; keeps memory lean for the BVH
    const keep = new Set(['position', 'normal']);
    for (const key of Object.keys(base.attributes)) {
      if (!keep.has(key)) base.deleteAttribute(key);
    }

    const world = mesh.matrixWorld;

    // Bake position into world space
    const posAttr = base.attributes.position as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const pos = new THREE.Vector3();
    for (let i = 0, len = positions.length; i < len; i += 3) {
      pos.set(positions[i], positions[i + 1], positions[i + 2]);
      pos.applyMatrix4(world);
      positions[i]     = pos.x;
      positions[i + 1] = pos.y;
      positions[i + 2] = pos.z;
    }
    posAttr.needsUpdate = true;

    // Bake normals via inverse-transpose
    if (base.attributes.normal) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
      const normalAttr = base.attributes.normal as THREE.BufferAttribute;
      const normals = normalAttr.array as Float32Array;
      const n = new THREE.Vector3();
      for (let i = 0, len = normals.length; i < len; i += 3) {
        n.set(normals[i], normals[i + 1], normals[i + 2]);
        n.applyMatrix3(normalMatrix).normalize();
        normals[i]     = n.x;
        normals[i + 1] = n.y;
        normals[i + 2] = n.z;
      }
      normalAttr.needsUpdate = true;
    }

    return base;
  }
}
