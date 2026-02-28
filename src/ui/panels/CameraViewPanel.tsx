import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { CameraNode } from '../../core/dag/CameraNode';

/**
 * Camera View Panel
 *
 * Renders a pixel-accurate crop of a camera's output at the configured
 * render resolution aspect ratio. Instead of a second renderer it subscribes to
 * ViewportManager's frame-listener API: after every Three.js render the main
 * renderer canvas is drawn into this panel's canvas using drawImage().
 *
 * Props:
 *  - cameraUuid?: locks this panel to a specific CameraNode. If omitted, shows
 *    the viewport's active camera (the old default behaviour).
 *
 * The panel can live anywhere in the flexlayout and be dragged/docked freely.
 */

interface CameraViewPanelProps {
  cameraUuid?: string;
}

export const CameraViewPanel: React.FC<CameraViewPanelProps> = ({ cameraUuid }) => {
  const vm           = useAppStore(s => s.viewportManager);
  const core         = useAppStore(s => s.core);
  const sceneVersion = useAppStore(s => s.sceneVersion); void sceneVersion;

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef      = useRef(core);
  const [info, setInfo] = useState({ w: 1920, h: 1080, camName: null as string | null });

  // Keep coreRef current without re-subscribing frame listener
  useEffect(() => { coreRef.current = core; }, [core]);

  // Re-compute gate info when vm or sceneVersion changes
  useEffect(() => {
    if (!vm) return;
    const res = vm.getRenderResolution();
    // If locked to a specific camera, use that; otherwise use active cam
    const uuid = cameraUuid ?? vm.getActiveCameraUuid();
    const camName = uuid
      ? (core?.sceneGraph.getNodeById(uuid) as CameraNode | undefined)?.name ?? null
      : null;
    setInfo({ w: res.w, h: res.h, camName });
  }, [vm, core, sceneVersion, cameraUuid]);

  // Subscribe to frame events and blit into our canvas.
  // When a specific cameraUuid is set, use the per-camera frame listener
  // so the panel shows what that camera sees, not the main viewport.
  useEffect(() => {
    if (!vm) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onFrame = (src: HTMLCanvasElement) => {
      const container = containerRef.current;
      if (!container) return;
      const cpW = container.clientWidth;
      const cpH = container.clientHeight;
      if (cpW < 1 || cpH < 1) return;

      const res   = vm.getRenderResolution();
      const renderAspect = res.w / res.h;

      // Compute gate rect in src canvas space
      const srcW = src.width;
      const srcH = src.height;
      const srcAspect = srcW / srcH;

      // gate in the source canvas (same math as GateMask)
      let gateW: number, gateH: number;
      if (srcAspect > renderAspect) {
        gateH = srcH;
        gateW = gateH * renderAspect;
      } else {
        gateW = srcW;
        gateH = gateW / renderAspect;
      }
      const srcX = (srcW - gateW) / 2;
      const srcY = (srcH - gateH) / 2;

      // Fit gate in our panel canvas
      let dstW: number, dstH: number;
      const vpAspect = cpW / cpH;
      if (vpAspect > renderAspect) {
        dstH = cpH;
        dstW = dstH * renderAspect;
      } else {
        dstW = cpW;
        dstH = dstW / renderAspect;
      }
      const dstX = (cpW - dstW) / 2;
      const dstY = (cpH - dstH) / 2;

      canvas.width  = cpW;
      canvas.height = cpH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, cpW, cpH);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, cpW, cpH);

      // Crop + scale the gate region onto our canvas
      ctx.drawImage(src, srcX, srcY, gateW, gateH, dstX, dstY, dstW, dstH);

      // Frame border
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dstX + 0.5, dstY + 0.5, dstW - 1, dstH - 1);

      // Action safe 90%
      const as = 0.05;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeRect(dstX + dstW * as + 0.5, dstY + dstH * as + 0.5, dstW * 0.90 - 1, dstH * 0.90 - 1);

      // Title safe 80%
      const ts = 0.10;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeRect(dstX + dstW * ts + 0.5, dstY + dstH * ts + 0.5, dstW * 0.80 - 1, dstH * 0.80 - 1);
      ctx.setLineDash([]);

      // Label — read from vm every frame to stay current
      const liveRes    = vm.getRenderResolution();
      const liveUuid   = cameraUuid ?? vm.getActiveCameraUuid();
      const liveCamName = liveUuid
        ? (coreRef.current?.sceneGraph.getNodeById(liveUuid) as CameraNode | undefined)?.name ?? null
        : null;
      const label = liveCamName
        ? `${liveCamName}  ${liveRes.w}×${liveRes.h}`
        : `${liveRes.w}×${liveRes.h}`;
      ctx.font = '9px Consolas, Menlo, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.40)';
      ctx.fillText(label, dstX + 6, dstY + 14);
    };

    // If locked to a specific camera, subscribe to per-camera renders;
    // otherwise fall back to the general frame listener (main viewport).
    if (cameraUuid) {
      vm.addCameraFrameListener(cameraUuid, onFrame);
      return () => vm.removeCameraFrameListener(cameraUuid, onFrame);
    } else {
      vm.addFrameListener(onFrame);
      return () => vm.removeFrameListener(onFrame);
    }
  }, [vm, cameraUuid]);

  if (!vm) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#111', color: 'rgba(255,255,255,0.25)',
        fontSize: '12px', fontFamily: '"Segoe UI",system-ui,sans-serif',
      }}>
        No active viewport
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#111', position: 'relative', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {/* Header overlay */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '3px 8px',
        background: 'rgba(0,0,0,0.55)',
        fontSize: '10px',
        fontFamily: '"Segoe UI",system-ui,sans-serif',
        color: 'rgba(255,255,255,0.5)',
        display: 'flex', alignItems: 'center', gap: 8,
        userSelect: 'none',
        zIndex: 1,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.75)' }}>Camera View</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{info.camName ?? 'Perspective'}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ fontFamily: '"Consolas","Menlo",monospace', fontSize: '9px' }}>
          {info.w}×{info.h}
        </span>
      </div>
    </div>
  );
};
