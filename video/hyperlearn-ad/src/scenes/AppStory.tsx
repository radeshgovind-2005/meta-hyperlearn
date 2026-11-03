import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Footage, Tag } from '../components/Footage';
import { Person } from '../components/Person';
import { AgentGraph } from './AgentGraph';
import { easeIn, easeOut, keys, lerp, line, prog, s, sceneTimes } from '../lib/anim';
import { C, F, SIZE, type Orientation } from '../lib/tokens';

// 10–26.5 s: genuine app footage in one card that becomes the agent graph and then a shared path.
// Every clip is a real production capture (see README "Footage"); speed changes are labelled on screen.

type View = { x: number; y: number };
type Beat = { id: string; clip: string; from: number; rate: number; start: number; end: number; label: string; view: Record<Orientation, (lt: number) => View>; pre?: number; post?: number };

const CARD = { h: { x: 270, y: 140, w: 3300, h: 1700 }, v: { x: 80, y: 380, w: 2000, h: 2500 } };
const fixed = (v: View) => () => v;

export function beats(): Beat[] {
  const v5 = line('v5'), v6 = line('v6'), v7 = line('v7'), v8 = line('v8');
  const T = sceneTimes();
  const cite = v5.start + 0.2, request = v5.end + 0.05, graph = v6.start + 0.9, result = v7.start + 1.45, answer = v8.start - 0.05;
  const adapted = answer + 1.15, share = adapted + 1.45, branch = v8.end - 0.6;
  return [
    { id: 'outline', clip: 'outline', from: 0.1, rate: 1, start: T.reveal[1] - 0.28, end: cite, label: 'Course built from your uploads',
      view: { h: fixed({ x: 0, y: 70 }), v: fixed({ x: 100, y: 0 }) } },
    { id: 'cite', clip: 'cite', from: 1.15, rate: 1, start: cite, end: request, label: 'Click a citation',
      view: { h: (lt) => ({ x: 150, y: keys(lt, [[0, 300], [1.4, 190]]) }), v: (lt) => ({ x: keys(lt, [[0.55, 260], [1.25, 1530]]), y: 30 }) } },
    { id: 'request', clip: 'request', from: 2.2, rate: 3, start: request, end: graph, label: 'Ask for a change · 3× speed',
      view: { h: fixed({ x: 120, y: 760 }), v: fixed({ x: 330, y: 40 }) }, post: 0.5 },
    { id: 'result1', clip: 'result', from: 1.0, rate: 1, start: result, end: result + 0.95, label: 'Changed in place',
      view: { h: fixed({ x: 100, y: 250 }), v: fixed({ x: 330, y: 30 }) }, pre: 0.5 },
    { id: 'result2', clip: 'result', from: 8.6, rate: 1.3, start: result + 0.95, end: answer, label: 'Interactive example · 1.3× speed',
      view: { h: fixed({ x: 100, y: 845 }), v: fixed({ x: 330, y: 65 }) } },
    { id: 'answer', clip: 'answer', from: 0.85, rate: 1.5, start: answer, end: adapted, label: 'Practice in the exam’s style · 1.5× speed',
      view: { h: fixed({ x: 0, y: 260 }), v: fixed({ x: 40, y: 30 }) } },
    { id: 'adapted', clip: 'adapted', from: 1.5, rate: 1, start: adapted, end: share, label: 'About 2 minutes later: path re-planned',
      view: { h: fixed({ x: 0, y: 420 }), v: fixed({ x: 40, y: 30 }) } },
    { id: 'share', clip: 'share', from: 1.6, rate: 1.8, start: share, end: branch, label: 'Share: follow or copy · 1.8× speed',
      view: { h: fixed({ x: 110, y: 60 }), v: fixed({ x: 450, y: 0 }) }, post: 0.45 },
  ];
}

export function storyTimes() {
  const b = beats();
  const g = b.find((x) => x.id === 'request')!.end, r = b.find((x) => x.id === 'result1')!.start, br = b.find((x) => x.id === 'share')!.end;
  return { graph: [g, r] as const, branch: [br, sceneTimes().end[0]] as const };
}

