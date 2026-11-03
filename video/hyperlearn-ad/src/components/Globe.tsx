import React, { useMemo } from 'react';
import { geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import land110 from 'world-atlas/land-110m.json';
import {
  BookOpen, TabletSmartphone, Headphones, Calculator, Laptop, Cpu, Mail, MessageSquare, Video,
  Map as MapIcon, Compass, Navigation, Wrench, Cog, Code, Newspaper, Rss, Lightbulb, type LucideIcon,
} from 'lucide-react';
import { C } from '../lib/tokens';

// Natural Earth land (public domain) via world-atlas, real orthographic rotation per frame.
const LAND = feature(land110 as unknown as Topology, (land110 as any).objects.land);
const GRAT = geoGraticule10();

/** Symbols that change each time they pass behind the globe: older tool → newer tool → newer still. */
const CHIP_SETS: LucideIcon[][] = [
  [BookOpen, TabletSmartphone, Headphones],
  [Calculator, Laptop, Cpu],
  [Mail, MessageSquare, Video],
  [MapIcon, Compass, Navigation],
  [Wrench, Cog, Code],
  [Newspaper, Rss, Lightbulb],
];

export type Ring = { rx: number; ry: number; tilt: number; speed: number; phase: number; chips: number[] };

export function ringPoint(r: Ring, theta: number, cx: number, cy: number) {
  const x = Math.cos(theta) * r.rx, y = Math.sin(theta) * r.ry;
  const a = (r.tilt * Math.PI) / 180;
  return { x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a), front: Math.sin(theta) > 0 };
}

function ringArc(r: Ring, cx: number, cy: number, from: number, to: number) {
  const n = 64; let d = '';
  for (let i = 0; i <= n; i++) { const p = ringPoint(r, from + ((to - from) * i) / n, cx, cy); d += `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }
  return d;
}

/**
 * Globe + orbit rings. Rendered in three layers so people can stand between them:
 * layer "back" = back half of rings + hidden chips, "globe", "front" = front half of rings + chips.
 */
export const GlobeLayer: React.FC<{
  layer: 'back' | 'globe' | 'front'; t: number; cx: number; cy: number; R: number; rings: Ring[];
  spin?: number; opacity?: number; chipR: number; ringFlatten?: number; strokeW: number;
}> = ({ layer, t, cx, cy, R, rings, spin = 18, opacity = 1, chipR, ringFlatten = 0, strokeW }) => {
  const proj = useMemo(() => geoOrthographic(), []);
  if (layer === 'globe') {
    proj.translate([cx, cy]).scale(R).clipAngle(90).rotate([-40 + t * spin, -18, 0]);
    const path = geoPath(proj);
    return (
      <g opacity={opacity}>
        <circle cx={cx} cy={cy} r={R} fill={C.blue} />
        <path d={path(GRAT) ?? ''} fill="none" stroke="#FFFFFF" strokeOpacity={0.16} strokeWidth={strokeW * 0.6} />
        <path d={path(LAND as any) ?? ''} fill="#FFFFFF" fillOpacity={0.94} />
      </g>
    );
  }
  const front = layer === 'front';
  return (
    <g opacity={opacity}>
      {rings.map((r0, i) => {
        const r = { ...r0, ry: r0.ry * (1 - ringFlatten) };
        return (
          <g key={i}>
            <path d={ringArc(r, cx, cy, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2)} fill="none" stroke={C.ink} strokeOpacity={front ? 0.55 : 0.22} strokeWidth={strokeW} />
            {r.chips.map((c, j) => {
              const theta = r.phase + (j * Math.PI * 2) / r.chips.length + t * r.speed;
              const p = ringPoint(r, theta, cx, cy);
              if (p.front !== front) return null;
              const gen = Math.max(0, Math.floor((theta - Math.PI * 1.5) / (Math.PI * 2)) + 1); // advances at the back centre, hidden by the globe
              const set = CHIP_SETS[c % CHIP_SETS.length];
              const Icon = set[Math.min(gen, set.length - 1)];
              const depth = Math.sin(theta); // -1 back … 1 front
              const sc = 0.82 + 0.18 * depth;
              const cr = chipR * sc;
              return (
                <g key={j} opacity={front ? 1 : 0.55}>
                  <circle cx={p.x} cy={p.y} r={cr} fill="#FFFFFF" stroke={C.border} strokeWidth={strokeW} />
                  <Icon x={p.x - cr * 0.52} y={p.y - cr * 0.52} width={cr * 1.04} height={cr * 1.04} color={gen === 0 ? C.ink : C.blue} strokeWidth={1.75} absoluteStrokeWidth={false} />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
};
