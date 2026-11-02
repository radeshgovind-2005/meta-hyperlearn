import { z } from "zod";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { chatJson, safeParseJson, asData, DATA_RULE, toJsonSchema } from "../ai/meta";
import { isOpenWeight, openChat, openModelLabel } from "../ai/openModel";
import { MODELS } from "../ai/models";

export type Verdict = { i: number; supported: boolean; reason: string };
export type SentenceCheck = { sentence: string; supported: boolean; reason: string };

/** Splits markdown prose into sentences, keeping math like "Av = λv." intact. */
export function splitSentences(md: string): string[] {
  const text = md.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const parts = text.match(/[^.!?]+(?:[.!?]+(?=\s+[A-Z(0-9"“$\\]|\s*$)|$)/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    // glue very short fragments (e.g. "e.g.") onto the previous sentence
    if (out.length && s.length < 12) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
}

const VerdictsSchema = z.object({
  verdicts: z.array(z.object({ i: z.number().int(), supported: z.boolean(), reason: z.string() })),
});

/** Parses verifier output leniently: JSON object, bare array, or "1: SUPPORTED - reason" lines. */
export function parseVerdicts(text: string, count: number): Verdict[] {
  const parsed = safeParseJson(text);
  let list: unknown[] | undefined;
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { verdicts?: unknown }).verdicts)) list = (parsed as { verdicts: unknown[] }).verdicts;
  const byIndex = new Map<number, Verdict>();
  if (list) {
    list.forEach((raw, idx) => {
      if (!raw || typeof raw !== "object") return;
      const r = raw as Record<string, unknown>;
      const i = typeof r.i === "number" ? r.i : typeof r.index === "number" ? r.index : idx + 1;
      const sup = r.supported ?? r.verdict ?? r.label;
      const supported = sup === true || (typeof sup === "string" && /^(supported|yes|true|entailed)$/i.test(sup.trim()));
      byIndex.set(i, { i, supported, reason: String(r.reason ?? r.explanation ?? "") });
    });
  } else {
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*\[?(\d+)\]?[.:)\-\s]+\s*(SUPPORTED|UNSUPPORTED|NOT SUPPORTED|YES|NO)\b[\s:\-–]*(.*)$/i);
      if (m) byIndex.set(Number(m[1]), { i: Number(m[1]), supported: /^(supported|yes)$/i.test(m[2]), reason: m[3].trim() });
    }
  }
  // missing verdicts count as unsupported: we never assume a sentence is fine
  return Array.from({ length: count }, (_, k) => byIndex.get(k + 1) ?? { i: k + 1, supported: false, reason: "no verdict returned" });
}

function buildPrompt(sentences: string[], evidence: string[]): string {
  return [
    "You check a study text against its sources. For each numbered sentence decide if the evidence supports it.",
    "A sentence is supported if it states, paraphrases, simplifies, or is a direct consequence of the evidence (including a correct worked example of a rule stated in the evidence). Connective sentences that make no factual claim are supported.",
    "It is unsupported if it adds a fact, number, or claim that the evidence does not back, or contradicts it.",
    DATA_RULE,
    "",
    evidence.map((e, k) => asData(`evidence ${k + 1}`, e)).join("\n"),
    "",
    "Sentences:",
    sentences.map((s, k) => `${k + 1}. ${s}`).join("\n"),
    "",
    'Answer with JSON only: {"verdicts":[{"i":1,"supported":true,"reason":"short reason"}, ...]} with one entry per sentence.',
  ].join("\n");
}

export async function verifySentences(
  env: Env,
  ctx: AiCtx,
  md: string,
  evidence: string[],
): Promise<{ checks: SentenceCheck[]; verifier: string }> {
  const sentences = splitSentences(md);
  if (!sentences.length) return { checks: [], verifier: "none" };
  if (!evidence.length) return { checks: sentences.map((s) => ({ sentence: s, supported: false, reason: "no cited source" })), verifier: "none" };
  const prompt = buildPrompt(sentences, evidence);

  if (isOpenWeight(env)) {
    try {
      const text = await openChat(env, [{ role: "user", content: prompt }], { trace: ctx.trace, maxTokens: 3000, jsonSchema: toJsonSchema(VerdictsSchema) });
      ctx.onCall?.(env.OPEN_MODEL_ID!, 0);
      const verdicts = parseVerdicts(text, sentences.length);
      return { checks: sentences.map((s, k) => ({ sentence: s, supported: verdicts[k].supported, reason: verdicts[k].reason })), verifier: openModelLabel(env) };
    } catch (err) {
      console.warn("open-weight verifier failed, falling back to Muse Spark", String(err));
    }
  }
  const out = await chatJson(ctx, {
    model: MODELS.spark,
    name: "verify-sentences",
    messages: [{ role: "user", content: prompt }],
    schema: VerdictsSchema,
    schemaName: "verdicts",
    maxTokens: 3000,
    reasoningEffort: "low",
  });
  const verdicts = parseVerdicts(JSON.stringify(out), sentences.length);
  return { checks: sentences.map((s, k) => ({ sentence: s, supported: verdicts[k].supported, reason: verdicts[k].reason })), verifier: "Muse Spark (verifier)" };
}
