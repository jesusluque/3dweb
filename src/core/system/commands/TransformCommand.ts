import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { Vector3Data } from '../../dag/DAGNode';

export interface NodeTransformEntry {
  node: DAGNode;
  oldTranslate: Vector3Data; newTranslate: Vector3Data;
  oldRotate: Vector3Data;    newRotate: Vector3Data;
  oldScale: Vector3Data;     newScale: Vector3Data;
}

export class TransformCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  constructor(public readonly entries: NodeTransformEntry[]) {
    const names = entries.map(e => `"${e.node.name}"`).join(', ');
    this.description = `Transform ${names}`;
    this.affectedNodeUuids = new Set(entries.map(e => e.node.uuid));
  }

  execute(): void {
    for (const e of this.entries) {
      e.node.translate.setValue(e.newTranslate);
      e.node.rotate.setValue(e.newRotate);
      e.node.scale.setValue(e.newScale);
    }
  }

  undo(): void {
    for (const e of this.entries) {
      e.node.translate.setValue(e.oldTranslate);
      e.node.rotate.setValue(e.oldRotate);
      e.node.scale.setValue(e.oldScale);
    }
  }
}
