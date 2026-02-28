import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { SceneGraph } from '../../dag/SceneGraph';
import { SelectionManager } from '../SelectionManager';

/**
 * Records a set of already-created clone nodes so the operation is undoable.
 * The ViewportManager creates and positions the clones before constructing this command.
 * undo() removes all clones from the view and sceneGraph.
 */
export class DuplicateCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  constructor(
    /** Flat list of ALL cloned nodes (roots + any descendants). */
    private readonly clones: DAGNode[],
    /** Only the root clones (top-level, without their cloned children). */
    private readonly rootClones: DAGNode[],
    private readonly originalSources: DAGNode[],
    private readonly sceneGraph: SceneGraph,
    private readonly selectionManager: SelectionManager,
    private readonly removeFromView: (uuid: string) => void,
  ) {
    this.description = `Duplicate ${rootClones.length} object(s)`;
    this.affectedNodeUuids = new Set(clones.map(n => n.uuid));
  }

  execute(): void {
    // Clones are already in sceneGraph + view — just select them
    this.selectionManager.clear();
    for (const c of this.rootClones) {
      this.selectionManager.select(c, true);
    }
  }

  undo(): void {
    // Remove deepest nodes first to avoid orphan issues
    const sorted = [...this.clones].reverse();
    for (const c of sorted) {
      this.removeFromView(c.uuid);
      this.sceneGraph.removeNode(c);
    }
    this.selectionManager.clear();
    for (const src of this.originalSources) {
      this.selectionManager.select(src, true);
    }
  }
}
