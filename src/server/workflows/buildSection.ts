import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { flushQuota, meteredEnv } from "../lib/quota";
import { getAiCtx } from "../ai/meta";
import { gatherSectionChunks, loadSourcesFor, verifyBlocks, writeSection } from "../course/build";
import { activeBuild } from "../course/buildJobs";
import { putBlocks } from "../lib/blocks";
import { illustrationsEnabled, makeIllustration } from "../course/illustrate";
import { withHero, type FigureBlock } from "../../shared/hero";
import type { WidgetBlock } from "../../shared/types";
import { warmNarration } from "../course/narrate";
import { makeInteractive, wantsInteractive, withInteractive } from "../course/interactive";
import type { ExamStyle } from "../ingest/pipeline";
import type { BuildParams } from "./buildCourse";

// chatJson and metaFetch already retry within a bounded budget. Never multiply it.
export const MODEL_STEP = { retries: { limit: 0, delay: "1 second" as const }, timeout: "10 minutes" as const };
export type SectionBuildParams = BuildParams & {
  sectionId: string;
  section: { title: string; concept: string; pages: { sourceId: string; page: number }[] };
  previousTitles: string[];
};

export class BuildSectionWorkflow extends WorkflowEntrypoint<Env, SectionBuildParams> {
  async run(event: WorkflowEvent<SectionBuildParams>, step: WorkflowStep) {
    const { courseId, userId, runId, sectionId, section, previousTitles } = event.payload;
    const env = meteredEnv(this.env);
    try {
      const execute = await step.do("claim", async () => {
        if (!(await activeBuild(env, courseId, runId))) return false;
        const r = await env.DB.prepare("UPDATE section_build_jobs SET status = 'running', updated_at = ? WHERE attempt_id = ? AND section_id = ? AND status = 'queued'").bind(Date.now(), runId, sectionId).run();
        return Boolean(r.meta.changes);
      });
      if (!execute) return { skipped: true };
      const contextJson = await step.do("context", MODEL_STEP, async () => {
        const sources = await loadSourcesFor(env, courseId);
        const exam = sources.find((s) => s.kind === "exam");
        const chunks = await gatherSectionChunks(env, sources, section.pages, `${section.title}: ${section.concept}`);
        if (!chunks.length) throw new Error("No source passages were found for this section.");
        return JSON.stringify({ ...section, chunks, sources, examStyle: exam?.meta.examStyle as ExamStyle | undefined, examName: exam?.filename, examSourceId: exam?.id, previousTitles });
      });
      const args = JSON.parse(contextJson) as Parameters<typeof writeSection>[2];
      const draftJson = await step.do("write", MODEL_STEP, async () => JSON.stringify(await writeSection(env, await getAiCtx(env, userId), args)));
      const verify = async (json: string) => JSON.stringify(await verifyBlocks(env, await getAiCtx(env, userId), JSON.parse(json)));
      const checkedJson = await step.do("verify", MODEL_STEP, async () => verify(draftJson));
      let result = JSON.parse(checkedJson) as Awaited<ReturnType<typeof verifyBlocks>>;
      if (result.problems.length) {
        const feedback = result.problems.join("\n");
        const repairedJson = await step.do("rewrite", MODEL_STEP, async () => JSON.stringify(await writeSection(env, await getAiCtx(env, userId), { ...args, feedback })));
        result = JSON.parse(await step.do("recheck", MODEL_STEP, async () => verify(repairedJson))) as typeof result;
      }
      if (!result.blocks.some((b) => b.kind === "text")) throw new Error("No teaching text could be verified against the sources. Please retry.");
      // best effort: a page without a picture is better than a failed build
      const heroJson = illustrationsEnabled(env)
        ? await step.do("illustrate", MODEL_STEP, async () => {
            try {
              const made = await makeIllustration(env, await getAiCtx(env, userId), { title: section.title, blocks: result.blocks });
              return made.block ? JSON.stringify(made.block) : "";
            } catch (err) {
              console.error("illustration failed", (err as Error).message);
              return "";
            }
          })
        : "";
      // best effort: math pages get an interactive example by default
      const widgetJson = wantsInteractive(result.blocks)
        ? await step.do("interact", MODEL_STEP, async () => {
            try {
              const made = await makeInteractive(env, await getAiCtx(env, userId), { title: section.title, blocks: result.blocks, chunks: args.chunks });
              return made.block ? JSON.stringify(made.block) : "";
            } catch (err) {
              console.error("interactive example failed", (err as Error).message);
              return "";
            }
          })
        : "";
      await step.do("save", async () => {
        if (!(await activeBuild(env, courseId, runId))) return;
        const withWidget = widgetJson ? withInteractive(result.blocks, JSON.parse(widgetJson) as WidgetBlock) : result.blocks;
        const blocks = heroJson ? withHero(withWidget, JSON.parse(heroJson) as FigureBlock) : withWidget;
        const hashes = await putBlocks(env, blocks);
        await env.DB.prepare("UPDATE section_build_jobs SET status = 'done', block_hashes = ?, checked = ?, supported = ?, verifier = ?, error = NULL, updated_at = ? WHERE attempt_id = ? AND section_id = ? AND status = 'running'").bind(JSON.stringify(hashes), result.checked, result.supported, result.verifier, Date.now(), runId, sectionId).run();
        await flushQuota(env);
      });
      // best effort: the spoken version is made now, so Listen starts at once
      await step.do("narrate", MODEL_STEP, async () => {
        const withWidget = widgetJson ? withInteractive(result.blocks, JSON.parse(widgetJson) as WidgetBlock) : result.blocks;
        await warmNarration(env, userId, section.title, heroJson ? withHero(withWidget, JSON.parse(heroJson) as FigureBlock) : withWidget);
        await flushQuota(env);
      });
      return { sectionId };
    } catch (err) {
      await step.do("failed", async () => {
        await env.DB.prepare("UPDATE section_build_jobs SET status = 'failed', error = ?, updated_at = ? WHERE attempt_id = ? AND section_id = ? AND status != 'done'").bind(String((err as Error).message).slice(0, 400), Date.now(), runId, sectionId).run();
      });
      throw err;
    } finally {
      await flushQuota(env);
    }
  }
}
