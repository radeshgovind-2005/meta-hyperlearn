import "./als";
import { z } from "zod";
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { chatJson, DATA_RULE } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { RunEvent } from "../../shared/types";
import { commitSnapshot, courseSnapshot, getBlocks, putBlocks, saveOwnPath } from "../lib/blocks";
import { randomId } from "../lib/crypto";
import { recordRunTrace } from "../lib/runs";
import { allMastery } from "../lib/mastery";
import { loadSourcesFor, verifyBlocks, writeSection } from "../course/build";
import { pathWithTitles } from "../course/practice";
import { warmNarration, type Defer } from "../course/narrate";
import { searchChunks } from "../lib/chunks";

export const ADAPT_STEPS = ["Graded against the exam's marking pattern", "Diagnosed the mistake", "Re-planned the next sections", "Wrote the review from your sources", "Checked every sentence against its source"];

const DiagnosisSchema = z.object({
  concept: z.string().describe("the concept the student is missing, short lower-case noun phrase"),
  isPrerequisite: z.boolean().describe("true if it is taught before (or outside) the section the question was about"),
  explanation: z.string().describe("one sentence, addressed to the student"),
});

const ReplanSchema = z.object({
  insert: z
    .array(z.object({ beforeSectionId: z.string(), title: z.string(), concept: z.string(), minutes: z.number().int(), why: z.string() }))
    .describe("at most one short review section to insert"),
  move: z.array(z.object({ sectionId: z.string(), afterSectionId: z.string(), why: z.string() })).describe("at most one move"),
  message: z.string().describe("2 sentences to the student: what was right, what was the problem, what changed in their course"),
});

export type AdaptDeps = { env: Env; ctx: AiCtx; emit: (e: RunEvent) => void; defer?: Defer };

const AdaptState = Annotation.Root({
  runId: Annotation<string>(),
  userId: Annotation<string>(),
  courseId: Annotation<string>(),
  isOwner: Annotation<boolean>(),
  question: Annotation<{ prompt: string; concept: string; sectionId: string | null }>(),
  grade: Annotation<{ feedback: string; mistake: string; errorConcept: string }>(),
  diagnosis: Annotation<z.infer<typeof DiagnosisSchema> | null>({ reducer: (_, b) => b, default: () => null }),
  plan: Annotation<z.infer<typeof ReplanSchema> | null>({ reducer: (_, b) => b, default: () => null }),
  newSections: Annotation<{ id: string; title: string; concept: string; chapter: string; hashes: string[]; beforeSectionId: string }[]>({ reducer: (_, b) => b, default: () => [] }),
  newPath: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  decision: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
});
type S = typeof AdaptState.State;

