import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { RunEvent } from "@shared/types";
import { Shell } from "../components/Shell";
import { Md } from "../components/Md";
import { api, streamEvents } from "../lib/api";
import { formatDate, useApi } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";
import { examLabel, stripQuestionNumber } from "../lib/format";
import { initialResponse, isComplete, QuestionInput, type QView } from "../components/Question";
import { PageSkeleton, Skeleton, Working } from "../components/Working";

type Q = QView & { ord: number; answer: string | null; concept: string; section_id: string | null; cites: { sourceId: string; page?: number }[] };
type Attempt = { id: string; question_id: string; answer: string; correct: number; feedback: string };
type Resp = { session: { id: string; course_id: string; chapter: string | null; status: string }; courseTitle: string; examName: string | null; questions: Q[]; attempts: Attempt[]; pending: string[] };
type Grade = { attemptId: string; correct: boolean; score: number; feedback: string; reveal?: string; parts?: boolean[]; gradedBy: "code" | "model"; answer: string; solution: unknown; cites: { sourceId: string; page?: number }[] };
type Replan = { status: "running" | "waiting" | "kept" | "undone" | "done" | "failed"; runId: string; steps: { label: string; status: string }[]; message: string };

export function PracticeHome() {
  const { courses, toast } = useApp();
  const navigate = useNavigate();
  const list = useApi<{ items: { id: string; course_title: string; chapter: string | null; status: string; questions: number; correct: number; created_at: number }[] }>("/api/practice");
  const [busy, setBusy] = useState<string | null>(null);
  usePageContext({}, []);
  return (
    <Shell>
      <h1 className="page-title">Practice</h1>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="section-title">Start a round</h2>
        <div className="row">
          {courses.filter((c) => c.status === "ready").map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(c.id);
                try {
                  const s = await api<{ id: string }>("/api/practice", { body: { courseId: c.id, count: 5 } });
                  navigate(`/practice/${s.id}`);
                } catch (e) {
                  toast((e as Error).message);
                  setBusy(null);
                }
              }}
            >
              {busy === c.id ? "Opening…" : c.title}
            </button>
          ))}
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="section-title">Recent rounds</h2>
        <table className="table">
          <thead>
            <tr><th>Course</th><th>Score</th><th>When</th><th /></tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.course_title}{p.chapter ? ` · ${p.chapter}` : ""}</td>
                <td>{p.correct} of {p.questions}</td>
                <td>{formatDate(p.created_at)}</td>
                <td><Link to={p.status === "finished" ? `/practice/${p.id}/results` : `/practice/${p.id}`}>{p.status === "finished" ? "Results" : "Continue"}</Link></td>
              </tr>
            ))}
            {list.data && !list.data.items.length && <tr><td colSpan={4} className="muted">No practice yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}

