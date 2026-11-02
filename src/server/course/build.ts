import { z } from "zod";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson, DATA_RULE } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { Block, Cite } from "../../shared/types";
import { chunkToCite, chunksForPages, formatChunksForPrompt, getChunks, searchChunks, type ChunkRow } from "../lib/chunks";
import { randomId } from "../lib/crypto";
import { verifySentenceBatch, splitSentences } from "../verify/sentences";
import type { ExamStyle } from "../ingest/pipeline";

// buildCourseGraph nodes: outline → sections as blocks → exam-style exercises → verify → commit v1.

export type SourceInfo = { id: string; filename: string; kind: string; pages: number | null; duration_s: number | null; meta: Record<string, unknown> };

export async function loadSourcesFor(env: Env, courseId: string): Promise<SourceInfo[]> {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.filename, s.kind, s.pages, s.duration_s, s.meta FROM sources s JOIN course_sources cs ON cs.source_id = s.id WHERE cs.course_id = ?",
  )
    .bind(courseId)
    .all<{ id: string; filename: string; kind: string; pages: number | null; duration_s: number | null; meta: string | null }>();
  return results.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : {} }));
}

export function sourceLabel(src: { filename: string }, c: ChunkRow): string {
  if (c.page) return `${src.filename} p.${c.page}`;
  if (c.t_start !== null) return `${src.filename} ${fmtTime(c.t_start)}`;
  return src.filename;
}
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const OutlineSchema = z.object({
  title: z.string(),
  description: z.string(),
  chapters: z.array(
    z.object({
      title: z.string(),
      sections: z.array(
        z.object({
          title: z.string(),
          concept: z.string().describe("the main concept, short lower-case noun phrase"),
          pages: z.array(z.object({ sourceId: z.string(), page: z.number().int() })),
        }),
      ).min(1).max(6),
    }),
  ).min(1).max(3),
});
export type Outline = z.infer<typeof OutlineSchema>;

export async function planOutline(ctx: AiCtx, sources: SourceInfo[], goal: string): Promise<Outline> {
  const docs = sources
    .filter((s) => s.kind !== "exam" && s.kind !== "audio")
    .map((s) => {
      const st = s.meta.structure as { title: string; pages: { page: number; title: string; concepts: string[] }[] } | undefined;
      const pages = (st?.pages ?? []).map((p) => `  page ${p.page}: ${p.title} — ${p.concepts.join(", ")}`).join("\n");
      return asData(`${s.filename} (sourceId ${s.id}, ${s.kind})`, `${st?.title ?? s.filename}\n${pages}`);
    })
    .join("\n");
  const exams = sources.filter((s) => s.kind === "exam").map((s) => s.filename).join(", ");
  return chatJson(ctx, {
    model: MODELS.spark,
    name: "plan-outline",
    schema: OutlineSchema,
    schemaName: "outline",
    reasoningEffort: "medium",
    messages: [
      { role: "system", content: `You design a course from a student's own material. Order sections so prerequisites come first. Every section must point at the exact pages that teach it. ${DATA_RULE}` },
      {
        role: "user",
        content: `Student goal: ${goal || "understand the material and do well on the exam"}.\n${exams ? `They also uploaded past exams (${exams}); the course should cover what those exams test.\n` : ""}Make 1–3 chapters with 3–6 short sections in total per chapter, each 4–8 minutes of reading. Use only pages listed below.\n\n${docs}`,
      },
    ],
  });
}

const SectionDraftSchema = z.object({
  blocks: z.array(
    z.object({
      kind: z.enum(["text", "exercise"]),
      md: z.string().describe("for text: one paragraph of markdown; for exercise: the question"),
      answer: z.string().describe("for exercise: worked answer; for text: empty string"),
      chunkIds: z.array(z.string()).describe("ids of the chunks this block is based on"),
      verbatim: z.boolean().describe("true if the text is copied from the chunk with only minimal edits"),
    }),
  ).max(7).refine((blocks) => blocks.filter((b) => b.kind === "text").length <= 6 && blocks.filter((b) => b.kind === "exercise").length === 1, "Use at most six text blocks and exactly one exercise"),
});
type SectionDraft = z.infer<typeof SectionDraftSchema>;

export function examStyleText(style: ExamStyle | undefined, examName: string | undefined): string {
  if (!style) return "";
  return [
    `Past exam "${examName}" style:`,
    `- format: ${style.format}`,
    `- command words: ${style.verbs.join(", ")}`,
    `- marks: ${style.points}`,
    `- conventions: ${style.conventions.join("; ")}`,
    `- example questions: ${style.questions.slice(0, 4).map((q) => `${q.number}. ${q.text}`).join(" | ")}`,
  ].join("\n");
}

