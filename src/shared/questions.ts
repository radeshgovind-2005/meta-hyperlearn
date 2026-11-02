import { z } from "zod";
import { eigen2, exprEquivalent, normalizeMath, plotGoalMet, PlotParams, Vector2dParams } from "./widgets";

/**
 * Practice question types. 1–21 are graded in code the moment the student answers;
 * the last four are graded by Muse Spark against the exam's rubric.
 */
export const QTYPES = [
  "mcq", "multi", "tf_fix", "two_tier", "numeric", "expression", "cloze_text", "cloze_select", "cloze_drag",
  "match", "order", "parsons", "categorize", "grid", "highlight", "hotspot", "label", "widget_goal", "estimate",
  "spot_error", "faded", "short", "worked", "justify", "teach_back",
] as const;
export type QType = (typeof QTYPES)[number];
export const MODEL_GRADED: ReadonlySet<QType> = new Set(["short", "worked", "justify", "teach_back"]);

export const QTYPE_LABEL: Record<QType, string> = {
  mcq: "Multiple choice", multi: "Select all that apply", tf_fix: "True or false", two_tier: "Answer and reason",
  numeric: "Numeric answer", expression: "Write the expression", cloze_text: "Fill in the blanks", cloze_select: "Choose the missing words",
  cloze_drag: "Drag words into the gaps", match: "Match the pairs", order: "Put in order", parsons: "Build the solution",
  categorize: "Sort into groups", grid: "Grid", highlight: "Highlight", hotspot: "Find it on the slide", label: "Label the slide",
  widget_goal: "Interactive challenge", estimate: "Estimate", spot_error: "Spot the error", faded: "Complete the solution",
  short: "Short answer", worked: "Exam question", justify: "Justify", teach_back: "Explain it out loud",
};

const str = z.string().min(1);
const Region = z.object({ sourceId: z.string(), page: z.number().int(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) });
export type Region = z.infer<typeof Region>;

/** Full specs, solutions included. Only `publicSpec` output reaches the browser before an answer. */
export const SpecSchemas = {
  mcq: z.object({ options: z.array(z.object({ text: str, why: z.string() })).min(2).max(6), correct: z.number().int() }),
  multi: z.object({ options: z.array(z.object({ text: str, why: z.string(), correct: z.boolean() })).min(3).max(7) }),
  tf_fix: z.object({ statement: str, isTrue: z.boolean(), fixes: z.array(str).max(4).default([]), correctFix: z.number().int().default(-1) }),
  two_tier: z.object({ options: z.array(str).min(2).max(5), correct: z.number().int(), reasons: z.array(str).min(2).max(5), correctReason: z.number().int() }),
  numeric: z.object({ answer: z.number(), tolerance: z.number().min(0).default(0), unit: z.string().default("") }),
  expression: z.object({ answer: str, hint: z.string().default("") }),
  cloze_text: z.object({ text: str, blanks: z.array(z.object({ accept: z.array(str).min(1) })).min(1).max(5) }),
  cloze_select: z.object({ text: str, blanks: z.array(z.object({ options: z.array(str).min(2).max(5), correct: z.number().int() })).min(1).max(5) }),
  cloze_drag: z.object({ text: str, blanks: z.array(str).min(1).max(6), distractors: z.array(str).max(4).default([]) }),
  match: z.object({ pairs: z.array(z.object({ left: str, right: str })).min(3).max(6) }),
  order: z.object({ items: z.array(str).min(3).max(7) }),
  parsons: z.object({ lines: z.array(str).min(3).max(8), distractors: z.array(str).max(3).default([]) }),
  categorize: z.object({ categories: z.array(str).min(2).max(4), items: z.array(z.object({ text: str, category: z.number().int() })).min(4).max(10) }),
  grid: z.object({ rows: z.array(str).min(2).max(6), cols: z.array(str).min(2).max(4), correct: z.array(z.number().int()) }),
  highlight: z.object({ segments: z.array(str).min(3).max(10), correct: z.array(z.number().int()).min(1) }),
  hotspot: z.object({ region: Region, regions: z.array(Region).default([]) }),
  label: z.object({ regions: z.array(Region.extend({ label: str })).min(2).max(5) }),
  widget_goal: z.union([
    z.object({ template: z.literal("vector2d"), params: Vector2dParams }),
    z.object({ template: z.literal("plot"), params: PlotParams.refine((p) => Boolean(p.goal), "plot challenges need a goal") }),
  ]),
  estimate: z.object({ min: z.number(), max: z.number(), step: z.number().positive(), answer: z.number(), tolerance: z.number().positive(), unit: z.string().default("") }),
  spot_error: z.object({ steps: z.array(str).min(3).max(8), wrongStep: z.number().int(), why: str }),
  faded: z.object({ steps: z.array(str).min(3).max(8), blankStep: z.number().int(), accept: z.array(str).min(1) }),
  short: z.object({}),
  worked: z.object({}),
  justify: z.object({}),
  teach_back: z.object({}),
} satisfies Record<QType, z.ZodType>;

