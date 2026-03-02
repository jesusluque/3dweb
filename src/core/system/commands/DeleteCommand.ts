import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { SceneGraph } from '../../dag/SceneGraph';
import { SelectionManager } from '../SelectionManager';

interface DeletedEntry {
  node: DAGNode;
  parentUuid: string;
  childIndex: number;
}

/**
 * Undoable deletion of one or more DAGNodes (including their subtrees).
 * On undo, nodes are re-inserted at their original parent / child-index.
 */
export class DeleteCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  /**
   * Flat list of ALL deleted nodes (roots + descendants), ordered deepest-first
   * so that undo can re-add them top-down by reversing the list.
   */
  private deleted: DeletedEntry[] = [];

  constructor(
    /** Only the root-level nodes the user selected. */
    private readonly roots: DAGNode[],
    private readonly sceneGraph: SceneGraph,
    private readonly selectionManager: SelectionManager,
    private readonly addToView: (node: DAGNode) => void,
    private readonly removeFromView: (uuid: string) => void,
    private readonly reparentInView: (nodeUuid: string, parentUuid: string) => void,
  ) {
    // Collect entire subtrees depth-first
    const uuids = new Set<string>();
    const collect = (node: DAGNode) => {
      for (const child of node.children) collect(child);
      const parent = node.parent ?? sceneGraph.root;
      const idx = parent.children.indexOf(node);
      this.deleted.push({ node, parentUuid: parent.uuid, childIndex: idx });
      uuids.add(node.uuid);
    };
    for (const r of roots) collect(r);

    const nameList = roots.slice(0, 2).map(n => `"${n.name}"`).join(', ');
    const extra = roots.length > 2 ? ` +${roots.length - 2} more` : '';
    this.description = `Delete ${nameList}${extra}`;
    this.affectedNodeUuids = uuids;
  }

  execute(): void {
    this.selectionManager.clear();
    // Remove deepest first (they're already in that order)
    for (const entry of this.deleted) {
      this.removeFromView(entry.node.uuid);
      this.sceneGraph.removeNode(entry.node);
    }
  }

  undo(): void {
    // Re-add in reverse order (top-level parents first)
    const reversed = [...this.deleted].reverse();
    for (const entry of reversed) {
      const parent = this.sceneGraph.getNodeById(entry.parentUuid) ?? this.sceneGraph.root;
      this.sceneGraph.addNode(entry.node, undefined); // just register in map
      parent.insertChildAt(entry.node, entry.childIndex);
      this.addToView(entry.node);
      // Re-parent in 3D view if not a root-level child
      if (parent.uuid !== this.sceneGraph.root.uuid) {
        this.reparentInView(entry.node.uuid, parent.uuid);
      }
    }
    // Restore selection to original roots
    this.selectionManager.clear();
    for (const r of this.roots) {
      this.selectionManager.select(r, true);
    }
  }
}
