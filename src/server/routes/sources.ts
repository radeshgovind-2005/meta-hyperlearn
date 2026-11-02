import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { randomId } from "../lib/crypto";
import { createRun } from "../lib/runs";
import { signFileUrl } from "../lib/http";
import { assertQuota, count, keys } from "../lib/quota";

const KINDS = ["slides", "paper", "notes", "exam", "audio"] as const;
const MAX_BYTES = 95 * 1024 * 1024;

export type SourceListRow = { id: string; title: string; filename: string; kind: string; mime: string; size_bytes: number; pages: number | null; duration_s: number | null; status: string; progress: string | null; error: string | null; created_at: number };

async function ownSource(env: Env, id: string, userId: string) {
  return env.DB.prepare("SELECT * FROM sources WHERE id = ? AND owner_id = ?").bind(id, userId).first<SourceListRow & { r2_key: string; meta: string | null; owner_id: string }>();
}

/** Starts the ingest workflow for a source; used by the API and the seed endpoint. */
export async function startIngest(env: Env, sourceId: string, userId: string): Promise<string> {
  const runId = await createRun(env, { userId, graph: "ingest", input: { sourceId } });
  await env.DB.prepare("UPDATE sources SET status = 'processing', progress = 'Queued', error = NULL WHERE id = ?").bind(sourceId).run();
  await env.INGEST.create({ id: runId, params: { sourceId, userId, runId } });
  return runId;
}

