import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { courseAccess } from "../lib/http";
import { randomId, randomToken } from "../lib/crypto";
import { commitSnapshot, courseSnapshot, getBlocks } from "../lib/blocks";
import type { Block } from "../../shared/types";

export async function userName(env: Env, userId: string): Promise<string> {
  const u = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?").bind(userId).first<{ name: string | null; email: string | null }>();
  return u?.name || u?.email?.split("@")[0] || "A HyperLearn user";
}

async function sectionTitleAndText(env: Env, sectionId: string, version: number) {
  const row = await env.DB.prepare("SELECT title, block_hashes FROM section_versions WHERE section_id = ? AND version = ?").bind(sectionId, version).first<{ title: string; block_hashes: string }>();
  if (!row) return null;
  const blocks = await getBlocks(env, JSON.parse(row.block_hashes));
  return { title: row.title, hashes: row.block_hashes, text: blocks.map(blockPlain).filter(Boolean).join("\n\n") };
}
const blockPlain = (b: Block) => (b.kind === "text" ? b.md : b.kind === "exercise" ? `Exercise: ${b.prompt}` : b.kind === "widget" ? `[Interactive example: ${b.spec.title ?? b.spec.template}]` : `[Figure: ${b.caption}]`);

/** Public invite preview (no auth). */
export const invitePublic = new Hono<AppEnv>().get("/:token", async (c) => {
  const inv = await c.env.DB.prepare("SELECT course_id, created_by, revoked FROM invites WHERE token = ?").bind(c.req.param("token")).first<{ course_id: string; created_by: string; revoked: number }>();
  if (!inv || inv.revoked) return c.json({ error: "This invite link is no longer valid" }, 404);
  const course = await c.env.DB.prepare("SELECT id, title, description, updated_at FROM courses WHERE id = ? AND status = 'ready'").bind(inv.course_id).first<{ id: string; title: string; description: string | null; updated_at: number }>();
  if (!course) return c.json({ error: "Course not found" }, 404);
  const snap = await courseSnapshot(c.env, course.id);
  const titles = await Promise.all(
    (snap?.path ?? []).slice(0, 4).map(async (id) => (await c.env.DB.prepare("SELECT title FROM section_versions WHERE section_id = ? AND version = ?").bind(id, snap!.sections[id]).first<string>("title")) ?? ""),
  );
  const sources = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM course_sources WHERE course_id = ?").bind(course.id).first<number>("n");
  return c.json({ course, sharedBy: await userName(c.env, inv.created_by), sources, sectionCount: snap?.path.length ?? 0, firstSections: titles });
});