export type Spec<T extends QType = QType> = z.infer<(typeof SpecSchemas)[T]>;

/** Checks index fields point inside their lists (zod cannot express that). */
export function parseSpec(type: QType, raw: unknown): Spec {
  const spec = SpecSchemas[type].parse(raw) as Record<string, unknown>;
  const within = (i: number, list: unknown[], what: string) => {
    if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error(`${what} index ${i} is out of range`);
  };
  const s = spec as never as Record<string, never>;
  if (type === "mcq") within(s.correct, s.options, "correct");
  if (type === "multi" && !(s.options as { correct: boolean }[]).some((o) => o.correct)) throw new Error("no correct option");
  if (type === "tf_fix" && !s.isTrue) within(s.correctFix, s.fixes, "correctFix");
  if (type === "two_tier") { within(s.correct, s.options, "correct"); within(s.correctReason, s.reasons, "correctReason"); }
  if (type === "cloze_select") for (const b of s.blanks as { options: string[]; correct: number }[]) within(b.correct, b.options, "blank");
  if (type.startsWith("cloze")) {
    const n = ((s.text as string).match(/\[\[\d+\]\]/g) ?? []).length;
    if (n !== (s.blanks as unknown[]).length) throw new Error(`text has ${n} [[n]] gaps but ${(s.blanks as unknown[]).length} blanks`);
  }
  if (type === "categorize") for (const it of s.items as { category: number }[]) within(it.category, s.categories, "category");
  if (type === "grid") { if ((s.correct as number[]).length !== (s.rows as unknown[]).length) throw new Error("grid needs one answer per row"); for (const c of s.correct as number[]) within(c, s.cols, "column"); }
  if (type === "highlight") for (const c of s.correct as number[]) within(c, s.segments, "segment");
  if (type === "spot_error") within(s.wrongStep, s.steps, "wrongStep");
  if (type === "faded") within(s.blankStep, s.steps, "blankStep");
  if (type === "estimate" && !((s.answer as number) >= (s.min as number) && (s.answer as number) <= (s.max as number))) throw new Error("answer outside the slider range");
  if (type === "widget_goal" && (s.template as string) === "vector2d") {
    const p = Vector2dParams.parse((spec as { params: unknown }).params);
    if (!eigen2(p.A).length) throw new Error("vector2d challenge needs real eigenvalues");
  }
  return spec as Spec;
}

/** Deterministic shuffle so a reload shows the same order. */
export function shuffled<T>(list: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = list.map((v, i) => ({ v, k: Math.imul(h ^ (i + 1), 2654435761) >>> 0 }));
  return out.sort((a, b) => a.k - b.k).map((x) => x.v);
}

