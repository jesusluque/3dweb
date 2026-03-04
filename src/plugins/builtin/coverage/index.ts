/**
 * Coverage Analysis Plugin — entry point.
 *
 * Contributes an "Analyze → Coverage Analysis…" menu item that opens a floating
 * window with the CoveragePanel component.
 */

import type { IPlugin, MenuContribution } from '../../IPlugin';

export const coveragePlugin: IPlugin = {
  name: 'Coverage Analysis',

  menuContributions: [
    {
      menu: 'Analyze',
      label: 'Coverage Analysis…',
      shortcut: '⌥C',
      action: (_engine, getStore) => {
        try {
          const store = getStore();
          store.openCoveragePanel();
        } catch (e) {
          console.error('[CoveragePlugin] Could not open panel:', e);
        }
      },
    } satisfies MenuContribution,
  ],
};
