import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Opening } from './scenes/Opening';
import { AppStory } from './scenes/AppStory';
import { EndCard } from './scenes/EndCard';
import { Captions } from './components/Captions';
import { loadFonts } from './lib/fonts';
import { sceneTimes } from './lib/anim';
import { C, FPS, type Orientation } from './lib/tokens';

loadFonts();

/** The whole film. Scenes overlap by a few frames and handle their own entrances/exits. */
export const Film: React.FC<{ o: Orientation; captions: boolean }> = ({ o, captions }) => {
  const t = useCurrentFrame() / FPS;
  const T = sceneTimes();
  return (
    <AbsoluteFill style={{ background: C.white }}>
      {t < T.reveal[1] + 0.15 && <Opening t={t} o={o} />}
      {t >= T.reveal[1] - 0.6 && t < T.end[0] + 0.7 && <AppStory t={t} o={o} />}
      {t >= T.end[0] - 0.1 && <EndCard t={t} o={o} />}
      {captions && <Captions t={t} o={o} />}
    </AbsoluteFill>
  );
};
