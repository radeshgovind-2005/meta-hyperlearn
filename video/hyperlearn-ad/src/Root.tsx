import React from 'react';
import { Composition, Still } from 'remotion';
import { Film } from './Film';
import { Thumbnail } from './scenes/Thumbnail';
import { DURATION, FPS, SIZE } from './lib/tokens';

export const Root: React.FC = () => (
  <>
    <Composition id="Horizontal" component={Film} durationInFrames={DURATION} fps={FPS} width={SIZE.h.w} height={SIZE.h.h} defaultProps={{ o: 'h' as const, captions: true }} />
    <Composition id="HorizontalClean" component={Film} durationInFrames={DURATION} fps={FPS} width={SIZE.h.w} height={SIZE.h.h} defaultProps={{ o: 'h' as const, captions: false }} />
    <Composition id="Vertical" component={Film} durationInFrames={DURATION} fps={FPS} width={SIZE.v.w} height={SIZE.v.h} defaultProps={{ o: 'v' as const, captions: true }} />
    <Composition id="VerticalClean" component={Film} durationInFrames={DURATION} fps={FPS} width={SIZE.v.w} height={SIZE.v.h} defaultProps={{ o: 'v' as const, captions: false }} />
    <Still id="ThumbH" component={Thumbnail} width={SIZE.h.w} height={SIZE.h.h} defaultProps={{ o: 'h' as const }} />
    <Still id="ThumbV" component={Thumbnail} width={SIZE.v.w} height={SIZE.v.h} defaultProps={{ o: 'v' as const }} />
  </>
);