export const AppStory: React.FC<{ t: number; o: Orientation }> = ({ t, o }) => {
  const { w: W, h: H } = SIZE[o];
  const card = CARD[o];
  const B = beats();
  const ST = storyTimes();
  const XF = 0.1; // crossfade between beats

  // card shape: enters under the logo, shrinks into the graph's Context node, grows back out of Save,
  // and finally shrinks into the shared course node.
  const enter = prog(t, B[0].start, B[0].start + 0.5, easeOut);
  const toGraph = prog(t, ST.graph[0] - 0.12, ST.graph[0] + 0.33);
  const fromGraph = prog(t, ST.graph[1] - 0.45, ST.graph[1] + 0.05, easeOut);
  const toBranch = prog(t, ST.branch[0] - 0.05, ST.branch[0] + 0.5, easeIn);
  const inGraph = t > ST.graph[0] + 0.35 && t < ST.graph[1] - 0.46;
  const ctxNode = o === 'h' ? { x: 560, y: 1100 } : { x: 760, y: 820 };
  const saveNode = o === 'h' ? { x: 3340, y: 1100 } : { x: 1080, y: 2330 };
  const shareNode = o === 'h' ? { x: 1380, y: 900 } : { x: 1080, y: 1250 };
  let cx = card.x + card.w / 2, cy = card.y + card.h / 2, k = 1, op = 1;
  if (t < ST.graph[1] - 0.45 && toGraph > 0) { cx = lerp(cx, ctxNode.x, toGraph); cy = lerp(cy, ctxNode.y, toGraph); k = lerp(1, 0.17, toGraph); op = 1 - prog(t, ST.graph[0] + 0.12, ST.graph[0] + 0.33); }
  if (t >= ST.graph[1] - 0.45 && t < ST.branch[0]) { cx = lerp(saveNode.x, cx, fromGraph); cy = lerp(saveNode.y, cy, fromGraph); k = lerp(0.15, 1, fromGraph); op = prog(t, ST.graph[1] - 0.45, ST.graph[1] - 0.25); }
  if (toBranch > 0) { cx = lerp(cx, shareNode.x, toBranch); cy = lerp(cy, shareNode.y, toBranch); k = lerp(1, 0.08, toBranch); op = 1 - prog(t, ST.branch[0] + 0.05, ST.branch[0] + 0.3); }
  const enterY = (1 - enter) * 260;

  // crossfade only between different clips; cuts within one clip are hard cuts (no double exposure)
  const xfIn = (i: number) => (i > 0 && B[i - 1].clip !== B[i].clip ? XF : 0);
  const xfOut = (i: number) => (i < B.length - 1 && B[i + 1].clip !== B[i].clip ? XF : 0);
  const lo = (i: number) => B[i].start - xfIn(i) - (B[i].pre ?? 0);
  const hi = (i: number) => B[i].end + xfOut(i) + (B[i].post ?? 0);
  const active = B.map((b, i) => ({ b, i })).filter(({ i }) => t >= lo(i) && t < hi(i));
  const label = [...B].reverse().find((b, ri) => t >= lo(B.length - 1 - ri));

  return (
    <AbsoluteFill>
      {!inGraph && op > 0.001 && (
        <div style={{ position: 'absolute', left: cx - card.w / 2, top: cy - card.h / 2 + enterY, width: card.w, height: card.h, transform: `scale(${k})`, opacity: op * enter }}>
          {active.map(({ b, i }) => {
            const a = (xfIn(i) && !b.pre ? prog(t, b.start - xfIn(i), b.start) : 1) * (xfOut(i) && !b.post ? 1 - prog(t, b.end, b.end + xfOut(i)) : 1);
            const lt = t - b.start;
            const lead = b.start - lo(i);
            return (
              <Sequence key={b.id} from={s(lo(i))} layout="none">
                <div style={{ position: 'absolute', inset: 0, opacity: i === 0 ? 1 : a }}>
                  <Footage clip={b.clip} from={b.from - lead * b.rate} rate={b.rate} view={b.view[o](lt)} w={card.w} h={card.h} radius={o === 'h' ? 36 : 44}>
                    {b.id === 'cite' && <CiteLink lt={lt} />}
                  </Footage>
                </div>
              </Sequence>
            );
          })}
          {label && k > 0.9 && (
            <Tag scale={o === 'h' ? 1.35 : 1.5} style={{ left: 0, top: o === 'h' ? -100 : -112, opacity: prog(t, label.start, label.start + 0.15) }}>{label.label}</Tag>
          )}
        </div>
      )}
      {t > ST.graph[0] - 0.1 && t < ST.graph[1] + 0.1 && <AgentGraph t={t} t0={ST.graph[0] + 0.15} o={o} exit={prog(t, ST.graph[1] - 0.45, ST.graph[1] - 0.25)} />}
      {t > ST.branch[0] - 0.12 && <Branches t={t} t0={ST.branch[0]} o={o} node={shareNode} W={W} H={H} />}
    </AbsoluteFill>
  );
};

