import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { PageSkeleton } from "../components/Working";
import { api } from "../lib/api";
import { fmtTime, formatDate, useApi, usePoll } from "../lib/hooks";
import { useApp } from "../lib/app";

type Chunk = { id: string; ord: number; text: string; page: number | null; bbox: string | null; t_start: number | null; t_end: number | null; section_path: string | null };
type SourceResp = {
  source: { id: string; title: string; filename: string; kind: string; pages: number | null; duration_s: number | null; status: string; progress: string | null; error: string | null; created_at: number; own: boolean };
  fileUrl: string;
  pageUrls: string[];
  structure: { title: string; summary: string; pages: { page: number; title: string; concepts: string[] }[] } | null;
  examStyle: { format: string; verbs: string[]; questions: { number: string; text: string; topic: string }[] } | null;
  chunks: Chunk[];
  courses: { id: string; title: string }[];
};

export function SourcePage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const r = useApi<SourceResp>(`/api/sources/${id}`);
  usePoll(() => void r.reload(), r.data?.source.status === "processing", 3000);
  const page = Number(params.get("page") ?? 1);
  const [tab, setTab] = useState<"sections" | "used" | "exam">("sections");
  const [imgFailed, setImgFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => setImgFailed(false), [page]);
  useEffect(() => {
    const t = params.get("t");
    if (t && audio.current) audio.current.currentTime = Number(t);
  }, [params, r.data]);

  if (r.error) return <Shell><p className="err-text">{r.error.message}</p></Shell>;
  const d = r.data;
  if (!d) return <Shell><PageSkeleton /></Shell>;
  const s = d.source;
  const pageChunks = d.chunks.filter((c) => c.page === page);
  const isAudio = s.kind === "audio";
  const setPage = (p: number) => setParams({ page: String(p) });

  return (
    <Shell commandBar={false}>
      <p className="crumbs">
        <Link to="/library">Library</Link> / Sources
      </p>
      <div className="page-head">
        <h1 className="page-title">{s.filename}</h1>
        <div className="row">
          <a className="btn" href={d.fileUrl} target="_blank" rel="noreferrer">Open original</a>
          {s.own && !d.courses.length && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (!window.confirm(`Remove ${s.filename}?`)) return;
                try {
                  await api(`/api/sources/${id}`, { method: "DELETE" });
                  navigate("/library");
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: -16 }}>
        {s.pages ? `${s.pages} pages` : s.duration_s ? `${Math.round(s.duration_s / 60)} min` : ""} · added {formatDate(s.created_at)}
        {d.courses.length ? ` · used in ${d.courses.map((c) => c.title).join(", ")}` : ""}
        {s.status !== "ready" && ` · ${s.status === "failed" ? `failed: ${s.error}` : s.progress}`}
      </p>

      <div className="row" style={{ alignItems: "flex-start", gap: 32 }}>
        <div style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {isAudio ? (
            <div className="card">
              <audio ref={audio} controls src={d.fileUrl} style={{ width: "100%" }} preload="metadata" />
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, maxHeight: "60vh", overflowY: "auto" }}>
                {d.chunks.map((c) => {
                  const hl = params.get("t") && c.t_start !== null && Number(params.get("t")) >= c.t_start - 1 && Number(params.get("t")) <= (c.t_end ?? 0);
                  return (
                    <li key={c.id} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.55 }}>
                      <button type="button" className="link-btn" style={{ fontSize: 13, flex: "none" }} onClick={() => { if (audio.current) { audio.current.currentTime = c.t_start ?? 0; void audio.current.play(); } }}>
                        {fmtTime(c.t_start ?? 0)}
                      </button>
                      <span style={hl ? { background: "var(--highlight)" } : undefined}>{c.text}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <>
              {d.pageUrls[page - 1] && !imgFailed ? (
                <div className="page-view" style={{ maxWidth: 760 }}>
                  <img src={d.pageUrls[page - 1]} alt={`${s.filename} page ${page}`} onError={() => setImgFailed(true)} />
                  {pageChunks.map((c) => {
                    const b = c.bbox ? (JSON.parse(c.bbox) as number[]) : null;
                    const hl = params.get("chunk") === c.id;
                    return b && hl ? <span key={c.id} className="page-hl" style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${b[2] * 100}%`, height: `${b[3] * 100}%` }} /> : null;
                  })}
                </div>
              ) : (
                <div className="text-page" style={{ maxWidth: 760 }}>
                  {pageChunks.map((c) => (
                    <p key={c.id} style={{ margin: 0, whiteSpace: "pre-line" }}>{c.text}</p>
                  ))}
                  {!pageChunks.length && <p className="muted">No text on this page.</p>}
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, textAlign: "right" }}>{page}</p>
                </div>
              )}
              {s.pages && (
                <div className="row" style={{ gap: 12 }}>
                  <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
                  <span className="small muted">Page {page} of {s.pages}</span>
                  <button type="button" className="btn btn-sm" disabled={page >= s.pages} onClick={() => setPage(page + 1)}>Next page</button>
                </div>
              )}
            </>
          )}
        </div>
        <aside aria-label="Found in this source" style={{ flex: "1 1 280px", maxWidth: 360, display: "flex", flexDirection: "column", gap: 12 }}>
          <div role="tablist" className="tabs">
            <button type="button" role="tab" className="tab" aria-selected={tab === "sections"} onClick={() => setTab("sections")}>Sections</button>
            {d.examStyle && <button type="button" role="tab" className="tab" aria-selected={tab === "exam"} onClick={() => setTab("exam")}>Exam style</button>}
            <button type="button" role="tab" className="tab" aria-selected={tab === "used"} onClick={() => setTab("used")}>Used in</button>
          </div>
          {tab === "sections" && (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {d.structure?.summary && <p className="small muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>{d.structure.summary}</p>}
              {(d.structure?.pages ?? []).map((p) => (
                <li key={p.page}>
                  <button type="button" className="palette-item" style={{ width: "100%", minHeight: 40, fontSize: 14 }} aria-current={p.page === page ? "page" : undefined} onClick={() => setPage(p.page)}>
                    <span>{p.title}</span>
                    <span className="small muted">p.{p.page}</span>
                  </button>
                </li>
              ))}
              {!d.structure && <p className="small muted">{s.status === "ready" ? "No sections found." : "Still reading this source…"}</p>}
            </ol>
          )}
          {tab === "exam" && d.examStyle && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14, color: "var(--body)", lineHeight: 1.5 }}>
              <p><strong>Format:</strong> {d.examStyle.format}</p>
              <p><strong>Command words:</strong> {d.examStyle.verbs.join(", ")}</p>
              <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {d.examStyle.questions.map((q) => (
                  <li key={q.number}>{q.text} <span className="muted">· {q.topic}</span></li>
                ))}
              </ol>
            </div>
          )}
          {tab === "used" && (
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
              {d.courses.map((c) => (
                <li key={c.id}><Link to={`/courses/${c.id}`}>{c.title}</Link></li>
              ))}
              {!d.courses.length && <p className="small muted">Not used in a course yet. <Link to={`/courses/new?sources=${id}`}>Build one</Link></p>}
            </ul>
          )}
        </aside>
      </div>
    </Shell>
  );
}
