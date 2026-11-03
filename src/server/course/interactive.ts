import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { Block, WidgetBlock } from "../../shared/types";
import { checkClaims, widgetProblems } from "../../shared/widgets";
import { hasFormula } from "../../shared/mathtext";
import { WIDGET_RULES, WidgetChoiceSchema, toWidgetSpec } from "../graphs/mutate";
import { renderAndJudge } from "../verify/widgetRender";
import { chunkToCite, type ChunkRow } from "../lib/chunks";
import { randomId } from "../lib/crypto";

/** A page that states a formula gets an interactive example by default. */
export function wantsInteractive(blocks: Block[]): boolean {
  if (blocks.some((b) => b.kind === "widget")) return false;
  return blocks.some((b) => b.kind === "text" && hasFormula(b.md));
}

/** The paragraph the example is built around: the first one with a formula. */
function formulaParagraph(blocks: Block[]) {
  return blocks.find((b): b is Extract<Block, { kind: "text" }> => b.kind === "text" && hasFormula(b.md));
}

/**
 * Builds one interactive example for the page's formula and tests it the way the mutate graph does:
 * parameters and claims in code, then a real browser. One repair round, then none (a page without an
 * example is better than a broken one).
 */
export async function makeInteractive(env: Env, ctx: AiCtx, args: { title: string; blocks: Block[]; chunks: ChunkRow[] }): Promise<{ block: WidgetBlock | null; reason: string }> {
  const para = formulaParagraph(args.blocks);
  if (!para) return { block: null, reason: "no formula on this page" };
  const request = `Make the formula in "${args.title}" something the student can play with.`;
  const byId = new Map(args.chunks.map((c) => [c.id, c]));
  const material = args.chunks.map((c) => `<chunk id="${c.id}">\n${c.text}\n</chunk>`).join("\n");
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const choice = await chatJson(ctx, {
      model: MODELS.spark,
      name: "build-default-widget",
      schema: WidgetChoiceSchema,
      schemaName: "widget",
      reasoningEffort: "medium",
      maxTokens: 3000,
      messages: [
        { role: "system", content: WIDGET_RULES },
        { role: "user", content: [`Request: "${request}"`, `Paragraph: ${para.md}`, feedback ? `Your last example failed checks:\n${feedback}\nFix it.` : "", asData("cited material", material)].filter(Boolean).join("\n\n") },
      ],
    });
    try {
      const spec = await toWidgetSpec(ctx, choice, request, para.md);
      const problems: string[] = [];
      if (spec.template !== "custom") {
        problems.push(...widgetProblems(spec.template, spec.params));
        problems.push(...checkClaims(spec.template, spec.params, spec.claims).filter((c) => !c.ok).map((c) => `claim "${c.claim}" ${c.detail}`));
      }
      const render = await renderAndJudge(env, ctx, spec, request);
      problems.push(...render.errors.map((e) => `console error: ${e}`));
      if (render.judge && !render.judge.ok) problems.push(`screenshot review: ${render.judge.reason}`);
      if (problems.length) {
        feedback = problems.map((p) => `- ${p}`).join("\n");
        continue;
      }
      let cites = choice.chunkIds.filter((id) => byId.has(id)).map((id) => chunkToCite(byId.get(id)!));
      if (!cites.length) cites = para.cites;
      return { block: { id: randomId("w"), kind: "widget", spec, cites }, reason: render.unavailable ? "checked in code" : "ran without errors" };
    } catch (err) {
      feedback = `- ${(err as Error).message}`;
    }
  }
  return { block: null, reason: feedback.replace(/^- /, "").slice(0, 160) };
}

/** Places the example right after the paragraph it is built around. */
export function withInteractive(blocks: Block[], widget: WidgetBlock): Block[] {
  const at = blocks.findIndex((b) => b.kind === "text" && hasFormula(b.md));
  if (at < 0 || blocks.some((b) => b.kind === "widget")) return blocks;
  return [...blocks.slice(0, at + 1), widget, ...blocks.slice(at + 1)];
}
