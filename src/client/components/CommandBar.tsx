import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { runAction, type TutorResult } from "../lib/actions";
import { startVoice, type VoiceSession } from "../lib/voice";
import { ArrowUp, Close, Mic } from "./Icons";
import { Md } from "./Md";
import { utterance } from "../lib/speech";

/** The "Ask, or tell HyperLearn what to do" bar, pinned to the bottom of every screen. */
export function CommandBar({ placeholder, micTrigger = 0, speakAnswers = false, onAnswered }: { placeholder?: string; micTrigger?: number; speakAnswers?: boolean; onAnswered?: () => void }) {
  const { pageContext, toast } = useApp();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Extract<TutorResult, { kind: "answer" }> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const voice = useRef<VoiceSession | null>(null);

  async function submit(value: string) {
    const q = value.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote(null);
    setAnswer(null);
    try {
      const r = await api<TutorResult>("/api/tutor", { body: { text: q, courseId: pageContext.courseId, sectionId: pageContext.sectionId } });
      if (r.kind === "answer") {
        setAnswer(r);
        // in Listen mode the answer is spoken too, so the student can keep their eyes off the screen
        if (speakAnswers && window.speechSynthesis) {
          const u = utterance(r.md.replace(/\[\^?\d+\]|[*_`$#>]/g, ""));
          u.onend = () => onAnswered?.();
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } else onAnswered?.();
      } else {
        setNote(await runAction(r, pageContext, navigate, toast));
        onAnswered?.();
      }
      setText("");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMic() {
    if (listening) {
      voice.current?.stop();
      setListening(false);
      return;
    }
    try {
      voice.current = await startVoice(
        (t) => setText(t),
        (t) => {
          setListening(false);
          if (t) void submit(t);
        },
        (msg) => {
          setListening(false);
          setNote(msg);
        },
      );
      setListening(true);
    } catch {
      setNote("Microphone access was blocked.");
    }
  }

  // Listen mode's "Ask by voice" opens the microphone here
  const toggleRef = useRef(toggleMic);
  toggleRef.current = toggleMic;
  useEffect(() => {
    if (micTrigger > 0) void toggleRef.current();
  }, [micTrigger]);

  const ph =
    placeholder ??
    (pageContext.sectionTitle ? `Ask about ${pageContext.sectionTitle}, or tell HyperLearn what to do` : "Ask, or tell HyperLearn what to do");

  return (
    <div className="cmdbar-dock" style={{ maxWidth: pageContext.sectionId ? 680 : undefined }}>
      {answer && (
        <div className="answer-card" aria-live="polite">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label-caps">From your sources</span>
            <button type="button" className="close-btn" aria-label="Close answer" onClick={() => setAnswer(null)}>
              <Close size={16} />
            </button>
          </div>
          <p className="serif" style={{ fontSize: 17, color: "var(--ink)" }}>
            <Md text={answer.md} />
          </p>
          {answer.cites.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
              {answer.cites.map((c, i) => (
                <li key={i}>
                  <a href={`/sources/${c.sourceId}${c.page ? `?page=${c.page}` : c.tStart !== undefined ? `?t=${c.tStart}` : ""}`} style={{ textDecoration: "none" }}>{c.label}</a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {note && (
        <p className="small muted" role="status">
          {note}
        </p>
      )}
      <form
        className="cmdbar"
        aria-label="Ask or do something"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <label htmlFor="cmd" className="sr-only">Ask or do something</label>
        <input id="cmd" type="text" placeholder={listening ? "Listening…" : ph} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoComplete="off" />
        {busy ? <span className="spinner" /> : <span className="kbd" aria-hidden="true">/</span>}
        <button type="button" className={`icon-btn ${listening ? "rec" : "ghost"}`} aria-label={listening ? "Stop voice input" : "Speak"} aria-pressed={listening} onClick={() => void toggleMic()}>
          <Mic color={listening ? "#FFFFFF" : "#1C2B33"} />
        </button>
        <button type="submit" className="icon-btn" aria-label="Send" disabled={busy}>
          <ArrowUp />
        </button>
      </form>
    </div>
  );
}
