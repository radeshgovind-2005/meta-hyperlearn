import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { PageSkeleton } from "../components/Working";
import { api } from "../lib/api";
import { formatDate, useApi } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";

type SharedItem = { id: string; title: string; sharedBy: string; how: "follow" | "copy"; updates: number; updatedAt: number };

export function SharedPage() {
  const r = useApi<{ items: SharedItem[] }>("/api/shared");
  usePageContext({}, []);
  return (
    <Shell>
      <h1 className="page-title">Shared with me</h1>
      <div className="table-wrap">
        <table className="table" style={{ minWidth: 600 }}>
          <thead>
            <tr><th>Course</th><th>Shared by</th><th>How</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {(r.data?.items ?? []).map((s) => (
              <tr key={s.id}>
                <td><Link to={`/courses/${s.id}`} className="strong">{s.title}</Link></td>
                <td>{s.sharedBy}</td>
                <td>
                  {s.how === "copy" ? "Your copy" : "Following"}
                  {s.updates > 0 && (
                    <>
                      {" · "}
                      <Link to={`/courses/${s.id}/updates`}>{s.updates} update{s.updates === 1 ? "" : "s"}</Link>
                    </>
                  )}
                </td>
                <td>{formatDate(s.updatedAt)}</td>
              </tr>
            ))}
            {r.data && !r.data.items.length && (
              <tr><td colSpan={4} className="muted">Nothing shared with you yet. When someone sends you an invite link, the course shows up here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

type CopyUpdate = { upstreamId: string; title: string; isNew: boolean; changedByYou: boolean; summary: string; mine: string; theirs: string };
type UpdatesResp =
  | { kind: "copy"; title: string; from: string; items: CopyUpdate[] }
  | { kind: "follow"; title: string; from: string; versions: { version: number; summary: string; created_at: number }[] }
  | { kind: "none"; title: string };

export function UpdatesPage() {
  const { courseId = "" } = useParams();
  const { toast } = useApp();
  const r = useApi<UpdatesResp>(`/api/courses/${courseId}/updates`);
  const [busy, setBusy] = useState(false);
  usePageContext({ courseId, courseTitle: r.data?.title }, [courseId, r.data]);
  const d = r.data;
  if (!d) return <Shell><PageSkeleton /></Shell>;
  const first = "from" in d ? d.from.split(" ")[0] : "";

  const pull = async (body: { upstreamSectionIds?: string[]; keepMine?: string[] }) => {
    setBusy(true);
    try {
      const res = await api<{ taken: string[] }>(`/api/courses/${courseId}/pull`, { body });
      toast(res.taken.length ? `Took ${res.taken.length} update${res.taken.length === 1 ? "" : "s"}` : "Kept your version");
      await r.reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 20 }}>
        <p className="crumbs"><Link to={`/courses/${courseId}`}>{d.title}</Link> · {d.kind === "copy" ? "your copy" : "following"}</p>
        {d.kind === "copy" && (
          <>
            <div className="page-head">
              <h1 className="page-title">{d.items.length} update{d.items.length === 1 ? "" : "s"} from {first}</h1>
              {d.items.length > 0 && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void pull({})}>Take all updates</button>}
            </div>
            {d.items.some((i) => i.changedByYou) ? (
              <p className="muted">Sections you changed show your version next to the update. Choose per section.</p>
            ) : d.items.length ? (
              <p className="muted">You haven't changed these sections, so taking the updates loses nothing.</p>
            ) : (
              <p className="muted">You're up to date.</p>
            )}
            {d.items.map((u) => (
              <section key={u.upstreamId} className="card" style={{ gap: 14 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{u.title}</span>
                    {u.isNew && <span className="badge badge-new" style={{ marginLeft: 8 }}>New section</span>}
                    <p className="small muted">{u.summary}</p>
                  </div>
                  <div className="row">
                    {!u.isNew && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void pull({ upstreamSectionIds: [u.upstreamId], keepMine: [u.upstreamId] })}>Keep mine</button>}
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void pull({ upstreamSectionIds: [u.upstreamId] })}>Take update</button>
                  </div>
                </div>
                {!u.isNew ? (
                  <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="label-caps">Your copy</span>
                      <p className="serif" style={{ fontSize: 16, lineHeight: 1.55, whiteSpace: "pre-wrap" }}><WordDiff a={u.mine} b={u.theirs} side="a" /></p>
                    </div>
                    <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <span className="label-caps">{first}'s update</span>
                      <p className="serif" style={{ fontSize: 16, lineHeight: 1.55, whiteSpace: "pre-wrap" }}><WordDiff a={u.mine} b={u.theirs} side="b" /></p>
                    </div>
                  </div>
                ) : (
                  <p className="serif" style={{ fontSize: 16, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{u.theirs.slice(0, 600)}{u.theirs.length > 600 ? "…" : ""}</p>
                )}
              </section>
            ))}
          </>
        )}
        {d.kind === "follow" && (
          <>
            <div className="page-head">
              <h1 className="page-title">{d.versions.length} update{d.versions.length === 1 ? "" : "s"} from {first}</h1>
              {d.versions.length > 0 && <button type="button" className="btn" onClick={async () => { await api(`/api/courses/${courseId}/updates/seen`, { body: {} }); void r.reload(); }}>Mark as read</button>}
            </div>
            <p className="muted">You follow this course, so updates are already in it. Your own changes stay on top.</p>
            {d.versions.map((v) => (
              <div key={v.version} className="card">
                <span style={{ fontWeight: 500 }}>{v.summary}</span>
                <span className="small muted">Version {v.version} · {formatDate(v.created_at)}</span>
              </div>
            ))}
          </>
        )}
        {d.kind === "none" && <p className="muted">This is your own course. Updates appear here for courses you follow or copied.</p>}
      </div>
    </Shell>
  );
}

/** Word-level diff: deletions marked on side a, insertions on side b. */
function WordDiff({ a, b, side }: { a: string; b: string; side: "a" | "b" }) {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  if (A.length * B.length > 400_000) return <>{side === "a" ? a : b}</>;
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: React.ReactNode[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      out.push(side === "a" ? A[i] : B[j]);
      i++;
      j++;
    } else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) {
      if (side === "b") out.push(/^\s+$/.test(B[j]) ? B[j] : <ins key={k++}>{B[j]}</ins>);
      j++;
    } else {
      if (side === "a") out.push(/^\s+$/.test(A[i]) ? A[i] : <del key={k++}>{A[i]}</del>);
      i++;
    }
  }
  return <>{out}</>;
}
