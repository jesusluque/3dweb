import React from 'react';
import { CameraViewPanel } from '../panels/CameraViewPanel';
import { useAppStore } from '../store/useAppStore';
import { CameraNode } from '../../core/dag/CameraNode';

/**
 * CameraMosaicOverlay
 *
 * Shows ALL scene cameras in a tiled mosaic grid.
 * Rendered inside a FloatingWindow by FloatingWindowManager.
 */
export const CameraMosaicOverlay: React.FC = () => {
  const core              = useAppStore(s => s.core);
  const sceneVersion      = useAppStore(s => s.sceneVersion); void sceneVersion;

  // Gather ALL cameras from the scene graph (not just open windows)
  const cameras: CameraNode[] = [];
  if (core) {
    for (const n of core.sceneGraph.getAllNodes()) {
      if (n instanceof CameraNode) cameras.push(n);
    }
  }

  if (cameras.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: '#111',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: '"Segoe UI",system-ui,sans-serif' }}>
          No cameras in scene
        </span>
      </div>
    );
  }

  // Compute grid dimensions (cols × rows) to best fill the space
  const count = cameras.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#111',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Grid of camera views */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: 2,
        padding: 2,
        overflow: 'hidden',
      }}>
        {cameras.map(cam => (
          <div
            key={cam.uuid}
            style={{
              position: 'relative',
              background: '#1a1a1a',
              borderRadius: 2,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Camera label */}
            <div style={{
              height: 20, minHeight: 20,
              display: 'flex', alignItems: 'center',
              padding: '0 8px',
              background: 'rgba(0,0,0,0.5)',
              fontSize: 10,
              fontFamily: '"Segoe UI",system-ui,sans-serif',
              color: 'rgba(255,255,255,0.6)',
              userSelect: 'none',
              zIndex: 1,
            }}>
              {cam.name}
            </div>
            {/* Camera view render */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <CameraViewPanel cameraUuid={cam.uuid} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
