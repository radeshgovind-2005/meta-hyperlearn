import { create, all, type MathJsInstance } from "mathjs";
import { z } from "zod";

// A restricted mathjs instance: model-written expressions can compute, never import or redefine.
const math: MathJsInstance = create(all, { epsilon: 1e-9 });
const evaluate = math.evaluate.bind(math);
const compile = math.compile.bind(math);
const parse = math.parse.bind(math);
const blocked = ["import", "createUnit", "evaluate", "parse", "compile", "simplify", "derivative", "resolve", "reviver", "chain"];
math.import(
  Object.fromEntries(blocked.map((name) => [name, () => { throw new Error(`${name} is disabled`); }])),
  { override: true },
);

export const Vector2dParams = z.object({
  A: z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])]),
  mode: z.enum(["eigen", "transform"]).default("eigen"),
  startAngle: z.number().default(20),
  goal: z.string().optional().describe("eigen mode task, e.g. 'Find both directions where A only stretches v'"),
  caption: z.string().optional(),
});
export type Vector2dParams = z.infer<typeof Vector2dParams>;

const PlotGoal = z.object({
  check: z.string().describe("mathjs boolean over x (the probe), f and the slider names, e.g. 'f(x) >= 200' or 'f(2) == 0'"),
  text: z.string().describe("the task, e.g. 'Push f until power passes the 200 W limit'"),
  done: z.string().describe("what to say when it is reached"),
});

export const PlotParams = z.object({
  expr: z.string(),
  xMin: z.number().default(-5),
  xMax: z.number().default(5),
  xLabel: z.string().default("x"),
  yLabel: z.string().default("y"),
  xStart: z.number().optional(),
  sliders: z.array(z.object({ name: z.string().regex(/^[a-z]\w*$/i), label: z.string().optional(), min: z.number(), max: z.number(), step: z.number().positive(), value: z.number() })).default([]),
  markers: z.array(z.object({ x: z.number(), label: z.string() })).default([]),
  goal: PlotGoal.optional(),
  caption: z.string().optional(),
});
export type PlotParams = z.infer<typeof PlotParams>;

export const StepperParams = z.object({
  steps: z.array(z.object({ title: z.string(), md: z.string() })).min(2),
});

/** Matrix helpers for vector2d (also used by the template component). */
export function apply2(A: number[][], v: [number, number]): [number, number] {
  return [A[0][0] * v[0] + A[0][1] * v[1], A[1][0] * v[0] + A[1][1] * v[1]];
}

/** Real eigenpairs of a 2x2 matrix (empty when eigenvalues are complex). */
export function eigen2(A: number[][]): { lambda: number; v: [number, number] }[] {
  const [[a, b], [c, d]] = A;
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  if (disc < -1e-12) return [];
  const r = Math.sqrt(Math.max(0, disc));
  const lambdas = r < 1e-12 ? [tr / 2] : [(tr + r) / 2, (tr - r) / 2];
  return lambdas.map((lambda) => {
    let v: [number, number];
    if (Math.abs(b) > 1e-12) v = [b, lambda - a];
    else if (Math.abs(c) > 1e-12) v = [lambda - d, c];
    else v = Math.abs(a - lambda) < 1e-12 ? [1, 0] : [0, 1];
    const n = Math.hypot(v[0], v[1]) || 1;
    return { lambda, v: [v[0] / n, v[1] / n] };
  });
}

/** Builds y = f(x) for a plot with slider values. */
export function plotFunction(expr: string, scope: Record<string, number>): (x: number) => number {
  const code = compile(expr);
  return (x: number) => {
    const y = code.evaluate({ ...scope, x });
    return typeof y === "number" ? y : Number(y);
  };
}

/** Symbol names an expression reads (used to reject sliders the curve ignores). */
export function exprSymbols(expr: string): Set<string> {
  const names = new Set<string>();
  parse(expr).traverse((node) => {
    if ((node as { isSymbolNode?: boolean }).isSymbolNode) names.add((node as unknown as { name: string }).name);
  });
  return names;
}

/** Inclusive grid of values a slider can take, thinned to at most n points. */
function sliderGrid(s: { min: number; max: number; step: number }, n = 9): number[] {
  const steps = Math.max(1, Math.round((s.max - s.min) / s.step));
  const out: number[] = [];
  for (let i = 0; i <= n - 1; i++) out.push(s.min + s.step * Math.round((steps * i) / (n - 1)));
  return [...new Set(out)];
}

/**
 * One fixed y-range for the whole widget: the curve over every slider setting, so moving a
 * slider visibly moves the curve instead of the axes rescaling around it.
 */
