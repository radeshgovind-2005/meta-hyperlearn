import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Pager, Shell } from "../components/Shell";
import { UploadDialog } from "../components/UploadDialog";
import { formatBytes, formatDate, useApi, usePoll } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";
import { api } from "../lib/api";

type SourceRow = { id: string; title: string; filename: string; kind: string; size_bytes: number; pages: number | null; duration_s: number | null; status: string; progress: string | null; created_at: number; courses: { id: string; title: string }[] };

const KIND_LABEL: Record<string, string> = { slides: "Slides", paper: "Paper or book", notes: "Notes", exam: "Past exam", audio: "Recording" };

export function LibraryPage() {
  const { courses, me, reloadCourses, toast } = useApp();
  const navigate = useNavigate();
  const [upload, setUpload] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [course, setCourse] = useState("");
  const [sort, setSort] = useState<"date" | "name">("date");
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const qs = new URLSearchParams({ page: String(page), ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(course ? { course } : {}), ...(sort === "name" ? { sort: "name" } : {}) });
  const src = useApi<{ total: number; page: number; per: number; items: SourceRow[] }>(`/api/sources?${qs}`);
  usePageContext({}, []);
  const busy = (src.data?.items ?? []).some((s) => s.status === "processing" || s.status === "uploading") || courses.some((c) => c.status === "building");
  usePoll(() => {
    void src.reload();
    void reloadCourses();
  }, busy, 4000);

  const own = courses.filter((c) => c.role === "owner");
  const demo = courses.find((c) => c.is_demo);
  const empty = !own.length && (src.data?.total ?? 0) === 0 && !q && !kind && !course;

  if (empty && src.data) {
    return (
      <Shell>
        <h1 className="page-title">Library</h1>
        <div className="empty" style={{ marginTop: 40 }}>
          <img src="/icon.png" alt="" style={{ width: 56, height: "auto" }} />
          <p style={{ fontSize: 18, fontWeight: 600 }}>No courses yet</p>
          <p style={{ maxWidth: 460, fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>Add lecture slides, papers or notes. HyperLearn builds a course from them, and every explanation links back to the page it came from.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-primary" onClick={() => setUpload(true)}>Add sources</button>
            {demo && <Link to={`/courses/${demo.id}`} className="btn">Open the sample course</Link>}
          </div>
          {me?.mode === "demo" && <p className="hint">You are in demo mode. <Link to="/settings/ai">Add your own key</Link> to build courses from your files.</p>}
        </div>
        {upload && <UploadDialog onClose={() => { setUpload(false); void src.reload(); }} />}
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="page-head">
        <h1 className="page-title">Library</h1>
        <div className="row">
          <button type="button" className="btn" onClick={() => setUpload(true)}>Add sources</button>
          <Link to={`/courses/new${checked.size ? `?sources=${[...checked].join(",")}` : ""}`} className="btn btn-primary">New course</Link>
        </div>
      </div>

      <section aria-label="Courses" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-head">
          <h2 className="section-title">Courses</h2>
          <span className="small muted">{courses.length} course{courses.length === 1 ? "" : "s"}</span>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th scope="col">Course</th>
                <th scope="col">Sources</th>
                <th scope="col">Next up</th>
                <th scope="col">Access</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/courses/${c.id}`} className="strong">{c.title}</Link>
                  </td>
                  <td>{c.source_count}</td>
                  <td>{c.nextUp ? <Link to={`/courses/${c.id}/s/${c.nextUp.id}`} style={{ textDecoration: "none" }}>{c.nextUp.title}</Link> : c.status === "ready" ? "Done" : "—"}</td>
                  <td>{c.is_demo ? "Sample course" : c.role === "owner" ? (c.forked_from ? "Your copy" : "Yours") : "Following"}</td>
                  <td>
                    {c.status === "building" ? (
                      <span className="row" style={{ gap: 8 }}><span className="spinner" /><span className="status-pill">{c.progress ?? "Building"}</span></span>
                    ) : c.status === "failed" ? (
                      <span className="status-pill err-text">Failed</span>
                    ) : (
                      <span className="status-pill" style={{ color: "#0047CC" }}>{c.nextUp ? "In progress" : "Ready"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Sources" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-head">
          <h2 className="section-title">Sources</h2>
          <div className="row">
            <label htmlFor="srch" className="sr-only">Search sources</label>
            <input id="srch" type="search" className="input input-sm" style={{ width: 220 }} placeholder="Search sources" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <label htmlFor="ftype" className="sr-only">Type</label>
            <select id="ftype" className="select select-sm input input-sm" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              <option value="slides">Slides</option>
              <option value="paper">Papers and books</option>
              <option value="notes">Notes</option>
              <option value="audio">Recordings</option>
              <option value="exam">Past exams</option>
            </select>
            <label htmlFor="fcourse" className="sr-only">Course</label>
            <select id="fcourse" className="select select-sm input input-sm" value={course} onChange={(e) => { setCourse(e.target.value); setPage(1); }}>
              <option value="">All courses</option>
              {own.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th scope="col">
                  <input type="checkbox" aria-label="Select all sources" style={{ accentColor: "#0A5CFF", width: 16, height: 16, margin: 0 }} checked={!!src.data?.items.length && src.data.items.every((s) => checked.has(s.id))} onChange={(e) => setChecked(e.target.checked ? new Set(src.data?.items.filter((s) => s.status === "ready").map((s) => s.id)) : new Set())} />
                </th>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
                <th scope="col">Used in</th>
                <th scope="col">
                  <button type="button" className="link-btn" style={{ color: "var(--ink)", fontSize: 13 }} aria-label={sort === "date" ? "Sort by name" : "Sort by date added, newest first"} onClick={() => setSort(sort === "date" ? "name" : "date")}>
                    {sort === "date" ? "Added ↓" : "Name ↓"}
                  </button>
                </th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(src.data?.items ?? []).map((s) => (
                <tr key={s.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${s.filename}`} disabled={s.status !== "ready"} style={{ accentColor: "#0A5CFF", width: 16, height: 16, margin: 0 }} checked={checked.has(s.id)} onChange={(e) => setChecked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                  </td>
                  <td>
                    <Link to={`/sources/${s.id}`} className="strong">{s.filename}</Link>
                    {s.status !== "ready" && <span className={`small ${s.status === "failed" ? "err-text" : "muted"}`} style={{ marginLeft: 8 }}>{s.status === "failed" ? "Failed" : s.progress}</span>}
                  </td>
                  <td>{KIND_LABEL[s.kind] ?? s.kind}</td>
                  <td>{s.pages ? `${s.pages} pages` : s.duration_s ? `${Math.round(s.duration_s / 60)} min` : formatBytes(s.size_bytes)}</td>
                  <td>{s.courses.map((c) => c.title).join(", ") || "—"}</td>
                  <td>{formatDate(s.created_at)}</td>
                  <td>
                    {!s.courses.length && (
                      <button
                        type="button"
                        className="link-btn muted"
                        onClick={async () => {
                          if (!window.confirm(`Remove ${s.filename}?`)) return;
                          try {
                            await api(`/api/sources/${s.id}`, { method: "DELETE" });
                            void src.reload();
                          } catch (e) {
                            toast((e as Error).message);
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {src.data && !src.data.items.length && (
                <tr>
                  <td colSpan={7} className="muted">No sources match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {src.data && <Pager page={src.data.page} per={src.data.per} total={src.data.total} label="sources" onPage={setPage} />}
      </section>
      {upload && (
        <UploadDialog
          onClose={() => {
            setUpload(false);
            void src.reload();
          }}
        />
      )}
      {checked.size > 0 && (
        <div className="toast" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {checked.size} selected
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate(`/courses/new?sources=${[...checked].join(",")}`)}>New course from these</button>
        </div>
      )}
    </Shell>
  );
}
