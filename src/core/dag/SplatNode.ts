import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export class SplatNode extends DAGNode {
  public fileName: Plug<string>;

  /**
   * Base64-encoded splat binary – stored here (not as a Plug) for scene
   * serialisation.  Empty string means the asset has not been embedded yet.
   */
  public fileData: string = '';

  /**
   * Original file format, derived from the file extension.
   * Stored separately for quick access at load time.
   */
  public fileFormat: 'splat' | 'ply' = 'splat';

  /**
   * Runtime gsplat Splat object – set once the asset is loaded.
   * Not serialised; reconstructed from `fileData` on scene restore.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public _splatObject: any = null;

  // ── Crop volume ────────────────────────────────────────────────────────────
  /** Whether the AABB crop box is active. */
  public cropEnabled: Plug<boolean>;
  /** Crop box minimum corner in model space. */
  public cropMinX: Plug<number>;
  public cropMinY: Plug<number>;
  public cropMinZ: Plug<number>;
  /** Crop box maximum corner in model space. */
  public cropMaxX: Plug<number>;
  public cropMaxY: Plug<number>;
  public cropMaxZ: Plug<number>;

  constructor(name: string) {
    super(name);
    this.nodeType = 'SplatNode';
    this.fileName = this.addPlug('fileName', PlugType.String, '');

    // Crop volume plugs — default to a generous ±5 unit box, disabled
    this.cropEnabled = this.addPlug('cropEnabled', PlugType.Boolean, false);
    this.cropMinX    = this.addPlug('cropMinX',    PlugType.Float,   -5);
    this.cropMinY    = this.addPlug('cropMinY',    PlugType.Float,   -5);
    this.cropMinZ    = this.addPlug('cropMinZ',    PlugType.Float,   -5);
    this.cropMaxX    = this.addPlug('cropMaxX',    PlugType.Float,    5);
    this.cropMaxY    = this.addPlug('cropMaxY',    PlugType.Float,    5);
    this.cropMaxZ    = this.addPlug('cropMaxZ',    PlugType.Float,    5);
  }
}
