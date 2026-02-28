import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { GroupNode } from '../../dag/GroupNode';
import { SceneGraph } from '../../dag/SceneGraph';
import { SelectionManager } from '../SelectionManager';

/**
 * Creates a GroupNode and re-parents the provided nodes under it.
 * On undo: un-parents the children (returns them to WorldRoot) and removes
 * the group node.
 */
export class CreateGroupCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  private readonly group: GroupNode;
  /** Original {node, parent} so undo can restore hierarchy */
  private readonly originalParents: { node: DAGNode; parent: DAGNode }[] = [];

  constructor(
    groupName: string,
    private readonly children: DAGNode[],
    private readonly sceneGraph: SceneGraph,
    private readonly selectionManager: SelectionManager,
    private readonly addToView: (node: DAGNode) => void,
    private readonly removeFromView: (uuid: string) => void,
    private readonly reparentInView: (nodeUuid: string, newParentUuid: string) => void,
  ) {
    this.group = new GroupNode(groupName);
    this.description = `Group "${groupName}" (${children.length} object${children.length !== 1 ? 's' : ''})`;
    this.affectedNodeUuids = new Set([this.group.uuid, ...children.map(c => c.uuid)]);

    for (const c of children) {
      this.originalParents.push({ node: c, parent: c.parent ?? sceneGraph.root });
    }
  }

  execute(): void {
    // Add the group to the scene
    this.sceneGraph.addNode(this.group);
    this.addToView(this.group);

    // Re-parent children: DAG + Three.js
    for (const c of this.children) {
      if (c.parent) c.parent.removeChild(c);
      this.group.addChild(c);
      this.reparentInView(c.uuid, this.group.uuid);
    }

    // Select the group
    this.selectionManager.select(this.group, false);
  }

  undo(): void {
    // Restore original parents: first move Three.js objects OUT of the group
    // so they are re-attached before we delete the group object.
    for (const { node, parent } of this.originalParents) {
      this.reparentInView(node.uuid, parent.uuid);
      if (node.parent) node.parent.removeChild(node);
      parent.addChild(node);
    }

    // Remove the now-empty group
    this.selectionManager.clear();
    this.removeFromView(this.group.uuid);
    this.sceneGraph.removeNode(this.group);
  }
}
