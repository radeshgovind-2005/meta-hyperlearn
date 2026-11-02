import { z } from "zod";
import type { AiCtx } from "./meta";
import { assertBudget, metaFetch, ModelError, recordSpend } from "./meta";
import { MODELS, PRICES } from "./models";
import { traceChild } from "../lib/tracing";

export type GeneratedImage = { bytes: Uint8Array<ArrayBuffer>; mime: string };

const ImagesResponse = z.object({
  data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })).min(1),
  output_format: z.string().optional(),
});

const MIME: Record<string, string> = { webp: "image/webp", png: "image/png", jpeg: "image/jpeg" };
export const EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reads POST /images/generations output (docs: https://dev.meta.ai/docs/api-reference/images/create-image). */
export function parseImagesResponse(json: unknown): GeneratedImage {
  const parsed = ImagesResponse.safeParse(json);
  const b64 = parsed.success ? parsed.data.data[0].b64_json : undefined;
  if (!parsed.success || !b64) throw new ModelError("Muse Image returned no picture");
  return { bytes: base64ToBytes(b64), mime: MIME[parsed.data.output_format ?? "webp"] ?? "image/webp" };
}

/** One picture from Muse Image. `size` only sets the aspect ratio; the model picks its own resolution. */
export async function generateImage(ctx: AiCtx, prompt: string, opts: { size?: string; format?: "webp" | "png" | "jpeg"; reasoning?: "low" | "high" } = {}): Promise<GeneratedImage> {
  await assertBudget(ctx);
  return traceChild(
    ctx.trace,
    MODELS.image,
    "llm",
    { prompt },
    async () => {
      const res = await metaFetch(
        ctx,
        "/images/generations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODELS.image,
            prompt,
            n: 1,
            size: opts.size ?? "1792x1024",
            response_format: "b64_json",
            output_format: opts.format ?? "webp",
            reasoning_strength: opts.reasoning ?? "low",
            user: ctx.userId.slice(0, 64),
          }),
        },
        2,
      );
      const image = parseImagesResponse(await res.json());
      await recordSpend(ctx, MODELS.image, PRICES.imageEach);
      return image;
    },
    (r) => ({ bytes: r.bytes.length, mime: r.mime }),
  );
}
