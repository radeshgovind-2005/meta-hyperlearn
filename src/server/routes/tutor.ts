import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { courseAccess, errorResponse } from "../lib/http";
import { asData, chat, DATA_RULE, getAiCtx, metaFetch, recordSpend, type ToolDef } from "../ai/meta";
import { MODELS, tokenCost } from "../ai/models";
import { chunkToCite, searchChunks } from "../lib/chunks";
import { pathWithTitles } from "../course/practice";
import { fmtTime } from "../course/build";
import { createRun, finishRun, recordRunTrace } from "../lib/runs";
import { randomId } from "../lib/crypto";

// The command bar router: Ask (answers from the user's sources, cited), Act (same tools as the UI), Research.

const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "ask", description: "Answer a question about the course material using the student's own sources.", parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } } },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Open a screen. target is one of library, practice, shared, settings, history, outline, section, source.",
      parameters: { type: "object", properties: { target: { type: "string", enum: ["library", "practice", "shared", "settings", "history", "outline", "section", "source"] }, sectionTitle: { type: "string" }, sourceName: { type: "string" }, page: { type: "number" } }, required: ["target"] },
    },
  },
  { type: "function", function: { name: "mutateBlock", description: "Change the current section: simplify, rewrite, add examples, analogy, exam focus.", parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } } },
  { type: "function", function: { name: "makeWidget", description: "Add an interactive example to the current section.", parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } } },
  { type: "function", function: { name: "addExercises", description: "Start a practice round of exam-style questions.", parameters: { type: "object", properties: { count: { type: "number" }, chapter: { type: "string" } }, required: [] } } },
  { type: "function", function: { name: "share", description: "Open the share dialog for the current course.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "fork", description: "Make the student's own copy of the current course.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "research", description: "Research a question beyond the course using the web. Only when the student asks for outside sources or the material clearly can't answer.", parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } } },
];

async function courseSourceIds(env: Env, courseId: string | undefined, userId: string): Promise<{ ids: string[]; names: Map<string, string> }> {
  const { results } = courseId
    ? await env.DB.prepare("SELECT s.id, s.filename FROM sources s JOIN course_sources cs ON cs.source_id = s.id WHERE cs.course_id = ? AND s.kind != 'exam'").bind(courseId).all<{ id: string; filename: string }>()
    : await env.DB.prepare("SELECT id, filename FROM sources WHERE owner_id = ? AND status = 'ready' AND kind != 'exam'").bind(userId).all<{ id: string; filename: string }>();
  return { ids: results.map((r) => r.id), names: new Map(results.map((r) => [r.id, r.filename])) };
}

export async function answerFromSources(env: Env, userId: string, question: string, courseId?: string) {
  const ctx = await getAiCtx(env, userId);
  const { ids, names } = await courseSourceIds(env, courseId, userId);
  const chunks = await searchChunks(env, question, ids, 8);
  const label = (c: (typeof chunks)[number]) => `${names.get(c.source_id) ?? "source"}${c.page ? ` p.${c.page}` : c.t_start !== null ? ` ${fmtTime(c.t_start)}` : ""}`;
  const r = await chat(ctx, {
    model: MODELS.spark,
    name: "ask",
    reasoningEffort: "low",
    maxTokens: 1200,
    messages: [
      { role: "system", content: `Answer the student's question in 2–5 plain sentences using only the chunks. After each sentence put the chunk number(s) it uses in square brackets, like [1] or [1,3]. If the chunks don't answer it, say so in one sentence. ${DATA_RULE}` },
      { role: "user", content: `Question: ${question}\n\n${asData("chunks", chunks.map((c, k) => `[${k + 1}] (${label(c)})\n${c.text}`).join("\n\n"))}` },
    ],
  });
  return { md: r.content.trim(), cites: chunks.map((c) => ({ ...chunkToCite(c), label: label(c) })) };
}

export const tutor = new Hono<AppEnv>()
  .post("/", async (c) => {
    const userId = c.get("userId");
    const body = z.object({ text: z.string().min(1).max(1000), courseId: z.string().optional(), sectionId: z.string().optional() }).parse(await c.req.json());
    if (body.courseId && !(await courseAccess(c.env, body.courseId, userId))) return c.json({ error: "Not found" }, 404);
    try {
      const ctx = await getAiCtx(c.env, userId);
      let where = "the library";
      let sectionList = "";
      if (body.courseId) {
        const { sections } = await pathWithTitles(c.env, body.courseId, userId);
        const cur = sections.find((s) => s.id === body.sectionId);
        where = cur ? `section "${cur.title}" of the course` : "the course outline";
        sectionList = `Sections: ${sections.map((s) => s.title).join("; ")}`;
      }
      const r = await chat(ctx, {
        model: MODELS.spark,
        name: "tutor-route",
        reasoningEffort: "low",
        maxTokens: 500,
        tools: TOOLS,
        toolChoice: "auto",
        messages: [
          { role: "system", content: `You route a student's command bar input to exactly one tool. The student is on ${where}. ${sectionList}. Questions go to ask unless they want outside or web sources.` },
          { role: "user", content: body.text },
        ],
      });
      const call = r.toolCalls[0];
      if (!call) return c.json({ kind: "answer", ...(await answerFromSources(c.env, userId, body.text, body.courseId)) });
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      if (call.function.name === "ask") {
        return c.json({ kind: "answer", ...(await answerFromSources(c.env, userId, String(args.question ?? body.text), body.courseId)) });
      }
      if (call.function.name === "navigate" && args.target === "section" && body.courseId && args.sectionTitle) {
        const { sections } = await pathWithTitles(c.env, body.courseId, userId);
        const t = String(args.sectionTitle).toLowerCase();
        const hit = sections.find((s) => s.title.toLowerCase().includes(t) || t.includes(s.title.toLowerCase()));
        if (hit) args.sectionId = hit.id;
      }
      return c.json({ kind: "action", tool: call.function.name, args });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/research", async (c) => {
    const userId = c.get("userId");
    const body = z.object({ question: z.string().min(3).max(500), courseId: z.string().optional() }).parse(await c.req.json());
    if (body.courseId && !(await courseAccess(c.env, body.courseId, userId))) return c.json({ error: "Not found" }, 404);
    const id = randomId("res");
    await c.env.DB.prepare("INSERT INTO research (id, user_id, course_id, question, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)").bind(id, userId, body.courseId ?? null, body.question, Date.now()).run();
    try {
      const report = await runResearch(c.env, userId, body.question, body.courseId);
      await c.env.DB.prepare("UPDATE research SET status = 'done', report = ? WHERE id = ?").bind(JSON.stringify(report), id).run();
    } catch (err) {
      await c.env.DB.prepare("UPDATE research SET status = 'failed', report = ? WHERE id = ?").bind(JSON.stringify({ error: String((err as Error).message) }), id).run();
    }
    return c.json({ id });
  })
  .get("/research/:id", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM research WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).first<{ report: string | null } & Record<string, unknown>>();
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ ...row, report: row.report ? JSON.parse(row.report) : null });
  });