export const sources = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const q = c.req.query("q")?.trim();
    const kind = c.req.query("kind");
    const courseId = c.req.query("course");
    const sort = c.req.query("sort") === "name" ? "title COLLATE NOCASE ASC" : "created_at DESC";
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const per = 8;
    const where = ["owner_id = ?"];
    const args: unknown[] = [userId];
    if (q) {
      where.push("(title LIKE ? OR filename LIKE ?)");
      args.push(`%${q}%`, `%${q}%`);
    }
    if (kind && (KINDS as readonly string[]).includes(kind)) {
      where.push("kind = ?");
      args.push(kind);
    }
    if (courseId) {
      where.push("id IN (SELECT source_id FROM course_sources WHERE course_id = ?)");
      args.push(courseId);
    }
    const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sources WHERE ${where.join(" AND ")}`).bind(...args).first<number>("n");
    const { results } = await c.env.DB.prepare(
      `SELECT id, title, filename, kind, mime, size_bytes, pages, duration_s, status, progress, error, created_at FROM sources WHERE ${where.join(" AND ")} ORDER BY ${sort} LIMIT ? OFFSET ?`,
    )
      .bind(...args, per, (page - 1) * per)
      .all<SourceListRow>();
    const usedIn = results.length
      ? (
          await c.env.DB.prepare(
            `SELECT cs.source_id, c.id, c.title FROM course_sources cs JOIN courses c ON c.id = cs.course_id WHERE cs.source_id IN (${results.map(() => "?").join(",")})`,
          )
            .bind(...results.map((r) => r.id))
            .all<{ source_id: string; id: string; title: string }>()
        ).results
      : [];
    return c.json({
      total: total ?? 0,
      page,
      per,
      items: results.map((r) => ({ ...r, courses: usedIn.filter((u) => u.source_id === r.id).map((u) => ({ id: u.id, title: u.title })) })),
    });
  })
  .post("/", async (c) => {
    const userId = c.get("userId");
    const body = z
      .object({ filename: z.string().min(1).max(200), kind: z.enum(KINDS), mime: z.string().max(100), size: z.number().int().min(1).max(MAX_BYTES), title: z.string().max(200).optional() })
      .parse(await c.req.json());
    await assertQuota(c.env, ["storage", "classA", "vectors", "ai"], body.size);
    const id = randomId("src");
    const ext = body.filename.split(".").pop()?.toLowerCase() ?? "bin";
    const r2Key = `sources/${id}/original.${ext}`;
    await c.env.DB.prepare(
      "INSERT INTO sources (id, owner_id, title, filename, kind, mime, r2_key, size_bytes, status, progress, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 'Uploading', ?)",
    )
      .bind(id, userId, body.title ?? body.filename.replace(/\.[^.]+$/, ""), body.filename, body.kind, body.mime, r2Key, body.size, Date.now())
      .run();
    return c.json({ id });
  })
  .put("/:id/file", async (c) => {
    const src = await ownSource(c.env, c.req.param("id"), c.get("userId"));
    if (!src) return c.json({ error: "Not found" }, 404);
    const body = c.req.raw.body;
    if (!body) return c.json({ error: "Empty upload" }, 400);
    await assertQuota(c.env, ["storage", "classA"], Number(c.req.header("Content-Length") ?? 0));
    await c.env.FILES.put(src.r2_key, body, { httpMetadata: { contentType: src.mime } });
    return c.json({ ok: true });
  })
  .put("/:id/pages/:n", async (c) => {
    const src = await ownSource(c.env, c.req.param("id"), c.get("userId"));
    if (!src) return c.json({ error: "Not found" }, 404);
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n < 1 || n > 2000) return c.json({ error: "Bad page" }, 400);
    await assertQuota(c.env, ["storage", "classA"], Number(c.req.header("Content-Length") ?? 0));
    await c.env.FILES.put(`sources/${src.id}/pages/${n}.png`, c.req.raw.body!, { httpMetadata: { contentType: "image/png" } });
    return c.json({ ok: true });
  })
  .put("/:id/segments/:k", async (c) => {
    const src = await ownSource(c.env, c.req.param("id"), c.get("userId"));
    if (!src) return c.json({ error: "Not found" }, 404);
    const k = Number(c.req.param("k"));
    const offsetMs = Number(c.req.query("offsetMs") ?? 0);
    await assertQuota(c.env, ["storage", "classA"], Number(c.req.header("Content-Length") ?? 0));
    const key = `sources/${src.id}/segments/${k}.wav`;
    await c.env.FILES.put(key, c.req.raw.body!, { httpMetadata: { contentType: "audio/wav" } });
    const meta = src.meta ? JSON.parse(src.meta) : {};
    const segments: { key: string; offsetMs: number }[] = (meta.segments ?? []).filter((s: { key: string }) => s.key !== key);
    segments.push({ key, offsetMs });
    segments.sort((a, b) => a.offsetMs - b.offsetMs);
    await c.env.DB.prepare("UPDATE sources SET meta = ? WHERE id = ?").bind(JSON.stringify({ ...meta, segments }), src.id).run();
    return c.json({ ok: true });
  })
  .post("/:id/ingest", async (c) => {
    const userId = c.get("userId");
    const src = await ownSource(c.env, c.req.param("id"), userId);
    if (!src) return c.json({ error: "Not found" }, 404);
    await assertQuota(c.env, ["vectors", "ai"]);
    const runId = await startIngest(c.env, src.id, userId);
    return c.json({ runId });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    // readable by its owner, or anyone who can read a course built from it
    const src = await c.env.DB.prepare(
      `SELECT * FROM sources WHERE id = ? AND (owner_id = ? OR id IN (
         SELECT cs.source_id FROM course_sources cs JOIN courses co ON co.id = cs.course_id
         WHERE co.is_demo = 1 OR co.owner_id = ? OR co.id IN (SELECT course_id FROM follows WHERE user_id = ?)))`,
    )
      .bind(id, userId, userId, userId)
      .first<SourceListRow & { r2_key: string; meta: string | null; owner_id: string }>();
    if (!src) return c.json({ error: "Not found" }, 404);
    const { results: chunks } = await c.env.DB.prepare("SELECT id, ord, text, page, bbox, t_start, t_end, section_path FROM chunks WHERE source_id = ? ORDER BY ord").bind(id).all();
    const meta = src.meta ? JSON.parse(src.meta) : {};
    const pages = src.pages ?? 0;
    const pageUrls = await Promise.all(Array.from({ length: pages }, (_, k) => signFileUrl(c.env, `sources/${id}/pages/${k + 1}.png`)));
    const { results: courses } = await c.env.DB.prepare("SELECT c.id, c.title FROM course_sources cs JOIN courses c ON c.id = cs.course_id WHERE cs.source_id = ? AND (c.owner_id = ? OR c.is_demo = 1)").bind(id, userId).all();
    return c.json({
      source: { id: src.id, title: src.title, filename: src.filename, kind: src.kind, mime: src.mime, size_bytes: src.size_bytes, pages: src.pages, duration_s: src.duration_s, status: src.status, progress: src.progress, error: src.error, created_at: src.created_at, own: src.owner_id === userId },
      fileUrl: await signFileUrl(c.env, src.r2_key),
      pageUrls,
      pageSizes: meta.pageSizes ?? [],
      structure: meta.structure ?? null,
      examStyle: meta.examStyle ?? null,
      chunks,
      courses,
    });
  })
  .delete("/:id", async (c) => {
    const src = await ownSource(c.env, c.req.param("id"), c.get("userId"));
    if (!src) return c.json({ error: "Not found" }, 404);
    const inCourse = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM course_sources WHERE source_id = ?").bind(src.id).first<number>("n");
    if (inCourse) return c.json({ error: "This source is used by a course. Remove it from the course first." }, 409);
    const { results } = await c.env.DB.prepare("SELECT id FROM chunks WHERE source_id = ?").bind(src.id).all<{ id: string }>();
    if (results.length) {
      await c.env.VECTORS.deleteByIds(results.map((r) => r.id));
      count(keys.vectors(), -results.length);
    }
    await c.env.DB.batch([c.env.DB.prepare("DELETE FROM chunks WHERE source_id = ?").bind(src.id), c.env.DB.prepare("DELETE FROM sources WHERE id = ?").bind(src.id)]);
    const listed = await c.env.FILES.list({ prefix: `sources/${src.id}/` });
    if (listed.objects.length) {
      await c.env.FILES.delete(listed.objects.map((o) => o.key));
      count(keys.storage(), -listed.objects.reduce((n, o) => n + o.size, 0));
    }
    return c.json({ ok: true });
  });
