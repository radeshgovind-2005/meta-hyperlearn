// HyperLearn design tokens (AGENTS.md "Design") shared by every scene.
export const C = {
  blue: '#0A5CFF',
  blueHover: '#0047CC',
  blueTint: '#E7EFFF',
  ink: '#1C2B33',
  body: '#3E4C59',
  muted: '#5B6B7A',
  border: '#E3E6EA',
  input: '#D4D9DE',
  sidebar: '#F6F7F9',
  selected: '#E9ECF0',
  success: '#0A7A3D',
  successTint: '#E6F4EC',
  warning: '#A14D00',
  highlight: '#FFF3BF',
  white: '#FFFFFF',
};

export const F = {
  ui: 'Figtree, "Helvetica Neue", Arial, sans-serif',
  serif: '"Source Serif 4", Georgia, serif',
};

export const FPS = 30;
export const DURATION_S = 30;
export const DURATION = FPS * DURATION_S;

export type Orientation = 'h' | 'v';
export const SIZE = { h: { w: 3840, h: 2160 }, v: { w: 2160, h: 3840 } } as const;
