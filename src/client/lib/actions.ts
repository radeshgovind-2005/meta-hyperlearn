import type { NavigateFunction } from "react-router-dom";
import { api } from "./api";
import type { PageContext } from "./app";

export type TutorResult =
  | { kind: "answer"; md: string; cites: { sourceId: string; page?: number; tStart?: number; label: string }[] }
  | { kind: "action"; tool: string; args: Record<string, unknown> };

/** Runs a command bar tool call with the same code paths the UI buttons use. */
export async function runAction(r: Extract<TutorResult, { kind: "action" }>, ctx: PageContext, navigate: NavigateFunction, toast: (m: string) => void): Promise<string | null> {
  const a = r.args;
  switch (r.tool) {
    case "navigate": {
      const t = String(a.target);
      if (t === "section" && ctx.courseId && a.sectionId) navigate(`/courses/${ctx.courseId}/s/${a.sectionId}`);
      else if (t === "history" && ctx.courseId) navigate(`/courses/${ctx.courseId}/history`);
      else if (t === "outline" && ctx.courseId) navigate(`/courses/${ctx.courseId}`);
      else if (t === "settings") navigate("/settings/ai");
      else if (t === "practice" || t === "shared" || t === "library") navigate(`/${t}`);
      else navigate("/library");
      return null;
    }
    case "mutateBlock":
    case "makeWidget": {
      const req = String(a.request ?? "");
      const full = r.tool === "makeWidget" && !/interactive|example|widget|picture|image|illustrat|draw|diagram|sketch/i.test(req) ? `${req}. Give me an interactive example.` : req;
      if (ctx.onMutate) {
        ctx.onMutate(full);
        return null;
      }
      return "Open a section first, then ask again.";
    }
    case "addExercises": {
      if (!ctx.courseId) return "Open a course first.";
      toast("Writing exam-style questions…");
      const s = await api<{ id: string }>("/api/practice", { body: { courseId: ctx.courseId, count: Math.min(8, Math.max(2, Number(a.count ?? 5))) } });
      navigate(`/practice/${s.id}`);
      return null;
    }
    case "share":
      if (ctx.onShare) ctx.onShare();
      else if (ctx.courseId) navigate(`/courses/${ctx.courseId}?share=1`);
      else return "Open a course to share it.";
      return null;
    case "fork": {
      if (!ctx.courseId) return "Open a course first.";
      const f = await api<{ courseId: string }>(`/api/courses/${ctx.courseId}/fork`, { body: {} });
      toast("Made your own copy");
      navigate(`/courses/${f.courseId}`);
      return null;
    }
    case "research": {
      toast("Researching…");
      const res = await api<{ id: string }>("/api/tutor/research", { body: { question: String(a.question ?? ""), courseId: ctx.courseId } });
      navigate(`/research/${res.id}`);
      return null;
    }
    default:
      return "I could not do that yet.";
  }
}
