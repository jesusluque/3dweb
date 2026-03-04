import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export type LightType = 'directional' | 'point' | 'ambient' | 'spot';

export class LightNode extends DAGNode {
  public lightType:  Plug<string>;
  public color:      Plug<string>;
  public intensity:  Plug<number>;
  /** SpotLight only — half cone-angle in degrees (default 30°). */
  public coneAngle:  Plug<number>;
  /** SpotLight only — penumbra soft-edge factor 0 (hard) … 1 (fully soft). */
  public penumbra:   Plug<number>;

  constructor(name: string) {
    super(name);
    this.nodeType = 'LightNode';

    this.lightType  = this.addPlug('lightType',  PlugType.String, 'directional' as string);
    this.color      = this.addPlug('color',      PlugType.String, '#ffffff');
    this.intensity  = this.addPlug('intensity',  PlugType.Float,  1.0);
    this.coneAngle  = this.addPlug('coneAngle',  PlugType.Float,  30.0);
    this.penumbra   = this.addPlug('penumbra',   PlugType.Float,  0.1);
  }
}