/** What the browser may see before answering: no correct flags, shuffled where order is the answer. */
export function publicSpec(type: QType, spec: Spec, seed: string): Record<string, unknown> {
  const s = spec as Record<string, never>;
  switch (type) {
    case "mcq": return { options: (s.options as { text: string }[]).map((o) => o.text) };
    case "multi": return { options: (s.options as { text: string }[]).map((o) => o.text) };
    case "tf_fix": return { statement: s.statement, fixes: s.fixes };
    case "two_tier": return { options: s.options, reasons: s.reasons };
    case "numeric": return { unit: s.unit };
    case "expression": return { hint: s.hint };
    case "cloze_text": return { text: s.text, blanks: (s.blanks as unknown[]).length };
    case "cloze_select": return { text: s.text, blanks: (s.blanks as { options: string[] }[]).map((b) => b.options) };
    case "cloze_drag": return { text: s.text, bank: shuffled([...(s.blanks as string[]), ...(s.distractors as string[])], seed) };
    case "match": return { left: (s.pairs as { left: string }[]).map((p) => p.left), right: shuffled((s.pairs as { right: string }[]).map((p) => p.right), seed) };
    case "order": return { items: shuffled(s.items as string[], seed) };
    case "parsons": return { pool: shuffled([...(s.lines as string[]), ...(s.distractors as string[])], seed) };
    case "categorize": return { categories: s.categories, items: shuffled((s.items as { text: string }[]).map((i) => i.text), seed) };
    case "grid": return { rows: s.rows, cols: s.cols };
    case "highlight": return { segments: s.segments };
    case "hotspot": return { sourceId: (s.region as Region).sourceId, page: (s.region as Region).page };
    case "label": {
      const regions = s.regions as (Region & { label: string })[];
      return { sourceId: regions[0].sourceId, page: regions[0].page, markers: regions.map((r) => r.bbox), labels: shuffled(regions.map((r) => r.label), seed) };
    }
    case "widget_goal": return { template: s.template, params: s.params };
    case "estimate": return { min: s.min, max: s.max, step: s.step, unit: s.unit };
    case "spot_error": return { steps: s.steps };
    case "faded": return { steps: (s.steps as string[]).map((t, i) => (i === s.blankStep ? null : t)) };
    default: return {};
  }
}

export type CodeGrade = { correct: boolean; score: number; feedback: string; mistake: string; reveal: string; parts?: boolean[] };

