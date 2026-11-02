import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Block, Cite, RunEvent, Section } from "@shared/types";
import { api, ApiError, sessionToken, streamEvents, wsUrl } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";
import { CiteMarks, ExerciseCard, FigureView, WidgetCard, type SourceInfo } from "../components/Blocks";
import { SourcePane } from "../components/SourcePane";
import { CommandBar } from "../components/CommandBar";
import { Md } from "../components/Md";
import { ShareDialog } from "../components/ShareDialog";
import { Speaker } from "../components/Icons";
import { useConfig } from "../main";

export type OutlineSection = { id: string; title: string; chapter: string; concept: string; origin: string; read: boolean; minutes: number };
export type CourseResp = {
  course: { id: string; title: string; status: string; owner_id: string; is_demo: number; forked_from: string | null; current_version: number };
  role: "owner" | "follower" | "demo";
  version: number;
  sections: OutlineSection[];
  sources: { id: string; filename: string; kind: string }[];
};
type SectionResp = { section: Section & { overlay: boolean }; sources: Record<string, SourceInfo>; figures: Record<string, string>; role: string };

const MODES = [
  { key: "original", label: "Original" },
  { key: "simpler", label: "Simpler" },
  { key: "analogy", label: "Analogy" },
  { key: "exam", label: "Exam style" },
] as const;
type Mode = (typeof MODES)[number]["key"];

type Step = { label: string; status: "pending" | "active" | "done" | "failed"; detail?: string };
type MutState =
  | { stage: "idle" }
  | { stage: "ask"; blockId: string; request: string }
  | { stage: "working"; blockId: string; request: string; runId: string; steps: Step[] }
  | { stage: "review"; blockId: string; request: string; runId: string; steps: Step[]; summary: string[]; after: Section; before: Section; showBefore: boolean; changedIds: string[] }
  | { stage: "saving"; blockId: string; request: string; runId: string; after: Section; summary: string[]; changedIds: string[] }
  | { stage: "kept"; message: string; summary: string[]; runId: string; changedIds: string[] };

const SUGGESTIONS = ["Simpler", "Interactive example", "More examples", "Exam focus"];
const SUGGESTION_TEXT: Record<string, string> = {
  Simpler: "This is too complex. Simplify it.",
  "Interactive example": "Give me an interactive example I can play with.",
  "More examples": "Show me more worked examples.",
  "Exam focus": "Focus this on what the exam asks.",
};

export function numberSections(sections: OutlineSection[]): Map<string, string> {
  const chapters: string[] = [];
  const out = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const s of sections) {
    if (!chapters.includes(s.chapter)) chapters.push(s.chapter);
    if (s.origin === "adapt") continue; // inserted reviews are not numbered (as in the design)
    const c = chapters.indexOf(s.chapter) + 1;
    const n = (counters.get(s.chapter) ?? 0) + 1;
    counters.set(s.chapter, n);
    out.set(s.id, `${c}.${n}`);
  }
  return out;
}

