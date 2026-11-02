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
import { Skeleton, Working } from "../components/Working";
import { ShareDialog } from "../components/ShareDialog";
import { Speaker } from "../components/Icons";
import { useConfig } from "../main";
import { utterance } from "../lib/speech";

export type OutlineSection = { id: string; title: string; chapter: string; concept: string; origin: string; read: boolean; minutes: number };
export type CourseResp = {
  course: { id: string; title: string; status: string; owner_id: string; is_demo: number; forked_from: string | null; current_version: number };
  role: "owner" | "follower" | "demo";
  version: number;
  sections: OutlineSection[];
  sources: { id: string; filename: string; kind: string }[];
};
type SectionResp = { section: Section & { overlay: boolean }; sources: Record<string, SourceInfo>; figures: Record<string, string>; role: string };

type Step = { label: string; status: "pending" | "active" | "done" | "failed"; detail?: string };
// a change is saved as soon as it passes verification; Undo puts `before` back
type Change = { blockId: string; request: string; runId: string; summary: string[]; before: Section; after: Section; changedIds: string[] };
type MutState =
  | { stage: "idle" }
  | { stage: "ask"; blockId: string; request: string }
  | { stage: "working"; blockId: string; request: string; runId: string; steps: Step[]; since: number }
  | ({ stage: "saving" } & Change)
  | ({ stage: "kept"; message: string; showBefore: boolean } & Change)
  | ({ stage: "undoing" } & Change);
