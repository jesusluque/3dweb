import * as THREE from 'three';
import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export class PlyNode extends DAGNode {
  public fileName: Plug<string>;
  public pointSize: Plug<number>;

  /**
   * Base64-encoded PLY binary – stored for scene serialisation.
   * Empty string means the asset has not been embedded yet.
   */
  public fileData: string = '';

  /**
   * Whether the PLY contains indexed faces (mesh) or only vertices (point cloud).
   * Set automatically at import time.
   */
  public plyType: 'mesh' | 'pointcloud' = 'pointcloud';

  /**
   * Runtime Three.js object – set once after parsing.
   * Not serialised; reconstructed from `fileData` on scene restore.
   */
  public _loadedObject: THREE.Object3D | null = null;

  constructor(name: string) {
    super(name);
    this.nodeType = 'PlyNode';
    this.fileName  = this.addPlug('fileName',  PlugType.String, '');
    this.pointSize = this.addPlug('pointSize', PlugType.Float,  0.01);
  }
}
