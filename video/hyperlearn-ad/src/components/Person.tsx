import React from 'react';
import { Img, staticFile } from 'remotion';

// Muse Image character cut-outs (public/cut, keyed by scripts/03-cutout.py). Natural sizes for aspect math.
export const PEOPLE = {
  'student-stand': [396, 949], 'worker-stand': [346, 1011], 'teacher-stand': [359, 975], 'learner-stand': [331, 996],
  'student-walk': [801, 1590], 'student-pause': [677, 1698], 'student-go': [751, 1535],
  'worker-walk': [801, 1680], 'teacher-walk': [731, 1670], 'learner-walk': [843, 1596],
} as const;
export type PersonKey = keyof typeof PEOPLE;

/** A character anchored at its feet (x, y). `walk` (seconds) adds a gentle step bob; `breathe` a tiny idle. */
export const Person: React.FC<{ k: PersonKey; x: number; y: number; h: number; t: number; walk?: number; breathe?: number; opacity?: number; phase?: number }> = ({ k, x, y, h, t, walk = 0, breathe = 1, opacity = 1, phase = 0 }) => {
  const [nw, nh] = PEOPLE[k];
  // Standing cut-outs are cropped tighter than poses; normalise so heads line up across poses.
  const hh = k.endsWith('stand') ? h * 0.93 : h;
  const w = (hh * nw) / nh;
  const step = walk ? Math.abs(Math.sin((t + phase) * Math.PI * 1.9)) * h * 0.012 * walk : 0;
  const sway = walk ? Math.sin((t + phase) * Math.PI * 1.9) * 0.8 * walk : 0;
  const idle = breathe ? 1 + Math.sin((t + phase) * 2.1) * 0.0035 * breathe : 1;
  return (
    <Img
      src={staticFile(`cut/${k}.png`)}
      style={{
        position: 'absolute', left: x - w / 2, top: y - hh, width: w, height: hh, opacity,
        transformOrigin: '50% 100%', transform: `translateY(${-step}px) rotate(${sway}deg) scaleY(${idle})`,
      }}
    />
  );
};
