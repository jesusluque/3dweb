import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { SceneGraph } from '../../dag/SceneGraph';

/**
 * Repositions a node to a specific index within a (possibly new) parent.
 * Supports full undo: restores to old parent at the old index.
 */
export class ReorderCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  private readonly oldParent: DAGNode;
  private readonly oldIndex: number;

  constructor(
    private readonly node: DAGNode,
    private readonly newParent: DAGNode,
    private readonly newIndex: number,
    private readonly sceneGraph: SceneGraph,
    private readonly reparentInView: (nodeUuid: string, newParentUuid: string) => void,
  ) {
    this.description = `Reorder "${node.name}" in "${newParent.name}"`;
    this.affectedNodeUuids = new Set([node.uuid, newParent.uuid]);
    this.oldParent = node.parent ?? sceneGraph.root;
    this.oldIndex = this.oldParent.children.indexOf(node);
  }

  execute(): void {
    const sameParent = this.node.parent === this.newParent;
    const currentIdx = sameParent ? this.newParent.children.indexOf(this.node) : -1;
    // removeChild shrinks the array; compensate when inserting after within same parent
    const insertIdx = sameParent && currentIdx < this.newIndex
      ? this.newIndex - 1
      : this.newIndex;
    if (this.node.parent) this.node.parent.removeChild(this.node);
    this.newParent.insertChildAt(this.node, insertIdx);
    this.reparentInView(this.node.uuid, this.newParent.uuid);
  }

  undo(): void {
    if (this.node.parent) this.node.parent.removeChild(this.node);
    this.oldParent.insertChildAt(this.node, this.oldIndex);
    this.reparentInView(this.node.uuid, this.oldParent.uuid);
  }
}
