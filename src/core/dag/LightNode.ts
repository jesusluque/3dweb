import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export type LightType = 'directional' | 'point' | 'ambient' | 'spot';

export class LightNode extends DAGNode {
  public lightType:  Plug<string>;
  public color:      Plug<string>;
  public intensity:  Plug<number>;

  constructor(name: string) {
    super(name);
    this.nodeType = 'LightNode';

    this.lightType  = this.addPlug('lightType',  PlugType.String, 'directional' as string);
    this.color      = this.addPlug('color',      PlugType.String, '#ffffff');
    this.intensity  = this.addPlug('intensity',  PlugType.Float,  1.0);
  }
}