export function buildAdaptGraph(deps: AdaptDeps, checkpointer: BaseCheckpointSaver) {
  const { env, ctx, emit } = deps;
  const step = (s: S, index: number, status: "active" | "done" | "failed", detail?: string) => emit({ type: "run.step", runId: s.runId, index, label: ADAPT_STEPS[index], status, detail });
  const trace = (s: S, label: string, model?: string) => recordRunTrace(env, s.runId, { label, model });

  async function diagnose(s: S): Promise<Partial<S>> {
    step(s, 0, "done");
    step(s, 1, "active");
    const { sections } = await pathWithTitles(env, s.courseId, s.userId);
    const diagnosis = await chatJson(ctx, {
      model: MODELS.spark,
      name: "diagnose",
      schema: DiagnosisSchema,
      schemaName: "diagnosis",
      reasoningEffort: "medium",
      maxTokens: 800,
      messages: [
        { role: "system", content: "You find the concept behind a student's mistake. Prefer the most basic missing concept (often a prerequisite)." },
        {
          role: "user",
          content: `Course sections: ${sections.map((x) => `${x.title} [${x.concept}]`).join("; ")}\nQuestion (about "${s.question.concept}"): ${s.question.prompt}\nGrader feedback: ${s.grade.feedback}\nMistake: ${s.grade.mistake}\nGrader's concept guess: ${s.grade.errorConcept}`,
        },
      ],
    });
    await trace(s, `Diagnosed the error as: ${diagnosis.concept}`, MODELS.spark);
    step(s, 1, "done", diagnosis.concept);
    return { diagnosis };
  }

  async function replan(s: S): Promise<Partial<S>> {
    step(s, 2, "active");
    const { sections, view } = await pathWithTitles(env, s.courseId, s.userId);
    const mastery = await allMastery(env, s.userId, s.courseId);
    const path = sections.map((x, k) => `${k + 1}. id=${x.id} "${x.title}" concept="${x.concept}" chapter="${x.chapter}" mastery=${Math.round((mastery[x.concept] ?? 0.5) * 100)}%`).join("\n");
    const plan = await chatJson(ctx, {
      model: MODELS.wonder,
      name: "replan-path",
      schema: ReplanSchema,
      schemaName: "path_diff",
      reasoningEffort: "medium",
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: `You re-plan a student's learning path after a practice mistake. Output a small diff, never a new course.
- If the mistake comes from a prerequisite (the student got the method right but slipped on an earlier skill), insert ONE short targeted review (3-5 minutes) right before the section the question was about, titled like "Determinants review", focused on exactly that slip. Do this even if a full section on the prerequisite exists earlier: the review is a quick recap of the specific mistake.
- Move a section only to push a later topic after more practice; never move a section before its prerequisites.
- If the mistake was careless and the concept is clearly mastered, change nothing.
${DATA_RULE}`,
        },
        {
          role: "user",
          content: `Current path:\n${path}\n\nThe question was about section ${s.question.sectionId ?? "unknown"} ("${s.question.concept}").\nDiagnosis: missing "${s.diagnosis!.concept}" (${s.diagnosis!.isPrerequisite ? "a prerequisite" : "the same topic"}). ${s.diagnosis!.explanation}\nInsert reviews right before the section the question was about. Reviews are 3–5 minutes.`,
        },
      ],
    });
    plan.insert = plan.insert.slice(0, 1).filter((i) => view.path.includes(i.beforeSectionId));
    // the student-facing message is written from the diff we will actually apply
    const titleOf = (id: string) => sections.find((x) => x.id === id)?.title ?? "the next section";
    const facts = [
      `What the grader said: ${s.grade.feedback}`,
      `Missing concept: ${s.diagnosis!.concept}`,
      ...plan.insert.map((i) => `Change: add a ${i.minutes}-minute review "${i.title}" before "${titleOf(i.beforeSectionId)}"`),
      ...plan.move.map((m) => `Change: move "${titleOf(m.sectionId)}" after "${titleOf(m.afterSectionId)}"`),
    ];
    if (!plan.insert.length && !plan.move.length) facts.push("Change: none, the course already covers it");
    plan.message = (
      await chatJson(ctx, {
        model: MODELS.spark,
        name: "replan-message",
        schema: z.object({ message: z.string() }),
        schemaName: "message",
        reasoningEffort: "low",
        maxTokens: 300,
        messages: [{ role: "user", content: `Write 2 short sentences to the student: first what they got right and what the actual problem was, then what changed in their course and why. Plain, warm, no emoji.\n${facts.join("\n")}` }],
      })
    ).message;
    plan.move = plan.move.slice(0, 1).filter((m) => view.path.includes(m.sectionId) && view.path.includes(m.afterSectionId));
    await trace(s, `Re-planned the path: ${plan.insert.length} review inserted, ${plan.move.length} section moved`, MODELS.wonder);
    step(s, 2, "done");
    return { plan };
  }

  async function writeReviews(s: S): Promise<Partial<S>> {
    if (!s.plan?.insert.length) return { newSections: [] };
    step(s, 3, "active");
    const sources = await loadSourcesFor(env, s.courseId);
    const { sections } = await pathWithTitles(env, s.courseId, s.userId);
    const out: S["newSections"] = [];
    for (const ins of s.plan.insert) {
      const chunks = await searchChunks(env, `${ins.concept}: ${ins.title}`, sources.filter((x) => x.kind !== "exam").map((x) => x.id), 10);
      const before = sections.find((x) => x.id === ins.beforeSectionId);
      let blocks = await writeSection(env, ctx, { title: ins.title, concept: ins.concept, chunks, sources, previousTitles: sections.slice(0, Math.max(0, sections.indexOf(before!))).map((x) => x.title) });
      // Verify node (next) re-checks; here we only keep block text supported by sources.
      const v = await verifyBlocks(env, ctx, blocks);
      if (v.problems.length) {
        blocks = await writeSection(env, ctx, { title: ins.title, concept: ins.concept, chunks, sources, previousTitles: [], feedback: v.problems.join("\n") });
      }
      out.push({ id: randomId("sec"), title: ins.title, concept: ins.concept, chapter: before?.chapter ?? "", hashes: await putBlocks(env, blocks), beforeSectionId: ins.beforeSectionId });
    }
    const names = sources.filter((x) => x.kind !== "exam").map((x) => x.filename);
    await trace(s, `Wrote ${out.length} review from ${names.slice(0, 2).join(", ")} only`, MODELS.spark);
    step(s, 3, "done");
    return { newSections: out };
  }

  async function verify(s: S): Promise<Partial<S>> {
    step(s, 4, "active");
    let checked = 0;
    let supported = 0;
    const fixed: S["newSections"] = [];
    let verifier = "";
    for (const ns of s.newSections) {
      const v = await verifyBlocks(env, ctx, await getBlocks(env, ns.hashes));
      checked += v.checked;
      supported += v.supported;
      verifier = v.verifier;
      fixed.push({ ...ns, hashes: await putBlocks(env, v.blocks) });
    }
    if (checked) await trace(s, `Checked ${checked} sentences: ${supported} matched, ${checked - supported} removed`, verifier);
    step(s, 4, "done", checked ? `${supported} of ${checked} matched` : undefined);

    const { view } = await pathWithTitles(env, s.courseId, s.userId);
    const path = [...view.path];
    for (const ns of fixed) path.splice(Math.max(0, path.indexOf(ns.beforeSectionId)), 0, ns.id);
    for (const m of s.plan?.move ?? []) {
      path.splice(path.indexOf(m.sectionId), 1);
      path.splice(path.indexOf(m.afterSectionId) + 1, 0, m.sectionId);
    }
    return { newSections: fixed, newPath: path };
  }

  async function review(s: S, config?: { configurable?: Record<string, unknown> }): Promise<Partial<S>> {
    const pad = (config?.configurable as { __pregel_scratchpad?: { resume?: unknown[]; nullResume?: unknown } } | undefined)?.__pregel_scratchpad;
    const resuming = Boolean(pad?.resume?.length) || pad?.nullResume !== undefined;
    const changed = s.newSections.length || s.plan?.move.length;
    if (!changed) {
      emit({ type: "run.done", runId: s.runId, status: "done", message: s.plan?.message });
      return { decision: "none" };
    }
    if (!resuming) emit({ type: "run.waiting", runId: s.runId, summary: [s.plan!.message], section: { id: "", courseId: s.courseId, version: 0, title: "", blocks: [] }, before: { id: "", courseId: s.courseId, version: 0, title: "", blocks: [] } });
    return { decision: interrupt({ message: s.plan!.message }) as string };
  }

  async function commit(s: S): Promise<Partial<S>> {
    if (s.decision === "none") return {};
    if (s.decision !== "keep") {
      await trace(s, "You chose Undo; the course path is unchanged");
      emit({ type: "run.done", runId: s.runId, status: "undone" });
      return {};
    }
    const now = Date.now();
    const stmts = s.newSections.flatMap((ns) => [
      env.DB.prepare("INSERT INTO sections (id, course_id, chapter, concept, origin, created_at) VALUES (?, ?, ?, ?, 'adapt', ?)").bind(ns.id, s.courseId, ns.chapter, ns.concept, now),
      env.DB.prepare("INSERT INTO section_versions (section_id, version, title, block_hashes, created_at) VALUES (?, 1, ?, ?, ?)").bind(ns.id, ns.title, JSON.stringify(ns.hashes), now),
    ]);
    if (stmts.length) await env.DB.batch(stmts);
    const snap = (await courseSnapshot(env, s.courseId))!;
    const summary = s.newSections.length ? `Added ${s.newSections.map((n) => n.title).join(", ")} after practice` : "Reordered sections after practice";
    let courseVersion: number | undefined;
    if (s.isOwner) {
      const sections = { ...snap.sections, ...Object.fromEntries(s.newSections.map((n) => [n.id, 1])) };
      courseVersion = await commitSnapshot(env, { courseId: s.courseId, path: s.newPath, sections, userId: s.userId, kind: "adapt", summary, runId: s.runId });
    } else {
      await saveOwnPath(env, s.courseId, s.userId, s.newPath, snap.version);
    }
    await trace(s, courseVersion ? `Saved as version ${courseVersion}` : "Saved to your own path of this course");
    emit({ type: "run.done", runId: s.runId, status: "kept", courseVersion, message: summary });
    for (const ns of s.newSections) deps.defer?.(getBlocks(env, ns.hashes).then((blocks) => warmNarration(env, s.userId, ns.title, blocks)));
    return {};
  }

  return new StateGraph(AdaptState)
    .addNode("diagnose", diagnose)
    .addNode("replan", replan)
    .addNode("writeReviews", writeReviews)
    .addNode("verify", verify)
    .addNode("review", review)
    .addNode("commit", commit)
    .addEdge(START, "diagnose")
    .addEdge("diagnose", "replan")
    .addEdge("replan", "writeReviews")
    .addEdge("writeReviews", "verify")
    .addEdge("verify", "review")
    .addEdge("review", "commit")
    .addEdge("commit", END)
    .compile({ checkpointer });
}