export const share = new Hono<AppEnv>()
  .post("/courses/:id/invites", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access || access.role !== "owner") return c.json({ error: "Only the owner can share this course" }, 403);
    const body = z.object({ email: z.string().email().optional() }).parse(await c.req.json().catch(() => ({})));
    let token = await c.env.DB.prepare("SELECT token FROM invites WHERE course_id = ? AND created_by = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1").bind(access.course.id, userId).first<string>("token");
    if (!token) {
      token = randomToken();
      await c.env.DB.prepare("INSERT INTO invites (token, course_id, created_by, created_at) VALUES (?, ?, ?, ?)").bind(token, access.course.id, userId, Date.now()).run();
    }
    const origin = new URL(c.req.url).origin;
    const url = `${origin}/invite/${token}`;
    let emailed = false;
    if (body.email) {
      // Clerk sends the invitation email; it links back to the invite page
      const clerk = c.get("clerk");
      try {
        await clerk.invitations.createInvitation({ emailAddress: body.email, redirectUrl: url, ignoreExisting: true, notify: true });
        emailed = true;
      } catch (err) {
        console.warn("clerk invitation failed", String(err));
      }
    }
    return c.json({ token, url, emailed });
  })
  .post("/invite/:token/follow", async (c) => {
    const userId = c.get("userId");
    const inv = await c.env.DB.prepare("SELECT course_id, revoked FROM invites WHERE token = ?").bind(c.req.param("token")).first<{ course_id: string; revoked: number }>();
    if (!inv || inv.revoked) return c.json({ error: "Invalid invite" }, 404);
    const course = await c.env.DB.prepare("SELECT owner_id, current_version FROM courses WHERE id = ?").bind(inv.course_id).first<{ owner_id: string; current_version: number }>();
    if (course?.owner_id === userId) return c.json({ courseId: inv.course_id });
    await c.env.DB.prepare("INSERT OR IGNORE INTO follows (user_id, course_id, last_seen_version, created_at) VALUES (?, ?, ?, ?)").bind(userId, inv.course_id, course?.current_version ?? 0, Date.now()).run();
    return c.json({ courseId: inv.course_id });
  })
  .post("/invite/:token/copy", async (c) => {
    const userId = c.get("userId");
    const inv = await c.env.DB.prepare("SELECT course_id, revoked FROM invites WHERE token = ?").bind(c.req.param("token")).first<{ course_id: string; revoked: number }>();
    if (!inv || inv.revoked) return c.json({ error: "Invalid invite" }, 404);
    return c.json({ courseId: await forkCourse(c.env, inv.course_id, userId) });
  })
  .post("/courses/:id/fork", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    return c.json({ courseId: await forkCourse(c.env, access.course.id, userId) });
  })
  .get("/shared", async (c) => {
    const userId = c.get("userId");
    const { results: followed } = await c.env.DB.prepare(
      "SELECT c.id, c.title, c.owner_id, c.updated_at, c.current_version, f.last_seen_version FROM follows f JOIN courses c ON c.id = f.course_id WHERE f.user_id = ? ORDER BY c.updated_at DESC",
    )
      .bind(userId)
      .all<{ id: string; title: string; owner_id: string; updated_at: number; current_version: number; last_seen_version: number }>();
    const { results: copies } = await c.env.DB.prepare(
      "SELECT c.id, c.title, c.forked_from, u.owner_id AS upstream_owner, u.updated_at FROM courses c JOIN courses u ON u.id = c.forked_from WHERE c.owner_id = ? ORDER BY u.updated_at DESC",
    )
      .bind(userId)
      .all<{ id: string; title: string; forked_from: string; upstream_owner: string; updated_at: number }>();
    const items = [
      ...(await Promise.all(followed.map(async (f) => ({ id: f.id, title: f.title, sharedBy: await userName(c.env, f.owner_id), how: "follow", updates: Math.max(0, f.current_version - f.last_seen_version), updatedAt: f.updated_at })))),
      ...(await Promise.all(copies.map(async (k) => ({ id: k.id, title: k.title, sharedBy: await userName(c.env, k.upstream_owner), how: "copy", updates: (await copyUpdates(c.env, k.id)).length, updatedAt: k.updated_at })))),
    ];
    return c.json({ items });
  })
  .get("/courses/:id/updates", async (c) => {
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access) return c.json({ error: "Not found" }, 404);
    const course = access.course;
    if (access.role === "owner" && course.forked_from) {
      const upstream = await c.env.DB.prepare("SELECT owner_id, title FROM courses WHERE id = ?").bind(course.forked_from).first<{ owner_id: string; title: string }>();
      return c.json({ kind: "copy", title: course.title, from: await userName(c.env, upstream?.owner_id ?? ""), items: await copyUpdates(c.env, course.id) });
    }
    if (access.role === "follower") {
      const f = await c.env.DB.prepare("SELECT last_seen_version FROM follows WHERE user_id = ? AND course_id = ?").bind(userId, course.id).first<number>("last_seen_version");
      const { results } = await c.env.DB.prepare("SELECT version, kind, summary, created_at FROM course_versions WHERE course_id = ? AND version > ? ORDER BY version DESC").bind(course.id, f ?? 0).all();
      return c.json({ kind: "follow", title: course.title, from: await userName(c.env, course.owner_id), versions: results });
    }
    return c.json({ kind: "none", title: course.title });
  })
  .post("/courses/:id/updates/seen", async (c) => {
    const userId = c.get("userId");
    await c.env.DB.prepare("UPDATE follows SET last_seen_version = (SELECT current_version FROM courses WHERE id = ?) WHERE user_id = ? AND course_id = ?").bind(c.req.param("id"), userId, c.req.param("id")).run();
    return c.json({ ok: true });
  })
  .post("/courses/:id/pull", async (c) => {
    // copies take upstream updates: one section, or all of them
    const userId = c.get("userId");
    const access = await courseAccess(c.env, c.req.param("id"), userId);
    if (!access || access.role !== "owner" || !access.course.forked_from) return c.json({ error: "Not a copy you own" }, 403);
    const { upstreamSectionIds, keepMine } = z.object({ upstreamSectionIds: z.array(z.string()).optional(), keepMine: z.array(z.string()).default([]) }).parse(await c.req.json());
    const updates = await copyUpdates(c.env, access.course.id);
    const now = Date.now();
    const snap = (await courseSnapshot(c.env, access.course.id))!;
    const sections = { ...snap.sections };
    const path = [...snap.path];
    const taken: string[] = [];
    for (const u of updates) {
      if (upstreamSectionIds && !upstreamSectionIds.includes(u.upstreamId)) continue;
      if (keepMine.includes(u.upstreamId)) {
        // remember the decision: mark upstream version as seen without changing content
        if (u.localId) await c.env.DB.prepare("UPDATE sections SET upstream_version = ? WHERE id = ?").bind(u.upstreamVersion, u.localId).run();
        continue;
      }
      const up = await c.env.DB.prepare("SELECT title, block_hashes FROM section_versions WHERE section_id = ? AND version = ?").bind(u.upstreamId, u.upstreamVersion).first<{ title: string; block_hashes: string }>();
      if (!up) continue;
      let localId = u.localId;
      if (!localId) {
        localId = randomId("sec");
        const meta = await c.env.DB.prepare("SELECT chapter, concept FROM sections WHERE id = ?").bind(u.upstreamId).first<{ chapter: string; concept: string }>();
        await c.env.DB.prepare("INSERT INTO sections (id, course_id, chapter, concept, origin, upstream_id, upstream_version, created_at) VALUES (?, ?, ?, ?, 'fork', ?, ?, ?)")
          .bind(localId, access.course.id, meta?.chapter ?? "", meta?.concept ?? "", u.upstreamId, u.upstreamVersion, now)
          .run();
        path.push(localId);
      }
      const last = (await c.env.DB.prepare("SELECT MAX(version) AS v FROM section_versions WHERE section_id = ?").bind(localId).first<number>("v")) ?? 0;
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO section_versions (section_id, version, title, block_hashes, created_at) VALUES (?, ?, ?, ?, ?)").bind(localId, last + 1, up.title, up.block_hashes, now),
        c.env.DB.prepare("UPDATE sections SET upstream_version = ? WHERE id = ?").bind(u.upstreamVersion, localId),
      ]);
      sections[localId] = last + 1;
      taken.push(up.title);
    }
    if (!taken.length) return c.json({ version: snap.version, taken: [] });
    const v = await commitSnapshot(c.env, { courseId: access.course.id, path, sections, userId, kind: "pull", summary: `Took updates: ${taken.join(", ")}` });
    return c.json({ version: v, taken });
  });

