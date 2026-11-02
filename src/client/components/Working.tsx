import { useEffect, useState } from "react";

/** Seconds since `since`, ticking once a second. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/** A live status line: what is happening, for how long, and how long it usually takes. */
export function Working({ label, since, usually, className }: { label: string; since: number; usually?: string; className?: string }) {
  const s = useElapsed(since);
  return (
    <p className={`working-line ${className ?? ""}`} role="status" aria-live="polite">
      <span className="spinner" />
      <span>{label}</span>
      <span className="muted working-time">{s} s{usually ? ` · usually ${usually}` : ""}</span>
    </p>
  );
}

/** Placeholder lines shaped like the content that is coming. */
export function Skeleton({ lines = 3, title = false }: { lines?: number; title?: boolean }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {title && <i style={{ width: "45%", height: 22 }} />}
      {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${[92, 78, 85, 64, 88][i % 5]}%` }} />)}
    </div>
  );
}

/** Full-page loading state that keeps the page's shape instead of a bare "Loading…". */
export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading">
      <Skeleton title lines={2} />
      <Skeleton lines={4} />
      <Skeleton lines={3} />
    </div>
  );
}
