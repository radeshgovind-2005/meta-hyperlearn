import { Easing, interpolate } from 'remotion';
import { FPS } from './tokens';
import narration from './narration.json';

export const s = (sec: number) => Math.round(sec * FPS);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.7, 0, 0.84, 0);

/** 0→1 between two times in seconds (clamped, eased). */
export function prog(t: number, a: number, b: number, ease: (x: number) => number = easeInOut) {
  return interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
}
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Keyframed value: [[t, v], ...] with easing between keys. */
export function keys(t: number, k: [number, number][], ease: (x: number) => number = easeInOut) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) return lerp(k[i - 1][1], k[i][1], ease((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  return k[k.length - 1][1];
}

/** Deterministic PRNG (mulberry32) for any seeded variation. */
export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Line = { id: string; text: string; start: number; end: number; dur: number };
export const LINES: Line[] = narration.lines;
export type Cue = { line: string; text: string; start: number; end: number };
export const CUES: Cue[] = narration.cues;
export const line = (id: string) => LINES.find((l) => l.id === id)!;

/** Scene boundaries (seconds), anchored on the narration so a new voice take re-times the film. */
export function sceneTimes() {
  const L = (id: string) => line(id);
  return {
    world: [0, L('v2').start - 0.1],
    paths: [L('v2').start - 0.1, L('v4').start - 0.45],
    reveal: [L('v4').start - 0.45, L('v5').start - 0.2],
    app: [L('v5').start - 0.2, L('v6').start + 0.7],
    agents: [L('v6').start + 0.7, L('v8').start - 0.05],
    share: [L('v8').start - 0.05, L('v9').start - 0.35],
    end: [L('v9').start - 0.35, 30],
  } as const;
}
