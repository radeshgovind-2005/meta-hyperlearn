import type { AiCtx } from "./meta";
import { metaFetch, recordSpend } from "./meta";
import { MODELS, PRICES } from "./models";
import { traceChild } from "../lib/tracing";

export type SamBox = { x1: number; y1: number; x2: number; y2: number; w?: number; h?: number; confidence?: number };

/**
 * Parses SAM 3.1 segmentation text, e.g.
 * `<0f>0<|box;x1=12;y1=30;x2=200;y2=180;w=640;h=480|><|mask;x=0;y=0;data=...|>`
 * Only boxes are used (to crop figures). Boxes are in pixels.
 */
export function parseSamBoxes(text: string): SamBox[] {
  const boxes: SamBox[] = [];
  const re = /<\|box;([^|]*)\|>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kv: Record<string, number> = {};
    for (const part of m[1].split(";")) {
      const [k, v] = part.split("=");
      if (k && v !== undefined && !Number.isNaN(Number(v))) kv[k.trim()] = Number(v);
    }
    if (["x1", "y1", "x2", "y2"].every((k) => k in kv) && kv.x2 > kv.x1 && kv.y2 > kv.y1) {
      boxes.push({
        x1: kv.x1, y1: kv.y1, x2: kv.x2, y2: kv.y2,
        ...(kv.w !== undefined ? { w: kv.w } : {}),
        ...(kv.h !== undefined ? { h: kv.h } : {}),
        ...(kv.conf !== undefined ? { confidence: kv.conf } : kv.confidence !== undefined ? { confidence: kv.confidence } : {}),
      });
    }
  }
  return boxes;
}

export async function segment(ctx: AiCtx, imageDataUrl: string, prompt: string): Promise<SamBox[]> {
  return traceChild(ctx.trace, "sam-3.1", "llm", { prompt }, async () => {
    const res = await metaFetch(ctx, "/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.sam,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl }] }],
        metadata: { include_confidence: "true", mask_encoding: "one_bit" },
      }),
    });
    const json = (await res.json()) as { output_text?: string; output?: { content?: { text?: string }[] }[] };
    const text = json.output_text ?? (json.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
    await recordSpend(ctx, MODELS.sam, PRICES.samPerImage);
    return parseSamBoxes(text);
  });
}
