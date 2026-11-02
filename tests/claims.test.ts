import { describe, expect, it } from "vitest";
import { checkClaims, eigen2, niceTicks, PlotParams, plotGoalMet, plotRange, widgetProblems } from "../src/shared/widgets";

describe("checkClaims", () => {
  it("verifies true eigen claims for vector2d", () => {
    const r = checkClaims("vector2d", { A: [[2, 1], [1, 2]] }, ["A * [1, 1] == 3 * [1, 1]", "det(A) == 3", "A * [1, -1] == 1 * [1, -1]"]);
    expect(r.every((x) => x.ok)).toBe(true);
  });
  it("catches a wrong claim", () => {
    const r = checkClaims("vector2d", { A: [[2, 1], [1, 2]] }, ["A * [1, 0] == 2 * [1, 0]"]);
    expect(r[0].ok).toBe(false);
  });
  it("evaluates plot claims through f with slider values", () => {
    const r = checkClaims("plot", { expr: "x^2 - a", sliders: [{ name: "a", min: 0, max: 4, step: 1, value: 2 }] }, ["abs(f(sqrt(2))) < 1e-9", "f(0) == -2"]);
    expect(r.map((x) => x.ok)).toEqual([true, true]);
  });
  it("refuses disabled functions", () => {
    const r = checkClaims("vector2d", { A: [[1, 0], [0, 1]] }, ['import({x: 1})', 'evaluate("1+1") == 2']);
    expect(r.every((x) => !x.ok)).toBe(true);
  });
  it("reports unparsable claims as failures", () => {
    expect(checkClaims("plot", { expr: "x" }, ["f(("])[0].ok).toBe(false);
  });
});

describe("eigen2", () => {
  it("finds both eigenpairs of a symmetric matrix", () => {
    const e = eigen2([[2, 1], [1, 2]]).map((p) => p.lambda).sort();
    expect(e).toEqual([1, 3]);
  });
  it("returns nothing for a rotation", () => {
    expect(eigen2([[0, -1], [1, 0]])).toEqual([]);
  });
});

describe("plot widgets stay interactive", () => {
  const base = { expr: "k*x^3", xMin: 0, xMax: 5, sliders: [{ name: "k", min: 1, max: 4, step: 0.5, value: 2 }] };

  it("keeps one y-range across every slider value", () => {
    const r = plotRange(PlotParams.parse(base));
    expect(r.yMax).toBeGreaterThanOrEqual(500);
    expect(r.yMin).toBeLessThanOrEqual(0);
  });

  it("rejects a slider the curve ignores and an unreachable goal", () => {
    expect(widgetProblems("plot", { ...base, expr: "2*x^3" })).toContain('slider "k" does not appear in expr, so moving it changes nothing');
    expect(widgetProblems("plot", { ...base, goal: { check: "f(x) >= 10000", text: "t", done: "d" } }).join()).toMatch(/never be reached/);
    expect(widgetProblems("plot", { ...base, goal: { check: "f(x) >= 200", text: "t", done: "d" } })).toEqual([]);
  });

  it("checks the goal for one widget state", () => {
    const p = PlotParams.parse({ ...base, goal: { check: "f(x) >= 200", text: "t", done: "d" } });
    expect(plotGoalMet(p, { k: 2 }, 5)).toBe(true);
    expect(plotGoalMet(p, { k: 2 }, 3)).toBe(false);
  });

  it("makes round ticks", () => {
    expect(niceTicks(0, 500, 5)).toEqual([0, 100, 200, 300, 400, 500]);
  });
});

describe("plot range with an asymptote", () => {
  it("trims a spike instead of flattening the curve", () => {
    const r = plotRange(PlotParams.parse({ expr: "1/x", xMin: -5, xMax: 5 }));
    expect(r.yMax).toBeLessThan(1000);
  });
});
