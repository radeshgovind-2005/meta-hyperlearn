import { z } from "zod";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson, DATA_RULE } from "../ai/meta";
import { EXT, generateImage, type GeneratedImage } from "../ai/image";
import { MODELS } from "../ai/models";
import type { Block, Cite } from "../../shared/types";
import type { FigureBlock } from "../../shared/hero";
import { randomId } from "../lib/crypto";

// Muse Spark writes the picture brief, Muse Image draws it, Muse Spark looks at the result.

/** Same look on every page; the model only decides what to draw. */
const HOUSE_STYLE =
  "Clean editorial illustration for a university course page. Flat vector look, hairline outlines, generous white space, light off-white background. " +
  "Palette: blue #0A5CFF, dark slate #1C2B33, soft grey #E3E6EA, one small warm accent #A14D00. No gradients, no drop shadows, no photographs, no emoji. " +
  "Absolutely no text, letters, numbers, equations, logos or watermarks anywhere in the picture. No human faces.";

const PlanSchema = z.object({
  subject: z.string().describe("what the picture shows, as a concrete visual scene or diagram, one or two sentences"),
  caption: z.string().describe("a plain caption naming what is drawn, max 14 words, no numbers or claims that the text does not make"),
});

const JudgeSchema = z.object({
  ok: z.boolean(),
  reason: z.string().describe("one short sentence"),
});

export type Illustration = { block: FigureBlock; reason: string; attempts: number };
export type IllustrationFailure = { block: null; reason: string; attempts: number };

export function illustrationsEnabled(env: Env): boolean {
  return env.ILLUSTRATIONS !== "off";
}

export function textOf(blocks: Block[], limit = 1800): string {
  return blocks
    .filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text")
    .map((b) => b.md)
    .join("\n\n")
    .slice(0, limit);
}

export function brief(subject: string): string {
  return `${HOUSE_STYLE} Subject: ${subject.trim()}`;
}

async function plan(ctx: AiCtx, args: { title: string; text: string; request?: string; feedback?: string }) {
  return chatJson(ctx, {
    model: MODELS.spark,
    name: "plan-illustration",
    schema: PlanSchema,
    schemaName: "illustration_plan",
    reasoningEffort: "low",
    maxTokens: 500,
    messages: [
      {
        role: "system",
        content: [
          "You brief an illustrator for one picture at the top of a course page. Show the idea of the page as a concrete visual: a diagram, a scene or an analogy a student would recognise.",
          "Describe shapes, objects, arrows and layout in plain words. Do not ask for any text, labels, numbers or formulas inside the picture; the caption carries the words.",
          "Draw only what the page's text says. Do not invent facts.",
          DATA_RULE,
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Page title: "${args.title}"`,
          args.request ? `The student asked for: "${args.request}"` : "",
          args.feedback ? `Your last picture was rejected: ${args.feedback}\nMake the subject simpler and more literal.` : "",
          asData("page text", args.text),
        ].filter(Boolean).join("\n\n"),
      },
    ],
  });
}

async function judge(ctx: AiCtx, image: GeneratedImage, args: { title: string; subject: string }) {
  let bin = "";
  for (let i = 0; i < image.bytes.length; i += 0x8000) bin += String.fromCharCode(...image.bytes.subarray(i, i + 0x8000));
  return chatJson(ctx, {
    model: MODELS.spark,
    name: "judge-illustration",
    schema: JudgeSchema,
    schemaName: "illustration_judgement",
    reasoningEffort: "low",
    maxTokens: 400,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This picture goes at the top of the course page "${args.title}". It was meant to show: ${args.subject}\nAnswer ok=true if it clearly relates to that, looks clean and is suitable for a textbook. Answer ok=false if it is unrelated, confusing, shows garbled or misspelled text, a watermark, a face, or looks broken. Give a one-sentence reason.`,
          },
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${btoa(bin)}` } },
        ],
      },
    ],
  });
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Content-addressed, like blocks: the same picture is stored once. */
export async function storeImage(env: Env, image: GeneratedImage): Promise<string> {
  const key = `illustrations/${await sha256Hex(image.bytes)}.${EXT[image.mime] ?? "webp"}`;
  if (!(await env.FILES.head(key))) await env.FILES.put(key, image.bytes, { httpMetadata: { contentType: image.mime } });
  return key;
}

/**
 * Draws one verified, labelled-as-generated picture for a page. Up to two attempts:
 * a rejected picture sends the reviewer's reason back to the brief.
 */
export async function makeIllustration(
  env: Env,
  ctx: AiCtx,
  args: { title: string; blocks: Block[]; request?: string; cites?: Cite[]; blockId?: string },
): Promise<Illustration | IllustrationFailure> {
  const text = textOf(args.blocks);
  if (!text) return { block: null, reason: "This page has no text to illustrate", attempts: 0 };
  const cites = args.cites ?? args.blocks.find((b) => b.kind === "text")?.cites ?? [];
  let feedback = "";
  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = await plan(ctx, { title: args.title, text, request: args.request, feedback });
    const image = await generateImage(ctx, brief(p.subject));
    const verdict = await judge(ctx, image, { title: args.title, subject: p.subject });
    reason = verdict.reason;
    if (verdict.ok) {
      const block: FigureBlock = { id: args.blockId ?? randomId("f"), kind: "figure", r2Key: await storeImage(env, image), caption: p.caption.trim(), cites, generated: true };
      return { block, reason, attempts: attempt };
    }
    feedback = verdict.reason;
  }
  return { block: null, reason, attempts: 2 };
}
