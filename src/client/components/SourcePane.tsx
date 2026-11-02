import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Cite } from "@shared/types";
import { api } from "../lib/api";
import { fmtTime } from "../lib/hooks";
import { citeLabel, type SourceInfo } from "./Blocks";
import { Pause, Play } from "./Icons";

type Chunk = { id: string; text: string; page: number | null; bbox: string | null; t_start: number | null; t_end: number | null };
const chunkCache = new Map<string, Promise<Chunk[]>>();
function sourceChunks(id: string): Promise<Chunk[]> {
  if (!chunkCache.has(id)) chunkCache.set(id, api<{ chunks: Chunk[] }>(`/api/sources/${id}`).then((r) => r.chunks));
  return chunkCache.get(id)!;
}

/** Right pane: the exact page region (or audio moment) each citation points to. */
export function SourcePane({ cites, active, onActive, sources }: { cites: Cite[]; active: number; onActive: (i: number) => void; sources: Record<string, SourceInfo> }) {
  const cite = cites[active];
  if (!cites.length || !cite) {
    return (
      <aside className="source-pane" aria-label="Sources">
        <p className="section-title">Sources</p>
        <p className="small muted">Click a paragraph or a citation number to see exactly where it comes from.</p>
      </aside>
    );
  }
  const src = sources[cite.sourceId];
  return (
    <aside className="source-pane" id="src" aria-label="Sources">
      <div role="tablist" aria-label="Cited sources" className="tabs">
        {cites.map((c, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === active} className="tab" onClick={() => onActive(i)}>
            {i + 1} · {citeLabel(c, sources, true)}
          </button>
        ))}
      </div>
      {src?.kind === "audio" || cite.tStart !== undefined ? <AudioCite cite={cite} src={src} /> : <PageCite cite={cite} src={src} />}
      {src && (
        <Link to={`/sources/${src.id}${cite.page ? `?page=${cite.page}` : cite.tStart !== undefined ? `?t=${Math.floor(cite.tStart)}` : ""}`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>
          {cite.page ? `Open ${src.filename} at page ${cite.page}` : `Open ${src.filename}`}
        </Link>
      )}
    </aside>
  );
}

function PageCite({ cite, src }: { cite: Cite; src?: SourceInfo }) {
  const url = cite.page ? src?.pageUrls[cite.page] : undefined;
  const [failed, setFailed] = useState(false);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  useEffect(() => setFailed(false), [url]);
  useEffect(() => {
    if ((!url || failed) && src) void sourceChunks(src.id).then(setChunks).catch(() => setChunks([]));
  }, [url, failed, src]);
  if (url && !failed) {
    const b = cite.bbox;
    return (
      <div className="page-view">
        <img src={url} alt={`${src?.filename ?? "Source"} page ${cite.page}`} onError={() => setFailed(true)} />
        {b && (
          <span
            className="page-hl"
            aria-hidden="true"
            style={{ left: `${(b[0] * 100).toFixed(2)}%`, top: `${(b[1] * 100).toFixed(2)}%`, width: `${(b[2] * 100).toFixed(2)}%`, height: `${(b[3] * 100).toFixed(2)}%` }}
          />
        )}
      </div>
    );
  }
  const page = (chunks ?? []).filter((c) => c.page === cite.page);
  return (
    <div className="text-page">
      {page.length === 0 && <p className="muted">Loading page text…</p>}
      {page.map((c) => (
        <p key={c.id} className={c.id === cite.chunkId ? "hl" : undefined} style={{ margin: 0, whiteSpace: "pre-line" }}>
          {c.text}
        </p>
      ))}
      {cite.page && <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, textAlign: "right" }}>{cite.page}</p>}
    </div>
  );
}

function AudioCite({ cite, src }: { cite: Cite; src?: SourceInfo }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  useEffect(() => {
    if (src) void sourceChunks(src.id).then(setChunks).catch(() => {});
  }, [src]);
  const start = cite.tStart ?? 0;
  const play = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    a.currentTime = start;
    void a.play();
  };
  const near = chunks.filter((c) => c.t_start !== null && c.t_end! >= start - 1 && c.t_start <= (cite.tEnd ?? start + 30));
  return (
    <div className="card">
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={play} aria-label={playing ? "Pause" : `Play from ${fmtTime(start)}`}>
          {playing ? <Pause /> : <Play />} {playing ? "Pause" : `Play from ${fmtTime(start)}`}
        </button>
        <span className="small muted">{src?.filename}</span>
      </div>
      <audio ref={audio} src={src?.fileUrl} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      {near.map((c) => (
        <p key={c.id} style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--body)" }}>
          <span className="small muted">{fmtTime(c.t_start!)} </span>
          <span style={{ background: "var(--highlight)" }}>{c.text}</span>
        </p>
      ))}
    </div>
  );
}
