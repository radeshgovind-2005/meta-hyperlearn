import type { Env } from "../env";
import type { BuildParams } from "../workflows/buildCourse";
import { createRun, finishRun } from "../lib/runs";
import { randomId } from "../lib/crypto";

export type SectionJob = {
  attempt_id: string; section_id: string; course_id: string; ord: number;
  title: string; chapter: string; concept: string; status: string;
  block_hashes: string | null; checked: number; supported: number; verifier: string | null; error: string | null;
};

export function activeBuild(env: Env, courseId: string, attemptId: string) {
  return env.DB.prepare("SELECT id FROM courses WHERE id = ? AND build_attempt = ? AND status = 'building' AND current_version = 0").bind(courseId, attemptId).first();
}

export async function buildJobs(env: Env, courseId: string, attemptId: string) {
  return (await env.DB.prepare("SELECT * FROM section_build_jobs WHERE course_id = ? AND attempt_id = ? ORDER BY ord").bind(courseId, attemptId).all<SectionJob>()).results;
}

export function completedJobs(jobs: SectionJob[], expected: number) {
  const failed = jobs.find((j) => j.status === "failed");
  if (failed) throw new Error(`Could not build “${failed.title}”: ${failed.error || "Please retry the build."}`);
  return jobs.length === expected && jobs.every((j) => j.status === "done" && j.block_hashes);
}

/** Every insert is guarded in the same atomic batch: stale attempts cannot publish. */
export async function commitBuild(env: Env, p: BuildParams, jobs: SectionJob[]) {
  if (!jobs.length || !completedJobs(jobs, jobs.length)) throw new Error("Sections are not all ready");
  const now = Date.now();
  const guard = "EXISTS (SELECT 1 FROM courses WHERE id = ? AND build_attempt = ? AND status = 'building' AND current_version = 0)";
  const checked = jobs.reduce((n, j) => n + j.checked, 0);
  const supported = jobs.reduce((n, j) => n + j.supported, 0);
  await env.DB.batch([
    ...jobs.flatMap((j) => [
      env.DB.prepare(`INSERT OR IGNORE INTO sections (id, course_id, chapter, concept, origin, created_at) SELECT ?, ?, ?, ?, 'build', ? WHERE ${guard}`).bind(j.section_id, p.courseId, j.chapter, j.concept, now, p.courseId, p.runId),
      env.DB.prepare(`INSERT OR IGNORE INTO section_versions (section_id, version, title, block_hashes, created_at) SELECT ?, 1, ?, ?, ? WHERE ${guard}`).bind(j.section_id, j.title, j.block_hashes, now, p.courseId, p.runId),
    ]),
    env.DB.prepare(`INSERT OR IGNORE INTO course_versions (course_id, version, kind, summary, path, sections, author_id, run_id, created_at) SELECT ?, 1, 'build', ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(
      p.courseId, `Built from ${jobs.length} sections. ${supported} of ${checked} sentences matched their sources.`, JSON.stringify(jobs.map((j) => j.section_id)), JSON.stringify(Object.fromEntries(jobs.map((j) => [j.section_id, 1]))), p.userId, p.runId, now, p.courseId, p.runId,
    ),
    env.DB.prepare("UPDATE courses SET status = 'ready', progress = NULL, current_version = 1, updated_at = ? WHERE id = ? AND build_attempt = ? AND status = 'building' AND current_version = 0").bind(now, p.courseId, p.runId),
  ]);
}

/** Claim before starting a workflow so concurrent retry requests cannot fork attempts. */
export async function retryBuild(env: Env, courseId: string, userId: string) {
  const previous = await env.DB.prepare("SELECT input FROM runs WHERE course_id = ? AND graph = 'buildCourse' ORDER BY created_at DESC LIMIT 1").bind(courseId).first<string>("input");
  const goal = previous ? String(JSON.parse(previous).goal ?? "") : "";
  const runId = randomId("run");
  const claim = await env.DB.prepare("UPDATE courses SET status = 'building', progress = 'Queued', build_attempt = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'failed' AND current_version = 0").bind(runId, Date.now(), courseId, userId).run();
  if (!claim.meta.changes) return null;
  try {
    await createRun(env, { id: runId, userId, courseId, graph: "buildCourse", input: { goal } });
    await env.BUILD.create({ id: runId, params: { courseId, userId, runId, goal } });
    return { id: courseId, runId };
  } catch (err) {
    await env.DB.prepare("UPDATE courses SET status = 'failed', progress = 'Could not start the build. Please retry.' WHERE id = ? AND build_attempt = ? AND status = 'building'").bind(courseId, runId).run();
    await finishRun(env, runId, "failed");
    throw err;
  }
}
