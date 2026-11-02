import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Pager, Shell } from "../components/Shell";
import { api } from "../lib/api";
import { formatDate, useApi } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";

type Item = { version: number; kind: string; summary: string; byYou: boolean; created_at: number; trace: { label: string; model?: string }[]; models: string[] };
type Resp = { role: string; current: number; total: number; page: number; per: number; items: Item[]; ownChanges: { section_id: string; title: string; updated_at: number }[] };

const KIND: Record<string, string> = {
  build: "Built from your sources",
  mutate: "You asked for a change",
  adapt: "After practice showed a mistake",
  undo: "Restored",
  pull: "Took updates",
  edit: "Edited by hand",
  illustrate: "A picture was added",
};

export function HistoryPage() {
  const { courseId = "" } = useParams();
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const r = useApi<Resp>(`/api/courses/${courseId}/history?page=${page}`);
  const course = useApi<{ course: { title: string } }>(`/api/courses/${courseId}`);
  const [open, setOpen] = useState<number | null>(null);
  usePageContext({ courseId, courseTitle: course.data?.course.title }, [courseId, course.data]);
  const d = r.data;

  return (
    <Shell>
      <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 }}>
        <p className="crumbs">
          <Link to={`/courses/${courseId}`}>{course.data?.course.title ?? "Course"}</Link> / History
        </p>
        <h1 className="page-title">Course history</h1>
        <p style={{ fontSize: 15, color: "var(--muted)" }}>Every change to this course is saved. Restoring creates a new version, so nothing is lost.</p>
        {d?.ownChanges.length ? (
          <div className="callout callout-blue">
            <strong style={{ fontSize: 14 }}>Your own changes</strong>
            <p className="small">You changed {d.ownChanges.map((o) => o.title).join(", ")} on top of this shared course. Only you see them.</p>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {(d?.items ?? []).map((v) => (
            <div key={v.version} style={{ display: "flex", gap: 20, padding: "16px 0", borderBottom: "1px solid var(--row)", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Version {v.version}</span>
                <span className="small muted">{formatDate(v.created_at)}</span>
              </div>
              <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 15 }}>{v.summary}</span>
                <p className="small muted">{KIND[v.kind] ?? v.kind} · {v.byYou ? "You" : v.kind === "adapt" || v.kind === "build" ? "HyperLearn" : "Course owner"}</p>
                {v.trace.length > 0 && (
                  <button type="button" className="link-btn" style={{ fontSize: 13, alignSelf: "flex-start" }} onClick={() => setOpen(open === v.version ? null : v.version)} aria-expanded={open === v.version}>
                    How this was decided
                  </button>
                )}
                {open === v.version && (
                  <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--body)" }}>
                    {v.trace.map((t, i) => (
                      <li key={i}>{t.label}</li>
                    ))}
                  </ol>
                )}
              </div>
              {v.version === d!.current ? (
                <span className="badge badge-ok">Current</span>
              ) : d!.role === "owner" ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      const res = await api<{ version: number }>(`/api/courses/${courseId}/restore`, { body: { version: v.version } });
                      toast(`Restored as version ${res.version}`);
                      setPage(1);
                      void r.reload();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  Restore
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {d && <Pager page={d.page} per={d.per} total={d.total} label="versions" onPage={setPage} />}
      </div>
    </Shell>
  );
}
