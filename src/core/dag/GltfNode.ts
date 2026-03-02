import * as THREE from 'three';
import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export class GltfNode extends DAGNode {
  public fileName: Plug<string>;

  /**
   * Base64-encoded GLB binary – stored here (not as a Plug) so it is included
   * in serialisation without going through the DG machinery.  Empty string means
   * the asset has not been embedded (e.g. unsaved import or large file skipped).
   */
  public fileData: string = '';

  /**
   * Runtime Three.js scene root – set once after GLTFLoader finishes.
   * Not serialised; reconstructed from `fileData` on load.
   */
  public _loadedScene: THREE.Group | null = null;

  constructor(name: string) {
    super(name);
    this.nodeType = 'GltfNode';
    this.fileName = this.addPlug('fileName', PlugType.String, '');
  }
}
