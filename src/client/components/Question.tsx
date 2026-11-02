import { useRef, useState, type ReactNode } from "react";
import type { QType } from "@shared/questions";
import { PlotParams, Vector2dParams } from "@shared/widgets";
import { Md } from "./Md";
import { Vector2d } from "../widgets/Vector2d";
import { Plot } from "../widgets/Plot";
import { startVoice, type VoiceSession } from "../lib/voice";

/* eslint-disable @typescript-eslint/no-explicit-any -- views and responses are per-type JSON */
export type QView = { id: string; type: QType; typeLabel: string; prompt: string; view: any; solution: any | null };
export type Marking = { parts?: boolean[] } | null;
type Props = { q: QView; value: any; onChange: (v: any) => void; locked: boolean; marking: Marking };

/** The response a question starts with (order questions start in their shuffled order). */
export function initialResponse(q: QView): any {
  const v = q.view;
  switch (q.type) {
    case "order": return { items: v.items };
    case "parsons": return { items: [] };
    case "multi": case "highlight": return { choices: [] };
    case "cloze_text": return { blanks: Array(v.blanks).fill("") };
    case "cloze_select": return { blanks: v.blanks.map(() => -1) };
    case "cloze_drag": return { blanks: Array(gaps(v.text)).fill("") };
    case "match": return { right: v.left.map(() => "") };
    case "categorize": return { categories: v.items.map(() => -1) };
    case "grid": return { cells: v.rows.map(() => -1) };
    case "label": return { labels: v.markers.map(() => "") };
    case "estimate": return { value: Math.round((v.min + v.max) / 2 / v.step) * v.step };
    case "widget_goal": return null;
    default: return {};
  }
}

/** Whether every part has an answer, so Check can be pressed. */
export function isComplete(q: QView, r: any): boolean {
  if (!r) return false;
  switch (q.type) {
    case "mcq": case "two_tier": return Number.isInteger(r.choice) && (q.type === "mcq" || Number.isInteger(r.reason));
    case "multi": case "highlight": return r.choices?.length > 0;
    case "tf_fix": return r.isTrue === true || (r.isTrue === false && (!q.view.fixes?.length || Number.isInteger(r.fix)));
    case "numeric": case "expression": case "faded": return String(r.value ?? "").trim().length > 0;
    case "cloze_text": case "cloze_drag": case "match": case "label": return (r.blanks ?? r.right ?? r.labels).every((x: string) => x.trim());
    case "cloze_select": return r.blanks.every((x: number) => x >= 0);
    case "categorize": return r.categories.every((x: number) => x >= 0);
    case "grid": return r.cells.every((x: number) => x >= 0);
    case "order": case "parsons": return r.items.length > 0;
    case "hotspot": return Boolean(r.point);
    case "widget_goal": return r !== null;
    case "estimate": return Number.isFinite(r.value);
    case "spot_error": return Number.isInteger(r.step);
    default: return String(r.text ?? "").trim().length > 0;
  }
}

function gaps(text: string): number {
  return (text.match(/\[\[\d+\]\]/g) ?? []).length;
}

const mark = (ok: boolean | undefined) => (ok === undefined ? null : <span className={ok ? "q-ok" : "q-bad"} aria-label={ok ? "right" : "wrong"}>{ok ? "✓" : "✗"}</span>);

/** Text with [[n]] gaps, each rendered by `slot(n - 1)`. */
function Cloze({ text, slot }: { text: string; slot: (i: number) => ReactNode }) {
  const parts = text.split(/(\[\[\d+\]\])/);
  return (
    <p className="serif q-cloze">
      {parts.map((p, k) => {
        const m = p.match(/^\[\[(\d+)\]\]$/);
        return m ? <span key={k}>{slot(Number(m[1]) - 1)}</span> : <Md key={k} text={p} />;
      })}
    </p>
  );
}

function Choices({ name, options, picked, multi, locked, correct, onPick }: { name: string; options: string[]; picked: number[]; multi?: boolean; locked: boolean; correct?: number[]; onPick: (i: number) => void }) {
  return (
    <div className="q-choices" role={multi ? "group" : "radiogroup"}>
      {options.map((o, i) => {
        const on = picked.includes(i);
        const state = correct ? (correct.includes(i) ? "right" : on ? "wrong" : "") : "";
        return (
          <label key={i} className={`q-choice ${on ? "on" : ""} ${state}`}>
            <input type={multi ? "checkbox" : "radio"} name={name} checked={on} disabled={locked} onChange={() => onPick(i)} />
            <span><Md text={o} /></span>
          </label>
        );
      })}
    </div>
  );
}