export function plotRange(p: PlotParams): { yMin: number; yMax: number } {
  const ys: number[] = [];
  const combos: Record<string, number>[] = [{}];
  for (const s of p.sliders.slice(0, 3)) {
    const grid = sliderGrid(s, p.sliders.length > 2 ? 3 : 5);
    combos.splice(0, combos.length, ...combos.flatMap((c) => grid.map((v) => ({ ...c, [s.name]: v }))));
  }
  for (const c of combos) {
    const scope = { ...Object.fromEntries(p.sliders.map((s) => [s.name, s.value])), ...c };
    try {
      const f = plotFunction(p.expr, scope);
      for (let i = 0; i <= 60; i++) {
        const y = f(p.xMin + ((p.xMax - p.xMin) * i) / 60);
        if (Number.isFinite(y)) ys.push(y);
      }
    } catch {
      /* invalid settings are reported by the component */
    }
  }
  if (!ys.length) return { yMin: -1, yMax: 1 };
  ys.sort((a, b) => a - b);
  // ignore the most extreme 2% so one asymptote does not flatten everything else
  let lo = ys[Math.floor(ys.length * 0.02)];
  let hi = ys[Math.ceil(ys.length * 0.98) - 1];
  lo = Math.min(0, lo);
  hi = Math.max(0, hi);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.06;
  return { yMin: lo - (lo < 0 ? pad : 0), yMax: hi + pad };
}

/** About five round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}

/** Whether the plot goal holds for one state of the widget. */
export function plotGoalMet(p: PlotParams, values: Record<string, number>, x: number): boolean {
  if (!p.goal) return false;
  try {
    const f = plotFunction(p.expr, values);
    return truthy(evaluate(p.goal.check, { ...values, x, f: (t: number) => f(t) }));
  } catch {
    return false;
  }
}

/** Searches slider and probe positions for a state that meets the goal (the goal must be reachable). */
export function plotGoalReachable(p: PlotParams): boolean {
  if (!p.goal) return true;
  let states: Record<string, number>[] = [Object.fromEntries(p.sliders.map((s) => [s.name, s.value]))];
  for (const s of p.sliders.slice(0, 3)) states = states.flatMap((st) => sliderGrid(s, 11).map((v) => ({ ...st, [s.name]: v })));
  for (const st of states) {
    for (let i = 0; i <= 100; i++) if (plotGoalMet(p, st, p.xMin + ((p.xMax - p.xMin) * i) / 100)) return true;
  }
  return false;
}

/** Structural checks run before any claim: every control must change what the student sees. */
export function widgetProblems(template: string, params: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (template === "plot") {
    const p = PlotParams.parse(params);
    let used: Set<string>;
    try {
      used = exprSymbols(p.expr);
    } catch (err) {
      return [`expr does not parse: ${(err as Error).message}`];
    }
    if (!used.has("x")) problems.push("expr must use x (the horizontal axis the student moves along)");
    for (const s of p.sliders) if (!used.has(s.name)) problems.push(`slider "${s.name}" does not appear in expr, so moving it changes nothing`);
    if (p.goal && !plotGoalReachable(p)) problems.push(`goal "${p.goal.check}" can never be reached with these slider ranges and x range`);
  }
  if (template === "vector2d") {
    const p = Vector2dParams.parse(params);
    if (p.mode === "eigen" && !eigen2(p.A).length) problems.push("eigen mode needs a matrix with real eigenvalues");
  }
  return problems;
}

export type ClaimResult = { claim: string; ok: boolean; detail: string };

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.flat(Infinity as 1).every((x) => truthy(x));
  if (value && typeof value === "object" && "toArray" in value && typeof (value as { toArray: () => unknown }).toArray === "function") {
    return truthy((value as { toArray: () => unknown[] }).toArray());
  }
  return false;
}

/** Recomputes each widget claim in code. Claims are mathjs boolean expressions over the widget params. */
export function checkClaims(template: string, params: Record<string, unknown>, claims: string[]): ClaimResult[] {
  const scope: Record<string, unknown> = {};
  if (template === "vector2d") {
    const p = Vector2dParams.parse(params);
    scope.A = math.matrix(p.A);
  } else if (template === "plot") {
    const p = PlotParams.parse(params);
    const sliderScope = Object.fromEntries(p.sliders.map((s) => [s.name, s.value]));
    Object.assign(scope, sliderScope);
    const f = plotFunction(p.expr, sliderScope);
    scope.f = (x: number) => f(x);
  } else {
    for (const [k, v] of Object.entries(params)) if (typeof v === "number" || Array.isArray(v)) scope[k] = v;
  }
  return claims.map((claim) => {
    try {
      const value = evaluate(claim, { ...scope });
      const ok = truthy(value);
      return { claim, ok, detail: ok ? "holds" : `evaluated to ${math.format(value as never, { precision: 6 })}` };
    } catch (err) {
      return { claim, ok: false, detail: `could not evaluate: ${(err as Error).message}` };
    }
  });
}
