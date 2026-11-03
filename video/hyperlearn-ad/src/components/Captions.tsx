import React from 'react';
import { CUES, prog } from '../lib/anim';
import { C, F, SIZE, type Orientation } from '../lib/tokens';

/** Burned-in captions from the measured narration (same source as the SRT). */
export const Captions: React.FC<{ t: number; o: Orientation }> = ({ t, o }) => {
  // The last line is set on the end card itself, so it is not burned in twice (the SRT still carries it).
  const l = CUES.find((x, i) => x.line !== 'v9' && t >= x.start - 0.05 && t < (CUES[i + 1] && CUES[i + 1].start - x.end < 0.3 ? CUES[i + 1].start - 0.05 : x.end + 0.25));
  if (!l) return null;
  const { w: W } = SIZE[o];
  const a = prog(t, l.start - 0.05, l.start + 0.12) * (1 - prog(t, l.end + 0.1, l.end + 0.25));
  const fs = o === 'h' ? 76 : 84;
  return (
    <div style={{ position: 'absolute', left: 0, width: W, bottom: o === 'h' ? 80 : 440, display: 'flex', justifyContent: 'center', opacity: a }}>
      <div style={{
        maxWidth: o === 'h' ? 3000 : 1880, padding: `${fs * 0.28}px ${fs * 0.6}px`, borderRadius: fs * 0.4, background: 'rgba(28,43,51,0.88)',
        color: C.white, fontFamily: F.ui, fontWeight: 600, fontSize: fs, lineHeight: 1.25, textAlign: 'center', letterSpacing: 0.2, textWrap: 'balance',
      }}>{l.text}</div>
    </div>
  );
};
