/**
 * IPlugin — contract every plugin must implement.
 *
 * Plugins are self-contained feature modules that contribute:
 *  - Menu items to the MenuBar ("Analyze", "Tools", …)
 *  - Optional one-time activation logic (register event listeners, warm up data, …)
 *
 * Lifecycle:
 *  1. PluginRegistry.register(plugin)        — called at app boot (before any render)
 *  2. PluginRegistry.activateAll(engine, store) — called once EngineCore is ready
 *  3. MenuBar reads PluginRegistry.getMenuContributions() to inject Analyze menu
 */

import type { EngineCore } from '../core/EngineCore';

// ── Menu contribution ────────────────────────────────────────────────────────

/** Minimal accessor surface exposed to plugin menu actions. */
export interface PluginStoreAccessor {
  openCoveragePanel: () => void;
  // extend with further store actions as plugins are added
}

/** A single entry contributed to a named top-level menu. */
export interface MenuContribution {
  /** Top-level menu label, e.g. "Analyze" */
  menu: string;
  /** Menu item label, e.g. "Coverage Analysis…" */
  label: string;
  /** Shortcut hint displayed on the right side (optional). */
  shortcut?: string;
  /** Called when the user clicks the item. Receives live engine + store accessor. */
  action: (engine: EngineCore | null, getStore: () => PluginStoreAccessor) => void;
}

// ── The plugin contract ──────────────────────────────────────────────────────

export interface IPlugin {
  /** Human-readable plugin identifier. Must be unique. */
  readonly name: string;

  /**
   * Called once when the engine is ready.
   * Use this to register event listeners, pre-build data, etc.
   * Keep it synchronous; defer heavy work to lazy init inside workers.
   */
  activate?(engine: EngineCore): void;

  /** Menu items this plugin contributes. Evaluated once after activation. */
  readonly menuContributions: MenuContribution[];
}
