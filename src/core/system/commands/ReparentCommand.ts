import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { SceneGraph } from '../../dag/SceneGraph';

/**
 * Moves a node to a new parent in the DAG hierarchy.
 * Also reparents the corresponding Three.js object via the provided callback
 * so that group transforms propagate correctly in the viewport.
 */
export class ReparentCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  private readonly oldParent: DAGNode;

  constructor(
    private readonly node: DAGNode,
    private readonly newParent: DAGNode,
    private readonly sceneGraph: SceneGraph,
    /** Reparents the Three.js Object3D — called after every DAG move */
    private readonly reparentInView: (nodeUuid: string, newParentUuid: string) => void,
  ) {
    this.description = `Parent "${node.name}" → "${newParent.name}"`;
    this.affectedNodeUuids = new Set([node.uuid, newParent.uuid]);
    this.oldParent = node.parent ?? sceneGraph.root;
  }

  execute(): void {
    if (this.node.parent) this.node.parent.removeChild(this.node);
    this.newParent.addChild(this.node);
    this.reparentInView(this.node.uuid, this.newParent.uuid);
  }

  undo(): void {
    if (this.node.parent) this.node.parent.removeChild(this.node);
    this.oldParent.addChild(this.node);
    this.reparentInView(this.node.uuid, this.oldParent.uuid);
  }
}
