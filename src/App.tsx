import { useEffect } from 'react';
import { AppLayout } from './ui/Layout';
import { useAppStore } from './ui/store/useAppStore';

function App() {
  const initCore = useAppStore(state => state.initCore);

  useEffect(() => {
    initCore();
  }, [initCore]);

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