/** Sections whose upstream changed since this copy last took them. */
async function copyUpdates(env: Env, courseId: string) {
  const course = await env.DB.prepare("SELECT forked_from FROM courses WHERE id = ?").bind(courseId).first<string>("forked_from");
  if (!course) return [];
  const up = await courseSnapshot(env, course);
  const mine = await courseSnapshot(env, courseId);
  if (!up || !mine) return [];
  const { results: local } = await env.DB.prepare("SELECT id, upstream_id, upstream_version FROM sections WHERE course_id = ? AND upstream_id IS NOT NULL").bind(courseId).all<{ id: string; upstream_id: string; upstream_version: number }>();
  const byUp = new Map(local.map((l) => [l.upstream_id, l]));
  const items: { upstreamId: string; localId: string | null; upstreamVersion: number; title: string; isNew: boolean; changedByYou: boolean; summary: string; mine: string; theirs: string }[] = [];
  for (const upId of up.path) {
    const upV = up.sections[upId];
    const l = byUp.get(upId);
    if (l && l.upstream_version >= upV) continue;
    const theirs = await sectionTitleAndText(env, upId, upV);
    if (!theirs) continue;
    const summary = (await env.DB.prepare("SELECT summary FROM course_versions WHERE course_id = ? AND json_extract(sections, '$.' || ?) = ? ORDER BY version ASC LIMIT 1").bind(course, upId, upV).first<string>("summary")) ?? "Updated";
    let mineText = "";
    let changedByYou = false;
    if (l) {
      const m = await sectionTitleAndText(env, l.id, mine.sections[l.id] ?? 1);
      const base = await sectionTitleAndText(env, upId, l.upstream_version);
      mineText = m?.text ?? "";
      changedByYou = Boolean(m && base && m.hashes !== base.hashes);
    }
    items.push({ upstreamId: upId, localId: l?.id ?? null, upstreamVersion: upV, title: theirs.title, isNew: !l, changedByYou, summary, mine: mineText, theirs: theirs.text });
  }
  return items;
}

