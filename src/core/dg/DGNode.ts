import { Plug, PlugType } from './Plug';

export abstract class DGNode {
  public uuid: string;
  public name: string;
  public plugs: Map<string, Plug<any>> = new Map();

  constructor(name: string) {
    this.uuid = crypto.randomUUID();
    this.name = name;
  }

  // Utility to register a plug
  protected addPlug<T>(name: string, type: PlugType, defaultValue: T): Plug<T> {
    const plug = new Plug<T>(name, type, this, defaultValue);
    this.plugs.set(name, plug);
    return plug;
  }

  public getPlug(name: string): Plug<any> | undefined {
    return this.plugs.get(name);
  }

  // To be implemented by subclasses. Called by output plugs when they need to resolve their value.
  public abstract compute(plug: Plug<any>): void;
}
