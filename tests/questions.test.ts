import { describe, expect, it } from "vitest";
import { describeResponse, gradeResponse, MODEL_GRADED, parseSpec, publicSpec, QTYPES, shuffled, textMatches } from "../src/shared/questions";
import { exprEquivalent } from "../src/shared/widgets";
import { planTypes } from "../src/server/course/practice";

describe("question specs", () => {
  it("rejects indexes outside their lists", () => {
    expect(() => parseSpec("mcq", { options: [{ text: "a", why: "" }, { text: "b", why: "" }], correct: 3 })).toThrow(/out of range/);
    expect(() => parseSpec("cloze_text", { text: "x [[1]] y [[2]]", blanks: [{ accept: ["a"] }] })).toThrow(/gaps/);
  });

  it("never sends the answer before the student answers", () => {
    const spec = parseSpec("mcq", { options: [{ text: "3", why: "right" }, { text: "5", why: "added" }], correct: 0 });
    expect(JSON.stringify(publicSpec("mcq", spec, "q1"))).not.toMatch(/correct|why|right/);
    const order = parseSpec("order", { items: ["a", "b", "c", "d", "e"] });
    expect((publicSpec("order", order, "q1").items as string[]).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("grading in code", () => {
  it("grades multiple choice with the distractor's reason", () => {
    const spec = parseSpec("mcq", { options: [{ text: "3", why: "trace minus" }, { text: "5", why: "You added the diagonal." }], correct: 0 });
    expect(gradeResponse("mcq", spec, { choice: 0 }, "q").correct).toBe(true);
    const wrong = gradeResponse("mcq", spec, { choice: 1 }, "q");
    expect(wrong.correct).toBe(false);
    expect(wrong.feedback).toBe("You added the diagonal.");
  });

  it("gives partial credit on select-all", () => {
    const spec = parseSpec("multi", { options: [{ text: "a", why: "", correct: true }, { text: "b", why: "", correct: true }, { text: "c", why: "", correct: false }, { text: "d", why: "", correct: false }] });
    const g = gradeResponse("multi", spec, { choices: [0] }, "q");
    expect(g.score).toBe(0.75);
    expect(g.parts).toEqual([true, false, true, true]);
  });

  it("accepts equivalent expressions and typed maths", () => {
    expect(exprEquivalent("λ² − 7λ + 10", "lambda^2 - 7*lambda + 10")).toBe(true);
    expect(exprEquivalent("(λ-2)(λ-5)", "lambda^2 - 7*lambda + 10")).toBe(true);
    expect(exprEquivalent("λ² + 7λ + 10", "lambda^2 - 7*lambda + 10")).toBe(false);
    const spec = parseSpec("expression", { answer: "lambda^2 - 7*lambda + 10" });
    expect(gradeResponse("expression", spec, { value: "(λ−2)(λ−5)" }, "q").correct).toBe(true);
    expect(textMatches("−2", ["-2"])).toBe(true);
  });

  it("grades numbers with tolerance and units", () => {
    const spec = parseSpec("numeric", { answer: 12.5, tolerance: 0.1, unit: "W" });
    expect(gradeResponse("numeric", spec, { value: "12.54" }, "q").correct).toBe(true);
    expect(gradeResponse("numeric", spec, { value: "13" }, "q").correct).toBe(false);
  });

  it("grades order and catches Parsons decoys", () => {
    const parsons = parseSpec("parsons", { lines: ["a", "b", "c"], distractors: ["x"] });
    expect(gradeResponse("parsons", parsons, { items: ["a", "b", "c"] }, "q").correct).toBe(true);
    expect(gradeResponse("parsons", parsons, { items: ["a", "x", "b", "c"] }, "q").mistake).toBe("used a decoy line");
  });

  it("grades groups in the order the student saw them", () => {
    const spec = parseSpec("categorize", { categories: ["even", "odd"], items: [{ text: "2", category: 0 }, { text: "3", category: 1 }, { text: "4", category: 0 }, { text: "5", category: 1 }] });
    const shown = shuffled(["2", "3", "4", "5"], "q9");
    const answer = shown.map((t) => (Number(t) % 2 === 0 ? 0 : 1));
    expect(gradeResponse("categorize", spec, { categories: answer }, "q9").correct).toBe(true);
  });

  it("checks a hotspot click against the cited region", () => {
    const spec = parseSpec("hotspot", { region: { sourceId: "s", page: 2, bbox: [0.1, 0.2, 0.3, 0.1] } });
    expect(gradeResponse("hotspot", spec, { point: { x: 0.2, y: 0.25 } }, "q").correct).toBe(true);
    expect(gradeResponse("hotspot", spec, { point: { x: 0.8, y: 0.8 } }, "q").correct).toBe(false);
  });

  it("checks widget challenges in code", () => {
    const eig = parseSpec("widget_goal", { template: "vector2d", params: { A: [[2, 1], [1, 2]], mode: "eigen" } });
    expect(gradeResponse("widget_goal", eig, { theta: 45 }, "q").correct).toBe(true);
    expect(gradeResponse("widget_goal", eig, { theta: 10 }, "q").correct).toBe(false);
    const plot = parseSpec("widget_goal", { template: "plot", params: { expr: "k*x^3", xMin: 0, xMax: 5, sliders: [{ name: "k", min: 1, max: 4, step: 1, value: 2 }], goal: { check: "f(x) >= 200", text: "t", done: "d" } } });
    expect(gradeResponse("widget_goal", plot, { values: { k: 2 }, x: 5 }, "q").correct).toBe(true);
  });

  it("refuses to code-grade open answers and describes responses", () => {
    expect(() => gradeResponse("worked", {} as never, { text: "x" }, "q")).toThrow();
    const spec = parseSpec("spot_error", { steps: ["a", "b", "c"], wrongStep: 1, why: "sign" });
    expect(describeResponse("spot_error", spec, { step: 1 })).toBe("step 2");
  });
});

describe("round plan", () => {
  it("starts with an instant type, ends with an exam question, and rotates types", () => {
    const plan = planTypes(5, [], "seed");
    expect(plan).toHaveLength(5);
    expect(MODEL_GRADED.has(plan[0])).toBe(false);
    expect(plan[4]).toBe("worked");
    const next = planTypes(5, plan, "seed2");
    expect(next.slice(0, 4).some((t) => plan.includes(t))).toBe(false);
    expect(QTYPES).toHaveLength(25);
  });
});
