import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/app";

/** Paste, verify and save a Meta Model API key (stored encrypted on the server). */
export function KeyForm({ onSaved, compact = false }: { onSaved?: () => void; compact?: boolean }) {
  const { me, reloadMe } = useApp();
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "checking" | "ok" | "bad"; msg?: string }>({ kind: "idle" });
  const [cap, setCap] = useState<string>(String(me?.capUsd ?? 20));

  const save = async () => {
    setState({ kind: "checking" });
    try {
      await api("/api/me/key", { method: "PUT", body: { key } });
      if (Number(cap) !== me?.capUsd && Number(cap) >= 1) await api("/api/me/cap", { method: "PUT", body: { usd: Number(cap) } });
      setState({ kind: "ok", msg: "Key works. All HyperLearn features are available." });
      setKey("");
      await reloadMe();
      onSaved?.();
    } catch (e) {
      setState({ kind: "bad", msg: (e as Error).message });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="field">
        <label htmlFor="key">API key</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="key" type="password" className="input" style={{ flex: 1, minWidth: 0 }} autoComplete="off" placeholder={me?.key ? `Saved key ending ${me.key.last4}` : "Paste your key"} value={key} onChange={(e) => { setKey(e.target.value); setState({ kind: "idle" }); }} />
          <button type="button" className="btn btn-lg" disabled={key.trim().length < 8 || state.kind === "checking"} onClick={() => void save()}>
            {state.kind === "checking" ? "Checking…" : "Verify"}
          </button>
        </div>
        {state.msg && <p className={state.kind === "ok" ? "small ok-text" : "small err-text"} role="status">{state.msg}</p>}
      </div>
      {!compact && (
        <div className="field">
          <label htmlFor="cap">Monthly limit</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <span className="muted">$</span>
            <input id="cap" type="number" min={1} max={1000} className="input" style={{ width: 120 }} value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => Number(cap) >= 1 && void api("/api/me/cap", { method: "PUT", body: { usd: Number(cap) } }).then(reloadMe)} />
          </div>
          <p className="hint">AI features pause when you reach it.</p>
        </div>
      )}
    </div>
  );
}
