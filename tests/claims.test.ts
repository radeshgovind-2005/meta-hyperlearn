import { describe, expect, it } from "vitest";
import { checkClaims, eigen2 } from "../src/shared/widgets";

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
