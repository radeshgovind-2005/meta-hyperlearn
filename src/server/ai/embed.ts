import type { Env } from "../env";
import { MODELS } from "./models";

export const EMBED_DIMS = 768;

/** Embeds texts with Workers AI in batches (bge-base takes up to ~512 tokens each). */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50).map((t) => t.slice(0, 2000));
    const res = (await env.AI.run(MODELS.embed as keyof AiModels, { text: batch } as never)) as unknown as { data: number[][] };
    out.push(...res.data);
  }
  return out;
}
