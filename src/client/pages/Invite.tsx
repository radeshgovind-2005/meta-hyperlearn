import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import { api, setTokenGetter } from "../lib/api";
import { formatDate } from "../lib/hooks";

type Preview = { course: { id: string; title: string; description: string | null; updated_at: number }; sharedBy: string; sources: number; sectionCount: number; firstSections: string[] };

/** Public invite preview. Signed-in users can follow or copy right away. */
export function InvitePage() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [how, setHow] = useState<"follow" | "copy">(params.get("how") === "copy" ? "copy" : "follow");
  const [busy, setBusy] = useState(false);
  useEffect(() => setTokenGetter(() => getToken()), [getToken]);
  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(async (r) => (r.ok ? setP((await r.json()) as Preview) : setErr(((await r.json()) as { error: string }).error)))
      .catch(() => setErr("Could not load this invite"));
  }, [token]);
  const anonymous = !p || /^a hyperlearn user$/i.test(p.sharedBy);
  const first = anonymous ? "the owner" : p!.sharedBy.split(" ")[0];
  const firstCap = anonymous ? "The owner" : first;
  const here = `/invite/${token}${how === "copy" ? "?how=copy" : ""}`;
  const accept = async () => {
    setBusy(true);
    try {
      const r = await api<{ courseId: string }>(`/api/invite/${token}/${how}`, { body: {} });
      navigate(`/courses/${r.courseId}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="onb-head">
        <img src="/logo.png" alt="HyperLearn" style={{ height: 24, width: "auto" }} />
        <SignedOut><Link to={`/sign-in?redirect=${encodeURIComponent(here)}`} style={{ fontSize: 14, fontWeight: 500, textDecoration: "none" }}>Sign in</Link></SignedOut>
      </header>
      <main className="onb-main">
        <section className="onb-card">
          {err && <p className="err-text">{err}</p>}
          {p && (
            <>
              <p className="small muted">{p.sharedBy} shared a course with you</p>
              <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.015em" }}>{p.course.title}</h1>
              <p className="muted">{p.sources} sources · {p.sectionCount} sections · updated {formatDate(p.course.updated_at)}</p>
              <div className="card" style={{ gap: 8 }}>
                {p.firstSections.map((t, i) => (
                  <div key={i} className="row" style={{ fontSize: 15 }}><span className="muted" style={{ width: 28 }}>{i + 1}</span>{t}</div>
                ))}
                {p.sectionCount > p.firstSections.length && <p className="small muted">and {p.sectionCount - p.firstSections.length} more sections</p>}
              </div>
              <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <legend style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>How do you want it?</legend>
                {(
                  [
                    ["follow", anonymous ? "Follow this course" : `Follow ${first}'s course`, `${firstCap}'s updates reach you automatically`],
                    ["copy", "Make my own copy", "It adapts to you"],
                  ] as const
                ).map(([k, t, d]) => (
                  <label key={k} style={{ display: "flex", gap: 12, padding: "12px 14px", border: `1px solid ${how === k ? "var(--primary)" : "var(--input)"}`, borderRadius: 10, cursor: "pointer" }}>
                    <input type="radio" name="how" checked={how === k} onChange={() => setHow(k)} style={{ accentColor: "#0A5CFF" }} />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 500 }}>{t}</span>
                      <span className="small muted">{d}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <SignedOut>
                <div className="row">
                  <Link to={`/sign-up?redirect=${encodeURIComponent(here)}`} className="btn btn-primary btn-lg">Sign up to add it</Link>
                  <Link to={`/sign-in?redirect=${encodeURIComponent(here)}`} className="btn btn-lg">I have an account</Link>
                </div>
              </SignedOut>
              <SignedIn>
                <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => void accept()}>{how === "follow" ? "Follow this course" : "Make my copy"}</button>
              </SignedIn>
              <p className="hint">Free to read. AI features use your own Meta API key.</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