export async function gatherSectionChunks(env: Env, sources: SourceInfo[], pages: { sourceId: string; page: number }[], query: string): Promise<ChunkRow[]> {
  const bySource = new Map<string, number[]>();
  for (const p of pages.filter((p) => sources.some((s) => s.id === p.sourceId && s.kind !== "exam"))) bySource.set(p.sourceId, [...(bySource.get(p.sourceId) ?? []), p.page]);
  const direct: ChunkRow[] = [];
  for (const [sid, ps] of bySource) direct.push(...(await chunksForPages(env, sid, ps)));
  // lecture audio and other sources join through semantic search
  const audioIds = sources.filter((s) => s.kind === "audio" || !bySource.has(s.id)).filter((s) => s.kind !== "exam").map((s) => s.id);
  const related = audioIds.length ? await searchChunks(env, query, audioIds, 4) : [];
  const seen = new Set(direct.map((c) => c.id));
  return [...direct, ...related.filter((c) => !seen.has(c.id))];
}

export async function writeSection(
  env: Env,
  ctx: AiCtx,
  args: { title: string; concept: string; chunks: ChunkRow[]; sources: SourceInfo[]; examStyle?: ExamStyle; examName?: string; examSourceId?: string; previousTitles: string[]; feedback?: string },
): Promise<Block[]> {
  const srcById = new Map(args.sources.map((s) => [s.id, s]));
  const material = formatChunksForPrompt(args.chunks, (c) => sourceLabel(srcById.get(c.source_id) ?? { filename: "source" }, c));
  const draft: SectionDraft = await chatJson(ctx, {
    model: MODELS.spark,
    name: "write-section",
    schema: SectionDraftSchema,
    schemaName: "section",
    reasoningEffort: "medium",
    maxTokens: 6000,
    messages: [
      {
        role: "system",
        content: [
          "You write one section of a course for a student, using only their material.",
          "Rules: prefer the source's own wording; copy it (verbatim=true) when it already reads well as prose, rephrase only when slide fragments must become sentences.",
          "Every text block is one paragraph and must cite the chunk ids it uses. Never state anything the chunks don't support. No filler, no emoji, plain and direct.",
          "Use $...$ for inline math only when needed; prefer plain notation like Av = λv.",
          DATA_RULE,
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Section: "${args.title}" (concept: ${args.concept}). Earlier sections: ${args.previousTitles.join("; ") || "none"}.`,
          "Write 3–6 text blocks that teach it in order, then exactly 1 exercise block: ONE new question about this section only (parts (a)/(b) allowed), not a copy of the past exam and not a list of questions.",
          args.examStyle ? `The exercise must follow this exam style:\n${examStyleText(args.examStyle, args.examName)}` : "The exercise should check understanding with a short worked answer.",
          args.feedback ? `Fix these problems from the last attempt:\n${args.feedback}` : "",
          "",
          "Material:",
          asData("student material", material),
        ].join("\n"),
      },
    ],
  });
  const valid = new Map(args.chunks.map((c) => [c.id, c]));
  const blocks: Block[] = [];
  for (const b of draft.blocks) {
    const cites: Cite[] = b.chunkIds.filter((id) => valid.has(id)).map((id) => chunkToCite(valid.get(id)!));
    if (b.kind === "text") {
      if (!cites.length || !b.md.trim()) continue;
      blocks.push({ id: randomId("b"), kind: "text", md: b.md.trim(), cites, origin: b.verbatim ? "source" : "rephrased" });
    } else {
      blocks.push({
        id: randomId("b"),
        kind: "exercise",
        prompt: b.md.trim(),
        answer: b.answer.trim(),
        cites,
        ...(args.examSourceId ? { styleOf: args.examSourceId } : {}),
      });
    }
  }
  return blocks;
}

/** Verify node: checks every sentence; drops sentences the verifier can't support. */
export async function verifyBlocks(env: Env, ctx: AiCtx, blocks: Block[]): Promise<{ blocks: Block[]; problems: string[]; checked: number; supported: number; verifier: string }> {
  const problems: string[] = [];
  let checked = 0;
  let supported = 0;
  let verifier = "none";
  const out: Block[] = [];
  const texts = blocks.filter((b) => b.kind === "text");
  const chunks = await getChunks(env, texts.flatMap((b) => b.cites.map((c) => c.chunkId!).filter(Boolean)));
  const groups = texts.map((b) => ({
    md: b.md,
    evidence: chunks.filter((ch) => b.cites.some((c) => c.chunkId === ch.id && c.sourceId === ch.source_id)).map((ch) => ch.text),
  }));
  const result = await verifySentenceBatch(env, ctx, groups);
  blocks.forEach((b) => {
    const group = texts.indexOf(b as typeof texts[number]);
    const r = b.kind === "text" ? { checks: result.checks.filter((c) => c.group === group), verifier: result.verifier } : null;
    if (!r) return out.push(b);
    verifier = r.verifier;
    checked += r.checks.length;
    const ok = r.checks.filter((c) => c.supported);
    supported += ok.length;
    for (const c of r.checks.filter((c) => !c.supported)) problems.push(`"${c.sentence}" — ${c.reason}`);
    if (ok.length === r.checks.length) out.push(b);
    else if (ok.length && b.kind === "text") out.push({ ...b, md: ok.map((c) => c.sentence).join(" ") });
  });
  return { blocks: out, problems, checked, supported, verifier };
}

export { splitSentences };
