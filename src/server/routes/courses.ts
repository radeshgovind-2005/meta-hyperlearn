import { Hono } from "hono";
import { z } from "zod";
import { prepareNarration, warmNarration, type NarratedSegment } from "../course/narrate";
import type { AppEnv, Env } from "../env";
import type { Block, Section } from "../../shared/types";
import { BlockSchema } from "../../shared/types";
import { randomId } from "../lib/crypto";
import { createRun } from "../lib/runs";
import { courseAccess, errorResponse, signFileUrl } from "../lib/http";
import { commitSection, commitSnapshot, courseSnapshot, courseView, loadSection } from "../lib/blocks";
import { pathWithTitles } from "../course/practice";
import { getAiCtx } from "../ai/meta";
import { retryBuild } from "../course/buildJobs";
import { assertQuota } from "../lib/quota";
import { chunkToCite, searchChunks, type ChunkRow } from "../lib/chunks";
import { illustrationsEnabled, makeIllustration } from "../course/illustrate";
import { canIllustrate, heroOf, withHero } from "../../shared/hero";

/** A narrated section as the reader plays it: each clip is a signed link, or null when the browser voice has to cover it. */
export async function narrationPayload(env: Env, segments: NarratedSegment[]) {
  return Promise.all(
    segments.map(async (s) => ({
      blockId: s.blockId,
      text: s.text,
      clips: await Promise.all(s.clips.map(async (cl) => ({ text: cl.text, url: cl.key ? await signFileUrl(env, cl.key) : null }))),
    })),
  );
}

export async function sourcesPayload(env: Env, blocks: Block[], courseId: string) {
  const ids = new Set<string>();
  for (const b of blocks) for (const c of b.cites) ids.add(c.sourceId);
  const { results } = await env.DB.prepare("SELECT s.id, s.filename, s.kind, s.title, s.r2_key, s.pages, s.meta FROM sources s JOIN course_sources cs ON cs.source_id = s.id WHERE cs.course_id = ?")
    .bind(courseId)
    .all<{ id: string; filename: string; kind: string; title: string; r2_key: string; pages: number | null; meta: string | null }>();
  const out: Record<string, { id: string; filename: string; kind: string; title: string; fileUrl: string; pageUrls: Record<number, string>; pageSizes: [number, number][] }> = {};
  for (const s of results) {
    if (!ids.has(s.id) && s.kind !== "audio") continue;
    const pages = new Set<number>();
    for (const b of blocks) for (const c of b.cites) if (c.sourceId === s.id && c.page) pages.add(c.page);
    const pageUrls: Record<number, string> = {};
    for (const p of pages) pageUrls[p] = await signFileUrl(env, `sources/${s.id}/pages/${p}.png`);
    const meta = s.meta ? JSON.parse(s.meta) : {};
    out[s.id] = { id: s.id, filename: s.filename, kind: s.kind, title: s.title, fileUrl: await signFileUrl(env, s.r2_key), pageUrls, pageSizes: meta.pageSizes ?? [] };
  }
  return out;
}

async function figureUrls(env: Env, blocks: Block[]) {
  const urls: Record<string, string> = {};
  for (const b of blocks) if (b.kind === "figure") urls[b.r2Key] = await signFileUrl(env, b.r2Key);
  return urls;
}

