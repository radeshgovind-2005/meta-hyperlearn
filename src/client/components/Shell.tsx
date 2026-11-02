import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { UserButton, useUser } from "@clerk/clerk-react";
import { useApp } from "../lib/app";
import { CommandBar } from "./CommandBar";

/** App layout: left nav (from the Library design), page content, command bar at the bottom. */
export function Shell({ children, commandBar = true, wide = false }: { children: ReactNode; commandBar?: boolean; wide?: boolean }) {
  const { pathname } = useLocation();
  const { courses, me } = useApp();
  const { user } = useUser();
  const current = (p: string) => (pathname === p || pathname.startsWith(`${p}/`) ? "page" : undefined);
  const courseCurrent = (id: string) => (pathname.startsWith(`/courses/${id}`) ? "page" : undefined);
  const usage = me
    ? me.mode === "byok"
      ? `$${me.spentUsd.toFixed(2)} of $${me.capUsd} used`
      : "Demo mode"
    : "";
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <Link to="/library" aria-label="HyperLearn home">
          <img src="/logo.png" alt="HyperLearn" className="nav-logo" />
        </Link>
        <Link className="nav-item" to="/library" aria-current={current("/library")}>Library</Link>
        <Link className="nav-item" to="/practice" aria-current={current("/practice")}>Practice</Link>
        <Link className="nav-item" to="/shared" aria-current={current("/shared")}>Shared with me</Link>
        {courses.length > 0 && <p className="nav-heading">Courses</p>}
        {courses.map((c) => (
          <Link key={c.id} className="nav-item" to={c.role === "follower" || c.forked_from ? `/courses/${c.id}` : `/courses/${c.id}`} aria-current={courseCurrent(c.id)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
            {c.is_demo ? <span className="badge" style={{ marginLeft: "auto" }}>Demo</span> : null}
          </Link>
        ))}
        <div className="nav-foot">
          <Link className="nav-item" to="/settings/account" aria-current={pathname.startsWith("/settings") ? "page" : undefined}>Settings</Link>
          <div className="nav-user">
            <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />
            <span title={user?.fullName ?? undefined}>{usage || user?.firstName}</span>
          </div>
        </div>
      </nav>
      <main className="page" style={wide ? { paddingRight: 32 } : undefined}>
        <LimitBanner />
        {children}
        {commandBar && <CommandBar />}
      </main>
    </div>
  );
}

export function Pager({ page, per, total, label, onPage }: { page: number; per: number; total: number; label: string; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (total === 0) return null;
  const from = (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="small muted">
        {from}–{to} of {total} {label}
      </span>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="muted" style={{ minWidth: 24, textAlign: "center" }}>…</span>
          ) : (
            <button key={n} type="button" className="pager-btn" aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>
              {n}
            </button>
          ),
        )}
        <button type="button" className="pager-btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </nav>
  );
}

export function Dialog({ title, onClose, children, label }: { title: ReactNode; onClose: () => void; children: ReactNode; label?: string }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="close-btn" aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C2B33" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }} role="status">
      <span className="spinner" />
      {label && <span className="small muted">{label}</span>}
    </span>
  );
}

/** Shown app-wide when HyperLearn has used its free hosting allowance. */
export function LimitBanner() {
  const { me } = useApp();
  const l = me?.limits;
  if (!l?.uploadsBlocked) return null;
  return (
    <div className="callout callout-warn" role="status">
      <strong style={{ fontSize: 14 }}>New uploads are paused</strong>
      <p className="small">
        HyperLearn has reached its free {l.uploadsBlocked} limit. Your courses still work. To add more material, contact <a href={`mailto:${l.contact}`}>{l.contact}</a>.
      </p>
    </div>
  );
}
