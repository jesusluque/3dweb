import { DAGNode } from '../dag/DAGNode';

export class SelectionManager {
  private selectedNodes: Set<DAGNode> = new Set();
  
  // Support multiple event listeners instead of overriding a single one
  private listeners: (() => void)[] = [];

  public addListener(listener: () => void) {
    this.listeners.push(listener);
  }

  public removeListener(listener: () => void) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public select(node: DAGNode, toggle: boolean = false) {
    if (!toggle) {
      this.selectedNodes.clear();
    }
    
    if (this.selectedNodes.has(node) && toggle) {
      this.selectedNodes.delete(node);
    } else {
      this.selectedNodes.add(node);
    }
    
    this.notify();
  }

  public clear() {
    this.selectedNodes.clear();
    this.notify();
  }

  // Last selected object for attribute editor
  public getLeadSelection(): DAGNode | null {
    if (this.selectedNodes.size === 0) return null;
    const arr = Array.from(this.selectedNodes);
    return arr[arr.length - 1];
  }

  public getSelection(): DAGNode[] {
    return Array.from(this.selectedNodes);
  }

  /** Replace the current selection with an arbitrary set of nodes, firing one notification. */
  public selectMany(nodes: DAGNode[]): void {
    this.selectedNodes.clear();
    for (const n of nodes) this.selectedNodes.add(n);
    this.notify();
  }
}
