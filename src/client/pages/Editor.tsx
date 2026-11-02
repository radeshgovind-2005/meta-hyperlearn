import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Block, Cite, Section } from "@shared/types";
import { api } from "../lib/api";
import { useApi, fmtTime } from "../lib/hooks";
import { useApp } from "../lib/app";
import { Md } from "../components/Md";
import { WidgetCard, type SourceInfo } from "../components/Blocks";
import { useConfig } from "../main";

type Hit = { cite: Cite; text: string; kind: string; filename: string };
const rid = () => `b_${Math.random().toString(36).slice(2, 12)}`;

export function EditorPage() {
  const { courseId = "", sectionId = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const config = useConfig();
  const sec = useApi<{ section: Section; sources: Record<string, SourceInfo>; role: string }>(`/api/courses/${courseId}/sections/${sectionId}`);
  const course = useApi<{ course: { title: string } }>(`/api/courses/${courseId}`);
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (sec.data) {
      setTitle(sec.data.section.title);
      setBlocks(sec.data.section.blocks);
    }
  }, [sec.data]);
  useEffect(() => {
    const t = setTimeout(() => void api<{ items: Hit[] }>(`/api/courses/${courseId}/search?q=${encodeURIComponent(q)}`).then((r) => setHits(r.items)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q, courseId]);

  const update = (next: Block[]) => {
    setBlocks(next);
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const n = [...blocks];
    [n[i], n[j]] = [n[j], n[i]];
    update(n);
  };
  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/courses/${courseId}/sections/${sectionId}/edit`, { body: { title, blocks } });
      setDirty(false);
      toast("Saved as a new version");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const label = (c: Cite, h?: Hit) => (c.page ? `${h?.kind === "slides" ? "Slide text" : "Page"} · ${(h?.filename ?? "").replace(/\.pdf$/i, "")} p.${c.page}` : c.tStart !== undefined ? `Lecture · ${(h?.filename ?? "").replace(/\.\w+$/, "")} at ${fmtTime(c.tStart)}` : h?.filename ?? "Source");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ height: 64, display: "flex", alignItems: "center", gap: 16, padding: "0 32px", borderBottom: "1px solid var(--border)" }}>
        <Link to={`/courses/${courseId}`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>{course.data?.course.title ?? "Course"}</Link>
        <span className="small muted">Editing {title}</span>
        <span className="row" style={{ marginLeft: "auto", gap: 16 }}>
          <span className="small muted">{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</span>
          {dirty && <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()}>Save</button>}
          <button type="button" className="btn btn-sm" onClick={() => navigate(`/courses/${courseId}/s/${sectionId}`)}>Done</button>
        </span>
      </header>
      <div style={{ flex: 1, display: "flex", flexWrap: "wrap" }}>
        <aside aria-label="Your sources" style={{ flex: "1 1 300px", maxWidth: 360, borderRight: "1px solid var(--border)", padding: 24, display: "flex", flexDirection: "column", gap: 14, background: "var(--sidebar)" }}>
          <h2 className="section-title">From your sources</h2>
          <label htmlFor="srcq" className="sr-only">Search your sources</label>
          <input id="srcq" className="input input-sm" placeholder="Search slides, papers, transcripts" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.map((h, i) => (
            <div key={i} className="card" style={{ background: "#fff", gap: 8 }}>
              <span className="small muted">{label(h.cite, h)}</span>
              <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--body)" }}>{h.text.length > 260 ? `${h.text.slice(0, 260)}…` : h.text}</p>
              <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => update([...blocks, { id: rid(), kind: "text", md: h.text.replace(/\n/g, " "), cites: [h.cite], origin: "source" }])}>
                Add to section
              </button>
            </div>
          ))}
        </aside>
        <main style={{ flex: "999 1 520px", padding: "32px 48px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: 700, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label htmlFor="stitle">Section title</label>
              <input id="stitle" className="input" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
            </div>
            {blocks.map((b, i) => (
              <div key={b.id} className="card" style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button type="button" className="close-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="close-btn" aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="label-caps">{b.kind === "text" ? (b.origin === "source" ? "From the source" : "Rephrased") : b.kind === "widget" ? "Interactive example" : b.kind === "exercise" ? "Exercise" : "Figure"}</span>
                  {b.kind === "text" ? (
                    <textarea className="textarea serif" rows={Math.min(8, Math.ceil(b.md.length / 70) + 1)} style={{ fontSize: 17 }} value={b.md} onChange={(e) => update(blocks.map((x) => (x.id === b.id ? { ...b, md: e.target.value, origin: "rephrased" } : x)))} aria-label="Paragraph text" />
                  ) : b.kind === "widget" ? (
                    <WidgetCard block={b} sources={sec.data?.sources ?? {}} widgetsOrigin={config.widgetsOrigin} />
                  ) : b.kind === "exercise" ? (
                    <p className="serif" style={{ fontSize: 17 }}><Md text={b.prompt} /></p>
                  ) : (
                    <p className="small">{b.caption}</p>
                  )}
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="small muted">{b.cites.length ? `Cites ${b.cites.length} source passage${b.cites.length === 1 ? "" : "s"}` : "No citation"}</span>
                    <button type="button" className="link-btn muted" onClick={() => update(blocks.filter((x) => x.id !== b.id))}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
            <div className="row">
              <span className="small muted">Add</span>
              <button type="button" className="btn btn-sm" onClick={() => setQ(q || title)}>Text from sources</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/courses/${courseId}/s/${sectionId}`)}>Interactive (ask in the reader)</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
