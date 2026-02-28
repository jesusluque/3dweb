import { DAGNode } from './DAGNode';

/**
 * A transform group — analogous to Maya's `group` command.
 * Has no geometry of its own; children inherit the group transform.
 */
export class GroupNode extends DAGNode {
  constructor(name: string) {
    super(name);
    this.nodeType = 'GroupNode';
  }
}