export async function forkCourse(env: Env, courseId: string, userId: string): Promise<string> {
  const src = await env.DB.prepare("SELECT title, description FROM courses WHERE id = ?").bind(courseId).first<{ title: string; description: string | null }>();
  const snap = await courseSnapshot(env, courseId);
  if (!src || !snap) throw new Error("Course not found");
  const id = randomId("crs");
  const now = Date.now();
  const map = new Map(snap.path.map((s) => [s, randomId("sec")]));
  const stmts = [
    env.DB.prepare("INSERT INTO courses (id, owner_id, title, description, status, current_version, forked_from, forked_at_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', 1, ?, ?, ?, ?)").bind(id, userId, src.title, src.description, courseId, snap.version, now, now),
    env.DB.prepare("INSERT INTO course_sources (course_id, source_id) SELECT ?, source_id FROM course_sources WHERE course_id = ?").bind(id, courseId),
  ];
  for (const [oldId, newId] of map) {
    // forks copy hash lists only: blocks in R2 are shared
    stmts.push(
      env.DB.prepare("INSERT INTO sections (id, course_id, chapter, concept, origin, upstream_id, upstream_version, created_at) SELECT ?, ?, chapter, concept, 'fork', id, ?, ? FROM sections WHERE id = ?").bind(newId, id, snap.sections[oldId], now, oldId),
      env.DB.prepare("INSERT INTO section_versions (section_id, version, title, block_hashes, created_at) SELECT ?, 1, title, block_hashes, ? FROM section_versions WHERE section_id = ? AND version = ?").bind(newId, now, oldId, snap.sections[oldId]),
    );
  }
  const newPath = snap.path.map((s) => map.get(s)!);
  stmts.push(
    env.DB.prepare("INSERT INTO course_versions (course_id, version, kind, summary, path, sections, author_id, created_at) VALUES (?, 1, 'build', ?, ?, ?, ?, ?)").bind(
      id,
      `Copied from ${src.title} (version ${snap.version})`,
      JSON.stringify(newPath),
      JSON.stringify(Object.fromEntries(newPath.map((s) => [s, 1]))),
      userId,
      now,
    ),
  );
  await env.DB.batch(stmts);
  return id;
}
