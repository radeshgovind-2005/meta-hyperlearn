import { z } from "zod";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson, DATA_RULE } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { Section, TextBlock } from "../../shared/types";
import { canonicalJson } from "../../shared/patch";
import { getChunks } from "../lib/chunks";
import { verifySentences } from "../verify/sentences";
import { examFor } from "./practice";
import { examStyleText } from "./build";

const MODES = {
  simpler: "Rewrite each paragraph more simply: everyday words, short sentences, define symbols before using them.",
  analogy: "Rewrite each paragraph around one everyday analogy, marked as an analogy ('Think of ...'), then state the precise idea.",
  exam: "Rewrite each paragraph as what the exam expects you to do and write down, step by step.",
} as const;

/**
 * "Show as" reading views. They never change the course; they are cached per
 * section version and checked sentence by sentence like any rewrite.
 */
export async function rephraseSection(env: Env, ctx: AiCtx, courseId: string, section: Section, mode: keyof typeof MODES) {
  const textBlocks = section.blocks.filter((b): b is TextBlock => b.kind === "text");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(textBlocks) + mode));
  const key = `views/${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}.json`;
  const cached = await env.FILES.get(key);
  if (cached) return cached.json();

  const exam = mode === "exam" ? await examFor(env, courseId) : null;
  const out = await chatJson(ctx, {
    model: MODELS.spark,
    name: `show-as-${mode}`,
    schema: z.object({ paragraphs: z.array(z.object({ blockId: z.string(), md: z.string() })) }),
    schemaName: "paragraphs",
    reasoningEffort: "low",
    maxTokens: 4000,
    messages: [
      { role: "system", content: `${MODES[mode]} Keep every fact; add nothing the paragraph doesn't support. One output paragraph per input block, same blockId. ${DATA_RULE}` },
      {
        role: "user",
        content: [
          exam?.style ? examStyleText(exam.style, exam.filename) : "",
          textBlocks.map((b) => asData(`block ${b.id}`, b.md)).join("\n"),
        ].join("\n\n"),
      },
    ],
  });
  const byId = new Map(out.paragraphs.map((p) => [p.blockId, p.md]));
  const blocks: Record<string, string> = {};
  let removed = 0;
  await Promise.all(
    textBlocks.map(async (b) => {
      const md = byId.get(b.id);
      if (!md) return;
      const ev = (await getChunks(env, b.cites.map((c) => c.chunkId!).filter(Boolean))).map((c) => c.text);
      const { checks } = await verifySentences(env, ctx, md, ev.length ? ev : [b.md]);
      const ok = checks.filter((c) => c.supported);
      removed += checks.length - ok.length;
      if (ok.length) blocks[b.id] = ok.map((c) => c.sentence).join(" ");
    }),
  );
  const result = { mode, blocks, removed };
  await env.FILES.put(key, JSON.stringify(result), { httpMetadata: { contentType: "application/json" } });
  return result;
}
