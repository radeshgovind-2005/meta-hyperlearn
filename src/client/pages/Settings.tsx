import { Link, useLocation } from "react-router-dom";
import { UserProfile } from "@clerk/clerk-react";
import { Shell } from "../components/Shell";
import { KeyForm } from "../components/KeyForm";
import { api } from "../lib/api";
import { formatDate, useApi } from "../lib/hooks";
import { useApp, usePageContext } from "../lib/app";

const MODEL_JOBS: Record<string, string> = {
  "muse-spark-1.3": "Muse Spark · structuring, writing, grading, command bar",
  "muse-wonder-1.0": "Muse Wonder · re-planning your path",
  "muse-voice-transcribe-1.0": "Muse Voice Transcribe · recordings and voice input",
  "sam-3.1": "SAM 3.1 · figures from slides",
  "muse-image-1.0": "Muse Image · page pictures and illustrations",
};

function SettingsTabs() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Settings sections" className="tabs" style={{ marginTop: -8 }}>
      <Link to="/settings/account" className="tab" aria-selected={pathname.startsWith("/settings/account")} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", ...(pathname.startsWith("/settings/account") ? { borderBottomColor: "var(--ink)", color: "var(--ink)", fontWeight: 600 } : {}) }}>Account</Link>
      <Link to="/settings/ai" className="tab" aria-selected={pathname === "/settings/ai"} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", ...(pathname === "/settings/ai" ? { borderBottomColor: "var(--ink)", color: "var(--ink)", fontWeight: 600 } : {}) }}>AI and usage</Link>
    </nav>
  );
}

export function SettingsAccountPage() {
  usePageContext({}, []);
  return (
    <Shell commandBar={false}>
      <h1 className="page-title">Settings</h1>
      <SettingsTabs />
      <UserProfile routing="path" path="/settings/account" appearance={{ elements: { rootBox: { width: "100%" }, cardBox: { boxShadow: "none", border: "1px solid #E3E6EA", width: "100%", maxWidth: 880 }, navbar: { background: "#F6F7F9" } } }} />
      <p className="small muted">Account and sign-in are managed by Clerk.</p>
    </Shell>
  );
}

export function SettingsKeyPage() {
  const { me, reloadMe, toast } = useApp();
  const usage = useApi<{ month: string; byModel: { model: string; usd: number; calls: number }[] }>("/api/me/usage");
  usePageContext({}, []);
  const pct = me && me.mode === "byok" ? Math.min(100, Math.round((me.spentUsd / me.capUsd) * 100)) : 0;
  return (
    <Shell commandBar={false}>
      <h1 className="page-title">Settings</h1>
      <SettingsTabs />
      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 28 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <span style={{ fontWeight: 600 }}>Meta Model API key</span>
              {me?.key ? (
                <p className="small muted">sk-…••••{me.key.last4} · added {formatDate(me.key.verifiedAt)} · working</p>
              ) : (
                <p className="small muted">No key saved. You are using the free demo{me ? ` ($${me.demo.spentUsd.toFixed(2)} of the shared $${me.demo.capUsd} used)` : ""}.</p>
              )}
            </div>
            {me?.key && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  if (!window.confirm("Remove your key? AI features will use the shared demo budget.")) return;
                  await api("/api/me/key", { method: "DELETE" });
                  await reloadMe();
                  toast("Key removed");
                }}
              >
                Remove
              </button>
            )}
          </div>
          <KeyForm />
        </div>
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-head">
            <h2 className="section-title">This month</h2>
            <span className="small muted">{me?.mode === "byok" ? `$${me.spentUsd.toFixed(2)} of $${me.capUsd}` : "Demo mode"}</span>
          </div>
          {me?.mode === "byok" && (
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly spend">
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          <table className="table">
            <thead>
              <tr><th>Model and job</th><th>Requests</th><th>Cost</th></tr>
            </thead>
            <tbody>
              {(usage.data?.byModel ?? []).map((u) => (
                <tr key={u.model}>
                  <td>{MODEL_JOBS[u.model] ?? u.model}</td>
                  <td>{u.calls}</td>
                  <td>${u.usd.toFixed(2)}</td>
                </tr>
              ))}
              {usage.data && !usage.data.byModel.length && <tr><td colSpan={3} className="muted">No AI requests this month.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}
