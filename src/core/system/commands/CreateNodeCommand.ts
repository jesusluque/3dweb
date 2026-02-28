import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { SceneGraph } from '../../dag/SceneGraph';
import { SelectionManager } from '../SelectionManager';

/**
 * Undoable creation of a DAGNode in the scene.
 * We accept callbacks for the 3D-view side effects to avoid a circular
 * import between Command ↔ ViewportManager.
 */
export class CreateNodeCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  constructor(
    public readonly node: DAGNode,
    private readonly parent: DAGNode | undefined,
    private readonly sceneGraph: SceneGraph,
    private readonly selectionManager: SelectionManager,
    private readonly addToView: (node: DAGNode) => void,
    private readonly removeFromView: (uuid: string) => void,
  ) {
    this.description = `Create "${node.name}"`;
    this.affectedNodeUuids = new Set([node.uuid]);
  }

  execute(): void {
    this.sceneGraph.addNode(this.node, this.parent);
    this.addToView(this.node);
    this.selectionManager.select(this.node, false);
  }

  undo(): void {
    this.selectionManager.clear();
    this.removeFromView(this.node.uuid);
    this.sceneGraph.removeNode(this.node);
  }
}