/** Blue connector: the orbit line, now joining a sentence to the exact region of the slide it came from. */
const CiteLink: React.FC<{ lt: number }> = ({ lt }) => {
  const k = prog(lt, 0.95, 1.45, easeOut);
  if (k <= 0) return null;
  // footage px: citation marker after the paragraph, and the highlighted region in the source pane
  const a = { x: 1690, y: 1795 }, b = { x: 2720, y: 445 };
  const d = `M${a.x},${a.y} C${a.x + 700},${a.y - 120} ${b.x - 250},${b.y + 700} ${b.x},${b.y}`;
  return (
    <svg width={3534} height={2565} style={{ position: 'absolute', inset: 0 }}>
      <path d={d} fill="none" stroke={C.blue} strokeWidth={9} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - k} />
      <circle cx={a.x} cy={a.y} r={16} fill={C.blue} />
      <circle cx={b.x} cy={b.y} r={16 * k} fill={C.blue} />
      <rect x={2695} y={232} width={720} height={225} rx={18} fill="none" stroke={C.blue} strokeWidth={8} opacity={prog(lt, 1.3, 1.5)} />
    </svg>
  );
};

/** The course, now a node, branches out to the people from the opening: follow or copy. */
const Branches: React.FC<{ t: number; t0: number; o: Orientation; node: { x: number; y: number }; W: number; H: number }> = ({ t, t0, o, node, W, H }) => {
  const people = o === 'h'
    ? [{ k: 'learner-stand', x: 2350, y: 1500, tag: 'Follow' }, { k: 'worker-stand', x: 2950, y: 1640, tag: 'Copy' }, { k: 'teacher-stand', x: 3500, y: 1500, tag: 'Follow' }]
    : [{ k: 'learner-stand', x: 420, y: 2700, tag: 'Follow' }, { k: 'worker-stand', x: 1080, y: 2820, tag: 'Copy' }, { k: 'teacher-stand', x: 1740, y: 2700, tag: 'Follow' }];
  const ph = o === 'h' ? 620 : 700;
  const exit = prog(t, sceneTimes().end[0] - 0.1, sceneTimes().end[0] + 0.35);
  const nodeIn = prog(t, t0 + 0.05, t0 + 0.35, easeOut);
  const student = o === 'h' ? { x: 820, y: 1500 } : { x: 1080, y: 1000 };
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - exit }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {people.map((p, i) => {
          const kk = prog(t, t0 + 0.2 + i * 0.1, t0 + 0.7 + i * 0.1, easeOut);
          const end = { x: p.x, y: p.y - ph - 60 };
          const d = o === 'h'
            ? `M${node.x},${node.y} C${node.x + 500},${node.y} ${end.x - 300},${end.y} ${end.x},${end.y}`
            : `M${node.x},${node.y} C${node.x},${node.y + 500} ${end.x},${end.y - 400} ${end.x},${end.y}`;
          return <path key={i} d={d} fill="none" stroke={C.blue} strokeWidth={10} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - kk} />;
        })}
        <circle cx={node.x} cy={node.y} r={70 * nodeIn} fill={C.blue} />
        <circle cx={node.x} cy={node.y} r={30 * nodeIn} fill={C.white} />
      </svg>
      <Person k="student-go" x={student.x} y={student.y} h={ph * 1.05} t={t} opacity={prog(t, t0 + 0.2, t0 + 0.45)} />
      {people.map((p, i) => {
        const kk = prog(t, t0 + 0.2 + i * 0.1, t0 + 0.55 + i * 0.1, easeOut);
        return (
          <React.Fragment key={p.k}>
            <Person k={p.k as any} x={p.x} y={p.y + (1 - kk) * 40} h={ph} t={t} opacity={kk} phase={i} />
            <div style={{ position: 'absolute', left: p.x, top: p.y - ph - 150, transform: 'translateX(-50%)', opacity: kk, padding: '12px 30px', borderRadius: 999, background: C.white, border: `4px solid ${C.blue}`, color: C.blue, fontFamily: F.ui, fontWeight: 700, fontSize: 46 }}>{p.tag}</div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
