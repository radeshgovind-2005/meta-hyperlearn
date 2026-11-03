import React from 'react';
import { AbsoluteFill } from 'remotion';
import { GlobeLayer, type Ring } from '../components/Globe';
import { Person } from '../components/Person';
import { Logo } from '../components/Logo';
import { loadFonts } from '../lib/fonts';
import { C, F, SIZE, type Orientation } from '../lib/tokens';

loadFonts();

/** Poster frame built from the film's own layers: the world, the people, the mark and the promise. */
export const Thumbnail: React.FC<{ o: Orientation }> = ({ o }) => {
  const { w: W, h: H } = SIZE[o];
  const h = o === 'h';
  const g = h ? { cx: 2780, cy: 1000, R: 640 } : { cx: 1080, cy: 1500, R: 600 };
  const ks = h ? [1.35, 1.62] : [1.3, 1.6];
  const rings: Ring[] = ks.map((k, i) => ({ rx: k * g.R, ry: k * g.R * 0.28, tilt: [-10, 7][i], speed: 0, phase: [0.6, 2.2][i], chips: [i * 3, i * 3 + 1, i * 3 + 2] }));
  const t = 1.2;
  const people = h
    ? [['learner-stand', 2050, 1990], ['student-go', 2640, 2080], ['worker-stand', 3200, 1990], ['teacher-stand', 3640, 2040]] as const
    : [['learner-stand', 330, 2930], ['student-go', 830, 3020], ['worker-stand', 1330, 2930], ['teacher-stand', 1830, 2990]] as const;
  const ph = h ? 760 : 820;
  return (
    <AbsoluteFill style={{ background: C.white }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <GlobeLayer layer="back" t={t} cx={g.cx} cy={g.cy} R={g.R} rings={rings} chipR={h ? 100 : 92} strokeW={5} />
        <GlobeLayer layer="globe" t={t} cx={g.cx} cy={g.cy} R={g.R} rings={rings} chipR={100} strokeW={5} />
        <GlobeLayer layer="front" t={t} cx={g.cx} cy={g.cy} R={g.R} rings={rings} chipR={h ? 100 : 92} strokeW={5} />
      </svg>
      {people.map(([k, x, y], i) => <Person key={k} k={k} x={x} y={y} h={k === 'student-go' ? ph * 1.08 : ph} t={t} phase={i} breathe={0} />)}
      <div style={{ position: 'absolute', left: h ? 260 : 0, top: h ? 560 : 300, width: h ? 1700 : W, display: 'flex', flexDirection: 'column', alignItems: h ? 'flex-start' : 'center', fontFamily: F.ui }}>
        <Logo width={h ? 1500 : 1700} />
        <div style={{ marginTop: 80, fontSize: h ? 150 : 150, lineHeight: 1.05, fontWeight: 700, color: C.ink, letterSpacing: -2, textAlign: h ? 'left' : 'center' }}>Keep learning,<br />your way.</div>
        <div style={{ marginTop: 60, fontSize: h ? 64 : 68, fontWeight: 600, color: C.body, textAlign: h ? 'left' : 'center', maxWidth: h ? 1500 : 1800, lineHeight: 1.3 }}>Your material becomes a course that adapts to you, with every sentence linked to its source.</div>
      </div>
    </AbsoluteFill>
  );
};
