import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { Dialog } from "./Shell";

export function ShareDialog({ courseId, title, role, onClose }: { courseId: string; title: string; role: string; onClose: () => void }) {
  const { toast, reloadCourses } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"follow" | "copy">("follow");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = role === "owner";

  useEffect(() => {
    if (owner) void api<{ url: string }>(`/api/courses/${courseId}/invites`, { body: {} }).then((r) => setUrl(r.url)).catch(() => {});
  }, [courseId, owner]);

  const link = url ? `${url}${mode === "copy" ? "?how=copy" : ""}` : "";

  if (!owner) {
    return (
      <Dialog title={`Share ${title}`} onClose={onClose}>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--body)" }}>Only the owner can invite people to this course. You can make your own copy: it adapts to you, and you can still pull the owner's updates later.</p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ courseId: string }>(`/api/courses/${courseId}/fork`, { body: {} });
                toast("Made your own copy");
                void reloadCourses();
                onClose();
                navigate(`/courses/${r.courseId}`);
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Make my own copy
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={`Share ${title}`} onClose={onClose}>
      <div className="field">
        <label htmlFor="invite">Invite by email</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="invite" type="email" className="input" style={{ flex: 1, minWidth: 0 }} placeholder="ana@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!/.+@.+\..+/.test(email) || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ emailed: boolean }>(`/api/courses/${courseId}/invites`, { body: { email } });
                toast(r.emailed ? `Invite sent to ${email}` : "Could not send email. Copy the link instead.");
                setEmail("");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Invite
          </button>
        </div>
      </div>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <legend style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>What they get</legend>
        {(
          [
            ["follow", "Follow your course", "Your edits reach them automatically. Their progress and notes stay private."],
            ["copy", "Make their own copy", "It adapts to them. They can still pull your updates later."],
          ] as const
        ).map(([k, t, d]) => (
          <label key={k} style={{ display: "flex", gap: 12, padding: "12px 14px", border: `1px solid ${mode === k ? "var(--primary)" : "var(--input)"}`, borderRadius: 10, cursor: "pointer" }}>
            <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} style={{ accentColor: "#0A5CFF", marginTop: 3 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{t}</span>
              <span className="small muted">{d}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="btn"
          disabled={!url}
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast("Link copied");
          }}
        >
          Copy link
        </button>
        <span className="small muted">They use their own API key for AI features.</span>
      </div>
    </Dialog>
  );
}
