import { describe, it, expect } from 'vitest';
import { Plug, PlugType } from '../dg/Plug';
import { DGNode } from '../dg/DGNode';

class DummyNode extends DGNode {
  public valOut: Plug<number>;

  constructor(name: string) {
    super(name);
    this.valOut = this.addPlug('valOut', PlugType.Float, 0);
  }

  public compute(plug: Plug<any>) {
    // Basic compute imitation
    if (plug === this.valOut) {
      plug.setValue(5);
    }
  }
}

describe('Dependency Graph - Plug Connections and Dirty Push', () => {
  it('Pushes dirty state to downstream dependents', () => {
    const nodeA = new DummyNode('NodeA');
    const nodeB = new DummyNode('NodeB');

    // Make custom input
    const inputPlug = new Plug('in', PlugType.Float, nodeB, 0);
    
    // Connect NodeA out -> NodeB in
    nodeA.valOut.connectTo(inputPlug);

    // Initial state setup: clear dirtiness
    inputPlug.getValue(); // pulls and evaluates A, making both clean
    
    expect(inputPlug.isDirty).toBe(false);
    expect(nodeA.valOut.isDirty).toBe(false);

    // Editing source should dirty the downstream
    nodeA.valOut.setValue(10);
    
    expect(nodeA.valOut.isDirty).toBe(true);
    expect(inputPlug.isDirty).toBe(true);
  });
});
