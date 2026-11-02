import type { Env } from "../env";
import type { Block, Section } from "../../shared/types";
import { BlockSchema } from "../../shared/types";
import { canonicalJson, hashBlock } from "../../shared/patch";

// Content-addressed block store: blocks/<sha256>.json in R2.

export async function putBlocks(env: Env, blocks: Block[]): Promise<string[]> {
  return Promise.all(
    blocks.map(async (b) => {
      const parsed = BlockSchema.parse(b);
      const hash = await hashBlock(parsed);
      const key = `blocks/${hash}.json`;
      const head = await env.FILES.head(key);
      if (!head) await env.FILES.put(key, canonicalJson(parsed), { httpMetadata: { contentType: "application/json" } });
      return hash;
    }),
  );
}

const cache = new Map<string, Block>();

export async function getBlocks(env: Env, hashes: string[]): Promise<Block[]> {
  return Promise.all(
    hashes.map(async (h) => {
      const hit = cache.get(h);
      if (hit) return hit;
      const obj = await env.FILES.get(`blocks/${h}.json`);
      if (!obj) throw new Error(`missing block ${h}`);
      const block = BlockSchema.parse(await obj.json());
      if (cache.size > 2000) cache.clear();
      cache.set(h, block);
      return block;
    }),
  );
}

export type CourseSnapshot = { version: number; path: string[]; sections: Record<string, number> };

export async function courseSnapshot(env: Env, courseId: string, version?: number): Promise<CourseSnapshot | null> {
  const row = version
    ? await env.DB.prepare("SELECT version, path, sections FROM course_versions WHERE course_id = ? AND version = ?").bind(courseId, version).first<{ version: number; path: string; sections: string }>()
    : await env.DB.prepare("SELECT version, path, sections FROM course_versions WHERE course_id = ? ORDER BY version DESC LIMIT 1").bind(courseId).first<{ version: number; path: string; sections: string }>();
  if (!row) return null;
  return { version: row.version, path: JSON.parse(row.path), sections: JSON.parse(row.sections) };
}

/** Loads a section as the given user sees it: owner's version, or follower's overlay on top. */
export async function loadSection(env: Env, courseId: string, sectionId: string, opts: { userId?: string; sectionVersion?: number; courseVersion?: number } = {}): Promise<Section & { overlay: boolean }> {
  if (opts.userId && opts.sectionVersion === undefined) {
    const ov = await env.DB.prepare("SELECT title, block_hashes FROM overlays WHERE user_id = ? AND course_id = ? AND section_id = ?")
      .bind(opts.userId, courseId, sectionId)
      .first<{ title: string; block_hashes: string }>();
    if (ov) {
      const snap = await courseSnapshot(env, courseId, opts.courseVersion);
      return { id: sectionId, courseId, version: snap?.sections[sectionId] ?? 0, title: ov.title, blocks: await getBlocks(env, JSON.parse(ov.block_hashes)), overlay: true };
    }
  }
  let v = opts.sectionVersion;
  if (v === undefined) {
    const snap = await courseSnapshot(env, courseId, opts.courseVersion);
    v = snap?.sections[sectionId];
  }
  if (v === undefined) {
    // sections added only to a user's own path (adapt for followers) are not in the base snapshot
    v = (await env.DB.prepare("SELECT MAX(version) AS v FROM section_versions WHERE section_id = ?").bind(sectionId).first<number>("v")) ?? undefined;
  }
  if (v === undefined || v === null) throw new Error("section not in course");
  const row = await env.DB.prepare("SELECT title, block_hashes FROM section_versions WHERE section_id = ? AND version = ?").bind(sectionId, v).first<{ title: string; block_hashes: string }>();
  if (!row) throw new Error("section version missing");
  return { id: sectionId, courseId, version: v, title: row.title, blocks: await getBlocks(env, JSON.parse(row.block_hashes)), overlay: false };
}

/**
 * Commits new section contents. Owners get a new section version + course version;
 * anyone else gets an overlay that only they see.
 */
