import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { accepted, guessKind, uploadSource, type Kind } from "../lib/upload";
import { Dialog } from "./Shell";
import { Upload } from "./Icons";

type Item = { key: string; file: File; kind: Kind; id?: string; label: string; pct: number; status: "uploading" | "processing" | "ready" | "failed"; error?: string };

/** "Adding sources": shows upload and ingest progress per file; keeps working in the background. */
export function UploadDialog({ onClose, initialFiles, onDone }: { onClose: () => void; initialFiles?: File[]; onDone?: (ids: string[]) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(new Set<string>());

  const add = (files: File[]) => {
    const fresh = files.filter(accepted).map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, file: f, kind: guessKind(f), label: "Waiting", pct: 0, status: "uploading" as const }));
    setItems((cur) => [...cur, ...fresh]);
  };
  useEffect(() => {
    if (initialFiles?.length) add(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // upload new items one at a time (page rendering is heavy)
  useEffect(() => {
    const next = items.find((i) => !i.id && i.status === "uploading" && !started.current.has(i.key));
    if (!next || items.some((i) => started.current.has(i.key) && !i.id && i.status === "uploading")) return;
    started.current.add(next.key);
    const set = (patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === next.key ? { ...i, ...patch } : i)));
    uploadSource(next.file, next.kind, (label, pct) => set({ label, pct }))
      .then((id) => set({ id, status: "processing" }))
      .catch((e: Error) => set({ status: "failed", error: e.message, label: e.message }));
  }, [items]);

  // poll ingest progress
  useEffect(() => {
    const ids = items.filter((i) => i.id && i.status === "processing").map((i) => i.id!);
    if (!ids.length) return;
    const t = setInterval(async () => {
      for (const id of ids) {
        try {
          const r = await api<{ source: { status: string; progress: string | null; error: string | null; pages: number | null; duration_s: number | null }; examStyle: { questions: unknown[] } | null }>(`/api/sources/${id}`);
          setItems((cur) =>
            cur.map((i) => {
              if (i.id !== id) return i;
              const s = r.source;
              if (s.status === "ready") {
                const label = i.kind === "exam" && r.examStyle ? `Done · ${r.examStyle.questions.length} questions found` : s.pages ? `Done · ${s.pages} pages` : s.duration_s ? `Done · ${Math.round(s.duration_s / 60)} min` : "Done";
                return { ...i, status: "ready", pct: 100, label };
              }
              if (s.status === "failed") return { ...i, status: "failed", label: s.error ?? "Failed" };
              return { ...i, label: s.progress ?? "Processing", pct: Math.max(i.pct, progressPct(s.progress)) };
            }),
          );
        } catch {
          // keep polling
        }
      }
    }, 2500);
    return () => clearInterval(t);
  }, [items]);

  useEffect(() => {
    if (items.length && items.every((i) => i.status === "ready" || i.status === "failed")) onDone?.(items.filter((i) => i.id && i.status === "ready").map((i) => i.id!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const exam = items.find((i) => i.kind === "exam");
  const ready = items.filter((i) => i.status === "ready" && i.id);
  return (
    <Dialog title={items.length ? `Adding ${items.length} source${items.length === 1 ? "" : "s"}` : "Add sources"} onClose={onClose}>
      <div
        className={`dropzone${drag ? " drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        aria-label="Add files"
        style={{ padding: items.length ? "16px" : undefined }}
      >
        {!items.length && <Upload />}
        <p style={{ fontWeight: 600, fontSize: 15 }}>{items.length ? "Add more files" : "Drop files here"}</p>
        <p className="hint">PDF slides, papers, notes or past exams, and lecture recordings. Up to 95 MB each.</p>
        <input ref={input} type="file" multiple accept="application/pdf,audio/*,video/mp4,.m4a" className="sr-only" onChange={(e) => add([...(e.target.files ?? [])])} />
      </div>
      {items.map((i) => (
        <div key={i.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
            <span style={{ fontWeight: 500 }}>{i.file.name}</span>
            <span className={i.status === "failed" ? "err-text small" : "small muted"}>{i.label}</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(i.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${i.file.name} progress`}>
            <span style={{ width: `${i.pct}%`, background: i.status === "ready" ? "var(--success)" : undefined }} />
          </div>
        </div>
      ))}
      {exam && (
        <label className="row" style={{ fontSize: 14, gap: 8 }}>
          <input type="checkbox" checked readOnly style={{ accentColor: "#0A5CFF", width: 16, height: 16 }} />
          Use {exam.file.name} as the exam style
        </label>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="small muted">You can close this. We keep working in the background.</p>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <Link to={`/courses/new${ready.length ? `?sources=${ready.map((r) => r.id).join(",")}` : ""}`} className="btn btn-primary" onClick={onClose}>
            Add to a course
          </Link>
        </div>
      </div>
    </Dialog>
  );
}

function progressPct(p: string | null): number {
  if (!p) return 75;
  if (/queued/i.test(p)) return 76;
  if (/reading|transcrib/i.test(p)) return 80;
  if (/topics|exam style/i.test(p)) return 88;
  if (/index/i.test(p)) return 95;
  return 78;
}
