import { create, all, type MathJsInstance } from "mathjs";
import { z } from "zod";

// A restricted mathjs instance: model-written expressions can compute, never import or redefine.
const math: MathJsInstance = create(all, { epsilon: 1e-9 });
const evaluate = math.evaluate.bind(math);
const compile = math.compile.bind(math);
const blocked = ["import", "createUnit", "evaluate", "parse", "compile", "simplify", "derivative", "resolve", "reviver", "chain"];
math.import(
  Object.fromEntries(blocked.map((name) => [name, () => { throw new Error(`${name} is disabled`); }])),
  { override: true },
);

export const Vector2dParams = z.object({
  A: z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])]),
  mode: z.enum(["eigen", "transform"]).default("eigen"),
  startAngle: z.number().default(20),
  caption: z.string().optional(),
});
export type Vector2dParams = z.infer<typeof Vector2dParams>;

export const PlotParams = z.object({
  expr: z.string(),
  xMin: z.number().default(-5),
  xMax: z.number().default(5),
  sliders: z.array(z.object({ name: z.string().regex(/^[a-z]\w*$/i), min: z.number(), max: z.number(), step: z.number().positive(), value: z.number() })).default([]),
  markers: z.array(z.object({ x: z.number(), label: z.string() })).default([]),
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
