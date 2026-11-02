import { z } from "zod";
import { extractTextItems, getDocumentProxy } from "unpdf";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson, DATA_RULE } from "../ai/meta";
import { transcribeWav } from "../ai/asr";
import { embed } from "../ai/embed";
import { MODELS } from "../ai/models";
import { mergeSmallRegions, regionsFromItems } from "./pdfLayout";

// ingestGraph nodes. Each runs as a durable Cloudflare Workflow step.

export type SourceRow = { id: string; owner_id: string; title: string; filename: string; kind: string; mime: string; r2_key: string; meta: string | null };

export const ExamStyleSchema = z.object({
  format: z.string().describe("How questions are laid out, e.g. 'numbered, multi-part (a)(b), show all work'"),
  verbs: z.array(z.string()).describe("Command words used, e.g. Compute, Show that, Explain"),
  points: z.string().describe("How marks are given, or 'not stated'"),
  conventions: z.array(z.string()).describe("Notation and answer conventions the exam expects"),
  questions: z.array(z.object({ number: z.string(), text: z.string(), topic: z.string() })),
});
export type ExamStyle = z.infer<typeof ExamStyleSchema>;

const StructureSchema = z.object({
  title: z.string(),
  summary: z.string(),
  pages: z.array(z.object({ page: z.number().int(), title: z.string(), concepts: z.array(z.string()) })),
});

export async function setProgress(env: Env, sourceId: string, progress: string, status = "processing") {
  await env.DB.prepare("UPDATE sources SET progress = ?, status = ? WHERE id = ?").bind(progress, status, sourceId).run();
}

export async function loadSource(env: Env, sourceId: string): Promise<SourceRow> {
  const row = await env.DB.prepare("SELECT id, owner_id, title, filename, kind, mime, r2_key, meta FROM sources WHERE id = ?").bind(sourceId).first<SourceRow>();
  if (!row) throw new Error("source not found");
  return row;
}

/** Node: extract text with positions → chunks in D1. Returns page count. */
export async function extractPdf(env: Env, src: SourceRow): Promise<{ pages: number; chunks: number; pageSizes: [number, number][] }> {
  const obj = await env.FILES.get(src.r2_key);
  if (!obj) throw new Error("file missing in storage");
  const data = new Uint8Array(await obj.arrayBuffer());
  const doc = await getDocumentProxy(data);
  const { items, totalPages } = await extractTextItems(doc);
  const pageSizes: [number, number][] = [];
  const rows: { id: string; ord: number; text: string; page: number; bbox: string }[] = [];
  let ord = 0;
  for (let p = 1; p <= totalPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    pageSizes.push([vp.width, vp.height]);
    const regions = mergeSmallRegions(regionsFromItems(items[p - 1] ?? [], vp.width, vp.height));
    for (const r of regions) {
      if (r.text.length < 3) continue;
      rows.push({ id: `${src.id}:${ord}`, ord: ord++, text: r.text, page: p, bbox: JSON.stringify(r.bbox) });
    }
  }
  await env.DB.prepare("DELETE FROM chunks WHERE source_id = ?").bind(src.id).run();
  for (let i = 0; i < rows.length; i += 40) {
    await env.DB.batch(
      rows.slice(i, i + 40).map((r) =>
        env.DB.prepare("INSERT INTO chunks (id, source_id, ord, text, page, bbox) VALUES (?, ?, ?, ?, ?, ?)").bind(r.id, src.id, r.ord, r.text, r.page, r.bbox),
      ),
    );
  }
  await env.DB.prepare("UPDATE sources SET pages = ? WHERE id = ?").bind(totalPages, src.id).run();
  return { pages: totalPages, chunks: rows.length, pageSizes };
}

async function pageTexts(env: Env, sourceId: string): Promise<Map<number, string>> {
  const { results } = await env.DB.prepare("SELECT page, text FROM chunks WHERE source_id = ? ORDER BY ord").bind(sourceId).all<{ page: number; text: string }>();
  const map = new Map<number, string>();
  for (const r of results) map.set(r.page, `${map.get(r.page) ?? ""}${r.text}\n`);
  return map;
}

