import React from 'react';
import { AbsoluteFill } from 'remotion';
import { GlobeLayer, type Ring } from '../components/Globe';
import { Person, type PersonKey } from '../components/Person';
import { Logo, LOGO_ASPECT } from '../components/Logo';
import { easeIn, easeOut, keys, lerp, line, prog, sceneTimes } from '../lib/anim';
import { C, SIZE, type Orientation } from '../lib/tokens';

// 0–10 s: the changing world → different routes → a missing connection → the HyperLearn bridge.
type Route = { base: number; amp: number; wave: number; kind: 'curve' | 'steps' | 'wave' };

const CFG = {
  h: {
    globe: { cx: 1920, cy: 900, R: 560 }, ringK: [1.42, 1.7, 1.98], ryK: 0.27, chipR: 92, stroke: 5,
    stand: { y: 1900, h: 780, xs: [600, 1230, 2610, 3240] },
    routes: [ { base: 1060, amp: 70, wave: 2600, kind: 'curve' }, { base: 1440, amp: 80, wave: 760, kind: 'steps' }, { base: 1840, amp: 45, wave: 1500, kind: 'wave' } ] as Route[],
    walkH: 520, gapX: 2500, gapW: 400, focus: 0.40, logoW: 2300,
  },
  v: {
    globe: { cx: 1080, cy: 1300, R: 540 }, ringK: [1.28, 1.52, 1.78], ryK: 0.3, chipR: 86, stroke: 5,
    stand: { y: 3060, h: 980, xs: [330, 830, 1330, 1830] },
    routes: [ { base: 1500, amp: 70, wave: 2000, kind: 'curve' }, { base: 2260, amp: 80, wave: 620, kind: 'steps' }, { base: 3000, amp: 45, wave: 1300, kind: 'wave' } ] as Route[],
    walkH: 600, gapX: 1650, gapW: 380, focus: 0.36, logoW: 1600,
  },
};

const smooth = (x: number) => x * x * (3 - 2 * x);
function routeY(r: Route, x: number) {
  if (r.kind === 'curve') return r.base - r.amp * Math.sin((x / r.wave) * Math.PI * 2);
  if (r.kind === 'wave') return r.base - r.amp * Math.sin((x / r.wave) * Math.PI * 2 + 1);
  const n = Math.floor(x / r.wave), f = x / r.wave - n;
  return r.base - r.amp * (n + smooth(Math.min(1, Math.max(0, (f - 0.6) / 0.4)))) + r.amp * 2;
}

// who walks where: [person, route index, start world x, speed px/s, walk phase]
const WALKERS: [string, number, number, number, number][] = [
  ['learner', 0, 0.22, 880, 0.3],
  ['student', 1, 0.18, 0, 0],
  ['worker', 2, 0.10, 820, 0.7],
  ['teacher', 2, 0.34, 760, 0.15],
];
const STAND_ORDER = ['learner', 'student', 'worker', 'teacher']; // left → right in the opening line-up

