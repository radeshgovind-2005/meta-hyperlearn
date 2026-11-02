import "./als";
import { z } from "zod";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { asData, chatJson, DATA_RULE } from "../ai/meta";
import { MODELS } from "../ai/models";
import type { Block, Cite, PatchOp, RunEvent, Section, TextBlock, WidgetBlock, WidgetSpec } from "../../shared/types";
import { WidgetSpecSchema } from "../../shared/types";
import { applyPatch } from "../../shared/patch";
import { checkClaims, PlotParams, StepperParams, Vector2dParams, widgetProblems, type ClaimResult } from "../../shared/widgets";
import { chunkToCite, evidenceForCites, getChunks, searchChunks, type ChunkRow } from "../lib/chunks";
import { randomId } from "../lib/crypto";
import { verifySentences, type SentenceCheck } from "../verify/sentences";
import { renderAndJudge, type RenderCheck } from "../verify/widgetRender";
import { commitSection } from "../lib/blocks";
import { recordRunTrace } from "../lib/runs";
import { adjustMastery, getMastery } from "../lib/mastery";
import { fmtTime } from "../course/build";
import { illustrationsEnabled, makeIllustration } from "../course/illustrate";
import type { FigureBlock } from "../../shared/hero";

export const MUTATE_STEPS = [
  "Understanding your request",
  "Reading the sources",
  "Rewriting the paragraph",
  "Building the example",
  "Checking each sentence against its source",
  "Testing the example",
];

const IntentSchema = z.object({
  simplify: z.boolean(),
  addWidget: z.boolean(),
  moreExamples: z.boolean().describe("only if the student explicitly asks for more or worked examples"),
  examFocus: z.boolean(),
  analogy: z.boolean(),
  addImage: z.boolean().describe("the student asks for a picture, illustration, drawing or diagram, or wants a selected picture redrawn or changed"),
  tooComplex: z.boolean().describe("the student says it is too hard / confusing"),
  rewrite: z.boolean().describe("the selected text itself should be rewritten"),
  notes: z.string().describe("anything else the student asked for, in a few words"),
});
type Intent = z.infer<typeof IntentSchema>;

const TextOutSchema = z.object({
  paragraphs: z.array(z.object({ md: z.string(), chunkIds: z.array(z.string()) })),
});

const WidgetChoiceSchema = z.object({
  template: z.enum(["vector2d", "plot", "stepper", "custom", "illustration"]),
  title: z.string().describe("short imperative title, e.g. 'Try it: turn v until A stops turning it'"),
  paramsJson: z.string().describe("JSON string of the template params"),
  claims: z.array(z.string()).describe("mathjs boolean expressions that must hold for the params, e.g. 'A * [1, 1] == 3 * [1, 1]'"),
  chunkIds: z.array(z.string()),
});

export type MutateDeps = {
  env: Env;
  ctx: AiCtx;
  emit: (e: RunEvent) => void;
  sources: Map<string, { filename: string; kind: string }>;
};

type Verification = { sentences: SentenceCheck[]; claims: ClaimResult[]; render: RenderCheck | null; verifier: string };

const MutateState = Annotation.Root({
  runId: Annotation<string>(),
  userId: Annotation<string>(),
  courseId: Annotation<string>(),
  sectionId: Annotation<string>(),
  blockId: Annotation<string>(),
  request: Annotation<string>(),
  concept: Annotation<string>(),
  before: Annotation<Section>(),
  intent: Annotation<Intent | null>({ reducer: (_, b) => b, default: () => null }),
  chunks: Annotation<ChunkRow[]>({ reducer: (_, b) => b, default: () => [] }),
  mastery: Annotation<number>({ reducer: (_, b) => b, default: () => 0.5 }),
  textBlocks: Annotation<TextBlock[] | null>({ reducer: (_, b) => b, default: () => null }),
  widget: Annotation<WidgetBlock | null>({ reducer: (_, b) => b, default: () => null }),
  figure: Annotation<FigureBlock | null>({ reducer: (_, b) => b, default: () => null }),
  figureNote: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  widgetError: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  textFeedback: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  widgetFeedback: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  attempts: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  verification: Annotation<Verification | null>({ reducer: (_, b) => b, default: () => null }),
  ops: Annotation<PatchOp[]>({ reducer: (_, b) => b, default: () => [] }),
  after: Annotation<Section | null>({ reducer: (_, b) => b, default: () => null }),
  summary: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  decision: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
  courseVersion: Annotation<number | null>({ reducer: (_, b) => b, default: () => null }),
});
type S = typeof MutateState.State;