function webLabel(u: string): string {
  try {
    const url = new URL(u);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const words = slug.replace(/[-_]+/g, " ").replace(/\.\w+$/, "").replace(/\b[0-9a-f]{8,}\b/g, "").trim();
    return words ? `${url.hostname.replace(/^www\./, "")}: ${words}` : url.hostname;
  } catch {
    return u;
  }
}

type ResearchSource = { n: number; label: string; origin: "library" | "web"; url?: string; text: string };

/**
 * Research mode: library sources first, then web results from the Meta Responses API
 * web search tool. Web sources are marked and never enter a course without approval.
 */
async function runResearch(env: Env, userId: string, question: string, courseId?: string) {
  const ctx = await getAiCtx(env, userId);
  const runId = await createRun(env, { userId, courseId, graph: "research", input: { question } });
  const { ids, names } = await courseSourceIds(env, courseId, userId);
  const lib = await searchChunks(env, question, ids, 4);
  const sources: ResearchSource[] = lib.map((ch, k) => ({ n: k + 1, label: `${names.get(ch.source_id) ?? "source"}${ch.page ? `, page ${ch.page}` : ""}`, origin: "library", text: ch.text }));
  await recordRunTrace(env, runId, { label: `Read ${sources.length} passages from your library` });
  let web: ResearchSource[] = [];
  try {
    const res = await metaFetch(ctx, "/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELS.spark, tools: [{ type: "web_search" }], input: `Find 3-4 reliable sources that answer: ${question}. For each give title, url and a 2-sentence summary of what it says.` }),
    }, 1);
    const json = (await res.json()) as {
      output?: { type: string; phase?: string; action?: { type: string; url?: string }; content?: { type: string; text?: string; annotations?: { url?: string; title?: string }[] }[] }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    await recordSpend(ctx, MODELS.spark, tokenCost(MODELS.spark, json.usage?.input_tokens ?? 0, json.usage?.output_tokens ?? 0) + 0.0025);
    const out = json.output ?? [];
    // the final answer is the last non-commentary message; URLs come from its text, annotations and opened pages
    const final = out.filter((o) => o.type === "message" && o.phase !== "commentary").flatMap((o) => o.content ?? []);
    const text = final.map((p) => p.text ?? "").join("\n");
    const urls = [
      ...final.flatMap((p) => (p.annotations ?? []).map((a) => a.url ?? "")),
      ...(text.match(/https?:\/\/[^\s)\]>"']+/g) ?? []),
      ...out.filter((o) => o.type === "web_search_call" && o.action?.type === "open_page").map((o) => o.action!.url ?? ""),
    ]
      .map((u) => u.replace(/[.,;]+$/, "").split("?")[0])
      .filter(Boolean);
    const unique = [...new Set(urls)].slice(0, 4);
    web = unique.map((u, k) => ({ n: sources.length + k + 1, label: webLabel(u), origin: "web" as const, url: u, text }));
    await recordRunTrace(env, runId, { label: `Searched the web: ${web.length} sources`, model: MODELS.spark });
  } catch (err) {
    await recordRunTrace(env, runId, { label: `Web search unavailable (${String((err as Error).message).slice(0, 80)}); used your library only`, ok: false });
  }
  const all = [...sources, ...web];
  const r = await chat(ctx, {
    model: MODELS.spark,
    name: "research-write",
    reasoningEffort: "medium",
    maxTokens: 1500,
    messages: [
      { role: "system", content: `Write 3–5 short paragraphs answering the question. End each sentence with the source numbers it uses in square brackets. Prefer library sources. ${DATA_RULE}` },
      { role: "user", content: `Question: ${question}\n\n${all.map((s) => asData(`[${s.n}] ${s.label} (${s.origin})`, s.text.slice(0, 3000))).join("\n")}` },
    ],
  });
  await finishRun(env, runId, "done");
  return { md: r.content.trim(), sources: all.map(({ text: _t, ...s }) => s), libraryCount: sources.length, webCount: web.length };
}