type RunDone = Extract<RunEvent, { type: "run.done" }>;

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
  const [selected, setSelected] = useState<string | null>(null);
  const [activeCite, setActiveCite] = useState(0);
  const [mut, setMut] = useState<MutState>({ stage: "idle" });
  const [share, setShare] = useState(false);
  const [listening, setListening] = useState<string | null>(null);
  const [listen, setListen] = useState<"off" | "preparing" | "playing" | "paused">("off");
  const listenRef = useRef(listen);
  listenRef.current = listen;
  const listenPos = useRef(0);
  const script = useRef<{ blockId: string; text: string }[]>([]);
  const [micTrigger, setMicTrigger] = useState(0);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const mutRef = useRef(mut);
  mutRef.current = mut;

  const numbers = useMemo(() => numberSections(outline.data?.sections ?? []), [outline.data]);
  const current = outline.data?.sections.find((s) => s.id === sectionId);
  const section = sec.data?.section;
  const sources = sec.data?.sources ?? {};
  const exam = outline.data?.sources.find((s) => s.kind === "exam");
  const reloadSection = sec.reload;
  const reloadOutline = outline.reload;

  // reset per section
  useEffect(() => {
    setSelected(null);
    setMut({ stage: "idle" });
    window.speechSynthesis?.cancel();
    setListening(null);
    setListen("off");
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
        if (typeof e.data !== "string" || !e.data.startsWith("{")) return; // keepalive "pong"
        const ev = JSON.parse(e.data) as RunEvent;
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
      setMut({ stage: "working", blockId, request, runId: "", steps: [], since: Date.now() });
      const result: { done?: RunDone } = {};
      try {
        await streamEvents<RunEvent>(`/api/courses/${courseId}/sections/${sectionId}/mutate`, { blockId, request }, (ev) => {
          if (ev.type === "run.done") result.done = ev;
          setMut((m) => {
            if (m.stage !== "working") return m;
            if (ev.type === "run.start") return { ...m, runId: ev.runId, steps: ev.steps.map((label) => ({ label, status: "pending" })) };
            if (ev.type === "run.step") {
              const s = [...m.steps];
              s[ev.index] = { label: ev.label, status: ev.status, detail: ev.detail };
              for (let i = 0; i < ev.index; i++) if (s[i]?.status === "pending" || s[i]?.status === "active") s[i] = { ...s[i], status: "done" };
              return { ...m, steps: s };
            }
            if (ev.type === "run.waiting") {
              const changedIds = ev.section.blocks.filter((b) => !ev.before.blocks.some((x) => JSON.stringify(x) === JSON.stringify(b))).map((b) => b.id);
              return { stage: "saving", blockId, request, runId: m.runId, summary: ev.summary, after: ev.section, before: ev.before, changedIds };
            }
            return m;
          });
        });
        const done = result.done;
        if (done?.status !== "kept") {
          toast(done?.status === "failed" ? done.message ?? "That change failed" : "Nothing changed. Try asking another way.");
          setMut({ stage: "idle" });
          return;
        }
        await reloadSection();
        void reloadOutline();
        void reloadCourses();
        setMut((m) => (m.stage === "saving" ? { ...m, stage: "kept", message: done.message || "Saved.", showBefore: false } : m));
      } catch (e) {
        const err = e as ApiError;
        toast(err.code === "budget" ? err.message : `Could not change it: ${err.message}`);
        setMut({ stage: "idle" });
      }
    },
    [section, courseId, sectionId, toast, reloadSection, reloadOutline, reloadCourses],
  );

  /** Puts the section back the way it was before the last change; optionally asks again differently. */
  const undoChange = async (retry = false) => {
    const m = mutRef.current;
    if (m.stage !== "kept") return;
    setMut({ ...m, stage: "undoing" });
    try {
      await api(`/api/courses/${courseId}/sections/${sectionId}/edit`, { body: { title: m.before.title, blocks: m.before.blocks, undo: true } });
      await sec.reload();
      void outline.reload();
      setMut({ stage: "idle" });
      if (retry) void startMutation(m.blockId, `${m.request} (Try a different approach from last time.)`);
      else toast("Change undone.");
    } catch (e) {
      toast((e as Error).message);
      setMut(m);
    }
  };

  usePageContext(
    {
      courseId,
      courseTitle: outline.data?.course.title,
      sectionId,
      sectionTitle: current ? `${numbers.get(current.id) ?? ""} ${current.title}`.trim() : undefined,
      onMutate: (request: string) => {
        const stage = mutRef.current.stage;
        if (stage === "working" || stage === "saving" || stage === "undoing") return toast("Still working on the last change. Ask again in a moment.");
        const target = (selected && section?.blocks.some((b) => b.id === selected) ? selected : undefined) ?? section?.blocks.find((b) => b.kind === "text")?.id;
        if (target) void startMutation(target, request);
      },
      onShare: () => setShare(true),
    },
    [courseId, sectionId, outline.data, section, selected, startMutation],
  );

  // Listen: Muse Spark writes the spoken script (maths read aloud properly), the browser voice reads it
  const speakFrom = (i: number, segs: { blockId: string; text: string }[]) => {
    const synth = window.speechSynthesis;
    if (i >= segs.length) {
      setListen("off");
      setListening(null);
      return;
    }
    listenPos.current = i;
    const u = utterance(segs[i].text);
    u.onstart = () => setListening(segs[i].blockId);
    u.onend = () => listenRef.current === "playing" && speakFrom(i + 1, segs);
    u.onerror = () => undefined;
    synth.speak(u);
  };

  const toggleListen = async () => {
    const synth = window.speechSynthesis;
    if (!synth || !section) return;
    if (listen !== "off") {
      listenRef.current = "off";
      synth.cancel();
      setListen("off");
      setListening(null);
      return;
    }
    setListen("preparing");
    let segs: { blockId: string; text: string }[];
    try {
      segs = (await api<{ segments: { blockId: string; text: string }[] }>(`/api/courses/${courseId}/sections/${sectionId}/listen`, { body: {} })).segments;
      if (!segs.length) throw new Error("empty script");
    } catch {
      // the raw text still works if the script cannot be written
      segs = section.blocks.filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text").map((b) => ({ blockId: b.id, text: b.md.replace(/[*_`$]/g, "") }));
    }
    script.current = segs;
    synth.cancel();
    setListen("playing");
    listenRef.current = "playing";
    speakFrom(0, segs);
  };

  const pauseListen = () => {
    listenRef.current = "paused";
    window.speechSynthesis.cancel();
    setListen("paused");
  };
  const resumeListen = () => {
    listenRef.current = "playing";
    setListen("playing");
    window.speechSynthesis.cancel();
    speakFrom(listenPos.current, script.current);
  };
  const askByVoice = () => {
    pauseListen();
    setMicTrigger((n) => n + 1);
  };

  if (outline.error || sec.error) {
    return (
      <div className="page">
        <p className="err-text">{(outline.error ?? sec.error)!.message}</p>
        <Link to="/library">Back to library</Link>
      </div>
    );
  }

  const hasChange = mut.stage === "saving" || mut.stage === "kept" || mut.stage === "undoing";
  const shownSection: Section | undefined = mut.stage === "saving" ? mut.after : mut.stage === "kept" && mut.showBefore ? mut.before : section;
  const blocks = shownSection?.blocks ?? [];
  const selBlock = blocks.find((b) => b.id === selected) ?? section?.blocks.find((b) => b.id === selected);
  const paneCites: Cite[] = selBlock?.cites ?? blocks.find((b) => b.kind === "text")?.cites ?? [];
  // Undo sits right under the change (the last changed block)
  const changedIds = hasChange ? mut.changedIds : [];
  const decisionAnchor = [...blocks].reverse().find((b) => changedIds.includes(b.id))?.id ?? (hasChange ? mut.blockId : undefined);
  const Decision = () =>
    mut.stage === "saving" ? (
      <p className="small muted">Saving…</p>
    ) : mut.stage === "undoing" ? (
      <p className="small muted">Undoing…</p>
    ) : mut.stage === "kept" ? (
      <div className="row" style={{ gap: 12 }}>
        <span style={{ fontSize: 14, color: "var(--success)" }}>{mut.message}</span>
        <button type="button" className="btn" onClick={() => void undoChange()}>Undo</button>
        <button type="button" className="link-btn" onClick={() => void undoChange(true)}>Try another way</button>
      </div>
    ) : null;
  const changed = (id: string) => !(mut.stage === "kept" && mut.showBefore) && changedIds.includes(id);
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
            setPracticeBusy(true);
            try {
              const s = await api<{ id: string }>("/api/practice", { body: { courseId, chapter: chapterOf, count: 5 } });
              navigate(`/practice/${s.id}`);
            } catch (e) {
              toast((e as Error).message);
              setPracticeBusy(false);
            }
          }}
          disabled={!chapterSections.length || practiceBusy}
          aria-busy={practiceBusy}
        >
          {practiceBusy ? (
            <span className="row" style={{ gap: 8 }}><span className="spinner" />Opening practice…</span>
          ) : (
            "Practice this chapter"
          )}
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
              <button type="button" className="link-btn" onClick={() => void toggleListen()} aria-pressed={listen !== "off"} disabled={listen === "preparing"}>
                <span className="row" style={{ gap: 6 }}>
                  {listen === "preparing" ? <span className="spinner" /> : <Speaker color="#0A5CFF" />} {listen === "preparing" ? "Preparing narration" : listen === "off" ? "Listen" : "Stop"}
                </span>
              </button>
              <Link to={`/courses/${courseId}/history`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>History</Link>
              <button type="button" className="link-btn" onClick={() => setShare(true)}>Share</button>
            </div>
          </div>
          <h1>{shownSection?.title ?? current?.title ?? ""}</h1>
          {(listen === "playing" || listen === "paused") && (
            <div className="listen-bar" role="group" aria-label="Listen controls">
              <span className="small muted">{listen === "playing" ? "Reading aloud · script by Muse Spark" : "Paused"}</span>
              {listen === "playing" ? <button type="button" className="btn btn-sm" onClick={pauseListen}>Pause</button> : <button type="button" className="btn btn-sm" onClick={resumeListen}>Resume</button>}
              <button type="button" className="btn btn-sm btn-primary" onClick={askByVoice}>Ask by voice</button>
            </div>
          )}

          {mut.stage === "kept" && (
            <div className="row small muted" style={{ gap: 10 }}>
              <span>{mut.showBefore ? "Before the change" : "Changed just now"}</span>
              <button type="button" className="link-btn" style={{ fontSize: 13 }} onClick={() => setMut({ ...mut, showBefore: !mut.showBefore })}>
                {mut.showBefore ? "Show new version" : "Show before"}
              </button>
            </div>
          )}

          {sec.loading && !section && <Skeleton title lines={6} />}
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
                    <Md text={b.md} />
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
                {showForm && <MutateForm initial={mut.request} onCancel={() => setMut({ stage: "idle" })} onRun={(r) => void startMutation(b.id, r)} />}
                {working && mut.stage === "working" && (
                  <Working
                    className="mutate-working"
                    label={mut.steps.find((s) => s.status === "active")?.label ?? "Understanding your request"}
                    since={mut.since}
                    usually={/example|widget|interactive/i.test(mut.request) ? "45 s" : "20 s"}
                  />
                )}
                {b.id === decisionAnchor && <Decision />}
              </div>
            );
          })}
          {!decisionAnchor && <Decision />}
        </article>

        <CommandBar micTrigger={micTrigger} speakAnswers={listen !== "off"} onAnswered={() => listenRef.current === "paused" && resumeListen()} />
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
      ) : mut.stage === "working" || hasChange ? (
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

