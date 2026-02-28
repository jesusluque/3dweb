import { DGNode } from '../dg/DGNode';
import { Plug, PlugType } from '../dg/Plug';

export type Vector3Data = { x: number, y: number, z: number };

export class DAGNode extends DGNode {
  public parent: DAGNode | null = null;
  public children: DAGNode[] = [];
  public nodeType: string = 'DAGNode';

  // Basic TRS plugs
  public translate: Plug<Vector3Data>;
  public rotate: Plug<Vector3Data>;
  public scale: Plug<Vector3Data>;
  public visibility: Plug<boolean>;

  constructor(name: string) {
    super(name);
    
    this.translate = this.addPlug('translate', PlugType.Vector3, { x: 0, y: 0, z: 0 });
    this.rotate = this.addPlug('rotate', PlugType.Vector3, { x: 0, y: 0, z: 0 });
    this.scale = this.addPlug('scale', PlugType.Vector3, { x: 1, y: 1, z: 1 });
    this.visibility = this.addPlug('visibility', PlugType.Boolean, true);
  }

  public addChild(child: DAGNode): void {
    if (child.parent) {
      child.parent.removeChild(child);
    }
    this.children.push(child);
    child.parent = this;
  }

  public removeChild(child: DAGNode): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
  }

  /** Inserts a child at a specific index (clamped to valid range). */
  public insertChildAt(child: DAGNode, index: number): void {
    if (child.parent) {
      child.parent.removeChild(child);
    }
    const clamped = Math.max(0, Math.min(index, this.children.length));
    this.children.splice(clamped, 0, child);
    child.parent = this;
  }

  public compute(plug: Plug<any>): void {
    // For basic TRS, we usually don't compute them from within unless they are driven by an internal constraint.
    // They are driven by their inputs (or static values).
  }
}
