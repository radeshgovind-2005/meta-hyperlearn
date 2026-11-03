import { describe, expect, it } from "vitest";
import { bulletText, displayMath, hasFormula, normalizeMath } from "../src/shared/mathtext";
import { dropSentences, splitSentences } from "../src/server/verify/sentences";
import { applyMathDefaults, type Intent } from "../src/server/graphs/mutate";
import type { Block } from "../src/shared/types";

const PARA = "Speedup compares the one-processor time with the p-processor time.\n$$S(p) = \\frac{T_1}{T_p}$$\nwhere:\n- $T_1$ is the execution time on one processor.\n- $T_p$ is the execution time on p processors.";

describe("normalizeMath", () => {
  it("puts display math on its own line and joins broken formulas", () => {
    expect(normalizeMath("Speedup is $$S = \\frac{a}{b}$$ for p workers.")).toBe("Speedup is\n$$S = \\frac{a}{b}$$\nfor p workers.");
    expect(normalizeMath("\\[\nS = \\frac{a}{\n b}\n\\]")).toBe("$$S = \\frac{a}{ b}$$");
  });
  it("converts \\( \\) to inline dollars", () => {
    expect(normalizeMath("where \\(T_1\\) is time")).toBe("where $T_1$ is time");
  });
  it("leaves a finished paragraph alone", () => {
    expect(normalizeMath(PARA)).toBe(PARA);
  });
});

describe("line helpers", () => {
  it("reads display and bullet lines", () => {
    expect(displayMath("$$E = S/p$$")).toBe("E = S/p");
    expect(displayMath("E = S/p")).toBeNull();
    expect(bulletText("- $T_1$ is time")).toBe("$T_1$ is time");
  });
  it("spots formulas", () => {
    expect(hasFormula("so $$S = 1$$")).toBe(true);
    expect(hasFormula("Tp = f x T1 + (1 - f) x T1 / p")).toBe(true);
    expect(hasFormula("For A = [[a, b], [c, d]], det(A) = ad − bc.")).toBe(true);
    expect(hasFormula("A nonzero vector v is an eigenvector of A if Av = λv for some scalar λ.")).toBe(true);
    expect(hasFormula("Parallel computers are used for large problems.")).toBe(false);
  });
});

describe("verifier units keep the paragraph's shape", () => {
  it("checks the formula and each legend line as its own unit", () => {
    expect(splitSentences(PARA)).toEqual([
      "Speedup compares the one-processor time with the p-processor time.",
      "$$S(p) = \\frac{T_1}{T_p}$$",
      "where:",
      "$T_1$ is the execution time on one processor.",
      "$T_p$ is the execution time on p processors.",
    ]);
  });
  it("dropping a sentence keeps lines, formula and legend", () => {
    const out = dropSentences(PARA, new Set(["$T_p$ is the execution time on p processors."]));
    expect(out).toBe("Speedup compares the one-processor time with the p-processor time.\n$$S(p) = \\frac{T_1}{T_p}$$\nwhere:\n- $T_1$ is the execution time on one processor.");
  });
  it("dropping a formula keeps the prose", () => {
    expect(dropSentences(PARA, new Set(["$$S(p) = \\frac{T_1}{T_p}$$"]))).toContain("where:");
  });
});

describe("applyMathDefaults", () => {
  const intent = (o: Partial<Intent> = {}): Intent => ({ simplify: false, addWidget: false, moreExamples: false, examFocus: false, analogy: false, addImage: false, tooComplex: false, rewrite: true, notes: "", ...o });
  const text = (id: string, md: string): Block => ({ id, kind: "text", md, cites: [], origin: "source" });
  const widget: Block = { id: "w", kind: "widget", spec: { template: "stepper", params: { steps: [] }, claims: [] } as never, cites: [] };

  it("adds an interactive example to a rewritten formula paragraph", () => {
    expect(applyMathDefaults(intent({ simplify: true }), [text("a", PARA)], "a").addWidget).toBe(true);
  });
  it("leaves prose, pictures and pages that already have an example alone", () => {
    expect(applyMathDefaults(intent(), [text("a", "Plain words only.")], "a").addWidget).toBe(false);
    expect(applyMathDefaults(intent({ addImage: true, rewrite: false }), [text("a", PARA)], "a").addWidget).toBe(false);
    expect(applyMathDefaults(intent(), [text("a", PARA), widget], "a").addWidget).toBe(false);
  });
});
