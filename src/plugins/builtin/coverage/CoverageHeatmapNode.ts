/**
 * CoverageHeatmapNode — DAG node representing the Gaussian coverage heatmap overlay.
 *
 * Appears in the Outliner so the user can select it and tweak parameters in
 * the Attribute Editor while the heatmap is live in the viewport.
 *
 * Plugs:
 *   density   — random sample points generated per triangle (1–32, default 4).
 *               Higher → smoother gradient at the cost of more geometry.
 *   pointSize — multiplier on the auto-computed Gaussian disk radius (0.1–8, default 1.0).
 *               Larger → broader, more "painterly" blobs.
 *   opacity   — alpha scale applied to every Gaussian disk (0–1, default 0.9).
 */

import { DAGNode } from '../../../core/dag/DAGNode';
import { Plug, PlugType } from '../../../core/dg/Plug';

export class CoverageHeatmapNode extends DAGNode {
  public readonly density:   Plug<number>;
  public readonly pointSize: Plug<number>;
  public readonly opacity:   Plug<number>;

  constructor() {
    super('Coverage Heatmap');
    this.nodeType = 'CoverageHeatmapNode';

    // samples per triangle (integer-like float so the MMB scrubber works)
    this.density = this.addPlug('density', PlugType.Float, 4.0);
    // world-space radius multiplier
    this.pointSize = this.addPlug('pointSize', PlugType.Float, 1.0);
    // overall alpha of the overlay
    this.opacity = this.addPlug('opacity', PlugType.Float, 0.9);
  }
}