const norm = (s: string) => normalizeMath(String(s)).toLowerCase().replace(/[\s.,;:!?'"`*_$]/g, "");
/** A typed answer matches if it equals an accepted one, or is the same maths. */
export function textMatches(given: string, accept: string[]): boolean {
  if (!given.trim()) return false;
  return accept.some((a) => norm(a) === norm(given) || (/[0-9a-z]/i.test(a) && /[+\-*/^()=]|\d/.test(a) && exprEquivalent(given, a)));
}

const ResponseSchemas = {
  index: z.number().int(),
  indices: z.array(z.number().int()),
  strings: z.array(z.string()),
  point: z.object({ x: z.number(), y: z.number() }),
};

/** Grades a structured response in code. Throws on a malformed response. */
export function gradeResponse(type: QType, spec: Spec, raw: unknown, seed: string): CodeGrade {
  const s = spec as Record<string, never>;
  const done = (score: number, feedback: string, reveal: string, mistake = "", parts?: boolean[]): CodeGrade => ({ correct: score >= 0.999, score, feedback, mistake: score >= 0.999 ? "" : mistake, reveal, parts });
  const fraction = (parts: boolean[]) => parts.filter(Boolean).length / Math.max(1, parts.length);
  const r = raw as Record<string, unknown>;
  switch (type) {
    case "mcq": {
      const pick = ResponseSchemas.index.parse(r.choice);
      const opts = s.options as { text: string; why: string }[];
      const right = opts[s.correct];
      return pick === s.correct ? done(1, right.why || "Correct.", right.text) : done(0, opts[pick]?.why || `The answer is: ${right.text}`, right.text, `chose "${opts[pick]?.text ?? "?"}"`);
    }
    case "multi": {
      const picks = new Set(ResponseSchemas.indices.parse(r.choices));
      const opts = s.options as { text: string; why: string; correct: boolean }[];
      const parts = opts.map((o, i) => o.correct === picks.has(i));
      const wrong = opts.filter((_, i) => !parts[i]);
      return done(fraction(parts), wrong.length ? wrong.map((o) => `${o.correct ? "Missed" : "Not this one"}: ${o.text.replace(/[.\s]+$/, "")}. ${o.why}`).join(" ") : "All the right options and none of the wrong ones.", opts.filter((o) => o.correct).map((o) => o.text).join("; "), `${wrong.length} option${wrong.length === 1 ? "" : "s"} wrong`, parts);
    }
    case "tf_fix": {
      const saysTrue = z.boolean().parse(r.isTrue);
      const fixes = s.fixes as string[];
      if (s.isTrue) return saysTrue ? done(1, "Correct, the statement is true.", "True") : done(0, "The statement is true as written.", "True", "called a true statement false");
      if (saysTrue) return done(0, `The statement is false. Correct version: ${fixes[s.correctFix]}`, `False. ${fixes[s.correctFix]}`, "accepted a false statement");
      const fix = ResponseSchemas.index.parse(r.fix);
      return fix === s.correctFix ? done(1, `Correct: ${fixes[s.correctFix]}`, `False. ${fixes[s.correctFix]}`) : done(0.5, `Right that it is false, but the correct fix is: ${fixes[s.correctFix]}`, `False. ${fixes[s.correctFix]}`, "picked the wrong correction");
    }
    case "two_tier": {
      const a = ResponseSchemas.index.parse(r.choice);
      const b = ResponseSchemas.index.parse(r.reason);
      const parts = [a === s.correct, b === s.correctReason];
      const reveal = `${(s.options as string[])[s.correct]}, because ${(s.reasons as string[])[s.correctReason]}`;
      return done(fraction(parts), parts[0] && parts[1] ? "Right answer for the right reason." : parts[0] ? `Right answer, wrong reason. The reason is: ${(s.reasons as string[])[s.correctReason]}` : `The answer is ${reveal}.`, reveal, parts[0] ? "right answer, wrong reason" : "wrong answer", parts);
    }
    case "numeric": {
      const v = z.number().parse(typeof r.value === "string" ? Number(normalizeMath(r.value as string).replace(/,/g, "")) : r.value);
      const tol = Math.max(s.tolerance as number, Math.abs(s.answer as number) * 1e-6);
      const reveal = `${s.answer}${s.unit ? ` ${s.unit}` : ""}`;
      return Math.abs(v - (s.answer as number)) <= tol ? done(1, `Correct: ${reveal}.`, reveal) : done(0, `You gave ${v}; the answer is ${reveal}.`, reveal, `gave ${v} instead of ${s.answer}`);
    }
    case "expression": {
      const given = z.string().parse(r.value);
      return exprEquivalent(given, s.answer) ? done(1, "Correct, that is the same expression.", s.answer) : done(0, `That is not equal to ${s.answer}.`, s.answer, `wrote ${given}`);
    }
    case "cloze_text": {
      const given = ResponseSchemas.strings.parse(r.blanks);
      const blanks = s.blanks as { accept: string[] }[];
      const parts = blanks.map((b, i) => textMatches(given[i] ?? "", b.accept));
      return done(fraction(parts), parts.every(Boolean) ? "Every gap is right." : `Gap ${parts.findIndex((p) => !p) + 1} should be "${blanks[parts.findIndex((p) => !p)].accept[0]}".`, blanks.map((b) => b.accept[0]).join(", "), "wrong gap", parts);
    }
    case "cloze_select": {
      const given = ResponseSchemas.indices.parse(r.blanks);
      const blanks = s.blanks as { options: string[]; correct: number }[];
      const parts = blanks.map((b, i) => given[i] === b.correct);
      return done(fraction(parts), parts.every(Boolean) ? "Every choice is right." : `Gap ${parts.findIndex((p) => !p) + 1} should be "${blanks[parts.findIndex((p) => !p)].options[blanks[parts.findIndex((p) => !p)].correct]}".`, blanks.map((b) => b.options[b.correct]).join(", "), "wrong choice", parts);
    }
    case "cloze_drag": {
      const given = ResponseSchemas.strings.parse(r.blanks);
      const blanks = s.blanks as string[];
      const parts = blanks.map((b, i) => norm(given[i] ?? "") === norm(b));
      return done(fraction(parts), parts.every(Boolean) ? "Every word is in the right gap." : `Gap ${parts.findIndex((p) => !p) + 1} takes "${blanks[parts.findIndex((p) => !p)]}".`, blanks.join(", "), "word in the wrong gap", parts);
    }
    case "match": {
      const given = ResponseSchemas.strings.parse(r.right);
      const pairs = s.pairs as { left: string; right: string }[];
      const parts = pairs.map((p, i) => norm(given[i] ?? "") === norm(p.right));
      return done(fraction(parts), parts.every(Boolean) ? "All pairs match." : `${pairs[parts.findIndex((p) => !p)].left} goes with ${pairs[parts.findIndex((p) => !p)].right}.`, pairs.map((p) => `${p.left} → ${p.right}`).join("; "), "mismatched pair", parts);
    }
    case "order":
    case "parsons": {
      const given = ResponseSchemas.strings.parse(r.items);
      const want = (type === "order" ? s.items : s.lines) as string[];
      const parts = want.map((w, i) => norm(given[i] ?? "") === norm(w));
      const extra = given.length > want.length;
      const score = extra ? Math.min(fraction(parts), 0.5) : fraction(parts);
      const first = parts.findIndex((p) => !p);
      return done(score, score >= 0.999 ? "Right order." : extra ? "One of the lines you used does not belong in the solution." : `Step ${first + 1} should be: ${want[first]}`, want.map((w, i) => `${i + 1}. ${w}`).join("\n"), extra ? "used a decoy line" : "steps out of order", parts);
    }
    case "categorize": {
      const given = ResponseSchemas.indices.parse(r.categories);
      const items = s.items as { text: string; category: number }[];
      const shownOrder = shuffled(items.map((i) => i.text), seed);
      const byText = new Map(items.map((i) => [i.text, i.category]));
      const parts = shownOrder.map((t, i) => given[i] === byText.get(t));
      const cats = s.categories as string[];
      const bad = shownOrder.find((_, i) => !parts[i]);
      return done(fraction(parts), bad ? `"${bad}" belongs in ${cats[byText.get(bad)!]}.` : "Everything is in the right group.", cats.map((c, k) => `${c}: ${items.filter((i) => i.category === k).map((i) => i.text).join(", ")}`).join("; "), "item in the wrong group", parts);
    }
    case "grid": {
      const given = ResponseSchemas.indices.parse(r.cells);
      const parts = (s.correct as number[]).map((c, i) => given[i] === c);
      const rows = s.rows as string[];
      const cols = s.cols as string[];
      return done(fraction(parts), parts.every(Boolean) ? "Every row is right." : `${rows[parts.findIndex((p) => !p)]}: ${cols[(s.correct as number[])[parts.findIndex((p) => !p)]]}.`, rows.map((r2, i) => `${r2}: ${cols[(s.correct as number[])[i]]}`).join("; "), "wrong cell", parts);
    }
    case "highlight": {
      const picks = new Set(ResponseSchemas.indices.parse(r.choices));
      const want = new Set(s.correct as number[]);
      const segs = s.segments as string[];
      const parts = segs.map((_, i) => want.has(i) === picks.has(i));
      return done(fraction(parts), parts.every(Boolean) ? "You found exactly the right parts." : `The parts to highlight: ${[...want].map((i) => `"${segs[i]}"`).join(", ")}.`, [...want].map((i) => segs[i]).join(" / "), "highlighted the wrong part", parts);
    }
    case "hotspot": {
      const p = ResponseSchemas.point.parse(r.point);
      const [x, y, w, h] = (s.region as Region).bbox;
      const pad = 0.02;
      const hit = p.x >= x - pad && p.x <= x + w + pad && p.y >= y - pad && p.y <= y + h + pad;
      return hit ? done(1, "That is the right spot.", "the highlighted region") : done(0, "Not there. The highlighted region is the answer.", "the highlighted region", "clicked the wrong place");
    }
    case "label": {
      const given = ResponseSchemas.strings.parse(r.labels);
      const regions = s.regions as { label: string }[];
      const parts = regions.map((reg, i) => norm(given[i] ?? "") === norm(reg.label));
      return done(fraction(parts), parts.every(Boolean) ? "Every label is in the right place." : `Marker ${parts.findIndex((p) => !p) + 1} is "${regions[parts.findIndex((p) => !p)].label}".`, regions.map((reg, i) => `${i + 1}: ${reg.label}`).join("; "), "misplaced label", parts);
    }
    case "widget_goal": {
      if (s.template === "vector2d") {
        const theta = z.number().parse(r.theta);
        const p = Vector2dParams.parse(s.params);
        const t = (theta * Math.PI) / 180;
        const hit = eigen2(p.A).some((e) => Math.abs(Math.cos(t) * e.v[1] - Math.sin(t) * e.v[0]) < 0.02);
        const reveal = eigen2(p.A).map((e) => `λ = ${Math.round(e.lambda * 100) / 100} along (${e.v.map((c) => Math.round(c * 100) / 100).join(", ")})`).join("; ");
        return hit ? done(1, "Av lies on the same line as v: that is an eigenvector.", reveal) : done(0, "Av still points another way, so v is not an eigenvector there.", reveal, "stopped before v and Av lined up");
      }
      const p = PlotParams.parse(s.params);
      const values = z.record(z.string(), z.number()).parse(r.values ?? {});
      const met = plotGoalMet(p, { ...Object.fromEntries(p.sliders.map((sl) => [sl.name, sl.value])), ...values }, z.number().parse(r.x));
      return met ? done(1, p.goal!.done, p.goal!.check) : done(0, `Not yet: ${p.goal!.text}`, p.goal!.check, "goal not reached");
    }
    case "estimate": {
      const v = z.number().parse(r.value);
      const reveal = `${s.answer}${s.unit ? ` ${s.unit}` : ""}`;
      return Math.abs(v - (s.answer as number)) <= (s.tolerance as number) ? done(1, `Good estimate. The exact value is ${reveal}.`, reveal) : done(0, `You estimated ${v}; the value is ${reveal}.`, reveal, `estimated ${v}`);
    }
    case "spot_error": {
      const pick = ResponseSchemas.index.parse(r.step);
      return pick === s.wrongStep ? done(1, `Yes, step ${pick + 1}. ${s.why}`, `Step ${(s.wrongStep as number) + 1}`) : done(0, `Step ${pick + 1} is fine. The error is in step ${(s.wrongStep as number) + 1}: ${s.why}`, `Step ${(s.wrongStep as number) + 1}`, "missed the wrong step");
    }
    case "faded": {
      const given = z.string().parse(r.value);
      const want = (s.steps as string[])[s.blankStep];
      return textMatches(given, s.accept as string[]) ? done(1, "That completes the solution.", want) : done(0, `The missing step is: ${want}`, want, "wrong missing step");
    }
    default:
      throw new Error(`${type} is graded by the model`);
  }
}

/** A readable one-line record of a structured response, for results and grading prompts. */
export function describeResponse(type: QType, spec: Spec, raw: unknown): string {
  const s = spec as Record<string, never>;
  const r = (raw ?? {}) as Record<string, never>;
  try {
    switch (type) {
      case "mcq": return (s.options as { text: string }[])[r.choice]?.text ?? "";
      case "multi": return (r.choices as number[]).map((i) => (s.options as { text: string }[])[i]?.text).join("; ");
      case "tf_fix": return r.isTrue ? "True" : `False${(s.fixes as string[])[r.fix] ? `: ${(s.fixes as string[])[r.fix]}` : ""}`;
      case "two_tier": return `${(s.options as string[])[r.choice]}, because ${(s.reasons as string[])[r.reason]}`;
      case "numeric": case "expression": case "estimate": case "faded": return String(r.value);
      case "cloze_text": case "cloze_drag": return (r.blanks as string[]).join(", ");
      case "cloze_select": return (r.blanks as number[]).map((b, i) => (s.blanks as { options: string[] }[])[i]?.options[b]).join(", ");
      case "match": return (s.pairs as { left: string }[]).map((p, i) => `${p.left} → ${(r.right as string[])[i] ?? "?"}`).join("; ");
      case "order": case "parsons": return (r.items as string[]).join(" / ");
      case "categorize": return `${(r.categories as number[]).length} items sorted`;
      case "grid": return (s.rows as string[]).map((row, i) => `${row}: ${(s.cols as string[])[(r.cells as number[])[i]] ?? "?"}`).join("; ");
      case "highlight": return (r.choices as number[]).map((i) => (s.segments as string[])[i]).join(" / ");
      case "hotspot": return "clicked on the slide";
      case "label": return (r.labels as string[]).join(", ");
      case "widget_goal": return s.template === "vector2d" ? `v at ${Math.round(r.theta)}°` : `x = ${r.x}`;
      case "spot_error": return `step ${(r.step as number) + 1}`;
      default: return String(r.text ?? "");
    }
  } catch {
    return "";
  }
}

/** Generation guide per type: the JSON the writer must return in `specJson`. */
export const SPEC_DOCS: Record<QType, string> = {
  mcq: `{"options":[{"text":"…","why":"why it is right or the exact misconception behind it"}],"correct":0} 4 options; distractors are the mistakes the rubric warns about.`,
  multi: `{"options":[{"text":"…","why":"…","correct":true}]} 4–6 options, 2–3 correct.`,
  tf_fix: `{"statement":"…","isTrue":false,"fixes":["corrected statement A","B","C"],"correctFix":1} Usually false; fixes are candidate corrections (empty if true).`,
  two_tier: `{"options":["…"],"correct":0,"reasons":["…"],"correctReason":2} The prompt asks for the answer, then why.`,
  numeric: `{"answer":12.5,"tolerance":0.05,"unit":"W"} A calculation with a single number.`,
  expression: `{"answer":"lambda^2 - 7*lambda + 10","hint":"in terms of λ"} mathjs syntax; checked for equivalence.`,
  cloze_text: `{"text":"The determinant of A is [[1]], so A is [[2]].","blanks":[{"accept":["-2","−2"]},{"accept":["invertible"]}]} Gaps marked [[1]], [[2]]…`,
  cloze_select: `{"text":"… [[1]] …","blanks":[{"options":["a","b","c"],"correct":1}]}`,
  cloze_drag: `{"text":"… [[1]] … [[2]] …","blanks":["word for 1","word for 2"],"distractors":["plausible wrong word"]}`,
  match: `{"pairs":[{"left":"term or matrix","right":"definition or result"}]} 4 pairs; rights must be distinct.`,
  order: `{"items":["first step","second step","…"]} Listed in the CORRECT order (shuffled for the student).`,
  parsons: `{"lines":["line 1 of the solution","line 2","…"],"distractors":["a plausible wrong line"]} Correct order; 4–6 lines.`,
  categorize: `{"categories":["A","B"],"items":[{"text":"…","category":0}]} 6–8 items.`,
  grid: `{"rows":["statement or case"],"cols":["True","False"],"correct":[0,1]} One column per row.`,
  highlight: `{"segments":["sentence 1","sentence 2","…"],"correct":[2]} A short passage split into sentences; the prompt says what to highlight.`,
  hotspot: `{"regionId":"<one region id from REGIONS>"} The prompt asks the student to click where the slide shows something specific.`,
  label: `{"regions":[{"regionId":"<id>","label":"short label"}]} 3–4 regions from the SAME page; labels say what each region is.`,
  widget_goal: `{"template":"vector2d","params":{"A":[[2,1],[1,2]],"mode":"eigen","startAngle":10}} or {"template":"plot","params":{"expr":"k*x^3","xMin":0,"xMax":5,"xLabel":"…","yLabel":"…","sliders":[…],"goal":{"check":"f(x) >= 200","text":"task","done":"what it shows"}}} The prompt states the challenge.`,
  estimate: `{"min":0,"max":100,"step":1,"answer":42,"tolerance":5,"unit":"%"} Estimate before computing.`,
  spot_error: `{"steps":["step 1","step 2 (contains one realistic mistake)","…"],"wrongStep":1,"why":"what is wrong and the fix"}`,
  faded: `{"steps":["step 1","the missing step","step 3"],"blankStep":1,"accept":["accepted forms of the missing step"]}`,
  short: `{} One or two sentence answer.`,
  worked: `{} A full exam-style problem with working (parts (a)/(b) allowed).`,
  justify: `{} The student justifies a claim or completes a short proof.`,
  teach_back: `{} The student explains the idea out loud as if teaching a friend.`,
};
