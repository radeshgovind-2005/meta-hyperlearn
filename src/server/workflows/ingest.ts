import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { getAiCtx } from "../ai/meta";
import { embedSource, extractPdf, loadSource, setProgress, structureSource, transcribeSegment } from "../ingest/pipeline";
import { recordRunTrace } from "../lib/runs";

export type IngestParams = { sourceId: string; userId: string; runId: string };

const retry = { retries: { limit: 2, delay: "5 seconds" as const, backoff: "exponential" as const }, timeout: "10 minutes" as const };

/** ingestGraph on Cloudflare Workflows: detect type → extract/transcribe → structure → embed. */
export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep) {
    const { sourceId, userId, runId } = event.payload;
    const env = this.env;
    try {
      const src = await step.do("load", async () => loadSource(env, sourceId));
      const isAudio = src.kind === "audio";

      if (isAudio) {
        const meta = src.meta ? (JSON.parse(src.meta) as { segments?: { key: string; offsetMs: number }[] }) : {};
        const segments = meta.segments ?? [];
        if (!segments.length) throw new Error("No audio segments were uploaded");
        let ord = 0;
        for (let k = 0; k < segments.length; k++) {
          await step.do(`progress-transcribe-${k}`, async () => setProgress(env, sourceId, `Transcribing part ${k + 1} of ${segments.length}`));
          const r = await step.do(`transcribe-${k}`, retry, async () => {
            const ctx = await getAiCtx(env, userId);
            return transcribeSegment(env, ctx, src, segments[k].key, segments[k].offsetMs, ord);
          });
          ord += r.chunks;
          await step.do(`duration-${k}`, async () => {
            await env.DB.prepare("UPDATE sources SET duration_s = ? WHERE id = ?").bind(r.endMs / 1000, sourceId).run();
          });
        }
        await recordRunTrace(env, runId, { label: "Transcribed the recording with timestamps", model: "muse-voice-transcribe-1.0" });
      } else {
        await step.do("progress-extract", async () => setProgress(env, sourceId, "Reading pages"));
        const ex = await step.do("extract", retry, async () => extractPdf(env, src));
        await step.do("save-page-sizes", async () => {
          const cur = await loadSource(env, sourceId);
          const meta = { ...(cur.meta ? JSON.parse(cur.meta) : {}), pageSizes: ex.pageSizes };
          await env.DB.prepare("UPDATE sources SET meta = ? WHERE id = ?").bind(JSON.stringify(meta), sourceId).run();
        });
        await recordRunTrace(env, runId, { label: `Read ${ex.pages} pages into ${ex.chunks} passages with positions` });
      }

      await step.do("progress-structure", async () => setProgress(env, sourceId, src.kind === "exam" ? "Learning the exam style" : "Finding topics"));
      const st = await step.do("structure", retry, async () => {
        const ctx = await getAiCtx(env, userId);
        return structureSource(env, ctx, await loadSource(env, sourceId));
      });
      await recordRunTrace(env, runId, { label: `Found ${st.concepts} concepts`, model: "muse-spark-1.3" });

      await step.do("progress-embed", async () => setProgress(env, sourceId, "Indexing for citations"));
      const n = await step.do("embed", retry, async () => embedSource(env, sourceId, userId));
      await recordRunTrace(env, runId, { label: `Indexed ${n} passages`, model: "@cf/baai/bge-base-en-v1.5" });

      await step.do("done", async () => {
        await setProgress(env, sourceId, "Ready", "ready");
        await env.DB.prepare("UPDATE runs SET status = 'done', finished_at = ? WHERE id = ?").bind(Date.now(), runId).run();
      });
    } catch (err) {
      await step.do("failed", async () => {
        await env.DB.prepare("UPDATE sources SET status = 'failed', error = ?, progress = NULL WHERE id = ?").bind(String((err as Error).message ?? err).slice(0, 500), sourceId).run();
        await env.DB.prepare("UPDATE runs SET status = 'failed', finished_at = ? WHERE id = ?").bind(Date.now(), runId).run();
      });
      throw err;
    }
  }
}
