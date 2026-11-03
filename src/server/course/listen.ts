import { z } from "zod";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson, DATA_RULE } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { Block } from "../../shared/types";

const ScriptSchema = z.object({
  segments: z.array(z.object({ blockId: z.string(), text: z.string().describe("what to say aloud for this block") })),
});
export type ListenSegment = z.infer<typeof ScriptSchema>["segments"][number];

function readable(b: Block): string | null {
  if (b.kind === "text") return b.md;
  if (b.kind === "exercise") return `Exercise: ${b.prompt}`;
  if (b.kind === "figure") return `Figure: ${b.caption}`;
  if (b.kind === "widget") return `Interactive example: ${b.spec.title ?? b.spec.template}`;
  return null;
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Muse Spark turns a section into a script for a text-to-speech voice: maths read the
 * way a lecturer says it, figures and examples described, no markdown. Cached per content.
 */
export async function listenScript(env: Env, ctx: AiCtx, title: string, blocks: Block[]): Promise<{ segments: ListenSegment[]; cached: boolean }> {
  const items = blocks.map((b) => ({ id: b.id, text: readable(b) })).filter((x): x is { id: string; text: string } => Boolean(x.text));
  if (!items.length) return { segments: [], cached: true };
  const key = `listen/${await sha256(JSON.stringify({ title, items }))}.json`;
  const hit = await env.FILES.get(key);
  if (hit) return { segments: JSON.parse(await hit.text()) as ListenSegment[], cached: true };
  const out = await chatJson(ctx, {
    model: MODELS.spark,
    name: "listen-script",
    schema: ScriptSchema,
    schemaName: "listen_script",
    reasoningEffort: "low",
    maxTokens: 400 + 120 * items.length + Math.ceil(items.reduce((n, x) => n + x.text.length, 0) / 2),
    messages: [
      {
        role: "system",
        content: [
          "You turn a study section into a script that a text-to-speech voice reads aloud. One segment per block, same order, same blockId.",
          "Keep the meaning and every fact; do not add facts. Write maths as it is spoken: λ² − 7λ + 10 becomes 'lambda squared minus seven lambda plus ten', [[4, 1], [2, 3]] becomes 'the matrix with rows four, one and two, three', A⁻¹ becomes 'A inverse'.",
          "No markdown, symbols, citations or bullet characters. Short spoken sentences. For an interactive example or figure, one sentence on what it shows and that it is on screen.",
          DATA_RULE,
        ].join(" "),
      },
      { role: "user", content: [`Section title: ${title}`, asData("blocks", items.map((x) => `<block id="${x.id}">\n${x.text}\n</block>`).join("\n"))].join("\n\n") },
    ],
  });
  const ids = new Set(items.map((x) => x.id));
  const segments = out.segments.filter((s) => ids.has(s.blockId) && s.text.trim());
  await env.FILES.put(key, JSON.stringify(segments), { httpMetadata: { contentType: "application/json" } });
  return { segments, cached: false };
}
