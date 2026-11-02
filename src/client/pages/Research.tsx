import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useApi, usePoll } from "../lib/hooks";
import { usePageContext } from "../lib/app";

type Report = { md: string; sources: { n: number; label: string; origin: "library" | "web"; url?: string }[]; libraryCount: number; webCount: number; error?: string };
type Resp = { id: string; question: string; status: string; course_id: string | null; report: Report | null };

/** Research results. Web sources are marked and stay here until the student adds them. */
export function ResearchPage() {
  const { id = "" } = useParams();
  const r = useApi<Resp>(`/api/tutor/research/${id}`);
  usePoll(() => void r.reload(), r.data?.status === "running", 2500);
  usePageContext({ courseId: r.data?.course_id ?? undefined }, [r.data]);
  const d = r.data;
  if (!d) return <Shell><p className="muted">Loading…</p></Shell>;
  const rep = d.report;
  const paras = (rep?.md ?? "").split(/\n{2,}/).filter(Boolean);
  return (
    <Shell>
      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 18 }}>
        <p className="small muted">Deep research{d.course_id ? " · from your course" : ""}</p>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.015em" }}>{d.question}</h1>
        {d.status === "running" && <p className="row muted"><span className="spinner" /> Reading your library and the web…</p>}
        {rep?.error && <p className="err-text">{rep.error}</p>}
        {rep && !rep.error && (
          <>
            <p className="muted">Read {rep.sources.length} sources: {rep.libraryCount} from your library, {rep.webCount} from the web.</p>
            {paras.map((p, i) => (
              <p key={i} className="serif" style={{ fontSize: 19, lineHeight: 1.6 }}>
                {p.split(/(\[[\d,\s]+\])/).map((part, k) =>
                  /^\[[\d,\s]+\]$/.test(part) ? (
                    <sup key={k} style={{ fontFamily: "var(--ui)", fontSize: 12 }}>
                      {part.slice(1, -1).split(",").map((n, j) => (
                        <span key={j}>{j > 0 && ","}<a href={`#s${n.trim()}`} style={{ textDecoration: "none", fontWeight: 600 }}>{n.trim()}</a></span>
                      ))}
                    </sup>
                  ) : (
                    part
                  ),
                )}
              </p>
            ))}
            {rep.webCount > 0 && <div className="callout callout-blue small">Web sources stay here until you add them. Nothing enters your course without your approval.</div>}
            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 className="section-title">Sources</h2>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {rep.sources.map((s) => (
                  <li key={s.n} id={`s${s.n}`} className="row" style={{ fontSize: 14 }}>
                    <span className="muted" style={{ width: 20 }}>{s.n}</span>
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : <span>{s.label}</span>}
                    <span className={`badge ${s.origin === "web" ? "badge-new" : ""}`}>{s.origin === "web" ? "Web" : "Your library"}</span>
                  </li>
                ))}
              </ol>
            </section>
            {d.course_id && <Link to={`/courses/${d.course_id}`} className="btn" style={{ alignSelf: "flex-start" }}>Back to the course</Link>}
          </>
        )}
      </div>
    </Shell>
  );
}
