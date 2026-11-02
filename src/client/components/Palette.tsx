import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { runAction, type TutorResult } from "../lib/actions";
import { Md } from "./Md";

type Item = { group: "Do" | "Go to" | "Research" | "Ask"; label: string; hint?: string; run: () => Promise<void> | void };

/** Global command palette (/ or Cmd+K). Same tools as the UI. */
export function Palette({ prefill, onClose }: { prefill?: string; onClose: () => void }) {
  const { pageContext, courses, toast } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState(prefill ?? "");
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    if (pageContext.courseId)
      void api<{ sections: { id: string; title: string }[] }>(`/api/courses/${pageContext.courseId}`).then((r) => setSections(r.sections)).catch(() => {});
  }, [pageContext.courseId]);

  const ask = async (text: string) => {
    setBusy(true);
    try {
      const r = await api<TutorResult>("/api/tutor", { body: { text, courseId: pageContext.courseId, sectionId: pageContext.sectionId } });
      if (r.kind === "answer") setAnswer(r.md);
      else {
        const msg = await runAction(r, pageContext, navigate, toast);
        if (msg) setAnswer(msg);
        else onClose();
      }
    } catch (e) {
      setAnswer((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = (label: string, fn: () => Promise<void> | void): Item => ({ group: "Do", label, run: fn });

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    if (pageContext.sectionId && pageContext.onMutate) {
      const m = pageContext.onMutate;
      list.push(
        act("Make 5 exam-style questions for this section", async () => {
          toast("Writing exam-style questions…");
          const s = await api<{ id: string }>("/api/practice", { body: { courseId: pageContext.courseId, count: 5 } });
          navigate(`/practice/${s.id}`);
          onClose();
        }),
        act("Make an interactive example", () => { m("Give me an interactive example I can play with."); onClose(); }),
        act("Draw a picture of this idea", () => { m("Draw an illustration of this idea."); onClose(); }),
        act("Make this section simpler", () => { m("This is too complex. Simplify it."); onClose(); }),
        act("Explain it with an analogy", () => { m("Explain it with an analogy."); onClose(); }),
      );
    }
    if (pageContext.courseId) {
      list.push(
        act("Practice this course", async () => {
          toast("Writing exam-style questions…");
          const s = await api<{ id: string }>("/api/practice", { body: { courseId: pageContext.courseId, count: 5 } });
          navigate(`/practice/${s.id}`);
          onClose();
        }),
        act("Share this course", () => { if (pageContext.onShare) pageContext.onShare(); else navigate(`/courses/${pageContext.courseId}?share=1`); onClose(); }),
        act("Open course history", () => { navigate(`/courses/${pageContext.courseId}/history`); onClose(); }),
      );
      for (const s of sections) list.push({ group: "Go to", label: s.title, hint: "Section", run: () => { navigate(`/courses/${pageContext.courseId}/s/${s.id}`); onClose(); } });
    }
    for (const c of courses) list.push({ group: "Go to", label: c.title, hint: "Course", run: () => { navigate(`/courses/${c.id}`); onClose(); } });
    list.push(
      { group: "Go to", label: "Library", hint: "Page", run: () => { navigate("/library"); onClose(); } },
      { group: "Go to", label: "Settings: AI and usage", hint: "Page", run: () => { navigate("/settings/ai"); onClose(); } },
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageContext, sections, courses]);

  const query = q.trim().toLowerCase();
  const filtered = items.filter((i) => !query || i.label.toLowerCase().includes(query)).slice(0, 9);
  const freeform: Item[] = query
    ? [
        { group: "Ask", label: `Ask: ${q.trim()}`, hint: "Your sources", run: () => ask(q.trim()) },
        { group: "Research", label: `Research: ${q.trim()}`, hint: "Uses the web", run: () => ask(`Research using the web: ${q.trim()}`) },
      ]
    : [];
  const all = [...filtered, ...freeform];
  const groups = ["Do", "Go to", "Ask", "Research"] as const;

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog palette" role="dialog" aria-modal="true" aria-label="Command bar">
        <div className="palette-input">
          <label htmlFor="pal" className="sr-only">Command</label>
          <input
            id="pal"
            ref={input}
            type="text"
            value={q}
            placeholder="Type a command or a question"
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
              setAnswer(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(all.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") {
                e.preventDefault();
                const it = filtered.length && query && !filtered[sel] ? null : all[sel];
                if (it) void it.run();
                else if (query) void ask(q.trim());
              }
            }}
          />
          {busy && <span className="spinner" />}
          {pageContext.sectionTitle && <span className="small muted">In {pageContext.sectionTitle}</span>}
        </div>
        {answer ? (
          <div style={{ padding: 18 }} className="serif" aria-live="polite">
            <Md text={answer} />
          </div>
        ) : (
          <div className="palette-list" role="listbox" aria-label="Commands">
            {groups.map((g) => {
              const its = all.map((it, idx) => ({ it, idx })).filter((x) => x.it.group === g);
              if (!its.length) return null;
              return (
                <div key={g} role="group" aria-label={g}>
                  <p className="palette-group">{g}</p>
                  {its.map(({ it, idx }) => (
                    <button key={idx} type="button" role="option" aria-selected={idx === sel} className="palette-item" onMouseEnter={() => setSel(idx)} onClick={() => void it.run()}>
                      <span>{it.label}</span>
                      <span className="small muted">{idx === sel ? "Enter" : it.hint ?? ""}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="palette-foot">
          <span>Enter to run</span>
          <span>Esc to close</span>
          <span style={{ marginLeft: "auto" }}>Answers use your sources first</span>
        </div>
      </section>
    </div>
  );
}