export async function commitSection(
  env: Env,
  args: { courseId: string; sectionId: string; title: string; blocks: Block[]; userId: string; kind: string; summary: string; runId?: string },
): Promise<{ courseVersion: number | null; overlay: boolean }> {
  const hashes = await putBlocks(env, args.blocks);
  const course = await env.DB.prepare("SELECT owner_id FROM courses WHERE id = ?").bind(args.courseId).first<{ owner_id: string }>();
  if (!course) throw new Error("course not found");
  const now = Date.now();
  const snap = await courseSnapshot(env, args.courseId);
  if (!snap) throw new Error("course has no version");
  if (course.owner_id !== args.userId) {
    await env.DB.prepare(
      "INSERT INTO overlays (user_id, course_id, section_id, title, block_hashes, base_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, course_id, section_id) DO UPDATE SET title = excluded.title, block_hashes = excluded.block_hashes, base_version = excluded.base_version, updated_at = excluded.updated_at",
    )
      .bind(args.userId, args.courseId, args.sectionId, args.title, JSON.stringify(hashes), snap.version, now)
      .run();
    return { courseVersion: null, overlay: true };
  }
  const lastSv = await env.DB.prepare("SELECT MAX(version) AS v FROM section_versions WHERE section_id = ?").bind(args.sectionId).first<number>("v");
  const sv = (lastSv ?? 0) + 1;
  const cv = snap.version + 1;
  const sections = { ...snap.sections, [args.sectionId]: sv };
  const path = snap.path.includes(args.sectionId) ? snap.path : [...snap.path, args.sectionId];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO section_versions (section_id, version, title, block_hashes, created_at) VALUES (?, ?, ?, ?, ?)").bind(args.sectionId, sv, args.title, JSON.stringify(hashes), now),
    env.DB.prepare("INSERT INTO course_versions (course_id, version, kind, summary, path, sections, author_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(args.courseId, cv, args.kind, args.summary, JSON.stringify(path), JSON.stringify(sections), args.userId, args.runId ?? null, now),
    env.DB.prepare("UPDATE courses SET current_version = ?, updated_at = ? WHERE id = ?").bind(cv, now, args.courseId),
  ]);
  return { courseVersion: cv, overlay: false };
}

/** Writes a whole new course snapshot (path changes, undo, pulls). */
export async function commitSnapshot(
  env: Env,
  args: { courseId: string; path: string[]; sections: Record<string, number>; userId: string; kind: string; summary: string; runId?: string },
): Promise<number> {
  const snap = await courseSnapshot(env, args.courseId);
  const cv = (snap?.version ?? 0) + 1;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO course_versions (course_id, version, kind, summary, path, sections, author_id, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(args.courseId, cv, args.kind, args.summary, JSON.stringify(args.path), JSON.stringify(args.sections), args.userId, args.runId ?? null, now),
    env.DB.prepare("UPDATE courses SET current_version = ?, updated_at = ? WHERE id = ?").bind(cv, now, args.courseId),
  ]);
  return cv;
}

const PATH_KEY = "__path__";

/**
 * The course as one user sees it: the base snapshot, with their own path
 * (from re-plans on a course they follow) merged on top.
 */
export async function courseView(env: Env, courseId: string, userId: string): Promise<CourseSnapshot & { ownPath: boolean }> {
  const snap = await courseSnapshot(env, courseId);
  if (!snap) throw new Error("course has no version");
  const ov = await env.DB.prepare("SELECT block_hashes FROM overlays WHERE user_id = ? AND course_id = ? AND section_id = ?").bind(userId, courseId, PATH_KEY).first<string>("block_hashes");
  if (!ov) return { ...snap, ownPath: false };
  const own = JSON.parse(ov) as string[];
  const base = new Set(snap.path);
  const { results } = await env.DB.prepare("SELECT id FROM sections WHERE course_id = ? AND origin = 'adapt'").bind(courseId).all<{ id: string }>();
  const adapted = new Set(results.map((r) => r.id));
  // keep the user's order for sections that still exist; add new base sections after their base predecessor
  const path = own.filter((id) => base.has(id) || adapted.has(id));
  snap.path.forEach((id, k) => {
    if (path.includes(id)) return;
    const prev = snap.path[k - 1];
    const at = prev ? path.indexOf(prev) + 1 : 0;
    path.splice(at, 0, id);
  });
  return { ...snap, path, ownPath: true };
}

export async function saveOwnPath(env: Env, courseId: string, userId: string, path: string[], baseVersion: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO overlays (user_id, course_id, section_id, title, block_hashes, base_version, updated_at) VALUES (?, ?, ?, '', ?, ?, ?) ON CONFLICT(user_id, course_id, section_id) DO UPDATE SET block_hashes = excluded.block_hashes, base_version = excluded.base_version, updated_at = excluded.updated_at",
  )
    .bind(userId, courseId, PATH_KEY, JSON.stringify(path), baseVersion, Date.now())
    .run();
}
