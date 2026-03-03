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

  constructor(name: string) {
    super(name);
    this.nodeType = 'SplatNode';
    this.fileName = this.addPlug('fileName', PlugType.String, '');
  }
}