export function CoursePage() {
  const { courseId = "", sectionId = "" } = useParams();
  const navigate = useNavigate();
  const { toast, reloadCourses } = useApp();
  const config = useConfig();
  const outline = useApi<CourseResp>(`/api/courses/${courseId}`);
  const sec = useApi<SectionResp>(`/api/courses/${courseId}/sections/${sectionId}`);
  const [mode, setMode] = useState<Mode>("original");
  const [view, setView] = useState<Record<string, string> | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeCite, setActiveCite] = useState(0);
  const [mut, setMut] = useState<MutState>({ stage: "idle" });
  const [share, setShare] = useState(false);
  const [listening, setListening] = useState<string | null>(null);
  const mutRef = useRef(mut);
  mutRef.current = mut;

  const numbers = useMemo(() => numberSections(outline.data?.sections ?? []), [outline.data]);
  const current = outline.data?.sections.find((s) => s.id === sectionId);
  const section = sec.data?.section;
  const sources = sec.data?.sources ?? {};
  const exam = outline.data?.sources.find((s) => s.kind === "exam");

  // reset per section
  useEffect(() => {
    setMode("original");
    setView(null);
    setSelected(null);
    setMut({ stage: "idle" });
    window.speechSynthesis?.cancel();
    setListening(null);
  }, [sectionId]);

  // mark as read after a short while on the page
  useEffect(() => {
    if (!section) return;
    const t = window.setTimeout(() => void api(`/api/courses/${courseId}/sections/${sectionId}/read`, { body: {} }).catch(() => {}), 8000);
    return () => window.clearTimeout(t);
  }, [section, courseId, sectionId]);

  // live updates from the course owner
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    void sessionToken().then((token) => {
      if (closed) return;
      ws = new WebSocket(wsUrl(`/api/courses/${courseId}/ws`, token));
      ws.onmessage = (e) => {
        const ev = JSON.parse(e.data as string) as RunEvent;
        if (ev.type === "course.version" && mutRef.current.stage === "idle") {
          void sec.reload();
          void outline.reload();
          if (ev.summary) toast(`Course updated: ${ev.summary}`);
        }
      };
    });
    const ping = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 30000);
    return () => {
      closed = true;
      window.clearInterval(ping);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const startMutation = useCallback(
    async (blockId: string, request: string) => {
      if (!section) return;
      setSelected(blockId);
      const steps: Step[] = [];
      setMut({ stage: "working", blockId, request, runId: "", steps });
      try {
        await streamEvents<RunEvent>(`/api/courses/${courseId}/sections/${sectionId}/mutate`, { blockId, request }, (ev) => {
          setMut((m) => {
            if (m.stage !== "working" && m.stage !== "review") return m;
            if (ev.type === "run.start") return { ...m, runId: ev.runId, steps: ev.steps.map((label) => ({ label, status: "pending" })) } as MutState;
            if (ev.type === "run.step" && m.stage === "working") {
              const s = [...m.steps];
              s[ev.index] = { label: ev.label, status: ev.status, detail: ev.detail };
              for (let i = 0; i < ev.index; i++) if (s[i]?.status === "pending" || s[i]?.status === "active") s[i] = { ...s[i], status: "done" };
              return { ...m, steps: s };
            }
            if (ev.type === "run.waiting" && m.stage === "working") {
              const changedIds = ev.section.blocks.filter((b) => !ev.before.blocks.some((x) => JSON.stringify(x) === JSON.stringify(b))).map((b) => b.id);
              return { ...m, stage: "review", summary: ev.summary, after: ev.section, before: ev.before, showBefore: false, changedIds, steps: m.steps.map((s) => (s.status === "pending" || s.status === "active" ? { ...s, status: "done" } : s)) };
            }
            if (ev.type === "run.done" && ev.status === "failed") {
              toast(ev.message ?? "That change failed");
              return { stage: "idle" };
            }
            if (ev.type === "run.done" && ev.status === "undone") {
              return { stage: "idle" };
            }
            return m;
          });
        });
        // stream ended: if no review arrived, nothing changed
        setMut((m) => (m.stage === "working" ? (toast("Nothing changed. Try asking another way."), { stage: "idle" }) : m));
      } catch (e) {
        const err = e as ApiError;
        toast(err.code === "budget" ? err.message : `Could not change it: ${err.message}`);
        setMut({ stage: "idle" });
      }
    },
    [section, courseId, sectionId, toast],
  );

  const decide = async (decision: "keep" | "undo", retry = false) => {
    const m = mutRef.current;
    if (m.stage !== "review") return;
    if (decision === "keep") setMut({ stage: "saving", blockId: m.blockId, request: m.request, runId: m.runId, after: m.after, summary: m.summary, changedIds: m.changedIds });
    else setMut({ stage: "idle" });
    try {
      let message = "";
      await streamEvents<RunEvent>(`/api/runs/${m.runId}/resume`, { decision }, (ev) => {
        if (ev.type === "run.done") message = ev.message ?? "";
      });
      if (decision === "keep") {
        setMut({ stage: "kept", message: message || "Saved.", summary: m.summary, runId: m.runId, changedIds: m.changedIds });
        await sec.reload();
        void outline.reload();
        void reloadCourses();
      } else if (retry) {
        void startMutation(m.blockId, `${m.request} (Try a different approach from last time.)`);
      }
    } catch (e) {
      toast((e as Error).message);
      setMut({ stage: "idle" });
    }
  };

  usePageContext(
    {
      courseId,
      courseTitle: outline.data?.course.title,
      sectionId,
      sectionTitle: current ? `${numbers.get(current.id) ?? ""} ${current.title}`.trim() : undefined,
      onMutate: (request: string) => {
        const target = selected ?? section?.blocks.find((b) => b.kind === "text")?.id;
        if (target) void startMutation(target, request);
      },
      onShare: () => setShare(true),
    },
    [courseId, sectionId, outline.data, section, selected, startMutation],
  );

  const pickMode = async (m: Mode) => {
    setMode(m);
    if (m === "original") return setView(null);
    setViewBusy(true);
    try {
      const r = await api<{ blocks: Record<string, string> }>(`/api/courses/${courseId}/sections/${sectionId}/view`, { body: { mode: m } });
      setView(r.blocks);
    } catch (e) {
      toast((e as Error).message);
      setMode("original");
    } finally {
      setViewBusy(false);
    }
  };

  const listen = () => {
    const synth = window.speechSynthesis;
    if (!synth || !section) return;
    if (listening) {
      synth.cancel();
      setListening(null);
      return;
    }
    const texts = section.blocks.filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text");
    const speakFrom = (i: number) => {
      if (i >= texts.length) return setListening(null);
      const b = texts[i];
      const u = new SpeechSynthesisUtterance((view?.[b.id] ?? b.md).replace(/[*_`$]/g, ""));
      u.rate = 1;
      u.onstart = () => setListening(b.id);
      u.onend = () => speakFrom(i + 1);
      u.onerror = () => setListening(null);
      synth.speak(u);
    };
    synth.cancel();
    speakFrom(0);
  };

  if (outline.error || sec.error) {
    return (
      <div className="page">
        <p className="err-text">{(outline.error ?? sec.error)!.message}</p>
        <Link to="/library">Back to library</Link>
      </div>
    );
  }

  const shownSection: Section | undefined =
    mut.stage === "review" ? (mut.showBefore ? mut.before : mut.after) : mut.stage === "saving" ? mut.after : section;
  const blocks = shownSection?.blocks ?? [];
  const selBlock = blocks.find((b) => b.id === selected) ?? section?.blocks.find((b) => b.id === selected);
  const paneCites: Cite[] = selBlock?.cites ?? blocks.find((b) => b.kind === "text")?.cites ?? [];
  const changed = (id: string) => (mut.stage === "review" || mut.stage === "saving" || mut.stage === "kept") && mut.changedIds.includes(id);
  const chapterOf = current?.chapter;
  const chapterSections = (outline.data?.sections ?? []).filter((s) => s.chapter === chapterOf);

  return (
    <div className="reader">
      <nav className="outline-nav" aria-label="Course outline">
        <Link to={`/courses/${courseId}`} className="course-link">
          <img src="/icon.png" alt="" style={{ width: 20, height: "auto" }} />
          <span>{outline.data?.course.title ?? "Course"}</span>
        </Link>
        {groupByChapter(outline.data?.sections ?? []).map(([chapter, list]) => (
          <div key={chapter} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <p className="chapter">{chapter}</p>
            {list.map((s) => (
              <Link key={s.id} to={`/courses/${courseId}/s/${s.id}`} className="outline-item" aria-current={s.id === sectionId ? "page" : undefined}>
                <span className={`dot ${s.id === sectionId ? "dot-current" : s.read ? "dot-done" : s.origin === "adapt" ? "dot-new" : "dot-todo"}`} />
                <span>
                  {numbers.get(s.id) ? `${numbers.get(s.id)} ` : ""}
                  {s.title}
                  {s.origin === "adapt" && !s.read && <span style={{ color: "var(--warning)", fontSize: 12 }}> new</span>}
                </span>
              </Link>
            ))}
          </div>
        ))}
        <button
          type="button"
          className="link-btn"
          style={{ marginTop: "auto", minHeight: 40, padding: "0 10px", textAlign: "left", fontWeight: 600 }}
          onClick={async () => {
            toast("Writing exam-style questions…");
            try {
              const s = await api<{ id: string }>("/api/practice", { body: { courseId, chapter: chapterOf, count: 5 } });
              navigate(`/practice/${s.id}`);
            } catch (e) {
              toast((e as Error).message);
            }
          }}
          disabled={!chapterSections.length}
        >
          Practice this chapter
        </button>
      </nav>

      <main className="reader-main">
        <article className="article">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="small muted">
              {current ? `${numbers.get(current.id) ?? "Review"} · ${current.minutes} min read` : ""}
              {sec.data?.section.overlay ? " · your version" : ""}
            </p>
            <div className="row" style={{ gap: 16 }}>
              <button type="button" className="link-btn" onClick={listen} aria-pressed={Boolean(listening)}>
                <span className="row" style={{ gap: 6 }}>
                  <Speaker color="#0A5CFF" /> {listening ? "Stop" : "Listen"}
                </span>
              </button>
              <Link to={`/courses/${courseId}/history`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>History</Link>
              <button type="button" className="link-btn" onClick={() => setShare(true)}>Share</button>
            </div>
          </div>
          <h1>{shownSection?.title ?? current?.title ?? ""}</h1>

          <div className="row" style={{ gap: 12 }}>
            <span className="small muted">Show as</span>
            <div role="group" aria-label="Show as" style={{ display: "inline-flex", border: "1px solid var(--input)", borderRadius: 8, padding: 2, gap: 2 }}>
              {MODES.map((m) => (
                <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => void pickMode(m.key)} disabled={viewBusy || mut.stage !== "idle"} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "none", font: "500 13px var(--ui)", cursor: "pointer", background: mode === m.key ? "var(--ink)" : "transparent", color: mode === m.key ? "#fff" : "var(--body)" }}>
                  {m.label}
                </button>
              ))}
            </div>
            {viewBusy && <span className="spinner" />}
          </div>

          {(mut.stage === "review" || mut.stage === "kept") && (
            <div className="row small muted" style={{ gap: 10 }}>
              <span>{mut.stage === "review" && mut.showBefore ? "Before the change" : "Changed just now"}</span>
              {mut.stage === "review" && (
                <button type="button" className="link-btn" style={{ fontSize: 13 }} onClick={() => setMut({ ...mut, showBefore: !mut.showBefore })}>
                  {mut.showBefore ? "Show new version" : "Show before"}
                </button>
              )}
            </div>
          )}

          {sec.loading && !section && <p className="muted">Loading…</p>}
          {blocks.map((b, i) => {
            const isSel = selected === b.id;
            const working = mut.stage === "working" && mut.blockId === b.id;
            const showForm = mut.stage === "ask" && mut.blockId === b.id;
            return (
              <div key={`${b.id}-${i}`} className="block" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {b.kind === "text" ? (
                  <p
                    className={`para${isSel ? " selected" : ""}${working ? " working" : ""}${changed(b.id) ? " changed" : ""}`}
                    style={listening === b.id ? { background: "var(--highlight)" } : undefined}
                    onClick={() => {
                      if (mut.stage !== "idle" && mut.stage !== "ask" && mut.stage !== "kept") return;
                      setSelected(b.id);
                      setActiveCite(0);
                    }}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && (setSelected(b.id), setActiveCite(0))}
                    aria-label={isSel ? "Selected paragraph" : undefined}
                  >
                    <Md text={view?.[b.id] ?? b.md} />
                    <CiteMarks cites={b.cites} active={isSel ? activeCite : null} onCite={(n) => { setSelected(b.id); setActiveCite(n); }} />
                    {(mut.stage === "idle" || mut.stage === "kept") && (
                      <span className="block-menu">
                        <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); setSelected(b.id); setMut({ stage: "ask", blockId: b.id, request: "" }); }}>
                          Change this
                        </button>
                      </span>
                    )}
                  </p>
                ) : b.kind === "widget" ? (
                  <div className="block" onClick={() => setSelected(b.id)}>
                    <WidgetCard block={b} sources={sources} widgetsOrigin={config.widgetsOrigin} />
                  </div>
                ) : b.kind === "exercise" ? (
                  <div className="block" onClick={() => setSelected(b.id)}>
                    <ExerciseCard block={b} styleName={b.styleOf ? sources[b.styleOf]?.filename ?? exam?.filename : undefined} />
                  </div>
                ) : (
                  <FigureView block={b} url={sec.data?.figures[b.r2Key]} />
                )}
                {i === 0 && mode !== "original" && view && b.kind === "text" && (
                  <p className="small muted" style={{ marginTop: -8 }}>
                    Rephrased for you. Same sources.{" "}
                    <button type="button" className="link-btn" style={{ fontSize: 13 }} onClick={() => void pickMode("original")}>Show original</button>
                  </p>
                )}
                {showForm && <MutateForm initial={mut.request} onCancel={() => setMut({ stage: "idle" })} onRun={(r) => void startMutation(b.id, r)} />}
                {working && <div className="placeholder-box">{mut.stage === "working" && mut.steps.findIndex((s) => s.status === "active") >= 3 ? "Building the interactive example…" : "Rewriting…"}</div>}
              </div>
            );
          })}

          {mut.stage === "review" && (
            <div className="row" style={{ gap: 12 }}>
              <button type="button" className="btn btn-dark" onClick={() => void decide("keep")}>Keep</button>
              <button type="button" className="btn" onClick={() => void decide("undo")}>Undo</button>
              <button type="button" className="link-btn" onClick={() => void decide("undo", true)}>Try another way</button>
            </div>
          )}
          {mut.stage === "saving" && <p className="small muted">Saving…</p>}
          {mut.stage === "kept" && <p style={{ fontSize: 14, color: "var(--success)" }}>{mut.message}</p>}
        </article>

        <CommandBar />
      </main>

      {mut.stage === "ask" ? (
        <aside className="side-panel" aria-label="What is happening">
          <p style={{ fontSize: 14, fontWeight: 600 }}>Change anything</p>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--body)" }}>Select a paragraph, figure or example, then say what you need. Other things people ask for:</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, fontSize: 14, color: "var(--body)" }}>
            <li>Explain it with an analogy</li>
            <li>Show 3 worked examples</li>
            <li>Turn this into exam questions</li>
            <li>Give me an interactive example</li>
          </ul>
        </aside>
      ) : mut.stage === "working" || mut.stage === "review" || mut.stage === "saving" || mut.stage === "kept" ? (
        <aside className="side-panel" aria-label="What is happening">
          {mut.stage === "working" ? (
            <>
              <p style={{ fontSize: 14, fontWeight: 600 }}>Working on it</p>
              <ol className="trace-list" aria-live="polite">
                {mut.steps.map((s, i) => (
                  <li key={i} style={{ color: s.status === "pending" ? "var(--faint)" : "var(--ink)" }}>
                    <span className="dot" style={s.status === "done" ? { background: "var(--success)" } : s.status === "active" ? { background: "var(--primary)" } : s.status === "failed" ? { background: "var(--warning)" } : { border: "1.5px solid var(--input)" }} />
                    <span>
                      {s.label}
                      {s.status === "failed" && <span className="small warn-text"> · retrying</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, fontWeight: 600 }}>What changed</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, fontSize: 14, color: "var(--body)" }}>
                {mut.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <Link to={`/courses/${courseId}/history`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>Course history</Link>
              {mut.runId && <RunTrace runId={mut.runId} />}
            </>
          )}
          {mut.stage === "kept" && (
            <button type="button" className="link-btn muted" style={{ marginTop: "auto", alignSelf: "flex-start" }} onClick={() => setMut({ stage: "idle" })}>
              Back to sources
            </button>
          )}
        </aside>
      ) : (
        <SourcePane cites={paneCites} active={Math.min(activeCite, Math.max(0, paneCites.length - 1))} onActive={setActiveCite} sources={sources} />
      )}

      {share && outline.data && <ShareDialog courseId={courseId} title={outline.data.course.title} role={outline.data.role} onClose={() => setShare(false)} />}
    </div>
  );
}

function groupByChapter(sections: OutlineSection[]): [string, OutlineSection[]][] {
  const map = new Map<string, OutlineSection[]>();
  for (const s of sections) map.set(s.chapter, [...(map.get(s.chapter) ?? []), s]);
  return [...map.entries()];
}

function MutateForm({ initial, onRun, onCancel }: { initial: string; onRun: (r: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial || "This is too complex. Simplify it and give me an interactive example I can play with.");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      className="mutate-form"
      aria-label="Change this paragraph"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onRun(text.trim());
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <label htmlFor="ask" style={{ fontSize: 13, fontWeight: 500, color: "var(--body)" }}>Change this paragraph</label>
      <textarea ref={ref} id="ask" rows={2} className="textarea" style={{ resize: "none", fontSize: 15 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setText(SUGGESTION_TEXT[s])}>
            {s}
          </button>
        ))}
        <button type="button" className="link-btn muted" style={{ marginLeft: "auto" }} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" style={{ height: 36 }}>Change it</button>
      </div>
    </form>
  );
}

export function RunTrace({ runId }: { runId: string }) {
  const [trace, setTrace] = useState<{ label: string; model?: string }[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !trace) void api<{ trace: { label: string; model?: string }[] }>(`/api/runs/${runId}`).then((r) => setTrace(r.trace)).catch(() => setTrace([]));
  }, [open, trace, runId]);
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 500, color: "var(--primary)" }}>How this was decided</summary>
      <ol style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--body)" }}>
        {(trace ?? []).map((t, i) => (
          <li key={i}>{t.label}</li>
        ))}
        {!trace && open && <li>Loading…</li>}
      </ol>
    </details>
  );
}

