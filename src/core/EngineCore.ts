import { SceneGraph } from './dag/SceneGraph';
import { SelectionManager } from './system/SelectionManager';
import { CommandHistory } from './system/CommandHistory';
import { ConsoleLogger } from './system/ConsoleLogger';
import { CameraNode } from './dag/CameraNode';
import { MeshNode } from './dag/MeshNode';
import { DAGNode } from './dag/DAGNode';

export class EngineCore {
  public sceneGraph: SceneGraph;
  public selectionManager: SelectionManager;
  public commandHistory: CommandHistory;
  public logger: ConsoleLogger;

  constructor() {
    this.sceneGraph = new SceneGraph();
    this.selectionManager = new SelectionManager();
    this.commandHistory = new CommandHistory();
    this.logger = new ConsoleLogger();
  }

  // Helper to init a basic scene
  public initDefaultScene() {
    const cam = new CameraNode('PerspCam');
    cam.translate.setValue({ x: 0, y: 5, z: 10 });
    // Let's assume rotating X down slightly
    cam.rotate.setValue({ x: -20, y: 0, z: 0 });
    this.sceneGraph.addNode(cam);

    const mesh = new MeshNode('CubeGeo1');
    this.sceneGraph.addNode(mesh);

    this.logger.log('Scene initialized with default camera and cube.', 'info');
    this.logger.log('Select objects with LMB. W=Translate  E=Rotate  R=Scale  T=Toggle Space  Q=Detach', 'info');
  }
}
