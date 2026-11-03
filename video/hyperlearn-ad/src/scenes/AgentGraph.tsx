import React from 'react';
import { getLength, getPointAtLength } from '@remotion/paths';
import { easeOut, prog } from '../lib/anim';
import { C, F, SIZE, type Orientation } from '../lib/tokens';

// The mutate graph as built in src/server/graphs/mutate.ts: writeText ‖ buildWidget run in parallel,
// verify checks sentences against cited chunks (Muse Spark verifier), recomputes widget claims with mathjs
// and loads the widget in a browser; on failure it routes back to the writers (MAX_RETRIES = 2).
// The check results shown are the ones the captured run reported in "How this was decided".

type P = { x: number; y: number };
const LAYOUT = {
  h: {
    title: { x: 300, y: 210, size: 128 }, tag: { x: 300, y: 130 },
    nodes: { context: { x: 560, y: 1100 }, text: { x: 1500, y: 840 }, widget: { x: 1500, y: 1360 }, verify: { x: 2470, y: 1100 }, save: { x: 3340, y: 1100 } },
    nodeW: 600, nodeH: 250, source: { x: 560, y: 1620 }, checks: { x: 2400, y: 1340 }, footer: { x: 1920, y: 1830 }, repairUp: 330,
  },
  v: {
    title: { x: 140, y: 330, size: 112 }, tag: { x: 140, y: 230 },
    nodes: { context: { x: 760, y: 820 }, text: { x: 620, y: 1360 }, widget: { x: 1540, y: 1360 }, verify: { x: 1080, y: 1900 }, save: { x: 1080, y: 2330 } },
    nodeW: 720, nodeH: 250, source: { x: 1700, y: 820 }, checks: { x: 330, y: 2560 }, footer: { x: 1080, y: 3000 }, repairUp: 0,
  },
};

const Node: React.FC<{ p: P; w: number; h: number; label: string; sub: string; on: number; done?: number; appear: number; scale: number }> = ({ p, w, h, label, sub, on, done = 0, appear, scale }) => {
  const border = done > 0.5 ? C.success : on > 0.5 ? C.blue : C.border;
  return (
    <div style={{
      position: 'absolute', left: p.x - w / 2, top: p.y - h / 2, width: w, height: h, boxSizing: 'border-box', borderRadius: 28 * scale,
      background: done > 0.5 ? C.successTint : on > 0.5 ? C.blueTint : C.white, border: `${5 * scale}px solid ${border}`,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: `0 ${40 * scale}px`, gap: 8 * scale,
      opacity: appear, transform: `scale(${0.9 + 0.1 * appear})`, fontFamily: F.ui,
    }}>
      <div style={{ fontSize: 74 * scale, fontWeight: 700, color: C.ink, lineHeight: 1.05 }}>{label}</div>
      <div style={{ fontSize: 44 * scale, fontWeight: 500, color: C.body, lineHeight: 1.15 }}>{sub}</div>
    </div>
  );
};

/** Animated edge with a travelling pulse. */
const Edge: React.FC<{ d: string; k: number; dashed?: boolean; color?: string; w: number; pulse?: number }> = ({ d, k, dashed, color = C.ink, w, pulse }) => (
  <g>
    <path d={d} fill="none" stroke={color} strokeOpacity={dashed ? 0.9 : 0.6} strokeWidth={w} strokeLinecap="round" pathLength={1}
      strokeDasharray={dashed ? undefined : '1 1'} strokeDashoffset={dashed ? undefined : 1 - k}
      style={dashed ? { strokeDasharray: `${w * 3} ${w * 3}`, opacity: k } : undefined} />
    {pulse !== undefined && pulse > 0.02 && pulse < 0.98 && (() => { const pt = getPointAtLength(d, getLength(d) * pulse); return pt && <circle cx={pt.x} cy={pt.y} r={w * 2.8} fill={C.blue} />; })()}
  </g>
);

