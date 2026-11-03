import React from 'react';
import { OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { C, F, FPS } from '../lib/tokens';

// Pre-scaled genuine captures (scripts/04-footage.sh): 3534 x 2565 px = capture x 300..2160 at 1.9x.
export const CAP = { w: 3534, h: 2565, k: 1.9, x0: 300 };
/** Capture-pixel coordinates (2160x1350 screencast) → pre-scaled footage pixels. */
export const cap = (x: number, y: number) => ({ x: (x - CAP.x0) * CAP.k, y: y * CAP.k });

/**
 * A window onto one pre-scaled clip. The clip is only translated (never rescaled) so the single
 * Lanczos upscale is the only resample. `view` is the top-left of the window in footage pixels.
 */
export const Footage: React.FC<{
  clip: string; from: number; rate?: number; view: { x: number; y: number }; w: number; h: number;
  radius?: number; style?: React.CSSProperties; children?: React.ReactNode;
}> = ({ clip, from, rate = 1, view, w, h, radius = 28, style, children }) => {
  return (
    <div style={{ position: 'absolute', width: w, height: h, overflow: 'hidden', borderRadius: radius, background: C.white, border: `3px solid ${C.border}`, boxSizing: 'border-box', ...style }}>
      <div style={{ position: 'absolute', left: -Math.round(view.x), top: -Math.round(view.y), width: CAP.w, height: CAP.h }}>
        <OffthreadVideo src={staticFile(`captures/${clip}.mp4`)} startFrom={Math.max(0, Math.round(from * FPS))} playbackRate={rate} muted style={{ width: CAP.w, height: CAP.h, display: 'block' }} />
        {children}
      </div>
    </div>
  );
};

/** Small honest label on edited footage ("2× speed", "2 min later", "Real app"). */
export const Tag: React.FC<{ children: React.ReactNode; scale: number; tone?: 'dark' | 'light'; style?: React.CSSProperties }> = ({ children, scale, tone = 'dark', style }) => (
  <div style={{
    position: 'absolute', padding: `${10 * scale}px ${22 * scale}px`, borderRadius: 999, fontFamily: F.ui, fontWeight: 600,
    fontSize: 30 * scale, letterSpacing: 0.2 * scale, whiteSpace: 'nowrap',
    background: tone === 'dark' ? C.ink : C.white, color: tone === 'dark' ? C.white : C.ink,
    border: tone === 'dark' ? 'none' : `${2 * scale}px solid ${C.border}`, ...style,
  }}>{children}</div>
);

export const useT = () => useCurrentFrame() / FPS;
