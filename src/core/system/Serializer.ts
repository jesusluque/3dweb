import { EngineCore } from '../EngineCore';
import { DAGNode } from '../dag/DAGNode';
import { MeshNode } from '../dag/MeshNode';
import { CameraNode } from '../dag/CameraNode';
import { GroupNode } from '../dag/GroupNode';

/* ════════════════════════════════════════════════════════════════════════════
   Serialised data shapes
   ════════════════════════════════════════════════════════════════════════ */
export interface SerializedNode {
  uuid: string;
  name: string;
  type: string;               // 'MeshNode' | 'CameraNode' | 'GroupNode'
  parentUuid: string | null;  // null = child of WorldRoot
  attributes: Record<string, any>;
}

export interface SerializedScene {
  formatVersion: string;
  metadata: { fps: number; unit: string; savedAt: string };
  nodes: SerializedNode[];
  /** Viewport settings snapshot (bgColor, shading, grid…). Opaque for the core. */
  viewportSettings?: Record<string, any>;
}

/* ════════════════════════════════════════════════════════════════════════════
   Serializer
   ════════════════════════════════════════════════════════════════════════ */
export class Serializer {
  constructor(private core: EngineCore) {}

  /* ── Serialize ─────────────────────────────────────────────────────── */

  public serialize(viewportSettings?: Record<string, any>): string {
    const rootUuid = this.core.sceneGraph.root.uuid;

    // Walk tree depth-first so parents are always listed before children.
    const nodes: SerializedNode[] = [];
    const visited = new Set<string>();

    const walk = (node: DAGNode) => {
      if (visited.has(node.uuid)) return;
      visited.add(node.uuid);
      if (node.uuid !== rootUuid) {
        const attributes: Record<string, any> = {};
        for (const [key, plug] of node.plugs.entries()) {
          attributes[key] = plug.getValue();
        }
        nodes.push({
          uuid: node.uuid,
          name: node.name,
          type: node.nodeType,
          parentUuid: (node.parent && node.parent.uuid !== rootUuid) ? node.parent.uuid : null,
          attributes,
        });
      }
      for (const child of node.children) walk(child);
    };
    walk(this.core.sceneGraph.root);

    const data: SerializedScene = {
      formatVersion: '1.0.0',
      metadata: { fps: 24, unit: 'meters', savedAt: new Date().toISOString() },
      nodes,
      viewportSettings,
    };

    return JSON.stringify(data, null, 2);
  }

  /* ── Deserialize ───────────────────────────────────────────────────── */

  /**
   * Parse a JSON string produced by `serialize()` and return the scene data.
   * Does NOT mutate the engine — the caller is responsible for clearing the
   * old scene, creating nodes, and wiring them into the viewport.
   */
  public static parse(json: string): SerializedScene {
    const data = JSON.parse(json) as SerializedScene;
    if (!data.formatVersion || !Array.isArray(data.nodes)) {
      throw new Error('Invalid scene file format');
    }
    return data;
  }

  /**
   * Instantiate DAGNodes from serialised data and add them to the scene graph.
   * Returns a map of  serialised-uuid → new DAGNode  so the caller can sync
   * the viewport.
   */
  public deserialize(data: SerializedScene): DAGNode[] {
    // uuid map: old → new node  (we preserve the original UUIDs)
    const nodeMap = new Map<string, DAGNode>();
    const ordered: DAGNode[] = [];

    for (const s of data.nodes) {
      let node: DAGNode;
      if (s.type === 'MeshNode') {
        node = new MeshNode(s.name);
        // Assign the serialised uuid so floating windows etc. still work
        (node as any).uuid = s.uuid;
        if (s.attributes.geometry != null) (node as MeshNode).geometryType.setValue(s.attributes.geometry);
        if (s.attributes.color != null)    (node as MeshNode).color.setValue(s.attributes.color);
      } else if (s.type === 'CameraNode') {
        node = new CameraNode(s.name);
        (node as any).uuid = s.uuid;
        if (s.attributes.focalLength != null)             (node as CameraNode).focalLength.setValue(s.attributes.focalLength);
        if (s.attributes.horizontalFilmAperture != null)  (node as CameraNode).horizontalFilmAperture.setValue(s.attributes.horizontalFilmAperture);
        if (s.attributes.verticalFilmAperture != null)    (node as CameraNode).verticalFilmAperture.setValue(s.attributes.verticalFilmAperture);
        if (s.attributes.nearClip != null)                (node as CameraNode).nearClip.setValue(s.attributes.nearClip);
        if (s.attributes.farClip != null)                 (node as CameraNode).farClip.setValue(s.attributes.farClip);
        if (s.attributes.filmFit != null)                 (node as CameraNode).filmFit.setValue(s.attributes.filmFit);
      } else {
        // GroupNode or unknown → GroupNode
        node = new GroupNode(s.name);
        (node as any).uuid = s.uuid;
      }

      // Common TRS + visibility
      if (s.attributes.translate)  node.translate.setValue(s.attributes.translate);
      if (s.attributes.rotate)     node.rotate.setValue(s.attributes.rotate);
      if (s.attributes.scale)      node.scale.setValue(s.attributes.scale);
      if (s.attributes.visibility !== undefined) node.visibility.setValue(s.attributes.visibility);

      nodeMap.set(s.uuid, node);
      ordered.push(node);
    }

    // Second pass: set up hierarchy and add to scene graph
    for (const s of data.nodes) {
      const node = nodeMap.get(s.uuid)!;
      const parent = s.parentUuid ? nodeMap.get(s.parentUuid) : undefined;
      this.core.sceneGraph.addNode(node, parent);
    }

    return ordered;
  }
}
