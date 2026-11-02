import { describe, expect, it } from "vitest";
import { parseVerdicts, splitSentences } from "../src/server/verify/sentences";
import { parseSamBoxes } from "../src/server/ai/sam";

describe("splitSentences", () => {
  it("splits prose and keeps formulas", () => {
    expect(splitSentences("Multiplying by A usually turns a vector. An eigenvector is not turned: Av = λv. How much it stretches is λ.")).toEqual([
      "Multiplying by A usually turns a vector.",
      "An eigenvector is not turned: Av = λv.",
      "How much it stretches is λ.",
    ]);
  });
  it("handles empty text", () => {
    expect(splitSentences("  ")).toEqual([]);
  });
});

describe("parseVerdicts", () => {
  it("parses a JSON object", () => {
    const v = parseVerdicts('{"verdicts":[{"i":1,"supported":true,"reason":"ok"},{"i":2,"supported":false,"reason":"adds a number"}]}', 2);
    expect(v.map((x) => x.supported)).toEqual([true, false]);
    expect(v[1].reason).toBe("adds a number");
  });
  it("parses fenced JSON arrays with string labels", () => {
    const v = parseVerdicts('Here you go\n```json\n[{"index":1,"verdict":"SUPPORTED"},{"index":2,"verdict":"unsupported"}]\n```', 2);
    expect(v.map((x) => x.supported)).toEqual([true, false]);
  });
  it("parses line format", () => {
    const v = parseVerdicts("1: SUPPORTED - matches slide\n2. NOT SUPPORTED: invents a date\n3) yes", 3);
    expect(v.map((x) => x.supported)).toEqual([true, false, true]);
  });
  it("treats missing verdicts as unsupported", () => {
    const v = parseVerdicts('{"verdicts":[{"i":1,"supported":true,"reason":""}]}', 3);
    expect(v.map((x) => x.supported)).toEqual([true, false, false]);
    expect(v[2].reason).toMatch(/no verdict/);
  });
});

describe("parseSamBoxes", () => {
  it("reads boxes and ignores masks", () => {
    const boxes = parseSamBoxes("<0f>0<|box;x1=10;y1=20;x2=110;y2=220;w=640;h=480;conf=0.91|><|mask;x=0;y=0;data=AAAA|>1<|box;x1=5;y1=5;x2=6;y2=6|>");
    expect(boxes).toEqual([
      { x1: 10, y1: 20, x2: 110, y2: 220, w: 640, h: 480, confidence: 0.91 },
      { x1: 5, y1: 5, x2: 6, y2: 6 },
    ]);
  });
  it("drops degenerate boxes", () => {
    expect(parseSamBoxes("<|box;x1=10;y1=10;x2=5;y2=20|>")).toEqual([]);
  });
});
