export enum PlugType {
  Float,
  Boolean,
  String,
  Vector3,
  Color
}

export class Plug<T> {
  public isDirty: boolean = true;
  private cachedValue: T;
  
  public incomingConnection: Plug<T> | null = null;
  public outgoingConnections: Plug<T>[] = [];
  
  // Event that gets triggered when this plug becomes dirty (useful for UI or viewport sync)
  public onDirty?: () => void;

  constructor(
    public name: string,
    public type: PlugType,
    public parentNode: any, // Will be DGNode
    defaultValue: T
  ) {
    this.cachedValue = defaultValue;
  }

  public connectTo(target: Plug<T>): void {
    if (this.type !== target.type) {
      throw new Error(`Cannot connect plug of type ${this.type} to ${target.type}`);
    }
    // Disconnect target's existing incoming connection if it exists
    if (target.incomingConnection) {
      target.incomingConnection.disconnectFrom(target);
    }
    
    this.outgoingConnections.push(target);
    target.incomingConnection = this;
    target.setDirty(true);
  }

  public disconnectFrom(target: Plug<T>): void {
    this.outgoingConnections = this.outgoingConnections.filter(p => p !== target);
    target.incomingConnection = null;
    target.setDirty(true);
  }

  public setDirty(propagate: boolean = true): void {
    if (!this.isDirty) {
      this.isDirty = true;
      if (this.onDirty) this.onDirty();
      
      if (propagate) {
        for (const out of this.outgoingConnections) {
          out.setDirty(true);
        }
      }
    }
  }

  public getValue(): T {
    if (this.isDirty) {
      if (this.incomingConnection) {
        this.cachedValue = this.incomingConnection.getValue();
      } else {
        // Output plug with no incoming connection, trigger node internal computation
        if (typeof this.parentNode.compute === 'function') {
          this.parentNode.compute(this);
        }
      }
      this.isDirty = false;
    }
    return this.cachedValue;
  }

  public setValue(val: T): void {
    if (this.incomingConnection) {
      console.warn(`Cannot set value directly on connected plug: ${this.parentNode.name}.${this.name}`);
      return;
    }
    this.cachedValue = val;
    this.setDirty(true);
  }
}
