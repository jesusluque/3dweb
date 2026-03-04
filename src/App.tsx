import { useEffect } from 'react';
import { AppLayout } from './ui/Layout';
import { useAppStore } from './ui/store/useAppStore';
import { pluginRegistry } from './plugins/PluginRegistry';
import { coveragePlugin } from './plugins/builtin/coverage';

// ── Register plugins (once at module load) ──────────────────────────────────
pluginRegistry.register(coveragePlugin);

function App() {
  const initCore = useAppStore(state => state.initCore);
  const core     = useAppStore(state => state.core);

  useEffect(() => {
    initCore();
  }, [initCore]);

  // Activate all plugins once the engine core is available
  useEffect(() => {
    if (core) {
      pluginRegistry.activateAll(core);
    }
  }, [core]);

  // Global keyboard shortcuts for File operations (⌘/Ctrl + N, O, S, ⇧S)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      const state = useAppStore.getState();

      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        state.newScene();
      } else if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        state.openScene();
      } else if (key === 's' && e.shiftKey) {
        e.preventDefault();
        state.saveSceneAs();
      } else if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        state.saveScene();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return <AppLayout />;
}

export default App;