export const courses = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const { results } = await c.env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM course_sources WHERE course_id = c.id) AS source_count,
              CASE WHEN c.owner_id = ? THEN 'owner' WHEN c.is_demo = 1 THEN 'demo' ELSE 'follower' END AS role
       FROM courses c
       WHERE c.owner_id = ? OR c.is_demo = 1 OR c.id IN (SELECT course_id FROM follows WHERE user_id = ?)
       ORDER BY c.is_demo ASC, c.updated_at DESC`,
    )
      .bind(userId, userId, userId)
      .all<Record<string, unknown> & { id: string }>();
    const items = await Promise.all(
      results.map(async (r) => {
        let nextUp: { id: string; title: string } | null = null;
        let progress = { read: 0, total: 0 };
        if (r.status === "ready") {
          const { sections } = await pathWithTitles(c.env, r.id, userId);
          const { results: reads } = await c.env.DB.prepare("SELECT section_id FROM reads WHERE user_id = ? AND course_id = ?").bind(userId, r.id).all<{ section_id: string }>();
          const read = new Set(reads.map((x) => x.section_id));
          const next = sections.find((s) => !read.has(s.id));
          nextUp = next ? { id: next.id, title: next.title } : null;
          progress = { read: sections.filter((s) => read.has(s.id)).length, total: sections.length };
        }
        return { ...r, nextUp, progress };
      }),
    );
    return c.json({ items });
  })
  .post("/", async (c) => {
    const userId = c.get("userId");
    const body = z.object({ title: z.string().max(200).optional(), sourceIds: z.array(z.string()).min(1).max(30), goal: z.string().max(500).default("") }).parse(await c.req.json());
    const { results } = await c.env.DB.prepare(`SELECT id, status, kind FROM sources WHERE owner_id = ? AND id IN (${body.sourceIds.map(() => "?").join(",")})`)
      .bind(userId, ...body.sourceIds)
      .all<{ id: string; status: string; kind: string }>();
    if (results.length !== body.sourceIds.length) return c.json({ error: "Some sources were not found" }, 400);
    if (results.some((r) => r.status !== "ready")) return c.json({ error: "Wait until every source is ready" }, 409);
    if (!results.some((r) => r.kind !== "exam" && r.kind !== "audio")) return c.json({ error: "Add at least one document (slides, paper or notes)" }, 400);
    await assertQuota(c.env, ["classA", "ai", "vectorQueries"]);
    const id = randomId("crs");
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO courses (id, owner_id, title, status, progress, created_at, updated_at) VALUES (?, ?, ?, 'building', 'Queued', ?, ?)").bind(id, userId, body.title || "New course", now, now),
      ...results.map((r) => c.env.DB.prepare("INSERT INTO course_sources (course_id, source_id) VALUES (?, ?)").bind(id, r.id)),
    ]);
    const runId = await createRun(c.env, { userId, courseId: id, graph: "buildCourse", input: { goal: body.goal } });
    await c.env.DB.prepare("UPDATE courses SET build_attempt = ? WHERE id = ?").bind(runId, id).run();
    try {
      await c.env.BUILD.create({ id: runId, params: { courseId: id, userId, runId, goal: body.goal } });
    } catch (err) {
      await c.env.DB.prepare("UPDATE courses SET status = 'failed', progress = 'Could not start the build. Please retry.' WHERE id = ? AND build_attempt = ?").bind(id, runId).run();
      throw err;
    }
    return c.json({ id, runId });
  })
  .post("/:id/retry", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access || access.role !== "owner") return c.json({ error: "Only the owner can retry this build" }, 403);
    if (access.course.status !== "failed" || access.course.current_version !== 0) return c.json({ error: "Only a failed, unpublished course can be rebuilt" }, 409);
    try {
      await assertQuota(c.env, ["classA", "ai", "vectorQueries"]);
      const result = await retryBuild(c.env, access.course.id, userId);
      return result ? c.json(result) : c.json({ error: "A build is already running" }, 409);
    } catch (err) { return errorResponse(c, err); }
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const course = access.course;
    if (course.status !== "ready") return c.json({ course, role: access.role, sections: [], changes: [] });
    const { sections, view } = await pathWithTitles(c.env, course.id, userId);
    const { results: reads } = await c.env.DB.prepare("SELECT section_id FROM reads WHERE user_id = ? AND course_id = ?").bind(userId, course.id).all<{ section_id: string }>();
    const read = new Set(reads.map((r) => r.section_id));
    const { results: changes } = await c.env.DB.prepare("SELECT version, kind, summary, author_id, created_at FROM course_versions WHERE course_id = ? AND version > 1 ORDER BY version DESC LIMIT 3").bind(course.id).all();
    const { results: srcs } = await c.env.DB.prepare("SELECT s.id, s.filename, s.kind FROM sources s JOIN course_sources cs ON cs.source_id = s.id WHERE cs.course_id = ?").bind(course.id).all();
    const { results: own } = await c.env.DB.prepare("SELECT section_id, title, updated_at FROM overlays WHERE user_id = ? AND course_id = ? ORDER BY updated_at DESC LIMIT 5").bind(userId, course.id).all<{ section_id: string; title: string; updated_at: number }>();
    const ownChanges = own.map((o) => ({ label: o.section_id === "__path__" ? "Re-planned your path after practice" : `Changed ${o.title}`, updated_at: o.updated_at }));
    const versionRows = await c.env.DB.prepare("SELECT created_at FROM course_versions WHERE course_id = ? AND version = ?").bind(course.id, view.version).first<number>("created_at");
    return c.json({
      course,
      role: access.role,
      version: view.version,
      ownPath: view.ownPath,
      versionAt: versionRows,
      sources: srcs,
      sections: sections.map((s) => ({ ...s, read: read.has(s.id), minutes: Math.max(2, Math.round(s.blocks * 1.2)) })),
      changes,
      ownChanges,
    });
  })
  .get("/:id/sections/:sid", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const v = c.req.query("version");
    const section = await loadSection(c.env, access.course.id, c.req.param("sid"), { userId, ...(v ? { sectionVersion: Number(v) } : {}) });
    return c.json({ section, sources: await sourcesPayload(c.env, section.blocks, access.course.id), figures: await figureUrls(c.env, section.blocks), role: access.role });
  })
  .post("/:id/sections/:sid/read", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    await c.env.DB.prepare("INSERT OR IGNORE INTO reads (user_id, section_id, course_id, read_at) VALUES (?, ?, ?, ?)").bind(userId, c.req.param("sid"), access.course.id, Date.now()).run();
    return c.json({ ok: true });
  })
  .post("/:id/sections/:sid/illustrate", async (c) => {
    // the picture at the top of a page; made once, for pages built before pictures existed
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const sectionId = c.req.param("sid");
    try {
      if (!illustrationsEnabled(c.env)) return c.json({ error: "Pictures are switched off." }, 503);
      const ai = await getAiCtx(c.env, userId);
      await assertQuota(c.env, ["storage", "classA"]);
      const section = await loadSection(c.env, access.course.id, sectionId, { userId });
      if (heroOf(section.blocks) || !canIllustrate(section.blocks)) return c.json({ added: false });
      const made = await makeIllustration(c.env, ai, { title: section.title, blocks: section.blocks });
      if (!made.block) return c.json({ error: `Could not draw a picture that passed review (${made.reason}).` }, 422);
      await commitSection(c.env, {
        courseId: access.course.id,
        sectionId,
        title: section.title,
        blocks: withHero(section.blocks, made.block),
        userId,
        kind: "illustrate",
        summary: `${section.title}: added a picture drawn by Muse Image`,
      });
      c.executionCtx.waitUntil(warmNarration(c.env, userId, section.title, withHero(section.blocks, made.block)));
      return c.json({ added: true });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/sections/:sid/mutate", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const { blockId, request } = z.object({ blockId: z.string(), request: z.string().min(2).max(1000) }).parse(await c.req.json());
    const sectionId = c.req.param("sid");
    try {
      await getAiCtx(c.env, userId); // fail fast without a key or budget
      await assertQuota(c.env, ["classA"]);
      const before: Section = await loadSection(c.env, access.course.id, sectionId, { userId });
      if (!before.blocks.some((b) => b.id === blockId)) return c.json({ error: "That block is no longer in this section" }, 409);
      const concept = (await c.env.DB.prepare("SELECT concept FROM sections WHERE id = ?").bind(sectionId).first<string>("concept")) ?? before.title;
      const runId = await createRun(c.env, { userId, courseId: access.course.id, graph: "mutate", input: { sectionId, blockId, request } });
      const stub = c.env.COURSE_DO.get(c.env.COURSE_DO.idFromName(access.course.id));
      return await stub.startMutate({ runId, userId, courseId: access.course.id, sectionId, blockId, request, concept, before: { id: before.id, courseId: before.courseId, version: before.version, title: before.title, blocks: before.blocks } });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/sections/:sid/edit", async (c) => {
    // manual edits from the Editor are a full block list (validated), committed like any change;
    // the reader's Undo sends the section as it was before an auto-saved change
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const body = z.object({ title: z.string().min(1).max(200), blocks: z.array(z.unknown()), undo: z.boolean().optional() }).parse(await c.req.json());
    const blocks = body.blocks.map((b) => BlockSchema.parse(b));
    const summary = body.undo ? `Undid the last change to ${body.title}` : `Edited ${body.title}`;
    const res = await commitSection(c.env, { courseId: access.course.id, sectionId: c.req.param("sid"), title: body.title, blocks, userId, kind: body.undo ? "undo" : "edit", summary });
    if (res.courseVersion) await c.env.COURSE_DO.get(c.env.COURSE_DO.idFromName(access.course.id)).notifyVersion(access.course.id, res.courseVersion, summary);
    c.executionCtx.waitUntil(warmNarration(c.env, userId, body.title, blocks));
    return c.json(res);
  })
  .get("/:id/history", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const per = 5;
    const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM course_versions WHERE course_id = ?").bind(access.course.id).first<number>("n");
    const { results } = await c.env.DB.prepare(
      "SELECT v.version, v.kind, v.summary, v.author_id, v.run_id, v.created_at, r.trace, r.models FROM course_versions v LEFT JOIN runs r ON r.id = v.run_id WHERE v.course_id = ? ORDER BY v.version DESC LIMIT ? OFFSET ?",
    )
      .bind(access.course.id, per, (page - 1) * per)
      .all<Record<string, unknown>>();
    const { results: own } = await c.env.DB.prepare("SELECT section_id, title, updated_at FROM overlays WHERE user_id = ? AND course_id = ? AND section_id != '__path__'").bind(userId, access.course.id).all();
    return c.json({
      role: access.role,
      current: access.course.current_version,
      total: total ?? 0,
      page,
      per,
      items: results.map((r) => ({ ...r, trace: r.trace ? JSON.parse(r.trace as string) : [], models: r.models ? JSON.parse(r.models as string) : [], byYou: r.author_id === userId })),
      ownChanges: own,
    });
  })
  .post("/:id/sections/:sectionId/listen", async (c) => {
    // a spoken script for Listen mode, written by Muse Spark, with its audio (made when the section last changed)
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    try {
      const section = await loadSection(c.env, access.course.id, c.req.param("sectionId"), { userId });
      const ctx = await getAiCtx(c.env, userId);
      const { segments, cached } = await prepareNarration(c.env, ctx, section.title, section.blocks);
      return c.json({ cached, segments: await narrationPayload(c.env, segments) });
    } catch (err) {
      return errorResponse(c, err);
    }
  })
  .post("/:id/restore", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access || access.role !== "owner") return c.json({ error: "Only the owner can restore versions" }, 403);
    const { version } = z.object({ version: z.number().int().min(1) }).parse(await c.req.json());
    const snap = await courseSnapshot(c.env, access.course.id, version);
    if (!snap) return c.json({ error: "Version not found" }, 404);
    const v = await commitSnapshot(c.env, { courseId: access.course.id, path: snap.path, sections: snap.sections, userId, kind: "undo", summary: `Restored version ${version}` });
    await c.env.COURSE_DO.get(c.env.COURSE_DO.idFromName(access.course.id)).notifyVersion(access.course.id, v, `Restored version ${version}`);
    return c.json({ version: v });
  })
  .delete("/:id/overlay/:sid", async (c) => {
    // a follower drops their own change and goes back to the shared version
    await c.env.DB.prepare("DELETE FROM overlays WHERE user_id = ? AND course_id = ? AND section_id = ?").bind(c.get("userId"), c.req.param("id"), c.req.param("sid")).run();
    return c.json({ ok: true });
  })
  .get("/:id/ws", async (c) => {
    // the Worker has already verified the Clerk token (query param) before we get here
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const req = new Request(new URL(`/ws`, c.req.url), c.req.raw);
    req.headers.set("X-User-Id", userId);
    return c.env.COURSE_DO.get(c.env.COURSE_DO.idFromName(access.course.id)).fetch(req);
  })
  .get("/:id/search", async (c) => {
    // Editor: find passages in this course's sources to add verbatim
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const q = (c.req.query("q") ?? "").trim();
    const { results: srcs } = await c.env.DB.prepare("SELECT s.id, s.filename, s.kind FROM sources s JOIN course_sources cs ON cs.source_id = s.id WHERE cs.course_id = ?").bind(access.course.id).all<{ id: string; filename: string; kind: string }>();
    const names = new Map(srcs.map((s) => [s.id, s]));
    const chunks = q
      ? await searchChunks(c.env, q, srcs.map((s) => s.id), 8)
      : (await c.env.DB.prepare(`SELECT * FROM chunks WHERE source_id IN (${srcs.map(() => "?").join(",") || "''"}) ORDER BY source_id, ord LIMIT 8`).bind(...srcs.map((s) => s.id)).all<ChunkRow>()).results;
    return c.json({
      items: chunks.map((ch) => ({ cite: chunkToCite(ch), text: ch.text, kind: names.get(ch.source_id)?.kind ?? "", filename: names.get(ch.source_id)?.filename ?? "" })),
    });
  })
  .get("/:id/view", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    return c.json(await courseView(c.env, access.course.id, userId));
  });

