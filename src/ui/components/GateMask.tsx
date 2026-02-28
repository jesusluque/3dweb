import React, { useEffect, useState } from 'react';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Render resolution (pixel w × h) — drives the gate aspect ratio */
  renderWidth: number;
  renderHeight: number;
  /** Name of the active CameraNode (shown as label) */
  activeCamName?: string | null;
  /** Show action-safe / title-safe guides inside gate */
  showSafeAreas?: boolean;
}

/**
 * Render Gate Mask
 * Draws opaque bars to represent the exact render-resolution crop,
 * plus optional action-safe (90 %) / title-safe (80 %) guide overlays.
 */
export const GateMask: React.FC<Props> = ({
  containerRef,
  renderWidth,
  renderHeight,
  activeCamName,
  showSafeAreas = true,
}) => {
  const [vpSize, setVpSize] = useState({ w: 1, h: 1 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setVpSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setVpSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const renderAspect = renderWidth  / renderHeight;
  const vpAspect     = vpSize.w / vpSize.h;

  // Compute gate rect inside viewport
  let gateW: number, gateH: number;
  if (vpAspect > renderAspect) {
    gateH = vpSize.h;
    gateW = gateH * renderAspect;
  } else {
    gateW = vpSize.w;
    gateH = gateW / renderAspect;
  }
  const barX = (vpSize.w - gateW) / 2;
  const barY = (vpSize.h - gateH) / 2;
  const label = activeCamName
    ? `${activeCamName}  ${renderWidth}×${renderHeight}`
    : `${renderWidth}×${renderHeight}`;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, overflow: 'hidden' }}>
      {/* Bars */}
      {barX > 0.5 ? (
        <>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0,
                        width: barX, background: 'rgba(0,0,0,0.82)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0,
                        width: barX, background: 'rgba(0,0,0,0.82)' }} />
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0,
                        height: barY, background: 'rgba(0,0,0,0.82)' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                        height: barY, background: 'rgba(0,0,0,0.82)' }} />
        </>
      )}
      {/* Gate border */}
      <div style={{
        position: 'absolute', left: barX, top: barY, width: gateW, height: gateH,
        boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.38)',
      }} />
      {/* Action-safe 90% */}
      {showSafeAreas && <div style={{
        position: 'absolute',
        left: barX + gateW * 0.05, top: barY + gateH * 0.05,
        width: gateW * 0.90, height: gateH * 0.90,
        boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.20)',
      }} />}
      {/* Title-safe 80% */}
      {showSafeAreas && <div style={{
        position: 'absolute',
        left: barX + gateW * 0.10, top: barY + gateH * 0.10,
        width: gateW * 0.80, height: gateH * 0.80,
        boxSizing: 'border-box', border: '1px dashed rgba(255,255,255,0.13)',
      }} />}
      {/* Resolution / camera label */}
      <div style={{
        position: 'absolute', left: barX + 6, top: barY + 4,
        fontSize: '9px', fontFamily: '"Consolas","Menlo",monospace',
        color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em', userSelect: 'none',
      }}>
        {label}
      </div>
    </div>
  );
};
