import React from 'react';
import paths from '../lib/logo-paths.json';
import { C } from '../lib/tokens';

const P = paths.logo; // vector trace of design/assets/logo.png (scripts/trace-logo.mjs), viewBox P.w x P.h
export const LOGO_ASPECT = P.w / P.h;
/** Width of the H mark as a fraction of the full logo width (measured on the trace). */
export const MARK_FRACTION = 0.1675;

/** HyperLearn wordmark. `wipe` 0→1 reveals the ink letters left to right; `mark` fades the blue H. */
export const Logo: React.FC<{ width: number; wipe?: number; mark?: number; ink?: string; blue?: string; style?: React.CSSProperties }> = ({ width, wipe = 1, mark = 1, ink = C.ink, blue = C.blue, style }) => {
  const h = width / LOGO_ASPECT;
  const id = React.useId().replace(/:/g, '');
  const startX = P.w * MARK_FRACTION;
  const feather = P.w * 0.12;
  const edge = wipe >= 1 ? P.w + feather * 2 : startX + (P.w - startX + feather) * wipe;
  return (
    <svg width={width} height={h} viewBox={`0 0 ${P.w} ${P.h}`} style={{ overflow: 'visible', ...style }}>
      <defs>
        {/* feathered wipe: letters fade in rather than being sliced, so a half-revealed glyph never reads as another letter */}
        <linearGradient id={`g${id}`} x1={0} x2={P.w} y1={0} y2={0} gradientUnits="userSpaceOnUse">
          <stop offset={Math.max(0, edge - feather) / P.w} stopColor="#fff" />
          <stop offset={Math.min(P.w, edge) / P.w} stopColor="#000" />
        </linearGradient>
        <mask id={`w${id}`} maskUnits="userSpaceOnUse" x={0} y={-50} width={P.w} height={P.h + 100}>
          <rect x={0} y={-50} width={P.w} height={P.h + 100} fill={`url(#g${id})`} />
        </mask>
      </defs>
      <path d={P.blue} fill={blue} opacity={mark} />
      <path d={P.ink} fill={ink} mask={`url(#w${id})`} />
    </svg>
  );
};

/** Only the H mark, cropped from the same trace. `size` is the rendered height. */
export const Mark: React.FC<{ size: number; color?: string; style?: React.CSSProperties }> = ({ size, color = C.blue, style }) => {
  const vw = P.w * MARK_FRACTION;
  return (
    <svg width={(size * vw) / P.h} height={size} viewBox={`0 0 ${vw} ${P.h}`} style={style}>
      <path d={P.blue} fill={color} />
    </svg>
  );
};
