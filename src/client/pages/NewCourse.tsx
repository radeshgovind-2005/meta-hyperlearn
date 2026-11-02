import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { api } from "../lib/api";
import { useApp } from "../lib/app";

type SourceRow = { id: string; filename: string; kind: string; pages: number | null; duration_s: number | null; status: string };

const DEPTH = {
  overview: { label: "Overview", hint: "Key ideas, fewer sections", goal: "a short overview of the key ideas" },
  standard: { label: "Standard", hint: "Follows your lectures", goal: "follow the lectures closely" },
  thorough: { label: "Thorough", hint: "Adds proofs and extra examples", goal: "thorough, including derivations and extra worked examples from the material" },
} as const;

export function NewCoursePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reloadCourses, me } = useApp();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set((params.get("sources") ?? "").split(",").filter(Boolean)));
  const [exam, setExam] = useState<string>("");
  const [examDate, setExamDate] = useState("");
  const [depth, setDepth] = useState<keyof typeof DEPTH>("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<SourceRow[]>([]);

  // the list endpoint pages by 8; fetch all pages for the picker
  useEffect(() => {
    void (async () => {
      const out: SourceRow[] = [];
      for (let p = 1; p < 20; p++) {
        const r = await api<{ items: SourceRow[]; total: number; per: number }>(`/api/sources?page=${p}`);
        out.push(...r.items);
        if (p * r.per >= r.total) break;
      }
      setRows(out);
      const ex = out.find((s) => s.kind === "exam" && (picked.size === 0 || picked.has(s.id)));
      if (ex) setExam(ex.id);
      if (!picked.size) setPicked(new Set(out.filter((s) => s.status === "ready" && s.kind !== "exam").map((s) => s.id)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docs = rows.filter((r) => r.kind !== "exam");
  const exams = rows.filter((r) => r.kind === "exam" && r.status === "ready");
  const build = async () => {
    setBusy(true);
    setErr(null);
    try {
      const sourceIds = [...picked].filter((id) => docs.some((d) => d.id === id));
      if (exam) sourceIds.push(exam);
      const goal = `${DEPTH[depth].goal}${examDate ? `; exam on ${examDate}` : ""}`;
      const r = await api<{ id: string }>("/api/courses", { body: { title: title.trim() || undefined, sourceIds, goal } });
      await reloadCourses();
      navigate(`/courses/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Shell commandBar={false}>
      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 28 }}>
        <h1 className="page-title">New course</h1>
        <div className="field">
          <label htmlFor="cname">Course name</label>
          <input id="cname" className="input" value={title} placeholder="We suggest one from your sources" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="section-title">Sources</h2>
          <div className="card" style={{ gap: 0, padding: 0 }}>
            {docs.map((s, i) => (
              <label key={s.id} className="row" style={{ padding: "12px 16px", borderTop: i ? "1px solid var(--row)" : "none", fontSize: 15, cursor: s.status === "ready" ? "pointer" : "default", color: s.status === "ready" ? "var(--ink)" : "var(--faint)" }}>
                <input type="checkbox" disabled={s.status !== "ready"} checked={picked.has(s.id)} style={{ accentColor: "#0A5CFF", width: 16, height: 16 }} onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                <span>{s.filename}</span>
                <span className="small muted" style={{ marginLeft: "auto" }}>
                  {s.status !== "ready" ? "still processing" : s.kind === "audio" ? `${Math.round((s.duration_s ?? 0) / 60)} min` : s.pages ? `${s.pages} pages` : "PDF"}
                </span>
              </label>
            ))}
            {!docs.length && <p className="muted" style={{ padding: 16 }}>No sources yet. Add some from the Library first.</p>}
          </div>
        </section>
        <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <label htmlFor="estyle">Exam style</label>
            <select id="estyle" className="input" value={exam} onChange={(e) => setExam(e.target.value)}>
              <option value="">None</option>
              {exams.map((x) => (
                <option key={x.id} value={x.id}>{x.filename}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <label htmlFor="edate">Exam date</label>
            <input id="edate" type="date" className="input" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
        </div>
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="section-title">Depth</h2>
          <div className="row" style={{ gap: 10, alignItems: "stretch" }}>
            {(Object.keys(DEPTH) as (keyof typeof DEPTH)[]).map((k) => (
              <label key={k} style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", border: `1px solid ${depth === k ? "var(--primary)" : "var(--input)"}`, borderRadius: 10, cursor: "pointer" }}>
                <span className="row" style={{ gap: 8, fontWeight: 500 }}>
                  <input type="radio" name="depth" checked={depth === k} onChange={() => setDepth(k)} style={{ accentColor: "#0A5CFF" }} />
                  {DEPTH[k].label}
                </span>
                <span className="small muted">{DEPTH[k].hint}</span>
              </label>
            ))}
          </div>
        </section>
        <div className="row" style={{ gap: 16 }}>
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || ![...picked].some((id) => docs.some((d) => d.id === id))} onClick={() => void build()}>
            {busy ? "Starting…" : "Build course"}
          </button>
          <p className="small muted">Takes a few minutes. You can leave this page.</p>
        </div>
        {me?.mode === "demo" && <p className="hint">Building uses the shared demo budget. <a href="/settings/ai">Add your own key</a> for your own courses.</p>}
        {err && <p className="err-text" role="alert">{err}</p>}
      </div>
    </Shell>
  );
}
