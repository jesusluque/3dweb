import type { Command } from '../CommandHistory';
import { SplatNode } from '../../dag/SplatNode';
import * as THREE from 'three';

/**
 * Records a change to a SplatNode's AABB crop bounds for undo / redo.
 * Only changes the 6 bound plugs; cropEnabled is left as-is.
 */
export class CropVolumeCommand implements Command {
  public readonly description: string;
  public readonly affectedNodeUuids: ReadonlySet<string>;

  constructor(
    private readonly node: SplatNode,
    private readonly oldMin: THREE.Vector3,
    private readonly oldMax: THREE.Vector3,
    private readonly newMin: THREE.Vector3,
    private readonly newMax: THREE.Vector3,
  ) {
    const r = (n: number) => parseFloat(n.toFixed(2));
    this.description = `Crop "${node.name}" [${r(newMin.x)},${r(newMin.y)},${r(newMin.z)}] → [${r(newMax.x)},${r(newMax.y)},${r(newMax.z)}]`;
    this.affectedNodeUuids = new Set([node.uuid]);
  }

  execute(): void {
    this._apply(this.newMin, this.newMax);
  }

  undo(): void {
    this._apply(this.oldMin, this.oldMax);
  }

  private _apply(min: THREE.Vector3, max: THREE.Vector3) {
    this.node.cropMinX.setValue(min.x);
    this.node.cropMinY.setValue(min.y);
    this.node.cropMinZ.setValue(min.z);
    this.node.cropMaxX.setValue(max.x);
    this.node.cropMaxY.setValue(max.y);
    this.node.cropMaxZ.setValue(max.z);
  }
}
