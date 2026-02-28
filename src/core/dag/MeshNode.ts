import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export class MeshNode extends DAGNode {
  public geometryType: Plug<string>; // e.g. "box", "sphere", "plane"
  public color: Plug<string>;

  constructor(name: string) {
    super(name);
    this.nodeType = 'MeshNode';
    this.geometryType = this.addPlug('geometry', PlugType.String, 'box');
    this.color = this.addPlug('color', PlugType.String, '#808080');
  }
}
