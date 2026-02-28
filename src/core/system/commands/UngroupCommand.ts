import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { GroupNode } from '../../dag/GroupNode';
import { SceneGraph } from '../../dag/SceneGraph';
import { SelectionManager } from '../SelectionManager';

/**
 * Dissolves a GroupNode: moves its children up to the group's parent, then
 * removes the (now empty) group from the scene.
 * Fully undoable — undo re-creates the group and re-parents children.
 */
export class UngroupCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  /** Children snapshotted at execute-time */
  private children: DAGNode[] = [];
  /** Where the group lived before execute */
  private groupParent: DAGNode;

  constructor(
    private readonly group: GroupNode,
    private readonly sceneGraph: SceneGraph,
    private readonly selectionManager: SelectionManager,
    private readonly addToView: (node: DAGNode) => void,
    private readonly removeFromView: (uuid: string) => void,
    private readonly reparentInView: (nodeUuid: string, newParentUuid: string) => void,
  ) {
    this.description = `Ungroup "${group.name}"`;
    this.affectedNodeUuids = new Set([group.uuid]);
    this.groupParent = group.parent ?? sceneGraph.root;
  }

  execute(): void {
    // Snapshot children before mutating
    this.children = [...this.group.children];
    const dest = this.groupParent;

    // Lift each child: Three.js first (while group object still exists), then DAG
    for (const c of this.children) {
      this.reparentInView(c.uuid, dest.uuid);
      this.group.removeChild(c);
      dest.addChild(c);
    }

    // Remove the now-empty group
    this.selectionManager.clear();
    this.removeFromView(this.group.uuid);
    this.sceneGraph.removeNode(this.group);

    // Select the lifted children
    for (const c of this.children) {
      this.selectionManager.select(c, true);
    }
  }

  undo(): void {
    // Re-add the group
    this.sceneGraph.addNode(this.group, this.groupParent);
    this.addToView(this.group);

    // Re-parent children back under the group: DAG + Three.js
    for (const c of this.children) {
      if (c.parent) c.parent.removeChild(c);
      this.group.addChild(c);
      this.reparentInView(c.uuid, this.group.uuid);
    }

    this.selectionManager.select(this.group, false);
  }
}
