import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { RunEvent } from "@shared/types";
import { Shell } from "../components/Shell";
import { Md } from "../components/Md";
import { api, streamEvents } from "../lib/api";
import { formatDate, useApi } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";

type Q = { id: string; ord: number; prompt: string; answer: string | null; concept: string; section_id: string | null; cites: { sourceId: string; page?: number }[] };
type Attempt = { id: string; question_id: string; answer: string; correct: number; feedback: string };
type Resp = { session: { id: string; course_id: string; chapter: string | null; status: string }; courseTitle: string; examName: string | null; questions: Q[]; attempts: Attempt[] };
type Grade = { attemptId: string; correct: boolean; score: number; feedback: string; answer: string; cites: { sourceId: string; page?: number }[] };
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
              {busy === c.id ? "Writing questions…" : c.title}
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
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [replan, setReplan] = useState<Replan | null>(null);
  usePageContext({ courseId: r.data?.session.course_id, courseTitle: r.data?.courseTitle }, [r.data]);

  // resume at the first unanswered question
  useEffect(() => {
    if (!r.data) return;
    const done = new Set(r.data.attempts.map((a) => a.question_id));
    const first = r.data.questions.findIndex((q) => !done.has(q.id));
    setIdx(first < 0 ? Math.max(0, r.data.questions.length - 1) : first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.data?.session.id]);

  if (r.error) return <Shell><p className="err-text">{r.error.message}</p></Shell>;
  const d = r.data;
  if (!d) return <Shell><p className="muted">Loading…</p></Shell>;
  const q = d.questions[idx];
  const total = d.questions.length;
  const examName = d.examName?.replace(/\.pdf$/i, "");

  const submit = async () => {
    setGrading(true);
    try {
      const g = await api<Grade>(`/api/practice/${sessionId}/answer`, { body: { questionId: q.id, answer } });
      setGrade(g);
      if (!g.correct) void adapt(g.attemptId);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setGrading(false);
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
    setAnswer("");
    setShowSolution(false);
    setReplan(null);
    if (idx + 1 < total) setIdx(idx + 1);
    else {
      await api(`/api/practice/${sessionId}/finish`, { body: {} });
      navigate(`/practice/${sessionId}/results`);
    }
  };

  const similar = async () => {
    try {
      await api(`/api/practice/${sessionId}/similar`, { body: { questionId: q.id } });
      await r.reload();
      toast("Added a similar question at the end");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const firstCite = grade?.cites?.[0];
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ height: 64, display: "flex", alignItems: "center", gap: 16, padding: "0 32px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <Link to={q?.section_id ? `/courses/${d.session.course_id}/s/${q.section_id}` : `/courses/${d.session.course_id}`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>Back to the course</Link>
        <span className="small muted">Practice · {d.courseTitle}</span>
        <span className="small muted" style={{ marginLeft: "auto" }}>{idx + 1} / {total}</span>
      </header>
      <div style={{ flex: 1, display: "flex", flexWrap: "wrap" }}>
        <main style={{ flex: "999 1 560px", padding: "40px 48px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", gap: 20 }}>
            {q && (
              <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p className="small muted">Question {idx + 1}{examName ? ` · in the style of ${examName}` : ""}</p>
                <p className="serif" style={{ fontSize: 22, lineHeight: 1.5 }}><Md text={q.prompt} /></p>
              </section>
            )}
            {!grade ? (
              <form
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (answer.trim()) void submit();
                }}
              >
                <label htmlFor="answer" className="label">Your answer</label>
                <textarea id="answer" className="textarea serif" rows={6} style={{ fontSize: 18 }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Write your working as you would on the exam" />
                <div className="row">
                  <button type="submit" className="btn btn-primary" disabled={!answer.trim() || grading}>{grading ? "Grading…" : "Check answer"}</button>
                  <button type="button" className="link-btn muted" onClick={() => void next()}>Skip</button>
                </div>
              </form>
            ) : (
              <>
                <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <p className="label-caps">Your answer</p>
                  <p className="serif" style={{ fontSize: 18, lineHeight: 1.55, whiteSpace: "pre-wrap", color: "var(--body)" }}>{answer}</p>
                </section>
                <section className={`callout ${grade.correct ? "callout-ok" : "callout-warn"}`}>
                  <p style={{ fontWeight: 600, color: grade.correct ? "var(--success)" : "var(--warning)" }}>{grade.correct ? "Correct" : "Not quite"}</p>
                  <p style={{ fontSize: 15, lineHeight: 1.55 }}>
                    {grade.feedback}{" "}
                    {firstCite && q.section_id && <Link to={`/courses/${d.session.course_id}/s/${q.section_id}`}>See the section</Link>}
                  </p>
                  {showSolution && <p className="serif" style={{ fontSize: 17, lineHeight: 1.55 }}><Md text={grade.answer} /></p>}
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
          </div>
        </main>
        <aside aria-label="How this was decided" className="side-panel">
          <p style={{ fontSize: 14, fontWeight: 600 }}>How this was decided</p>
          {!replan && <p className="small muted">{grade ? (grade.correct ? "Graded against the exam's marking pattern." : "") : "Answer the question. A wrong answer re-plans your course path."}</p>}
          {replan && (
            <ol className="trace-list">
              {replan.steps.map((s, i) => (
                <li key={i} style={{ color: s.status === "pending" ? "var(--faint)" : "var(--ink)" }}>
                  <span className="dot" style={s.status === "done" ? { background: "var(--success)" } : s.status === "active" ? { background: "var(--primary)" } : { border: "1.5px solid var(--input)" }} />
                  {s.label}
                </li>
              ))}
              {replan.status === "failed" && <li className="err-text small">{replan.message}</li>}
            </ol>
          )}
          {replan && <p className="small muted" style={{ marginTop: "auto" }}>muse-spark-1.3 · muse-wonder-1.0 · open-weight verifier</p>}
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
  if (!d) return <Shell><p className="muted">Loading…</p></Shell>;
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
            <p className="muted">{d.session.chapter ?? "Whole course"}{d.examName ? ` · in the style of ${d.examName.replace(/\.pdf$/i, "")}` : ""} · {d.minutes} minutes</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {d.items.map((it, i) => (
              <div key={it.id} className="row" style={{ padding: "14px 0", borderBottom: "1px solid var(--row)", flexWrap: "nowrap", alignItems: "flex-start" }}>
                <span className="muted" style={{ width: 24 }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 15 }}>{it.prompt.length > 110 ? `${it.prompt.slice(0, 110)}…` : it.prompt}</span>
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
