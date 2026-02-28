import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

export const StatusBar: React.FC = () => {
  const core = useAppStore((s) => s.core);
  const selectedNodes = useAppStore((s) => s.selectedNodes);
  const sceneVersion = useAppStore((s) => s.sceneVersion);

  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  useEffect(() => {
    if (!core) return;
    const sync = () => {
      setUndoCount(core.commandHistory.undoDepth);
      setRedoCount(core.commandHistory.redoDepth);
    };
    core.commandHistory.onHistoryChanged = sync;
    sync();
    return () => { core.commandHistory.onHistoryChanged = undefined; };
  }, [core]);

  const nodeCount = core?.sceneGraph.getAllNodes().length ?? 0;
  const selCount = selectedNodes.length;
  const selLabel = selCount === 0
    ? 'Nothing selected'
    : selCount === 1
      ? selectedNodes[0].name
      : `${selCount} objects`;

  return (
    <div style={{
      height: '26px',
      flexShrink: 0,
      backgroundColor: '#1f1f1f',
      borderTop: '1px solid #111',
      color: '#888',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      fontSize: '11px',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      gap: '18px',
      userSelect: 'none',
    }}>
      <span style={{ color: selCount > 0 ? '#c8c8c8' : '#666' }}>
        {selLabel}
      </span>
      <Sep />
      <span>Objects: {nodeCount}</span>
      <Sep />
      <span title="Undo / Redo depth">
        Undo: {undoCount} &nbsp;|&nbsp; Redo: {redoCount}
      </span>
      <div style={{ flexGrow: 1 }} />
      <span style={{ color: sceneVersion > 0 ? '#a8c8a8' : '#666' }}>
        {sceneVersion > 0 ? `Rev ${sceneVersion}` : 'Saved'}
      </span>
      <Sep />
      <span style={{ color: '#555' }}>3D Web Simulator &nbsp;·&nbsp; Three.js r183</span>
    </div>
  );
};

const Sep: React.FC = () => (
  <span style={{ width: '1px', height: '14px', backgroundColor: '#3a3a3a', display: 'inline-block' }} />
);
