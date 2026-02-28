import { DAGNode } from './DAGNode';
import { CameraNode, FilmFit } from './CameraNode';
import { MeshNode } from './MeshNode';

export class SceneGraph {
  public root: DAGNode;
  public nodes: Map<string, DAGNode> = new Map();

  constructor() {
    this.root = new DAGNode('WorldRoot');
    this.nodes.set(this.root.uuid, this.root);
  }

  public addNode(node: DAGNode, parent?: DAGNode) {
    this.nodes.set(node.uuid, node);
    if (parent) {
      parent.addChild(node);
    } else {
      this.root.addChild(node);
    }
  }

  public removeNode(node: DAGNode) {
    if (node.parent) {
      node.parent.removeChild(node);
    }
    this.nodes.delete(node.uuid);
    // Note: in a real system we'd recursively remove children
  }

  /** Remove ALL nodes except the WorldRoot. */
  public clear(): void {
    // Collect all non-root nodes
    const toRemove: DAGNode[] = [];
    for (const [uuid, node] of this.nodes) {
      if (uuid !== this.root.uuid) toRemove.push(node);
    }
    // Detach children from root
    this.root.children = [];
    // Clear the map and re-add root
    this.nodes.clear();
    this.nodes.set(this.root.uuid, this.root);
  }

  public getNodeById(uuid: string): DAGNode | undefined {
    return this.nodes.get(uuid);
  }

  public getAllNodes(): DAGNode[] {
    return Array.from(this.nodes.values());
  }
}
