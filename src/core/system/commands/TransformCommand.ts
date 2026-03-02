import { Command } from '../CommandHistory';
import { DAGNode } from '../../dag/DAGNode';
import { Vector3Data } from '../../dag/DAGNode';

export interface NodeTransformEntry {
  node: DAGNode;
  oldTranslate: Vector3Data; newTranslate: Vector3Data;
  oldRotate: Vector3Data;    newRotate: Vector3Data;
  oldScale: Vector3Data;     newScale: Vector3Data;
}

function v3Eq(a: Vector3Data, b: Vector3Data) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function fmtV3(v: Vector3Data) {
  const r = (n: number) => parseFloat(n.toFixed(3));
  return `${r(v.x)}, ${r(v.y)}, ${r(v.z)}`;
}

function buildDesc(entries: NodeTransformEntry[]): string {
  if (entries.length === 1) {
    const e    = entries[0];
    const name = `"${e.node.name}"`;
    const tMoved = !v3Eq(e.oldTranslate, e.newTranslate);
    const rMoved = !v3Eq(e.oldRotate,    e.newRotate);
    const sMoved = !v3Eq(e.oldScale,     e.newScale);
    const parts: string[] = [];
    if (tMoved) parts.push(`T(${fmtV3(e.newTranslate)})`);
    if (rMoved) parts.push(`R(${fmtV3(e.newRotate)}°)`);
    if (sMoved) parts.push(`S(${fmtV3(e.newScale)})`);
    // Single operation — use a friendlier verb
    if (parts.length === 1) {
      if (tMoved) return `Move ${name} → (${fmtV3(e.newTranslate)})`;
      if (rMoved) return `Rotate ${name} → (${fmtV3(e.newRotate)}°)`;
      if (sMoved) return `Scale ${name} → (${fmtV3(e.newScale)})`;
    }
    if (parts.length > 1) return `Transform ${name} ${parts.join(' ')}`;
    return `Transform ${name}`;
  }
  // Multiple nodes — list up to 2 names then "+N more"
  const names = entries.slice(0, 2).map(e => `"${e.node.name}"`).join(', ');
  const extra = entries.length > 2 ? ` +${entries.length - 2} more` : '';
  return `Transform ${names}${extra}`;
}

export class TransformCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  constructor(public readonly entries: NodeTransformEntry[]) {
    this.description = buildDesc(entries);
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
