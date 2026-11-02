import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { flushQuota, meteredEnv } from "../lib/quota";
import { getAiCtx } from "../ai/meta";
import { loadSourcesFor, planOutline } from "../course/build";
import { randomId } from "../lib/crypto";
import { finishRun, recordRunTrace } from "../lib/runs";
import { activeBuild, buildJobs, commitBuild, completedJobs } from "../course/buildJobs";
import { MODEL_STEP, type SectionBuildParams } from "./buildSection";

export type BuildParams = { courseId: string; userId: string; runId: string; goal: string };

/** The coordinator makes only outline calls; every section gets its own request budget. */
export class BuildCourseWorkflow extends WorkflowEntrypoint<Env, BuildParams> {
  async run(event: WorkflowEvent<BuildParams>, step: WorkflowStep) {
    const p = event.payload;
    const { courseId, userId, runId, goal } = p;
    const env = meteredEnv(this.env);
    const progress = (text: string) => env.DB.prepare("UPDATE courses SET progress = ? WHERE id = ? AND build_attempt = ? AND status = 'building'").bind(text, courseId, runId).run();
    try {
      const active = await step.do("active", async () => Boolean(await activeBuild(env, courseId, runId)));
      if (!active) return { skipped: true };
      await step.do("progress-outline", async () => { await progress("Planning the outline"); });
      const outline = await step.do("outline", MODEL_STEP, async () => {
        const ctx = await getAiCtx(env, userId);
        return planOutline(ctx, await loadSourcesFor(env, courseId), goal);
      });
      const flat = outline.chapters.flatMap((ch) => ch.sections.map((s) => ({ ...s, chapter: ch.title })));
      const ids = await step.do("section-ids", async () => flat.map(() => randomId("sec")));
      await step.do("prepare-sections", async () => {
        if (!(await activeBuild(env, courseId, runId))) return;
        await env.DB.batch([
          env.DB.prepare("UPDATE courses SET title = CASE WHEN title = 'New course' THEN ? ELSE title END, description = ? WHERE id = ? AND build_attempt = ?").bind(outline.title, outline.description, courseId, runId),
          ...flat.map((s, k) => env.DB.prepare("INSERT OR IGNORE INTO section_build_jobs (attempt_id, section_id, course_id, ord, title, chapter, concept, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(runId, ids[k], courseId, k, s.title, s.chapter, s.concept, Date.now())),
        ]);
        await recordRunTrace(env, runId, { label: `Planned ${flat.length} sections; each will be written and checked independently`, model: "muse-spark-1.3" });
      });
      // Stable IDs make a replay of dispatch safe. Completed children are never rerun.
      for (let k = 0; k < flat.length; k++) {
        await step.do(`dispatch-${k}`, async () => {
          if (!(await activeBuild(env, courseId, runId))) return;
          const id = `${runId}-${ids[k]}`;
          const params: SectionBuildParams = { ...p, sectionId: ids[k], section: flat[k], previousTitles: flat.slice(0, k).map((s) => s.title) };
          try {
            await env.BUILD_SECTION.create({ id, params });
          } catch (err) {
            // Only accept a duplicate if the exact instance actually exists.
            try { await (await env.BUILD_SECTION.get(id)).status(); } catch { throw err; }
          }
        });
      }
      for (let poll = 0; poll < 160; poll++) {
        const state = await step.do(`poll-${poll}`, async () => {
          // One query for all children per interval; no per-child status API polling.
          const jobs = await buildJobs(env, courseId, runId);
          const done = completedJobs(jobs, flat.length);
          await progress(`${jobs.filter((j) => j.status === "done").length} of ${flat.length} sections written and checked`);
          return { done };
        });
        if (state.done) {
          await step.do("commit", async () => {
            const jobs = await buildJobs(env, courseId, runId);
            if (!completedJobs(jobs, flat.length)) throw new Error("Sections are not all ready");
            await commitBuild(env, p, jobs);
            await recordRunTrace(env, runId, { label: `Checked ${jobs.reduce((n, j) => n + j.checked, 0)} sentences against their own cited sources; unsupported sentences removed`, model: jobs[0]?.verifier ?? undefined });
            await finishRun(env, runId, "done");
          });
          return { version: 1 };
        }
        await step.sleep(`wait-${poll}`, "15 seconds");
      }
      throw new Error("The sections took too long to finish. Please retry the build.");
    } catch (err) {
      await step.do("failed", async () => {
        await env.DB.prepare("UPDATE courses SET status = 'failed', progress = ? WHERE id = ? AND build_attempt = ? AND status = 'building'").bind(String((err as Error).message).slice(0, 500), courseId, runId).run();
        await finishRun(env, runId, "failed");
      });
      throw err;
    } finally {
      await flushQuota(env);
    }
  }
}