/** Node: Muse Spark structures the document (titles, concepts) and, for exams, the question style. */
export async function structureSource(env: Env, ctx: AiCtx, src: SourceRow): Promise<{ title: string; concepts: number }> {
  const pages = await pageTexts(env, src.id);
  const doc = [...pages.entries()].map(([p, t]) => asData(`${src.filename} page ${p}`, t)).join("\n");
  const structure = await chatJson(ctx, {
    model: MODELS.spark,
    name: "structure-source",
    schema: StructureSchema,
    schemaName: "structure",
    reasoningEffort: "low",
    messages: [
      { role: "system", content: `You organise a student's course material. ${DATA_RULE}` },
      {
        role: "user",
        content: `File "${src.filename}" (${src.kind}). Give a short title, a two-sentence summary, and for every page its title and the concepts it teaches (short noun phrases, lower case).\n\n${doc}`,
      },
    ],
  });
  const meta: Record<string, unknown> = { ...(src.meta ? JSON.parse(src.meta) : {}), structure };
  if (src.kind === "exam") {
    meta.examStyle = await chatJson(ctx, {
      model: MODELS.spark,
      name: "exam-style",
      schema: ExamStyleSchema,
      schemaName: "exam_style",
      reasoningEffort: "low",
      messages: [
        { role: "system", content: `You describe the style of a past exam so new questions can copy it. ${DATA_RULE}` },
        { role: "user", content: `Describe the style of this exam and list each question with its topic.\n\n${doc}` },
      ],
    });
  }
  const title = src.title && src.title !== src.filename ? src.title : structure.title;
  await env.DB.prepare("UPDATE sources SET meta = ?, title = ? WHERE id = ?").bind(JSON.stringify(meta), title, src.id).run();
  // tag chunks with the section path (page title) for retrieval and display
  await env.DB.batch(
    structure.pages.map((p) => env.DB.prepare("UPDATE chunks SET section_path = ? WHERE source_id = ? AND page = ?").bind(p.title, src.id, p.page)),
  );
  return { title, concepts: structure.pages.reduce((n, p) => n + p.concepts.length, 0) };
}

/** Node: transcribe one WAV segment and store its turns as timestamped chunks. */
export async function transcribeSegment(env: Env, ctx: AiCtx, src: SourceRow, segKey: string, offsetMs: number, ordStart: number): Promise<{ chunks: number; endMs: number }> {
  const obj = await env.FILES.get(segKey);
  if (!obj) throw new Error(`segment missing: ${segKey}`);
  const { turns, durationMs } = await transcribeWav(ctx, await obj.arrayBuffer(), offsetMs);
  // merge turns into ~30 s chunks: short enough to cite precisely, long enough to embed
  const merged: { text: string; s: number; e: number }[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && t.endMs - last.s < 30_000) {
      last.text += ` ${t.transcript}`;
      last.e = t.endMs;
    } else merged.push({ text: t.transcript, s: t.startMs, e: t.endMs });
  }
  const stmts = merged
    .filter((m) => m.text.trim())
    .map((m, k) =>
      env.DB.prepare("INSERT OR REPLACE INTO chunks (id, source_id, ord, text, t_start, t_end) VALUES (?, ?, ?, ?, ?, ?)").bind(
        `${src.id}:${ordStart + k}`,
        src.id,
        ordStart + k,
        m.text.trim(),
        m.s / 1000,
        m.e / 1000,
      ),
    );
  if (stmts.length) await env.DB.batch(stmts);
  return { chunks: stmts.length, endMs: offsetMs + durationMs };
}

/** Node: embed all chunks of a source into Vectorize with citation metadata. */
export async function embedSource(env: Env, sourceId: string, ownerId: string): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, text, page, bbox, t_start, t_end, section_path FROM chunks WHERE source_id = ? ORDER BY ord")
    .bind(sourceId)
    .all<{ id: string; text: string; page: number | null; bbox: string | null; t_start: number | null; t_end: number | null; section_path: string | null }>();
  for (let i = 0; i < results.length; i += 50) {
    const batch = results.slice(i, i + 50);
    const vectors = await embed(env, batch.map((c) => (c.section_path ? `${c.section_path}: ${c.text}` : c.text)));
    await env.VECTORS.upsert(
      batch.map((c, k) => ({
        id: c.id,
        values: vectors[k],
        metadata: {
          sourceId,
          ownerId,
          ...(c.page ? { page: c.page } : {}),
          ...(c.bbox ? { bbox: c.bbox } : {}),
          ...(c.t_start !== null ? { tStart: c.t_start } : {}),
          ...(c.t_end !== null ? { tEnd: c.t_end } : {}),
          sectionPath: c.section_path ?? "",
        },
      })),
    );
  }
  return results.length;
}
