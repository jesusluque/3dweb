/**
 * PluginRegistry — manages registration and activation of IPlugin instances.
 *
 * Usage (in main.tsx / App.tsx after EngineCore is ready):
 * ```ts
 * import { pluginRegistry } from './plugins/PluginRegistry';
 * import { coveragePlugin } from './plugins/builtin/coverage';
 *
 * pluginRegistry.register(coveragePlugin);
 * pluginRegistry.activateAll(engine);
 * ```
 *
 * MenuBar reads:
 * ```ts
 * pluginRegistry.getMenuContributions('Analyze')
 * ```
 */

import type { IPlugin, MenuContribution } from './IPlugin';
import type { EngineCore } from '../core/EngineCore';

class PluginRegistry {
  private readonly _plugins: IPlugin[] = [];
  private _activated = false;

  /** Register a plugin. Must be called before activateAll(). */
  register(plugin: IPlugin): void {
    if (this._plugins.find(p => p.name === plugin.name)) {
      console.warn(`[PluginRegistry] Plugin "${plugin.name}" is already registered — skipping.`);
      return;
    }
    this._plugins.push(plugin);
  }

  /** Activate all registered plugins. Safe to call multiple times — only runs once. */
  activateAll(engine: EngineCore): void {
    if (this._activated) return;
    this._activated = true;
    for (const plugin of this._plugins) {
      try {
        plugin.activate?.(engine);
      } catch (e) {
        console.error(`[PluginRegistry] Error activating plugin "${plugin.name}":`, e);
      }
    }
  }

  /**
   * Returns all menu contributions, optionally filtered by top-level menu name.
   * MenuBar calls this to build the "Analyze" menu dynamically.
   */
  getMenuContributions(menu?: string): MenuContribution[] {
    const all = this._plugins.flatMap(p => p.menuContributions);
    return menu ? all.filter(c => c.menu === menu) : all;
  }

  /** All registered plugins. */
  get plugins(): readonly IPlugin[] {
    return this._plugins;
  }
}

/** Singleton registry used throughout the app. */
export const pluginRegistry = new PluginRegistry();
