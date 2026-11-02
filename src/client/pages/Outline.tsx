import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ShareDialog } from "../components/ShareDialog";
import { api } from "../lib/api";
import { formatDate, useApi, usePoll } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";
import { numberSections, type CourseResp, type OutlineSection } from "./Course";

type Resp = CourseResp & { ownChanges?: { label: string; updated_at: number }[]; changes: { version: number; kind: string; summary: string; created_at: number; author_id: string }[]; course: CourseResp["course"] & { progress: string | null; description: string | null } };

export function OutlinePage() {
  const { courseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast, reloadCourses } = useApp();
  const r = useApi<Resp>(`/api/courses/${courseId}`);
  const [share, setShare] = useState(params.get("share") === "1");
  const [practiceBusy, setPracticeBusy] = useState(false);
  const building = r.data?.course.status === "building";
  usePoll(() => {
    void r.reload();
    if (!building) void reloadCourses();
  }, building, 3000);
  usePageContext({ courseId, courseTitle: r.data?.course.title, onShare: () => setShare(true) }, [courseId, r.data]);

  if (r.error) return <Shell><p className="err-text">{r.error.message}</p></Shell>;
  const d = r.data;
  if (!d) return <Shell><p className="muted">Loading…</p></Shell>;

  if (d.course.status !== "ready") {
    return (
      <Shell>
        <h1 className="page-title">{d.course.title}</h1>
        {d.course.status === "building" ? (
          <div className="card" style={{ maxWidth: 560 }}>
            <div className="row"><span className="spinner" /><strong>Building your course</strong></div>
            <p className="muted">{d.course.progress ?? "Starting"}. Every sentence is checked against its source before it is shown.</p>
          </div>
        ) : (
          <div className="callout callout-warn" style={{ maxWidth: 560 }}>
            <strong>The build failed</strong>
            <p className="small">{d.course.progress}</p>
          </div>
        )}
      </Shell>
    );
  }

  const numbers = numberSections(d.sections);
  const chapters = new Map<string, OutlineSection[]>();
  for (const s of d.sections) chapters.set(s.chapter, [...(chapters.get(s.chapter) ?? []), s]);
  const next = d.sections.find((s) => !s.read) ?? d.sections[0];
  const chapterIdx = [...chapters.keys()].indexOf(next?.chapter ?? "") + 1;
  const isCopy = d.role === "owner" && d.course.forked_from;

  const practice = async () => {
    setPracticeBusy(true);
    try {
      const s = await api<{ id: string }>("/api/practice", { body: { courseId, chapter: next?.chapter, count: 5 } });
      navigate(`/practice/${s.id}`);
    } catch (e) {
      toast((e as Error).message);
      setPracticeBusy(false);
    }
  };

  return (
    <Shell>
      <div className="row" style={{ alignItems: "flex-start", gap: 40 }}>
        <div style={{ flex: "1 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 className="page-title">{d.course.title}</h1>
            <p className="small muted">
              {d.sources.length} source{d.sources.length === 1 ? "" : "s"} · {d.sections.length} sections · chapter {chapterIdx} of {chapters.size}
              {d.role === "demo" ? " · sample course" : d.role === "follower" ? " · following" : isCopy ? " · your copy" : ""}
            </p>
          </div>
          <div className="row">
            {next && <Link to={`/courses/${courseId}/s/${next.id}`} className="btn btn-primary">{next.read ? "Start" : "Continue"} {numbers.get(next.id) ?? ""} {next.title}</Link>}
            <button type="button" className="btn" onClick={() => void practice()} disabled={practiceBusy} aria-busy={practiceBusy}>
              {practiceBusy ? <><span className="spinner" /> Writing questions…</> : "Practice"}
            </button>
            {d.role === "owner" && next && <Link to={`/courses/${courseId}/s/${next.id}/edit`} className="btn">Edit</Link>}
            <button type="button" className="btn" onClick={() => setShare(true)}>Share</button>
            {(isCopy || d.role === "follower") && <Link to={`/courses/${courseId}/updates`} className="btn">Updates</Link>}
          </div>
          {[...chapters.entries()].map(([chapter, list], ci) => {
            const done = list.every((s) => s.read);
            const started = list.some((s) => s.read);
            return (
              <section key={chapter} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 600 }}>{ci + 1} · {chapter}</h2>
                  <span className="small" style={{ color: done ? "var(--success)" : started ? "#0047CC" : "var(--muted)" }}>{done ? "Done" : started ? "In progress" : "Not started"}</span>
                </div>
                {list.map((s) => (
                  <Link key={s.id} to={`/courses/${courseId}/s/${s.id}`} className="outline-item" style={{ fontSize: 15, minHeight: 44, border: "1px solid var(--row)", borderRadius: 8 }}>
                    <span className={`dot ${s.read ? "dot-done" : s.origin === "adapt" ? "dot-new" : "dot-todo"}`} />
                    <span style={{ minWidth: 32, color: "var(--muted)" }}>{numbers.get(s.id) ?? ""}</span>
                    <span style={{ flex: 1 }}>
                      {s.title}
                      {s.origin === "adapt" && <span style={{ color: "var(--warning)", fontSize: 12 }}> added for you</span>}
                    </span>
                    <span className="small muted">{s.minutes} min</span>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
        <aside aria-label="Recent changes" style={{ flex: "1 1 240px", maxWidth: 300, display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <h2 className="section-title">Recent changes</h2>
          {(d.ownChanges ?? []).map((o) => (
            <div key={o.label} style={{ fontSize: 14, lineHeight: 1.5, color: "var(--body)" }}>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>{o.label}</span>
              <br />
              <span className="small muted">Your change · {formatDate(o.updated_at)}</span>
            </div>
          ))}
          {d.changes.length === 0 && !d.ownChanges?.length && <p className="small muted">No changes yet. Select any paragraph in a section and say what you need.</p>}
          {d.changes.map((c) => (
            <div key={c.version} style={{ fontSize: 14, lineHeight: 1.5, color: "var(--body)" }}>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>{c.summary}</span>
              <br />
              <span className="small muted">Version {c.version} · {formatDate(c.created_at)}</span>
            </div>
          ))}
          <Link to={`/courses/${courseId}/history`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>See full history</Link>
          {d.course.description && <p className="small muted" style={{ lineHeight: 1.5, marginTop: 12 }}>{d.course.description}</p>}
        </aside>
      </div>
      {share && (
        <ShareDialog
          courseId={courseId}
          title={d.course.title}
          role={d.role}
          onClose={() => {
            setShare(false);
            if (params.get("share")) setParams({});
          }}
        />
      )}
    </Shell>
  );
}