export const AgentGraph: React.FC<{ t: number; t0: number; o: Orientation; exit: number }> = ({ t, t0, o, exit }) => {
  const L = LAYOUT[o], { w: W, h: H } = SIZE[o], sc = 1;
  const n = L.nodes, w = L.nodeW, h = L.nodeH, sw = 6;
  const K = 0.78; // schedule compression to fit the narration
  const at = (a: number, b: number) => prog(t, t0 + a * K, t0 + b * K, easeOut);
  const ctxIn = at(0.05, 0.45), forkK = at(0.45, 0.95), parIn = at(0.6, 1.0), toVerify = at(1.05, 1.5), verifyOn = at(1.45, 1.6);
  const evidence = at(1.3, 1.9), checks = [at(1.75, 2.0), at(2.0, 2.25), at(2.25, 2.5)], repair = at(2.5, 3.0), saveK = at(3.0, 3.35), saveOn = at(3.3, 3.45), footer = at(3.2, 3.7);
  const titleIn = at(0.15, 0.6);
  const H2 = h / 2, W2 = w / 2;
  let dCtxText: string, dCtxWidget: string, dTextVer: string, dWidgetVer: string, dVerSave: string, dRepair: string, dSrcCtx: string, dSrcVer: string;
  if (o === 'h') {
    dCtxText = `M${n.context.x + W2},${n.context.y} C${n.context.x + W2 + 200},${n.context.y} ${n.text.x - W2 - 200},${n.text.y} ${n.text.x - W2},${n.text.y}`;
    dCtxWidget = `M${n.context.x + W2},${n.context.y} C${n.context.x + W2 + 200},${n.context.y} ${n.widget.x - W2 - 200},${n.widget.y} ${n.widget.x - W2},${n.widget.y}`;
    dTextVer = `M${n.text.x + W2},${n.text.y} C${n.text.x + W2 + 200},${n.text.y} ${n.verify.x - W2 - 200},${n.verify.y} ${n.verify.x - W2},${n.verify.y}`;
    dWidgetVer = `M${n.widget.x + W2},${n.widget.y} C${n.widget.x + W2 + 200},${n.widget.y} ${n.verify.x - W2 - 200},${n.verify.y} ${n.verify.x - W2},${n.verify.y}`;
    dVerSave = `M${n.verify.x + W2},${n.verify.y} L${n.save.x - W2 + 120},${n.save.y}`;
    dRepair = `M${n.verify.x},${n.verify.y - H2} C${n.verify.x},${n.text.y - L.repairUp} ${n.text.x},${n.text.y - L.repairUp} ${n.text.x},${n.text.y - H2}`;
    dSrcCtx = `M${L.source.x},${L.source.y - 150} L${n.context.x},${n.context.y + H2}`;
    dSrcVer = `M${L.source.x + 330},${L.source.y} C${L.source.x + 1300},${L.source.y} ${n.verify.x - 160},${L.source.y} ${n.verify.x - 160},${n.verify.y + H2}`;
  } else {
    dCtxText = `M${n.context.x},${n.context.y + H2} C${n.context.x},${n.context.y + H2 + 130} ${n.text.x},${n.text.y - H2 - 130} ${n.text.x},${n.text.y - H2}`;
    dCtxWidget = `M${n.context.x},${n.context.y + H2} C${n.context.x},${n.context.y + H2 + 130} ${n.widget.x},${n.widget.y - H2 - 130} ${n.widget.x},${n.widget.y - H2}`;
    dTextVer = `M${n.text.x},${n.text.y + H2} C${n.text.x},${n.text.y + H2 + 130} ${n.verify.x},${n.verify.y - H2 - 130} ${n.verify.x},${n.verify.y - H2}`;
    dWidgetVer = `M${n.widget.x},${n.widget.y + H2} C${n.widget.x},${n.widget.y + H2 + 130} ${n.verify.x},${n.verify.y - H2 - 130} ${n.verify.x},${n.verify.y - H2}`;
    dVerSave = `M${n.verify.x},${n.verify.y + H2} L${n.save.x},${n.save.y - H2}`;
    dRepair = `M${n.verify.x - W2},${n.verify.y} C${100},${n.verify.y} ${100},${n.text.y} ${n.text.x - W2},${n.text.y}`;
    dSrcCtx = `M${L.source.x - 260},${L.source.y} L${n.context.x + W2},${n.context.y}`;
    dSrcVer = `M${L.source.x},${L.source.y + 200} C${2060},${L.source.y + 700} ${2060},${n.verify.y} ${n.verify.x + W2},${n.verify.y}`;
  }
  const checkRows = ['10 / 10 sentences match their cited source', '3 / 3 widget claims recomputed with mathjs', 'Loaded in a browser: 0 errors'];
  const fs = o === 'h' ? 1 : 1;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 1 - exit }}>
      <div style={{ position: 'absolute', left: L.tag.x, top: L.tag.y - 40, opacity: titleIn, display: 'flex', gap: 24, alignItems: 'center', fontFamily: F.ui }}>
        <div style={{ padding: '10px 30px', borderRadius: 999, border: `4px solid ${C.blue}`, color: C.blue, fontWeight: 700, fontSize: 48 }}>LangGraph</div>
        <div style={{ color: C.muted, fontWeight: 500, fontSize: 46 }}>the change you asked for, as an agent graph</div>
      </div>
      <div style={{ position: 'absolute', left: L.title.x, top: L.title.y, opacity: titleIn, fontFamily: F.ui, fontWeight: 700, fontSize: L.title.size, color: C.ink, letterSpacing: -1 }}>
        Generate <span style={{ color: C.blue }}>→</span> Verify <span style={{ color: C.blue }}>→</span> Repair
      </div>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <Edge d={dSrcCtx} k={ctxIn} w={sw} color={C.warning} />
        <Edge d={dCtxText} k={forkK} w={sw} pulse={forkK} />
        <Edge d={dCtxWidget} k={forkK} w={sw} pulse={forkK} />
        <Edge d={dTextVer} k={toVerify} w={sw} pulse={toVerify} />
        <Edge d={dWidgetVer} k={toVerify} w={sw} pulse={toVerify} />
        <Edge d={dSrcVer} k={evidence} w={sw} color={C.warning} />
        <Edge d={dRepair} k={repair} w={sw} dashed color={C.blue} />
        <Edge d={dVerSave} k={saveK} w={sw} pulse={saveK} />
      </svg>
      {/* source evidence: the cited page region */}
      <div style={{ position: 'absolute', left: L.source.x - 300, top: L.source.y - 150, width: 600, height: 300, opacity: ctxIn, borderRadius: 24, border: `4px solid ${C.border}`, background: C.white, padding: 30, boxSizing: 'border-box', fontFamily: F.ui }}>
        <div style={{ fontSize: 34, fontWeight: 600, color: C.muted }}>Source · L06 slides p.6</div>
        <div style={{ marginTop: 18, background: C.highlight, borderRadius: 10, padding: '16px 20px', fontFamily: F.serif, fontSize: 36, color: C.ink, lineHeight: 1.25 }}>We will often need det(A − λI), where λ is unknown.</div>
      </div>
      <Node p={n.context} w={w} h={h} label="Context" sub="paragraph + its cited source" on={ctxIn} appear={ctxIn} scale={fs} />
      <Node p={n.text} w={w} h={h} label="Text" sub="rewrite it simpler" on={parIn * (1 - verifyOn * 0.99)} appear={parIn} scale={fs} />
      <Node p={n.widget} w={w} h={h} label="Widget" sub="interactive plot" on={parIn * (1 - verifyOn * 0.99)} appear={parIn} scale={fs} />
      <Node p={n.verify} w={w} h={h} label="Verify" sub="against the sources" on={verifyOn} appear={at(0.9, 1.25)} scale={fs} />
      <Node p={n.save} w={o === 'h' ? 520 : w} h={h} label="Save" sub="new version · Undo" on={saveOn} done={saveOn} appear={at(2.85, 3.15)} scale={fs} />
      {/* repair label */}
      <div style={{
        position: 'absolute', fontFamily: F.ui, fontSize: 42, fontWeight: 600, color: C.blue, opacity: repair, whiteSpace: 'nowrap',
        ...(o === 'h' ? { left: (n.text.x + n.verify.x) / 2 - 330, top: n.text.y - L.repairUp - 20 } : { left: 70, top: (n.text.y + n.verify.y) / 2 - 150, transform: 'rotate(-90deg)', transformOrigin: '0 0' }),
      }}>{o === 'h' ? 'Repair · only if a check fails · max 2 tries' : ''}</div>
      {o === 'v' && <div style={{ position: 'absolute', left: 240, top: n.verify.y - 380, fontFamily: F.ui, fontSize: 40, fontWeight: 600, color: C.blue, opacity: repair, width: 480 }}>Repair<br /><span style={{ color: C.muted, fontWeight: 500 }}>only if a check fails, max 2 tries</span></div>}
      {/* checks reported by the captured run */}
      <div style={{ position: 'absolute', left: L.checks.x, top: L.checks.y, fontFamily: F.ui, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: C.muted, opacity: checks[0], letterSpacing: 2, textTransform: 'uppercase' }}>This run</div>
        {checkRows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: checks[i], transform: `translateY(${(1 - checks[i]) * 20}px)` }}>
            <svg width={58} height={58} viewBox="0 0 24 24"><circle cx={12} cy={12} r={11} fill={C.success} /><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div style={{ fontSize: o === 'h' ? 54 : 50, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' }}>{r}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: L.footer.x, top: L.footer.y, transform: 'translateX(-50%)', opacity: footer, display: 'flex', gap: 28, fontFamily: F.ui }}>
        {['Source-linked', 'Versioned', 'Reversible'].map((x, i) => (
          <React.Fragment key={x}>
            {i > 0 && <div style={{ fontSize: 56, color: C.input }}>•</div>}
            <div style={{ fontSize: 56, fontWeight: 700, color: C.ink }}>{x}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