export const Opening: React.FC<{ t: number; o: Orientation }> = ({ t, o }) => {
  const L = CFG[o], { w: W, h: H } = SIZE[o];
  const T = sceneTimes();
  const pStart = T.paths[0], rStart = T.reveal[0], v3 = line('v3'), v4 = line('v4');
  const { cx, R } = L.globe;
  const rings: Ring[] = L.ringK.map((k, i) => {
    const speed = [0.9, 0.75, 0.62][i], swapAt = [0.9, 1.7, 0.5][i];
    return { rx: k * R, ry: k * R * L.ryK, tilt: [-10, 7, -3][i], speed, phase: Math.PI * 1.5 - speed * swapAt, chips: [i * 3, i * 3 + 1, i * 3 + 2] };
  });

  // --- world → paths transition
  const lift = prog(t, pStart - 0.2, pStart + 0.9, easeIn);          // globe rises out
  const flat = prog(t, pStart - 0.1, pStart + 0.5);                   // rings flatten
  const drop = prog(t, pStart + 0.25, pStart + 1.05, easeOut);        // lines fall to their routes and gain shape
  const cy = L.globe.cy - lift * (L.globe.cy + R * 1.3);
  const intro = prog(t, 0, 0.9, easeOut);

  // camera truck (world → screen x) during paths
  const gx = L.gapX, stopX = gx - 40;
  const studentStart = W * WALKERS[1][2];
  const studentArrive = v3.start - 0.25;
  const studentX = t < pStart + 0.4 ? studentStart : lerp(studentStart, stopX, prog(t, pStart + 0.4, studentArrive, (x) => x));
  const camTarget = stopX - W * L.focus;
  const cam = keys(t, [[pStart + 0.3, 0], [studentArrive, camTarget * 0.92], [v4.start, camTarget]], (x) => x * (2 - x));

  // --- reveal
  const bridge = prog(t, rStart, rStart + 0.45, easeOut);
  const goPose = t >= rStart + 0.25;
  const stepOn = prog(t, rStart + 0.3, rStart + 1.2, easeOut);
  const toLogo = prog(t, v4.start + 0.05, v4.start + 0.6, easeOut);
  const sceneFade = 1 - prog(t, v4.start - 0.05, v4.start + 0.35);
  const wipe = prog(t, v4.start + 0.35, v4.start + 0.95, easeOut);
  const logoOut = prog(t, T.reveal[1] - 0.45, T.reveal[1] - 0.22, easeIn);
  const altPaths = prog(t, v3.start + 0.1, v3.start + 0.9, easeOut) * sceneFade;
  const gapPulse = t > v3.start ? 0.5 + 0.5 * Math.sin((t - v3.start) * 7) : 0;

  const sx = (x: number) => x - cam;
  const r1 = L.routes[1];
  const ga = { x: sx(gx), y: routeY(r1, gx) }, gb = { x: sx(gx + L.gapW), y: routeY(r1, gx + L.gapW) };
  const bridgePath = `M${ga.x},${ga.y} C${ga.x + L.gapW * 0.35},${ga.y - 10} ${gb.x - L.gapW * 0.45},${gb.y + 30} ${gb.x},${gb.y}`;
  const node = { x: lerp(ga.x, gb.x, 0.62), y: lerp(ga.y, gb.y, 0.62) - 6 };

  const people = WALKERS.map(([who, ri, sx0, speed, ph], idx) => {
    const standX = L.stand.xs[STAND_ORDER.indexOf(who)] - t * 14 * (idx % 2 ? 1 : 0.6);
    const r = L.routes[ri];
    const wx0 = W * sx0;
    const wx = who === 'student' ? studentX + stepOn * (L.gapW * 0.55) : wx0 + Math.max(0, t - pStart - 0.4) * speed;
    const walkX = sx(wx), walkY = routeY(r, wx);
    const k = prog(t, pStart + 0.15, pStart + 1.0, easeOut);
    const x = lerp(standX, walkX, k), y = lerp(L.stand.y, walkY, k);
    const h = lerp(L.stand.h, L.walkH, k);
    let pose: PersonKey = `${who}-walk` as PersonKey;
    if (who === 'student' && t >= studentArrive) pose = 'student-pause';
    if (who === 'student' && goPose) pose = 'student-go';
    const walking = who === 'student' ? (t < studentArrive ? 1 : stepOn > 0 && stepOn < 1 ? 1 : 0) : 1;
    const enter = prog(t, 0.15 + idx * 0.12, 0.85 + idx * 0.12, easeOut);
    return { who, x, y: y + (1 - enter) * 60, h, pose, walking: walking * k, k, enter, ph, depth: walkY };
  });

  const renderPeople = (filter: (p: (typeof people)[number]) => boolean) =>
    people.filter(filter).sort((a, b) => a.depth - b.depth).map((p) => (
      <React.Fragment key={p.who}>
        {p.k < 1 && <Person k={`${p.who}-stand` as PersonKey} x={p.x} y={p.y} h={p.h} t={t} phase={p.ph} opacity={p.enter * (1 - p.k)} />}
        {p.k > 0 && <Person k={p.pose} x={p.x} y={p.y} h={p.h} t={t} walk={p.walking} phase={p.ph} opacity={p.enter * Math.min(1, p.k * 1.6)} />}
      </React.Fragment>
    ));

  const routePath = (r: Route, ri: number) => {
    // a flattened orbit (through the globe centre, tilted) that falls to the route and gains its shape
    const tilt = ([-10, 7, -3][ri] * Math.PI) / 180;
    let d = '';
    for (let x = -100; x <= W + 100; x += 24) {
      const ringY = L.globe.cy + (x - cx) * Math.tan(tilt) * (1 - drop);
      const wx = x + cam;
      const y = lerp(ringY, routeY(r, wx), drop);
      d += `${d ? 'L' : 'M'}${x},${y.toFixed(1)}`;
    }
    return d;
  };
  const lineReveal = prog(t, pStart, pStart + 0.5);
  const extent = lerp(rings[2].rx, W, prog(t, pStart, pStart + 0.9, easeOut));
  const dash = (gx0: number) => ({ x: sx(gx0), w: L.gapW });

  return (
    <AbsoluteFill style={{ background: C.white }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <clipPath id="extent"><rect x={cx - extent} y={0} width={extent * 2} height={H} /></clipPath>
          <clipPath id="gapcut">
            <rect x={-200} y={0} width={dash(gx).x + 200} height={H} />
            <rect x={dash(gx).x + L.gapW} y={0} width={W + 400} height={H} />
          </clipPath>
        </defs>
        <g transform={`translate(${-t * 10},0)`} opacity={sceneFade}>
          <g opacity={(1 - flat) * intro}>
            <GlobeLayer layer="back" t={t} cx={cx} cy={cy} R={R} rings={rings} chipR={L.chipR} strokeW={L.stroke} ringFlatten={flat} />
          </g>
          <g transform={`translate(${cx},${cy}) scale(${lerp(0.92, 1, intro)}) translate(${-cx},${-cy})`} opacity={intro}>
            <GlobeLayer layer="globe" t={t} cx={cx} cy={cy} R={R} rings={rings} chipR={L.chipR} strokeW={L.stroke} />
          </g>
          <g opacity={(1 - flat) * intro}>
            <GlobeLayer layer="front" t={t} cx={cx} cy={cy} R={R} rings={rings} chipR={L.chipR} strokeW={L.stroke} ringFlatten={flat} />
          </g>
        </g>
        {/* routes: the orbits, unrolled */}
        <g opacity={lineReveal * sceneFade} clipPath="url(#extent)">
          {L.routes.map((r, ri) => (
            <path key={ri} d={routePath(r, ri)} fill="none" stroke={C.ink} strokeOpacity={0.8} strokeWidth={L.stroke * 1.8} strokeLinecap="round" clipPath={ri === 1 ? 'url(#gapcut)' : undefined} />
          ))}
          {/* milestone dots on every route */}
          {L.routes.map((r, ri) => Array.from({ length: 14 }, (_, i) => {
            const wx = 260 + i * 520 + ri * 170; const x = sx(wx);
            if (ri === 1 && wx > gx - 30 && wx < gx + L.gapW + 30) return null;
            if (x < -60 || x > W + 60) return null;
            return <circle key={`${ri}-${i}`} cx={x} cy={lerp(L.globe.cy, routeY(r, wx), drop)} r={L.stroke * 3.2} fill={C.white} stroke={C.ink} strokeOpacity={0.55} strokeWidth={L.stroke * 1.3} opacity={drop} />;
          }))}
        </g>
        {/* the missing connection */}
        <g opacity={drop * sceneFade}>
          <path d={`M${ga.x},${ga.y} L${gb.x},${gb.y}`} stroke={C.muted} strokeOpacity={0.45} strokeWidth={L.stroke * 1.2} strokeDasharray={`${L.stroke * 4} ${L.stroke * 5}`} />
          {[ga, gb].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={L.stroke * (3.4 + gapPulse * 1.4)} fill={C.white} stroke={C.ink} strokeWidth={L.stroke * 1.3} />)}
          {/* other ways forward appear from the gap */}
          {[-1, 1].map((dir) => {
            const ty = routeY(L.routes[1 + dir], gx + L.gapW * 1.6);
            return <path key={dir} d={`M${ga.x},${ga.y} C${ga.x + L.gapW * 0.6},${ga.y} ${ga.x + L.gapW * 0.9},${ty} ${ga.x + L.gapW * 1.6},${ty}`} fill="none" stroke={C.blue} strokeOpacity={0.5 * altPaths} strokeWidth={L.stroke} strokeDasharray={`${L.stroke * 2} ${L.stroke * 4}`} pathLength={1} strokeDashoffset={0} />;
          })}
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, opacity: sceneFade }}>{renderPeople(() => true)}</div>
      {/* the bridge: a path with a node — the HyperLearn mark in the making */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: 1 - toLogo }}>
        <path d={bridgePath} fill="none" stroke={C.blue} strokeWidth={L.stroke * 2.6} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - bridge} />
        <circle cx={node.x} cy={node.y} r={L.stroke * 6 * prog(t, rStart + 0.3, rStart + 0.55, easeOut)} fill={C.blue} />
      </svg>
      {toLogo > 0 && (() => {
        const lw = L.logoW, lh = lw / LOGO_ASPECT;
        const fx = (W - lw) / 2, fy = (o === 'h' ? H * 0.46 : H * 0.44) - lh / 2;
        const k = toLogo;
        // the mark grows out of the node position, then the wordmark wipes in
        const sc = lerp(0.25, 1, k), ox = lerp(node.x - lw * 0.07 * 0.25, fx, k), oy = lerp(node.y - lh * 0.45 * 0.25, fy, k);
        return (
          <div style={{ position: 'absolute', left: ox, top: oy, transformOrigin: '0 0', transform: `scale(${sc}) translateY(${-logoOut * 120}px)`, opacity: Math.min(1, k * 2) * (1 - logoOut) }}>
            <Logo width={lw} wipe={wipe} />
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};