/** A reorderable list: drag, or use the arrow buttons. */
function Reorder({ items, locked, parts, onChange, onRemove }: { items: string[]; locked: boolean; parts?: boolean[]; onChange: (items: string[]) => void; onRemove?: (i: number) => void }) {
  const drag = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  return (
    <ol className="q-order">
      {items.map((t, i) => (
        <li
          key={`${t}-${i}`}
          draggable={!locked}
          onDragStart={() => (drag.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drag.current !== null && move(drag.current, i)}
        >
          <span className="q-grip" aria-hidden="true">⋮⋮</span>
          <span style={{ flex: 1, minWidth: 0 }}><Md text={t} /></span>
          {mark(parts?.[i])}
          {!locked && (
            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
              <button type="button" className="icon-btn ghost q-mini" aria-label={`Move "${t}" up`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
              <button type="button" className="icon-btn ghost q-mini" aria-label={`Move "${t}" down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>↓</button>
              {onRemove && <button type="button" className="icon-btn ghost q-mini" aria-label={`Remove "${t}"`} onClick={() => onRemove(i)}>×</button>}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function PageImage({ url, children, onClick, alt }: { url: string; children?: ReactNode; onClick?: (p: { x: number; y: number }) => void; alt: string }) {
  return (
    <div
      className="page-view q-page"
      onClick={(e) => {
        if (!onClick) return;
        const r = e.currentTarget.getBoundingClientRect();
        onClick({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      }}
      style={{ cursor: onClick ? "crosshair" : undefined }}
    >
      <img src={url} alt={alt} draggable={false} />
      {children}
    </div>
  );
}

const box = (b: number[]) => ({ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${b[2] * 100}%`, height: `${b[3] * 100}%` });

function VoiceAnswer({ value, onChange, locked }: { value: string; onChange: (t: string) => void; locked: boolean }) {
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState("");
  const session = useRef<VoiceSession | null>(null);
  const toggle = async () => {
    if (rec) {
      session.current?.stop();
      setRec(false);
      return;
    }
    setErr("");
    try {
      const base = value ? `${value} ` : "";
      session.current = await startVoice((t) => onChange(base + t), (t) => { onChange(base + t); setRec(false); }, (m) => { setErr(m); setRec(false); });
      setRec(true);
    } catch {
      setErr("Microphone not available. You can type instead.");
    }
  };
  return (
    <div className="field">
      <div className="row">
        <button type="button" className={`btn ${rec ? "btn-dark" : "btn-primary"}`} disabled={locked} onClick={() => void toggle()} aria-pressed={rec}>
          {rec ? "Stop recording" : value ? "Keep talking" : "Explain it out loud"}
        </button>
        <span className="small muted">Transcribed by Muse Voice Transcribe. You can edit the text.</span>
      </div>
      <label htmlFor={`ans-${"voice"}`} className="label">What you said</label>
      <textarea id={`ans-${"voice"}`} className="textarea serif" rows={5} style={{ fontSize: 17 }} value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} />
      {err && <p className="small err-text">{err}</p>}
    </div>
  );
}

export function QuestionInput({ q, value: r, onChange, locked, marking }: Props) {
  const v = q.view;
  const sol = q.solution;
  const parts = marking?.parts;
  const set = (patch: any) => onChange({ ...(r ?? {}), ...patch });
  switch (q.type) {
    case "mcq":
      return <Choices name={q.id} options={v.options} picked={Number.isInteger(r?.choice) ? [r.choice] : []} locked={locked} correct={sol ? [sol.correct] : undefined} onPick={(i) => set({ choice: i })} />;
    case "multi":
      return (
        <>
          <p className="small muted">Select every option that applies.</p>
          <Choices name={q.id} multi options={v.options} picked={r.choices} locked={locked} correct={sol ? sol.options.map((o: any, i: number) => (o.correct ? i : -1)).filter((i: number) => i >= 0) : undefined} onPick={(i) => set({ choices: r.choices.includes(i) ? r.choices.filter((x: number) => x !== i) : [...r.choices, i] })} />
        </>
      );
    case "tf_fix":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <blockquote className="q-statement serif"><Md text={v.statement} /></blockquote>
          <div className="row" role="radiogroup" aria-label="True or false">
            {[true, false].map((t) => (
              <button key={String(t)} type="button" className="chip q-chip-lg" aria-pressed={r?.isTrue === t} disabled={locked} onClick={() => set({ isTrue: t })}>{t ? "True" : "False"}</button>
            ))}
          </div>
          {r?.isTrue === false && v.fixes?.length > 0 && (
            <>
              <p className="label">Which correction makes it true?</p>
              <Choices name={`${q.id}-fix`} options={v.fixes} picked={Number.isInteger(r.fix) ? [r.fix] : []} locked={locked} correct={sol && !sol.isTrue ? [sol.correctFix] : undefined} onPick={(i) => set({ fix: i })} />
            </>
          )}
        </div>
      );
    case "two_tier":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p className="label">Your answer</p>
          <Choices name={`${q.id}-a`} options={v.options} picked={Number.isInteger(r?.choice) ? [r.choice] : []} locked={locked} correct={sol ? [sol.correct] : undefined} onPick={(i) => set({ choice: i })} />
          <p className="label">Because…</p>
          <Choices name={`${q.id}-b`} options={v.reasons} picked={Number.isInteger(r?.reason) ? [r.reason] : []} locked={locked} correct={sol ? [sol.correctReason] : undefined} onPick={(i) => set({ reason: i })} />
        </div>
      );
    case "numeric":
    case "expression":
    case "faded": {
      const input = (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id={`ans-${q.id}`} className="input serif" style={{ fontSize: 18, flex: 1, minWidth: 0 }} inputMode={q.type === "numeric" ? "decimal" : "text"} value={r?.value ?? ""} disabled={locked} onChange={(e) => set({ value: e.target.value })} placeholder={q.type === "expression" ? v.hint || "e.g. λ² − 7λ + 10" : q.type === "numeric" ? "Number" : "The missing step"} autoComplete="off" />
          {q.type === "numeric" && v.unit && <span className="muted">{v.unit}</span>}
        </div>
      );
      if (q.type !== "faded") return <div className="field"><label htmlFor={`ans-${q.id}`} className="label">{q.type === "numeric" ? "Your answer" : "Your expression"}</label>{input}</div>;
      return (
        <ol className="q-steps">
          {v.steps.map((s: string | null, i: number) => (
            <li key={i}>{s === null ? <div className="field"><label htmlFor={`ans-${q.id}`} className="small muted">Missing step</label>{input}</div> : <Md text={s} />}</li>
          ))}
        </ol>
      );
    }
    case "cloze_text":
      return <Cloze text={v.text} slot={(i) => <span className="q-gap"><input aria-label={`Gap ${i + 1}`} className="input input-sm q-gap-input" value={r.blanks[i] ?? ""} disabled={locked} onChange={(e) => set({ blanks: r.blanks.map((b: string, k: number) => (k === i ? e.target.value : b)) })} />{mark(parts?.[i])}</span>} />;
    case "cloze_select":
      return (
        <Cloze
          text={v.text}
          slot={(i) => (
            <span className="q-gap">
              <select aria-label={`Gap ${i + 1}`} className="select select-sm" value={r.blanks[i]} disabled={locked} onChange={(e) => set({ blanks: r.blanks.map((b: number, k: number) => (k === i ? Number(e.target.value) : b)) })}>
                <option value={-1}>Choose…</option>
                {v.blanks[i].map((o: string, k: number) => <option key={k} value={k}>{o}</option>)}
              </select>
              {mark(parts?.[i])}
            </span>
          )}
        />
      );
    case "cloze_drag":
      return <DragCloze v={v} r={r} set={set} locked={locked} parts={parts} />;
    case "match":
      return (
        <div className="q-match">
          {v.left.map((l: string, i: number) => (
            <div key={i} className="q-match-row">
              <span className="serif"><Md text={l} /></span>
              <select aria-label={`Match for ${l}`} className="select select-sm" value={r.right[i]} disabled={locked} onChange={(e) => set({ right: r.right.map((x: string, k: number) => (k === i ? e.target.value : x)) })}>
                <option value="">Choose…</option>
                {v.right.map((o: string) => <option key={o} value={o}>{o}</option>)}
              </select>
              {mark(parts?.[i])}
            </div>
          ))}
        </div>
      );
    case "order":
      return (
        <>
          <p className="small muted">Drag the steps, or use the arrows, to put them in order.</p>
          <Reorder items={r.items} locked={locked} parts={parts} onChange={(items) => set({ items })} />
        </>
      );
    case "parsons": {
      const used = new Set<string>(r.items);
      return (
        <div className="q-parsons">
          <div>
            <p className="label">Lines</p>
            <div className="q-pool">
              {v.pool.filter((t: string) => !used.has(t)).map((t: string) => (
                <button key={t} type="button" className="q-line" disabled={locked} onClick={() => set({ items: [...r.items, t] })}><Md text={t} /></button>
              ))}
            </div>
          </div>
          <div>
            <p className="label">Your solution</p>
            {r.items.length ? <Reorder items={r.items} locked={locked} parts={parts} onChange={(items) => set({ items })} onRemove={(i) => set({ items: r.items.filter((_: string, k: number) => k !== i) })} /> : <p className="small muted q-empty">Tap lines on the left to build the solution in order. Some lines do not belong.</p>}
          </div>
        </div>
      );
    }
    case "categorize":
      return <Buckets v={v} r={r} set={set} locked={locked} parts={parts} />;
    case "grid":
      return (
        <div className="tbl-scroll">
          <table className="table q-grid">
            <thead><tr><th />{v.cols.map((c: string) => <th key={c}>{c}</th>)}<th /></tr></thead>
            <tbody>
              {v.rows.map((row: string, i: number) => (
                <tr key={i}>
                  <td className="serif"><Md text={row} /></td>
                  {v.cols.map((c: string, k: number) => (
                    <td key={c} className={sol ? (sol.correct[i] === k ? "q-cell-right" : r.cells[i] === k ? "q-cell-wrong" : "") : ""}>
                      <input type="radio" name={`${q.id}-r${i}`} aria-label={`${row}: ${c}`} checked={r.cells[i] === k} disabled={locked} onChange={() => set({ cells: r.cells.map((x: number, j: number) => (j === i ? k : x)) })} />
                    </td>
                  ))}
                  <td>{mark(parts?.[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "highlight":
      return (
        <>
          <p className="small muted">Tap the parts to highlight. Tap again to clear.</p>
          <p className="serif q-passage">
            {v.segments.map((t: string, i: number) => {
              const on = r.choices.includes(i);
              const right = sol ? sol.correct.includes(i) : null;
              return (
                <button key={i} type="button" className={`q-seg${on ? " on" : ""}${right === true ? " right" : on && right === false ? " wrong" : ""}`} aria-pressed={on} disabled={locked} onClick={() => set({ choices: on ? r.choices.filter((x: number) => x !== i) : [...r.choices, i] })}>
                  <Md text={t} />
                </button>
              );
            })}
          </p>
        </>
      );
    case "hotspot":
      return (
        <>
          <p className="small muted">Click on the slide.</p>
          <PageImage url={v.pageUrl} alt={`Slide page ${v.page}`} onClick={locked ? undefined : (point) => set({ point })}>
            {sol && <span className="page-hl" style={box(sol.region.bbox)} />}
            {r?.point && <span className="q-pin" style={{ left: `${r.point.x * 100}%`, top: `${r.point.y * 100}%` }} aria-label="Your click" />}
          </PageImage>
        </>
      );
    case "label":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <PageImage url={v.pageUrl} alt={`Slide page ${v.page} with numbered markers`}>
            {v.markers.map((b: number[], i: number) => <span key={i} className="q-marker" style={{ left: `${(b[0] + b[2] / 2) * 100}%`, top: `${(b[1] + b[3] / 2) * 100}%` }}>{i + 1}</span>)}
          </PageImage>
          <div className="q-match">
            {v.markers.map((_: number[], i: number) => (
              <div key={i} className="q-match-row">
                <span style={{ fontWeight: 600 }}>Marker {i + 1}</span>
                <select aria-label={`Label for marker ${i + 1}`} className="select select-sm" value={r.labels[i]} disabled={locked} onChange={(e) => set({ labels: r.labels.map((x: string, k: number) => (k === i ? e.target.value : x)) })}>
                  <option value="">Choose…</option>
                  {v.labels.map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
                {mark(parts?.[i])}
              </div>
            ))}
          </div>
        </div>
      );
    case "widget_goal": {
      if (v.template === "vector2d") {
        const p = Vector2dParams.safeParse(v.params);
        return p.success ? <div className="widget-card"><Vector2d params={p.data} onState={locked ? undefined : (st) => onChange(st)} /></div> : <p className="err-text small">This challenge has invalid settings.</p>;
      }
      const p = PlotParams.safeParse(v.params);
      return p.success ? <div className="widget-card"><Plot params={p.data} onState={locked ? undefined : (st) => onChange(st)} /></div> : <p className="err-text small">This challenge has invalid settings.</p>;
    }
    case "estimate":
      return (
        <div className="field">
          <label htmlFor={`ans-${q.id}`} className="label">Your estimate: <strong>{r.value}{v.unit ? ` ${v.unit}` : ""}</strong></label>
          <input id={`ans-${q.id}`} type="range" min={v.min} max={v.max} step={v.step} value={r.value} disabled={locked} onChange={(e) => set({ value: Number(e.target.value) })} style={{ accentColor: "#0A5CFF" }} />
          <div className="row small muted" style={{ justifyContent: "space-between" }}><span>{v.min}</span><span>{v.max}</span></div>
        </div>
      );
    case "spot_error":
      return (
        <>
          <p className="small muted">Click the step with the mistake.</p>
          <ol className="q-steps">
            {v.steps.map((s: string, i: number) => (
              <li key={i}>
                <button type="button" className={`q-step-btn${r?.step === i ? " on" : ""}${sol ? (sol.wrongStep === i ? " wrong-step" : "") : ""}`} aria-pressed={r?.step === i} disabled={locked} onClick={() => set({ step: i })}>
                  <Md text={s} />
                </button>
              </li>
            ))}
          </ol>
        </>
      );
    case "teach_back":
      return <VoiceAnswer value={r?.text ?? ""} onChange={(text) => set({ text })} locked={locked} />;
    default:
      return (
        <div className="field">
          <label htmlFor={`ans-${q.id}`} className="label">Your answer</label>
          <textarea id={`ans-${q.id}`} className="textarea serif" rows={q.type === "short" ? 3 : 6} style={{ fontSize: 18 }} value={r?.text ?? ""} disabled={locked} onChange={(e) => set({ text: e.target.value })} placeholder={q.type === "justify" ? "Give your reasoning step by step" : "Write your working as you would on the exam"} />
        </div>
      );
  }
}

/** Word bank: tap a word then a gap, or drag the word onto the gap. */
function DragCloze({ v, r, set, locked, parts }: { v: any; r: any; set: (p: any) => void; locked: boolean; parts?: boolean[] }) {
  const [held, setHeld] = useState<string | null>(null);
  const placed = new Set<string>(r.blanks.filter(Boolean));
  const put = (i: number, word: string | null) => {
    if (locked) return;
    const blanks = r.blanks.map((b: string) => (b === word ? "" : b));
    blanks[i] = word ?? "";
    set({ blanks });
    setHeld(null);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="q-bank" aria-label="Word bank">
        {v.bank.filter((w: string) => !placed.has(w)).map((w: string) => (
          <button key={w} type="button" className="chip" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData("text/plain", w)} aria-pressed={held === w} disabled={locked} onClick={() => setHeld(held === w ? null : w)}>{w}</button>
        ))}
      </div>
      <Cloze
        text={v.text}
        slot={(i) => (
          <span className="q-gap">
            <button
              type="button"
              className={`q-drop${r.blanks[i] ? " filled" : ""}${held ? " ready" : ""}`}
              aria-label={r.blanks[i] ? `Gap ${i + 1}: ${r.blanks[i]}. Tap to clear` : `Gap ${i + 1}, empty`}
              disabled={locked}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); put(i, e.dataTransfer.getData("text/plain")); }}
              onClick={() => (held ? put(i, held) : r.blanks[i] && put(i, null))}
            >
              {r.blanks[i] || " "}
            </button>
            {mark(parts?.[i])}
          </span>
        )}
      />
    </div>
  );
}

/** Sort items into groups: tap a group for each item, or drag items into a group. */
function Buckets({ v, r, set, locked, parts }: { v: any; r: any; set: (p: any) => void; locked: boolean; parts?: boolean[] }) {
  const assign = (item: number, cat: number) => !locked && set({ categories: r.categories.map((c: number, k: number) => (k === item ? cat : c)) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="q-buckets">
        {v.categories.map((c: string, k: number) => (
          <div key={c} className="q-bucket" onDragOver={(e) => e.preventDefault()} onDrop={(e) => assign(Number(e.dataTransfer.getData("text/plain")), k)}>
            <p className="label">{c}</p>
            {v.items.map((t: string, i: number) => r.categories[i] === k && (
              <span key={i} className="q-item" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}>
                <Md text={t} /> {mark(parts?.[i])}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="q-match">
        {v.items.map((t: string, i: number) => (
          <div key={i} className="q-match-row" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}>
            <span className="serif"><Md text={t} /></span>
            <span className="row" style={{ gap: 6 }} role="radiogroup" aria-label={`Group for ${t}`}>
              {v.categories.map((c: string, k: number) => (
                <button key={c} type="button" className="chip" aria-pressed={r.categories[i] === k} disabled={locked} onClick={() => assign(i, k)}>{c}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
