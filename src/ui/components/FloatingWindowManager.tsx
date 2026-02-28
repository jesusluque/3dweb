import React from 'react';
import { FloatingWindow } from './FloatingWindow';
import { CameraMosaicOverlay } from './CameraMosaicOverlay';
import { CameraViewPanel } from '../panels/CameraViewPanel';
import { useAppStore } from '../store/useAppStore';
import { Camera } from 'lucide-react';
import { CameraNode } from '../../core/dag/CameraNode';

/**
 * FloatingWindowManager
 *
 * Renders all in-app floating windows on top of the dockable layout area.
 * Also renders a small taskbar strip for minimised windows.
 */
export const FloatingWindowManager: React.FC = () => {
  const floatingWindows = useAppStore(s => s.floatingWindows);
  const closeFloatingWindow    = useAppStore(s => s.closeFloatingWindow);
  const focusFloatingWindow    = useAppStore(s => s.focusFloatingWindow);
  const minimiseFloatingWindow = useAppStore(s => s.minimiseFloatingWindow);
  const restoreFloatingWindow  = useAppStore(s => s.restoreFloatingWindow);
  const cameraMosaicMode        = useAppStore(s => s.cameraMosaicMode);
  const toggleCameraMosaic      = useAppStore(s => s.toggleCameraMosaic);
  const selectedNodes          = useAppStore(s => s.selectedNodes);

  // Build a set of selected camera UUIDs for quick lookup
  const selectedCamUuids = new Set(
    selectedNodes.filter(n => n instanceof CameraNode).map(n => n.uuid),
  );

  const minimised = floatingWindows.filter(w => w.minimised);
  const visible   = floatingWindows.filter(w => !w.minimised);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 90 }}>
      {/* Mosaic window */}
      {cameraMosaicMode && (
        <FloatingWindow
          id="__mosaic__"
          title="Camera Mosaic"
          initialRect={{ x: 60, y: 40, w: 700, h: 500 }}
          zIndex={600}
          minimised={false}
          highlighted={false}
          onClose={() => toggleCameraMosaic()}
          onFocus={() => {}}
          onMinimise={() => toggleCameraMosaic()}
        >
          <CameraMosaicOverlay />
        </FloatingWindow>
      )}

      {/* Floating windows layer */}
      {visible.map(win => {
        const camUuid = win.payload?.cameraUuid as string | undefined;
        const isHighlighted = !!camUuid && selectedCamUuids.has(camUuid);
        return (
        <FloatingWindow
          key={win.id}
          id={win.id}
          title={win.title}
          initialRect={win.rect}
          zIndex={100 + win.zOrder}
          minimised={false}
          highlighted={isHighlighted}
          onMosaic={win.type === 'camera_view' ? toggleCameraMosaic : undefined}
          onClose={closeFloatingWindow}
          onFocus={focusFloatingWindow}
          onMinimise={minimiseFloatingWindow}
        >
          {win.type === 'camera_view' && (
            <CameraViewPanel cameraUuid={camUuid} />
          )}
        </FloatingWindow>
        );
      })}

      {/* Taskbar for minimised windows */}
      {minimised.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 28, display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 4px',
          background: 'rgba(30,30,30,0.85)',
          borderTop: '1px solid #444',
          zIndex: 99,
          pointerEvents: 'auto',
        }}>
          {minimised.map(win => (
            <button
              key={win.id}
              onClick={() => restoreFloatingWindow(win.id)}
              title={win.title}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 10px', height: 22,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 3, cursor: 'pointer',
                color: 'rgba(255,255,255,0.6)',
                fontSize: '10px',
                fontFamily: '"Segoe UI", system-ui, sans-serif',
                maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
            >
              <Camera size={10} style={{ flexShrink: 0, color: '#a0c8f0' }} />
              {win.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
