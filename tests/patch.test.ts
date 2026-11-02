import { describe, expect, it } from "vitest";
import { applyPatch, canonicalJson, diffBlocks, hashBlock, PatchError } from "../src/shared/patch";
import type { Block } from "../src/shared/types";

const t = (id: string, md = id): Block => ({ id, kind: "text", md, cites: [{ sourceId: "s1", page: 1 }], origin: "source" });
const base = [t("a"), t("b"), t("c")];

describe("applyPatch", () => {
  it("replaces a block and keeps others identical", () => {
    const out = applyPatch(base, [{ op: "replace", blockId: "b", block: t("b", "simpler") }]);
    expect(out.map((b) => (b as { md: string }).md)).toEqual(["a", "simpler", "c"]);
    expect(out[0]).toBe(base[0]);
    expect(out[2]).toBe(base[2]);
  });
  it("inserts after a block and at the top", () => {
    const out = applyPatch(base, [
      { op: "insertAfter", blockId: "b", block: t("w") },
      { op: "insertAfter", blockId: "^", block: t("top") },
    ]);
    expect(out.map((b) => b.id)).toEqual(["top", "a", "b", "w", "c"]);
  });
  it("removes and moves", () => {
    const out = applyPatch(base, [{ op: "remove", blockId: "a" }, { op: "move", blockId: "c", afterId: "^" }]);
    expect(out.map((b) => b.id)).toEqual(["c", "b"]);
  });
  it("rejects unknown and duplicate ids", () => {
    expect(() => applyPatch(base, [{ op: "remove", blockId: "zz" }])).toThrow(PatchError);
    expect(() => applyPatch(base, [{ op: "insertAfter", blockId: "a", block: t("b") }])).toThrow(PatchError);
  });
  it("does not mutate the input", () => {
    applyPatch(base, [{ op: "remove", blockId: "a" }]);
    expect(base.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("diffBlocks", () => {
  const same = (x: Block, y: Block) => canonicalJson(x) === canonicalJson(y);
  it("round-trips inserts, removals, replacements and reorders", () => {
    const after = [t("c"), t("x"), t("a", "changed")];
    const ops = diffBlocks(base, after, same);
    expect(applyPatch(base, ops).map((b) => canonicalJson(b))).toEqual(after.map((b) => canonicalJson(b)));
  });
  it("returns no ops for equal lists", () => {
    expect(diffBlocks(base, [...base], same)).toEqual([]);
  });
});

describe("hashBlock", () => {
  it("is stable under key order", async () => {
    const a = { id: "a", kind: "text", md: "x", cites: [], origin: "source" } as Block;
    const b = { origin: "source", cites: [], md: "x", kind: "text", id: "a" } as Block;
    expect(await hashBlock(a)).toBe(await hashBlock(b));
    expect(await hashBlock(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
