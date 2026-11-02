import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { getAiCtx } from "../ai/meta";
import { gatherSectionChunks, loadSourcesFor, planOutline, verifyBlocks, writeSection } from "../course/build";
import { putBlocks } from "../lib/blocks";
import { randomId } from "../lib/crypto";
import { finishRun, recordRunTrace } from "../lib/runs";
import type { ExamStyle } from "../ingest/pipeline";

export type BuildParams = { courseId: string; userId: string; runId: string; goal: string };

const retry = { retries: { limit: 2, delay: "5 seconds" as const, backoff: "exponential" as const }, timeout: "10 minutes" as const };

/** buildCourseGraph on Workflows; sections are written in parallel steps. */
export class BuildCourseWorkflow extends WorkflowEntrypoint<Env, BuildParams> {
  async run(event: WorkflowEvent<BuildParams>, step: WorkflowStep) {
    const { courseId, userId, runId, goal } = event.payload;
    const env = this.env;
    const progress = (p: string) => env.DB.prepare("UPDATE courses SET progress = ? WHERE id = ?").bind(p, courseId).run();
    try {
      await step.do("progress-outline", async () => { await progress("Planning the outline"); });
      const outline = await step.do("outline", retry, async () => {
        const ctx = await getAiCtx(env, userId);
        return planOutline(ctx, await loadSourcesFor(env, courseId), goal);
      });
      await step.do("trace-outline", async () => {
        await recordRunTrace(env, runId, { label: `Planned ${outline.chapters.length} chapters, ${outline.chapters.reduce((n, c) => n + c.sections.length, 0)} sections`, model: "muse-spark-1.3" });
        await env.DB.prepare("UPDATE courses SET title = ?, description = ? WHERE id = ?").bind(outline.title, outline.description, courseId).run();
      });

      const flat = outline.chapters.flatMap((ch) => ch.sections.map((s) => ({ ...s, chapter: ch.title })));
      const ids = await step.do("section-ids", async () => flat.map(() => randomId("sec")));
      await step.do("progress-write", async () => { await progress(`Writing ${flat.length} sections`); });

      const written = await Promise.all(
        flat.map((s, k) =>
          step.do(`section-${k}`, retry, async () => {
            const ctx = await getAiCtx(env, userId);
            const sources = await loadSourcesFor(env, courseId);
            const exam = sources.find((x) => x.kind === "exam");
            const chunks = await gatherSectionChunks(env, sources, s.pages, `${s.title}: ${s.concept}`);
            const args = {
              title: s.title,
              concept: s.concept,
              chunks,
              sources,
              examStyle: exam?.meta.examStyle as ExamStyle | undefined,
              examName: exam?.filename,
              examSourceId: exam?.id,
              previousTitles: flat.slice(0, k).map((p) => p.title),
            };
            let blocks = await writeSection(env, ctx, args);
            let v = await verifyBlocks(env, ctx, blocks);
            if (v.problems.length) {
              blocks = await writeSection(env, ctx, { ...args, feedback: v.problems.join("\n") });
              v = await verifyBlocks(env, ctx, blocks);
            }
            const hashes = await putBlocks(env, v.blocks);
            return { hashes, checked: v.checked, supported: v.supported, verifier: v.verifier };
          }),
        ),
      );

      const version = await step.do("commit", async () => {
        const now = Date.now();
        const stmts = flat.flatMap((s, k) => [
          env.DB.prepare("INSERT OR IGNORE INTO sections (id, course_id, chapter, concept, origin, created_at) VALUES (?, ?, ?, ?, 'build', ?)").bind(ids[k], courseId, s.chapter, s.concept, now),
          env.DB.prepare("INSERT OR IGNORE INTO section_versions (section_id, version, title, block_hashes, created_at) VALUES (?, 1, ?, ?, ?)").bind(ids[k], s.title, JSON.stringify(written[k].hashes), now),
        ]);
        await env.DB.batch(stmts);
        const checked = written.reduce((n, w) => n + w.checked, 0);
        const supported = written.reduce((n, w) => n + w.supported, 0);
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO course_versions (course_id, version, kind, summary, path, sections, author_id, run_id, created_at) VALUES (?, 1, 'build', ?, ?, ?, ?, ?, ?)").bind(
            courseId,
            `Built from ${flat.length} sections. ${supported} of ${checked} sentences matched their sources.`,
            JSON.stringify(ids),
            JSON.stringify(Object.fromEntries(ids.map((id) => [id, 1]))),
            userId,
            runId,
            now,
          ),
          env.DB.prepare("UPDATE courses SET status = 'ready', progress = NULL, current_version = 1, updated_at = ? WHERE id = ?").bind(now, courseId),
        ]);
        await recordRunTrace(env, runId, { label: `Checked ${checked} sentences against their sources: ${supported} supported, the rest removed`, model: written[0]?.verifier });
        await finishRun(env, runId, "done");
        return 1;
      });
      return { version };
    } catch (err) {
      await step.do("failed", async () => {
        await env.DB.prepare("UPDATE courses SET status = 'failed', progress = ? WHERE id = ?").bind(String((err as Error).message).slice(0, 300), courseId).run();
        await finishRun(env, runId, "failed");
      });
      throw err;
    }
  }
}