const MAX_RETRIES = 2;

export function buildMutateGraph(deps: MutateDeps, checkpointer: BaseCheckpointSaver) {
  const { env, ctx, emit } = deps;
  const wantsPicture = (s: S) => Boolean(s.figure) || (s.intent?.addImage && !s.intent.addWidget);
  const step = (s: S, index: number, status: "active" | "done" | "failed", detail?: string) => {
    const label = index === 1 ? readingLabel(s) : index === 3 && wantsPicture(s) ? "Drawing the illustration" : index === 5 && wantsPicture(s) ? "Checking the picture" : MUTATE_STEPS[index];
    emit({ type: "run.step", runId: s.runId, index, label, status, detail });
  };
  const trace = (s: S, label: string, model?: string) => recordRunTrace(env, s.runId, { label, model });
  const selected = (s: S) => s.before.blocks.find((b) => b.id === s.blockId);

  function readingLabel(s: S): string {
    const b = s.before.blocks.find((x) => x.id === s.blockId);
    const names = [...new Set((b?.cites ?? []).map((c) => citeLabel(deps.sources, c)))];
    return names.length ? `Reading ${names.slice(0, 2).join(" and ")}` : "Reading the sources";
  }

  async function classifyIntent(s: S): Promise<Partial<S>> {
    step(s, 0, "active");
    const intent = await chatJson(ctx, {
      model: MODELS.spark,
      name: "classify-intent",
      schema: IntentSchema,
      schemaName: "intent",
      reasoningEffort: "low",
      maxTokens: 400,
      messages: [
        { role: "system", content: "Classify what a student wants changed about a part of their course. Output flags only. addImage is true when they ask to see a picture, illustration, drawing or diagram, or to redraw a selected picture." },
        { role: "user", content: `Selected ${selected(s)?.kind ?? "block"}. Request: "${s.request}"` },
      ],
    });
    // a widget request on a non-text block still needs text left alone
    if (!intent.rewrite && !intent.addWidget && !intent.moreExamples && !intent.addImage) intent.rewrite = true;
    await trace(s, `Read the request as: ${describeIntent(intent)}`, MODELS.spark);
    step(s, 0, "done", describeIntent(intent));
    return { intent };
  }

  async function gatherContext(s: S): Promise<Partial<S>> {
    step(s, 1, "active");
    const block = selected(s);
    if (!block) throw new Error("Selected block no longer exists");
    const cited = await getChunks(env, block.cites.map((c) => c.chunkId!).filter(Boolean));
    let chunks = cited;
    if (!chunks.length) {
      const ev = await evidenceForCites(env, block.cites);
      chunks = ev.map((text, k) => ({ id: `ev${k}`, source_id: block.cites[k]?.sourceId ?? "", ord: k, text, page: block.cites[k]?.page ?? null, bbox: null, t_start: null, t_end: null, section_path: null }));
    }
    // a little extra material from the same sources helps examples stay grounded
    const sourceIds = [...new Set(block.cites.map((c) => c.sourceId))];
    const extra = await searchChunks(env, `${s.concept}: ${blockText(block)}`.slice(0, 500), [...deps.sources.keys()], 4).catch(() => []);
    const seen = new Set(chunks.map((c) => c.id));
    chunks = [...chunks, ...extra.filter((c) => !seen.has(c.id))];
    let mastery = await getMastery(env, s.userId, s.courseId, s.concept);
    if (s.intent?.tooComplex || s.intent?.simplify) mastery = await adjustMastery(env, s.userId, s.courseId, s.concept, -0.15);
    await trace(s, `Used ${cited.length || chunks.length} cited passages from ${sourceIds.length} source${sourceIds.length === 1 ? "" : "s"}; your mastery of "${s.concept}" is ${Math.round(mastery * 100)}%`);
    step(s, 1, "done");
    return { chunks, mastery };
  }

  /** Decides the shape of the patch (which ops, where) before any content is written. */
  async function planPatch(s: S): Promise<Partial<S>> {
    const i = s.intent!;
    const b = selected(s)!;
    const plan: string[] = [];
    if (b.kind === "text" && (i.rewrite || i.simplify || i.analogy || i.examFocus || i.moreExamples)) plan.push(`replace ${b.id}`);
    if (i.moreExamples) plan.push(`insertAfter ${b.id} (examples)`);
    if (i.addWidget) plan.push(`insertAfter ${b.id} (interactive example, or an illustration when no template fits)`);
    if (i.addImage && !i.addWidget) plan.push(b.kind === "figure" ? `replace ${b.id} (new picture)` : `insertAfter ${b.id} (illustration)`);
    await trace(s, `Planned the patch: ${plan.join("; ") || "no change"}. Other blocks stay untouched`);
    return {};
  }

  async function writeText(s: S): Promise<Partial<S>> {
    const intent = s.intent!;
    const block = selected(s)!;
    if (s.attempts > 0 && !s.textFeedback) return {}; // retry round for the widget only
    if (!(intent.rewrite || intent.simplify || intent.analogy || intent.moreExamples || intent.examFocus) || block.kind !== "text") return { textBlocks: null };
    step(s, 2, "active");
    const material = s.chunks.map((c) => `<chunk id="${c.id}" from="${citeLabel(deps.sources, chunkToCite(c))}">\n${c.text}\n</chunk>`).join("\n");
    const out = await chatJson(ctx, {
      model: MODELS.spark,
      name: "write-text",
      schema: TextOutSchema,
      schemaName: "paragraphs",
      reasoningEffort: "medium",
      maxTokens: 2500,
      messages: [
        {
          role: "system",
          content: [
            "You rewrite one paragraph of a student's course on request. Use only facts from the chunks; every paragraph cites the chunk ids it uses.",
            "Write plainly, short sentences, no filler, no emoji. Keep notation consistent with the original.",
            intent.simplify || intent.tooComplex ? `Make it simpler for a student at ${Math.round(s.mastery * 100)}% mastery: everyday words first, one idea per sentence, define symbols before using them.` : "",
            intent.analogy ? "Include one short analogy, clearly marked as an analogy (e.g. 'Think of ...')." : "",
            intent.moreExamples ? "Add worked examples only if the chunks contain them or they are direct calculations from rules in the chunks." : "",
            intent.examFocus ? "Focus on what an exam asks: the steps to compute and what to write down." : "",
            DATA_RULE,
          ].filter(Boolean).join(" "),
        },
        {
          role: "user",
          content: [
            `Request: "${s.request}"`,
            `Original paragraph:\n${(block as TextBlock).md}`,
            s.textFeedback ? `Your last version had sentences the verifier could not match to the sources. Fix or remove them:\n${s.textFeedback}` : "",
            `Return 1 paragraph${intent.moreExamples ? " (or up to 3 if adding examples)" : ""}.`,
            asData("cited material", material),
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });
    const byId = new Map(s.chunks.map((c) => [c.id, c]));
    const textBlocks: TextBlock[] = out.paragraphs
      .filter((p) => p.md.trim())
      .map((p, k) => {
        let cites: Cite[] = p.chunkIds.filter((id) => byId.has(id)).map((id) => chunkToCite(byId.get(id)!));
        if (!cites.length) cites = block.cites; // keep the original citations
        return { id: k === 0 ? block.id : randomId("b"), kind: "text", md: p.md.trim(), cites, origin: "rephrased" };
      });
    await trace(s, `Rewrote the paragraph${textBlocks.length > 1 ? ` as ${textBlocks.length} paragraphs` : ""}`, MODELS.spark);
    step(s, 2, "done");
    return { textBlocks };
  }

  /** Muse Image draws it; Muse Spark looks at the result before it is shown. */
  async function drawPicture(s: S): Promise<Partial<S>> {
    const block = selected(s)!;
    if (!illustrationsEnabled(env)) {
      step(s, 3, "failed", "Pictures are switched off");
      return { widget: null, figure: null, widgetError: "", figureNote: "Pictures are switched off" };
    }
    step(s, 3, "active");
    // a picture request on a picture replaces it; otherwise it is added after the selected block
    const made = await makeIllustration(env, ctx, {
      title: s.before.title,
      blocks: s.before.blocks,
      request: s.request,
      cites: block.cites.length ? block.cites : undefined,
      blockId: block.kind === "figure" ? block.id : undefined,
    });
    if (!made.block) {
      step(s, 3, "failed", made.reason);
      return { widget: null, figure: null, widgetError: "", figureNote: made.reason };
    }
    await trace(s, `Muse Image drew an illustration (${made.attempts === 1 ? "first try" : "second try"}): ${made.block.caption}`, MODELS.image);
    await trace(s, `Muse Spark looked at the picture: ${made.reason}`, MODELS.spark);
    step(s, 3, "done");
    step(s, 5, "done", made.reason);
    return { widget: null, figure: made.block, widgetError: "", figureNote: made.reason };
  }

  async function buildWidget(s: S): Promise<Partial<S>> {
    const intent = s.intent!;
    if (!intent.addWidget && !intent.addImage) return { widget: null, figure: null };
    if (s.attempts > 0 && !s.widgetFeedback) return {}; // retry round for the text only
    if (s.figure || (intent.addImage && !intent.addWidget)) return s.figure ? {} : drawPicture(s);
    step(s, 3, "active");
    const block = selected(s)!;
    const material = s.chunks.map((c) => `<chunk id="${c.id}">\n${c.text}\n</chunk>`).join("\n");
    const choice = await chatJson(ctx, {
      model: MODELS.spark,
      name: "build-widget",
      schema: WidgetChoiceSchema,
      schemaName: "widget",
      reasoningEffort: "medium",
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: [
            "You design one small interactive example for a course paragraph. Pick a template and fill its params. Use a template only when it truly fits: vector2d for a 2x2 matrix acting on vectors (eigenvectors, transformations), plot for a function you can drag along (e.g. a polynomial with its roots), stepper for worked procedures. For anything else (physical systems, architecture, processes, biology, analogies, anything you would draw on a whiteboard) choose 'illustration': a picture drawn by an image model, and leave paramsJson as '{}' and claims empty. Never force an idea into a template that does not fit it. Use 'custom' only for an interaction no template can express.",
            `Templates:\n${TEMPLATE_DOCS}`,
            "Claims are mathjs boolean expressions over the params that state the facts the widget teaches; they are recomputed in code. For vector2d, A is available as a matrix (e.g. 'A * [1, 1] == 3 * [1, 1]', 'det(A) == 3'). For plot, f(x) is the plotted function with slider values (e.g. 'f(2) == 0'). Give 2–4 claims.",
            "Numbers must come from the chunks when they give an example; otherwise choose small integers.",
            "The student must be able to DO what the title says. If the title says 'push the frequency', frequency is x (the probe the student drags along the curve) or a slider. Every slider must appear in expr. Give it a goal the student can reach by moving the controls, and name the axes with units.",
            DATA_RULE,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Request: "${s.request}"`,
            `Paragraph: ${blockText(block)}`,
            s.widgetFeedback ? `Your last example failed checks:\n${s.widgetFeedback}\nFix it.` : "",
            asData("cited material", material),
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });
    if (choice.template === "illustration") return drawPicture({ ...s, intent: { ...intent, addImage: true, addWidget: false } } as S);
    try {
      const spec = await toWidgetSpec(ctx, choice, s.request, blockText(block));
      const byId = new Map(s.chunks.map((c) => [c.id, c]));
      let cites = choice.chunkIds.filter((id) => byId.has(id)).map((id) => chunkToCite(byId.get(id)!));
      if (!cites.length) cites = block.cites;
      const existing = s.widget?.id;
      const widget: WidgetBlock = { id: existing ?? randomId("w"), kind: "widget", spec, cites };
      await trace(s, `Built a "${spec.template}" example: ${spec.title ?? ""}`, MODELS.spark);
      step(s, 3, "done");
      return { widget, widgetError: "" };
    } catch (err) {
      step(s, 3, "failed", (err as Error).message);
      return { widget: null, widgetError: (err as Error).message };
    }
  }

  async function verify(s: S): Promise<Partial<S>> {
    const v: Verification = { sentences: [], claims: [], render: null, verifier: "" };
    const textFeedback: string[] = [];
    const widgetFeedback: string[] = [];
    if (s.textBlocks?.length) {
      step(s, 4, "active");
      for (const tb of s.textBlocks) {
        const ev = await evidenceForCites(env, tb.cites);
        const evidence = ev.length ? ev : s.chunks.map((c) => c.text);
        const r = await verifySentences(env, ctx, tb.md, evidence);
        v.verifier = r.verifier;
        v.sentences.push(...r.checks);
        for (const c of r.checks.filter((c) => !c.supported)) textFeedback.push(`- "${c.sentence}": ${c.reason}`);
      }
      const ok = v.sentences.filter((c) => c.supported).length;
      await trace(s, `${v.verifier} checked ${v.sentences.length} sentences: ${ok} matched their source`, v.verifier);
      step(s, 4, textFeedback.length ? "failed" : "done", `${ok} of ${v.sentences.length} sentences matched`);
    }
    if (s.widget) {
      step(s, 5, "active");
      const spec = s.widget.spec;
      if (spec.template !== "custom") {
        for (const p of widgetProblems(spec.template, spec.params)) widgetFeedback.push(`- ${p}`);
        v.claims = checkClaims(spec.template, spec.params, spec.claims);
        for (const c of v.claims.filter((c) => !c.ok)) widgetFeedback.push(`- claim "${c.claim}" ${c.detail}`);
        await trace(s, `Recomputed ${v.claims.length} widget claims with mathjs: ${v.claims.filter((c) => c.ok).length} hold`);
      }
      v.render = await renderAndJudge(env, ctx, spec, s.request);
      for (const e of v.render.errors) widgetFeedback.push(`- console error: ${e}`);
      if (v.render.judge && !v.render.judge.ok) widgetFeedback.push(`- screenshot review: ${v.render.judge.reason}`);
      if (v.render.unavailable) await trace(s, `Browser test unavailable (${v.render.unavailable}); the example's math was checked in code`);
      else await trace(s, `Loaded the example in a browser: ${v.render.errors.length} errors; screenshot review: ${v.render.judge?.reason ?? "skipped"}`, MODELS.spark);
      step(s, 5, widgetFeedback.length ? "failed" : "done");
    } else if (s.widgetError) {
      widgetFeedback.push(`- ${s.widgetError}`);
    }
    return { verification: v, textFeedback: textFeedback.join("\n"), widgetFeedback: widgetFeedback.join("\n"), attempts: s.attempts + 1 };
  }

  function afterVerify(s: S): string[] | "finalize" {
    if (s.attempts > MAX_RETRIES) return "finalize";
    // both writers always run again (the join waits for both); each skips if it has no feedback
    const retryText = Boolean(s.textFeedback && s.textBlocks?.length);
    const retryWidget = Boolean(s.widgetFeedback && s.intent?.addWidget);
    return retryText || retryWidget ? ["writeText", "buildWidget"] : "finalize";
  }

  async function finalize(s: S): Promise<Partial<S>> {
    const block = selected(s)!;
    const summary: string[] = [];
    const ops: PatchOp[] = [];
    let textBlocks = s.textBlocks;
    // drop unsupported sentences that survived the retries, and say so
    if (textBlocks?.length && s.verification?.sentences.length) {
      const bad = new Set(s.verification.sentences.filter((c) => !c.supported).map((c) => c.sentence));
      if (bad.size) {
        textBlocks = textBlocks
          .map((tb) => ({ ...tb, md: tb.md.split(/(?<=[.!?])\s+/).filter((sent) => !bad.has(sent.trim())).join(" ") }))
          .filter((tb) => tb.md.trim());
        summary.push(`Removed ${bad.size} sentence${bad.size === 1 ? "" : "s"} that did not match the sources`);
      }
    }
    let last = block.id;
    if (textBlocks?.length) {
      ops.push({ op: "replace", blockId: block.id, block: textBlocks[0] });
      for (const tb of textBlocks.slice(1)) {
        ops.push({ op: "insertAfter", blockId: last, block: tb });
        last = tb.id;
      }
      if (block.kind === "text") last = textBlocks[textBlocks.length - 1].id;
      const what = s.intent?.simplify || s.intent?.tooComplex ? "simpler" : s.intent?.analogy ? "with an analogy" : "as asked";
      summary.unshift(`Rewrote ${textBlocks.length === 1 ? "1 paragraph" : `${textBlocks.length} paragraphs`}, ${what}`);
      const kept = textBlocks.every((tb) => tb.cites.length >= 1);
      if (kept) summary.push(`Kept ${textBlocks[0].cites.length === 1 ? "the citation" : `${new Set(textBlocks.flatMap((t) => t.cites.map((c) => c.chunkId ?? c.page))).size} citations`}`);
      if (!s.verification?.sentences.some((c) => !c.supported)) summary.push("Every sentence matched its source");
    }
    const widgetOk = s.widget && !s.widgetFeedback;
    if (s.widget && widgetOk) {
      ops.push({ op: "insertAfter", blockId: last, block: s.widget });
      summary.push("Added 1 interactive example");
      summary.push(s.verification?.render?.unavailable ? "Example's math checked in code" : "Example ran without errors");
    } else if (s.intent?.addWidget && !s.figure) {
      summary.push(s.figureNote ? "Could not draw a picture that passed review, so none was added" : "Could not build an example that passed every check, so none was added");
    }
    if (s.figure) {
      const redraw = block.kind === "figure";
      ops.push(redraw ? { op: "replace", blockId: block.id, block: s.figure } : { op: "insertAfter", blockId: last, block: s.figure });
      summary.push(redraw ? "Redrew the picture with Muse Image" : "Added 1 illustration drawn by Muse Image (labelled generated)");
      if (s.figureNote) summary.push(`Muse Spark checked the picture: ${s.figureNote}`);
    } else if (s.intent?.addImage && !s.intent.addWidget) {
      summary.push("Could not draw a picture that passed review, so none was added");
    }
    const after: Section = { ...s.before, blocks: applyPatch(s.before.blocks, ops) };
    emit({ type: "patch", runId: s.runId, sectionId: s.sectionId, ops });
    return { ops, after, summary };
  }

  async function review(s: S): Promise<Partial<S>> {
    if (!s.ops.length) return { decision: "undo" };
    // changes are saved as soon as they pass verification; the reader offers Undo afterwards
    emit({ type: "run.waiting", runId: s.runId, summary: s.summary, section: s.after!, before: s.before });
    return { decision: "keep" };
  }

  async function commit(s: S): Promise<Partial<S>> {
    if (s.decision !== "keep") {
      await trace(s, "Nothing changed; nothing was saved");
      emit({ type: "run.done", runId: s.runId, status: "undone" });
      return {};
    }
    const res = await commitSection(env, {
      courseId: s.courseId,
      sectionId: s.sectionId,
      title: s.after!.title,
      blocks: s.after!.blocks,
      userId: s.userId,
      kind: "mutate",
      summary: `${s.after!.title}: ${s.summary[0] ?? "changed"} (“${s.request.slice(0, 80)}”)`,
      runId: s.runId,
    });
    await trace(s, res.overlay ? "Saved as your own change on top of the shared course" : `Saved as version ${res.courseVersion}`);
    emit({ type: "run.done", runId: s.runId, status: "kept", courseVersion: res.courseVersion ?? undefined, message: res.overlay ? "Saved for you. The course owner's version is unchanged." : `Saved as version ${res.courseVersion}.` });
    return { courseVersion: res.courseVersion };
  }

  return new StateGraph(MutateState)
    .addNode("classifyIntent", classifyIntent)
    .addNode("gatherContext", gatherContext)
    .addNode("planPatch", planPatch)
    .addNode("writeText", writeText)
    .addNode("buildWidget", buildWidget)
    .addNode("verify", verify)
    .addNode("finalize", finalize)
    .addNode("review", review)
    .addNode("commit", commit)
    .addEdge(START, "classifyIntent")
    .addEdge("classifyIntent", "gatherContext")
    .addEdge("gatherContext", "planPatch")
    .addEdge("planPatch", "writeText")
    .addEdge("planPatch", "buildWidget")
    .addEdge(["writeText", "buildWidget"], "verify")
    .addConditionalEdges("verify", afterVerify, ["writeText", "buildWidget", "finalize"])
    .addEdge("finalize", "review")
    .addEdge("review", "commit")
    .addEdge("commit", END)
    .compile({ checkpointer });
}

const TEMPLATE_DOCS = `
- vector2d: a 2x2 matrix acting on a vector the student turns with a slider. params: {"A": [[a,b],[c,d]], "mode": "eigen" | "transform", "startAngle": degrees, "caption": "one line explaining what to look for"}. In eigen mode the widget says when v and Av lie on the same line and shows λ.
- vector2d also takes "goal": the task in eigen mode (default: find both eigen-directions). The student drags v; the widget counts the directions found.
- plot: y = f(x). The student drags a probe along x and reads y live; sliders change parameters. Axes stay fixed over all slider values, so the curve visibly moves. params: {"expr": "k*x^3", "xMin": 0, "xMax": 5, "xLabel": "frequency (GHz)", "yLabel": "power (W)", "xStart": 1, "sliders": [{"name":"k","label":"chip constant","min":1,"max":4,"step":0.5,"value":2}], "markers": [{"x": 1, "label": "root"}], "goal": {"check": "f(x) >= 200", "text": "Push the frequency until power passes 200 W", "done": "Past 200 W: doubling f multiplied power by 8."}, "caption": "..."}. goal.check is a mathjs boolean over x, f and the slider names, and must be reachable.
- stepper: a worked example revealed one step at a time. params: {"steps": [{"title": "Step 1", "md": "..."}]} (3–6 steps).
- custom: a self-contained HTML document (inline CSS/JS only, no network) with paramsJson = {"html": "<!doctype html>..."}.`;

async function toWidgetSpec(ctx: AiCtx, choice: z.infer<typeof WidgetChoiceSchema>, request: string, paragraph: string): Promise<WidgetSpec> {
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(choice.paramsJson);
  } catch {
    throw new Error("Widget params were not valid JSON");
  }
  if (choice.template === "vector2d") return { template: "vector2d", title: choice.title, params: Vector2dParams.parse(params), claims: choice.claims };
  if (choice.template === "plot") return { template: "plot", title: choice.title, params: PlotParams.parse(params), claims: choice.claims };
  if (choice.template === "stepper") return { template: "stepper", title: choice.title, params: StepperParams.parse(params), claims: [] };
  if (choice.template === "illustration") throw new Error("illustrations are drawn, not specified");
  // custom: Muse Code has no API, so Muse Spark writes the sandboxed HTML
  let html = typeof params.html === "string" ? params.html : "";
  if (!html) {
    const out = await chatJson(ctx, {
      model: MODELS.spark,
      name: "custom-widget-html",
      schema: z.object({ html: z.string() }),
      schemaName: "widget_html",
      maxTokens: 6000,
      messages: [{ role: "user", content: `Write a single self-contained HTML file (inline CSS and JS, no external requests, font-family Figtree, sans-serif, colors #1C2B33 text and #0A5CFF accent, white background) for an interactive example. Request: "${request}". Paragraph: ${paragraph}` }],
    });
    html = out.html;
  }
  return WidgetSpecSchema.parse({ template: "custom", title: choice.title, html, claims: choice.claims });
}

function blockText(b: Block): string {
  if (b.kind === "text") return b.md;
  if (b.kind === "exercise") return `${b.prompt}\nAnswer: ${b.answer}`;
  if (b.kind === "figure") return b.caption;
  return b.spec.title ?? b.spec.template;
}

function describeIntent(i: Intent): string {
  const parts = [i.simplify && "simplify", i.addWidget && "add an interactive example", i.moreExamples && "more examples", i.examFocus && "exam focus", i.analogy && "analogy", i.addImage && "add a picture", i.notes].filter(Boolean);
  return parts.join(", ") || "rewrite";
}

export function citeLabel(sources: Map<string, { filename: string }>, c: Cite): string {
  const name = (sources.get(c.sourceId)?.filename ?? "source").replace(/\.(pdf|m4a|mp3|wav)$/i, "");
  if (c.page) return `${name} p.${c.page}`;
  if (c.tStart !== undefined) return `${name} ${fmtTime(c.tStart)}`;
  return name;
}