export function PracticePage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const r = useApi<Resp>(`/api/practice/${sessionId}`);
  const [idx, setIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [confidence, setConfidence] = useState<"guess" | "unsure" | "sure" | null>(null);
  const [gradingSince, setGradingSince] = useState<number | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [replan, setReplan] = useState<Replan | null>(null);
  const [writeSince, setWriteSince] = useState<number | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writing = useRef(false);
  usePageContext({ courseId: r.data?.session.course_id, courseTitle: r.data?.courseTitle }, [r.data]);
  const setData = r.setData;

  // resume at the first unanswered question
  useEffect(() => {
    if (!r.data) return;
    const done = new Set(r.data.attempts.map((a) => a.question_id));
    const first = r.data.questions.findIndex((q) => !done.has(q.id));
    setIdx(first < 0 ? (r.data.pending.length ? r.data.questions.length : Math.max(0, r.data.questions.length - 1)) : first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.data?.session.id]);

  // questions are written while the student answers: the first in a few seconds, then the rest
  const pendingCount = r.data?.pending.length ?? 0;
  useEffect(() => {
    if (!pendingCount || writing.current || writeError) return;
    writing.current = true;
    setWriteSince(Date.now());
    void (async () => {
      try {
        for (let round = 0; round < 8; round++) {
          const res = await api<{ done: boolean; busy?: boolean; added: number }>(`/api/practice/${sessionId}/write`, { body: {} });
          if (res.busy) await new Promise((ok) => setTimeout(ok, 3000));
          const fresh = await api<Resp>(`/api/practice/${sessionId}`);
          setData(fresh);
          if (res.done || !fresh.pending.length) break;
          setWriteSince(Date.now());
        }
      } catch (e) {
        setWriteError((e as Error).message);
      } finally {
        writing.current = false;
        setWriteSince(null);
      }
    })();
  }, [pendingCount, sessionId, setData, writeError]);

  if (r.error) return <Shell><p className="err-text">{r.error.message}</p></Shell>;
  const d = r.data;
  if (!d) return <Shell><PageSkeleton /></Shell>;
  const raw = d.questions[idx];
  const q: Q | undefined = raw && { ...raw, solution: grade?.solution ?? raw.solution };
  const total = d.questions.length + d.pending.length;
  const examName = d.examName ? examLabel(d.examName) : undefined;
  const response = q ? (q.id in responses ? responses[q.id] : initialResponse(q)) : null;
  const modelGraded = q ? ["short", "worked", "justify", "teach_back"].includes(q.type) : false;
  const attempted = new Map(d.attempts.map((a) => [a.question_id, a]));

  const submit = async () => {
    if (!q) return;
    setGradingSince(Date.now());
    try {
      const body = modelGraded
        ? { questionId: q.id, answer: (response as { text?: string })?.text ?? "", confidence: confidence ?? undefined }
        : { questionId: q.id, response, confidence: confidence ?? undefined };
      const g = await api<Grade>(`/api/practice/${sessionId}/answer`, { body });
      setGrade(g);
      setData((cur) => (cur ? { ...cur, attempts: [...cur.attempts, { id: g.attemptId, question_id: q.id, answer: "", correct: g.correct ? 1 : 0, feedback: g.feedback }] } : cur));
      // small slips on multi-part questions do not re-plan the course
      if (!g.correct && g.score < 0.5) void adapt(g.attemptId);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setGradingSince(null);
    }
  };

  const adapt = async (attemptId: string) => {
    setReplan({ status: "running", runId: "", steps: [], message: "" });
    try {
      await streamEvents<RunEvent>(`/api/practice/${sessionId}/adapt`, { attemptId }, (ev) => {
        setReplan((cur) => {
          if (!cur) return cur;
          if (ev.type === "run.start") return { ...cur, runId: ev.runId, steps: ev.steps.map((label) => ({ label, status: "pending" })) };
          if (ev.type === "run.step") {
            const steps = [...cur.steps];
            steps[ev.index] = { label: ev.label, status: ev.status };
            return { ...cur, steps };
          }
          if (ev.type === "run.waiting") return { ...cur, status: "waiting", message: ev.summary[0] ?? "" };
          if (ev.type === "run.done") return { ...cur, status: ev.status === "failed" ? "failed" : ev.status === "done" ? "done" : cur.status, message: ev.message ?? cur.message };
          return cur;
        });
      });
    } catch (e) {
      setReplan({ status: "failed", runId: "", steps: [], message: (e as Error).message });
    }
  };

  const decide = async (decision: "keep" | "undo") => {
    if (!replan?.runId) return;
    setReplan({ ...replan, status: "running" });
    try {
      await streamEvents<RunEvent>(`/api/runs/${replan.runId}/resume`, { decision }, () => {});
      setReplan({ ...replan, status: decision === "keep" ? "kept" : "undone" });
      if (decision === "keep") toast("Your course was updated");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const next = async () => {
    setGrade(null);
    setConfidence(null);
    setShowSolution(false);
    setReplan(null);
    if (idx + 1 < total) setIdx(idx + 1);
    else {
      await api(`/api/practice/${sessionId}/finish`, { body: {} });
      navigate(`/practice/${sessionId}/results`);
    }
  };

  const similar = async () => {
    if (!q) return;
    const since = Date.now();
    toast("Writing a similar question…");
    try {
      await api(`/api/practice/${sessionId}/similar`, { body: { questionId: q.id } });
      setData(await api<Resp>(`/api/practice/${sessionId}`));
      toast(`Added a similar question at the end (${Math.round((Date.now() - since) / 1000)} s)`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const firstCite = grade?.cites?.[0];
  const locked = Boolean(grade) || gradingSince !== null;
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ height: 64, display: "flex", alignItems: "center", gap: 16, padding: "0 32px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <Link to={q?.section_id ? `/courses/${d.session.course_id}/s/${q.section_id}` : `/courses/${d.session.course_id}`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>Back to the course</Link>
        <span className="small muted">Practice · {d.courseTitle}</span>
        <span className="small muted" style={{ marginLeft: "auto" }}>{Math.min(idx + 1, total)} / {total}</span>
      </header>
      <div style={{ flex: 1, display: "flex", flexWrap: "wrap" }}>
        <main style={{ flex: "999 1 560px", padding: "40px 48px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", gap: 20 }}>
            {!q ? (
              <section className="skel-card" aria-busy="true">
                <p className="q-type">{d.pending[idx - d.questions.length] ?? d.pending[0] ?? "Question"}</p>
                {writeError ? (
                  <>
                    <p className="err-text small">Could not write this question: {writeError}</p>
                    <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setWriteError(null)}>Try again</button>
                  </>
                ) : (
                  <>
                    <Working label={d.questions.length ? `Writing question ${d.questions.length + 1} of ${total}` : "Writing your first question from your sources"} since={writeSince ?? Date.now()} usually={d.questions.length ? "30 s" : "10 s"} />
                    <Skeleton title lines={3} />
                  </>
                )}
              </section>
            ) : (
              <>
                <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <p className="small muted">
                    <span className="q-type">{q.typeLabel}</span> · Question {idx + 1}{examName ? ` · in the style of ${examName}` : ""}
                  </p>
                  <div className="serif" style={{ fontSize: 22, lineHeight: 1.5 }}><Md text={stripQuestionNumber(q.prompt)} /></div>
                </section>
                <form
                  style={{ display: "flex", flexDirection: "column", gap: 16 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (isComplete(q, response) && !locked) void submit();
                  }}
                >
                  <QuestionInput key={q.id} q={q} value={response} onChange={(v) => setResponses((m) => ({ ...m, [q.id]: v }))} locked={locked || attempted.has(q.id)} marking={grade ? { parts: grade.parts } : null} />
                  {!grade && !attempted.has(q.id) && (
                    <>
                      <div className="confidence" role="radiogroup" aria-label="How sure are you?">
                        <span>How sure are you?</span>
                        {(["guess", "unsure", "sure"] as const).map((c) => (
                          <button key={c} type="button" className="chip" aria-pressed={confidence === c} onClick={() => setConfidence(confidence === c ? null : c)}>
                            {c === "guess" ? "Guessing" : c === "unsure" ? "Fairly sure" : "Sure"}
                          </button>
                        ))}
                      </div>
                      {gradingSince !== null ? (
                        <Working label={modelGraded ? `Muse Spark is marking your working${examName ? ` against ${examName}` : ""}` : "Checking"} since={gradingSince} usually={modelGraded ? "10 s" : undefined} />
                      ) : (
                        <div className="row">
                          <button type="submit" className="btn btn-primary" disabled={!isComplete(q, response)}>Check answer</button>
                          <button type="button" className="link-btn muted" onClick={() => void next()}>Skip</button>
                        </div>
                      )}
                    </>
                  )}
                </form>
                {attempted.has(q.id) && !grade && (
                  <section className="callout">
                    <p className="small muted">You answered this already: {attempted.get(q.id)!.feedback}</p>
                    <button type="button" className="btn btn-sm btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => void next()}>{idx + 1 < total ? "Next question" : "See results"}</button>
                  </section>
                )}
                {grade && (
                  <>
                    <section className={`callout ${grade.correct ? "callout-ok" : "callout-warn"}`}>
                      <p style={{ fontWeight: 600, color: grade.correct ? "var(--success)" : "var(--warning)" }}>
                        {grade.correct ? "Correct" : grade.score > 0 ? `Partly right · ${Math.round(grade.score * 100)}%` : "Not quite"}
                        <span className="small muted" style={{ fontWeight: 400 }}> · {grade.gradedBy === "code" ? "checked instantly" : "marked by Muse Spark"}</span>
                      </p>
                      <p style={{ fontSize: 15, lineHeight: 1.55 }}>
                        <Md text={grade.feedback} />{" "}
                        {firstCite && q.section_id && <Link to={`/courses/${d.session.course_id}/s/${q.section_id}`}>See the section</Link>}
                      </p>
                      {grade.reveal && !grade.correct && grade.gradedBy === "code" && <p className="small" style={{ whiteSpace: "pre-line" }}><strong>Answer:</strong> <Md text={grade.reveal} /></p>}
                      {showSolution && <div className="serif" style={{ fontSize: 17, lineHeight: 1.55 }}><Md text={grade.answer} /></div>}
                      <div className="row">
                        {!grade.correct && <button type="button" className="btn btn-sm" onClick={() => void similar()}>Try a similar question</button>}
                        <button type="button" className="btn btn-sm" onClick={() => setShowSolution(!showSolution)}>{showSolution ? "Hide full solution" : "Show full solution"}</button>
                        <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => void next()}>{idx + 1 < total ? "Next question" : "See results"}</button>
                      </div>
                    </section>
                    {replan && (replan.status === "waiting" || replan.status === "kept" || replan.status === "undone" || replan.status === "done") && replan.message && (
                      <section aria-label="Course updated" className="callout callout-blue">
                        <p style={{ fontWeight: 600 }}>{replan.status === "done" ? "Your course already covers this" : "We adjusted your course"}</p>
                        <p style={{ fontSize: 15, lineHeight: 1.55 }}>{replan.message}</p>
                        {replan.status === "waiting" && (
                          <div className="row">
                            <button type="button" className="btn btn-dark btn-sm" onClick={() => void decide("keep")}>Keep</button>
                            <button type="button" className="btn btn-sm" onClick={() => void decide("undo")}>Undo</button>
                          </div>
                        )}
                        {replan.status === "kept" && <p className="small ok-text">Saved. You will see it in your outline.</p>}
                        {replan.status === "undone" && <p className="small muted">Undone. Your course is unchanged.</p>}
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </main>
        <aside aria-label="This round" className="side-panel">
          <p style={{ fontSize: 14, fontWeight: 600 }}>This round</p>
          <ol className="trace-list">
            {d.questions.map((qq, i) => {
              const a = attempted.get(qq.id);
              return (
                <li key={qq.id} style={{ color: i === idx ? "var(--ink)" : "var(--body)", fontWeight: i === idx ? 600 : 400 }}>
                  <span className="dot" style={a ? { background: a.correct ? "var(--success)" : "var(--warning)" } : i === idx ? { background: "var(--primary)" } : { border: "1.5px solid var(--input)" }} />
                  {qq.typeLabel}
                </li>
              );
            })}
            {d.pending.map((label, i) => (
              <li key={`p${i}`} style={{ color: "var(--faint)" }}>
                {i === 0 && writeSince ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <span className="dot" style={{ border: "1.5px dashed var(--input)" }} />}
                {label}{i === 0 && writeSince ? " · writing" : ""}
              </li>
            ))}
          </ol>
          {replan && (
            <>
              <p style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>How this was decided</p>
              <ol className="trace-list">
                {replan.steps.map((s, i) => (
                  <li key={i} style={{ color: s.status === "pending" ? "var(--faint)" : "var(--ink)" }}>
                    <span className="dot" style={s.status === "done" ? { background: "var(--success)" } : s.status === "active" ? { background: "var(--primary)" } : { border: "1.5px solid var(--input)" }} />
                    {s.label}
                  </li>
                ))}
                {replan.status === "failed" && <li className="err-text small">{replan.message}</li>}
              </ol>
            </>
          )}
          <p className="small muted" style={{ marginTop: "auto" }}>
            {replan ? "muse-spark-1.3 · muse-wonder-1.0" : "Most types are checked in code the moment you answer. Exam questions are marked by Muse Spark. A wrong answer re-plans your course path."}
          </p>
        </aside>
      </div>
    </div>
  );
}

export function ResultsPage() {
  const { sessionId = "" } = useParams();
  const { toast } = useApp();
  const navigate = useNavigate();
  const r = useApi<{ session: { course_id: string; chapter: string | null }; courseTitle: string; examName: string | null; minutes: number; items: { id: string; ord: number; prompt: string; concept: string; correct: number | null; feedback: string | null }[]; replan: { status: string; trace: { label: string }[] } | null }>(`/api/practice/${sessionId}/results`);
  const d = r.data;
  if (!d) return <Shell><PageSkeleton /></Shell>;
  const correct = d.items.filter((i) => i.correct === 1).length;
  const retry = async () => {
    try {
      const s = await api<{ id: string }>("/api/practice", { body: { courseId: d.session.course_id, chapter: d.session.chapter ?? undefined, count: 5 } });
      navigate(`/practice/${s.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ height: 64, display: "flex", alignItems: "center", gap: 16, padding: "0 32px", borderBottom: "1px solid var(--border)" }}>
        <Link to={`/courses/${d.session.course_id}`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>{d.courseTitle}</Link>
        <span className="small muted">Practice results</span>
      </header>
      <main style={{ display: "flex", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 600 }}>{correct} of {d.items.length} correct</h1>
            <p className="muted">{d.session.chapter ?? "Whole course"}{d.examName ? ` · in the style of ${examLabel(d.examName)}` : ""} · {d.minutes} minutes</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {d.items.map((it, i) => (
              <div key={it.id} className="row" style={{ padding: "14px 0", borderBottom: "1px solid var(--row)", flexWrap: "nowrap", alignItems: "flex-start" }}>
                <span className="muted" style={{ width: 24 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 15 }}>{(() => { const p = stripQuestionNumber(it.prompt); return p.length > 110 ? `${p.slice(0, 110)}…` : p; })()}</span>
                  {it.correct === 0 && it.feedback && <p className="small muted">{it.feedback}</p>}
                </div>
                <span className="small" style={{ color: it.correct === 1 ? "var(--success)" : it.correct === 0 ? "var(--warning)" : "var(--muted)", whiteSpace: "nowrap" }}>{it.correct === 1 ? "Correct" : it.correct === 0 ? "Not quite" : "Skipped"}</span>
              </div>
            ))}
          </div>
          {d.replan && (
            <section className="callout callout-blue">
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>What we changed</h2>
              <p style={{ fontSize: 15 }}>{d.replan.status === "kept" ? d.replan.trace.filter((t) => /Added|Saved|Re-planned|Diagnosed/.test(t.label)).map((t) => t.label).join(". ") : d.replan.status === "undone" ? "You chose to keep your course as it was." : "Nothing yet."}</p>
              <Link to={`/courses/${d.session.course_id}/history`}>See changes</Link>
            </section>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void retry()}>Practice again</button>
            <Link to={`/courses/${d.session.course_id}`} className="btn">Back to course</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
