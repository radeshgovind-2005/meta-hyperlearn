import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/server/env";
import { base64ToBytes, generateImage, parseImagesResponse } from "../src/server/ai/image";
import { brief, makeIllustration, storeImage, textOf } from "../src/server/course/illustrate";
import { canIllustrate, heroOf, withHero, type FigureBlock } from "../src/shared/hero";
import { applyPatch } from "../src/shared/patch";
import type { Block } from "../src/shared/types";

const bindings = env as unknown as { FILES: R2Bucket };
// 1x1 transparent webp
const PIXEL = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const appEnv = { ...bindings, META_API_KEY: "test", META_BASE_URL: "https://model.invalid/v1", DEMO_SPEND_CAP_USD: "40", USER_DO: { idFromName: () => "id", get: () => ({ getSpend: async () => 0, addSpend: async () => {}, addQuota: async () => ({}) }) } } as unknown as Env;
const ctx = () => ({ env: appEnv, userId: "owner", apiKey: "test", mode: "demo" as const });
const chatReply = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: {} });
const imageReply = () => Response.json({ data: [{ b64_json: PIXEL }], output_format: "webp" });

const text: Block = { id: "t1", kind: "text", md: "Eigenvectors keep their direction when a matrix acts on them.", cites: [{ sourceId: "s", page: 3, chunkId: "c1" }], origin: "source" };
const exercise: Block = { id: "e1", kind: "exercise", prompt: "Find them.", answer: "Solve det(A - λI) = 0.", cites: [] };
const hero: FigureBlock = { id: "f1", kind: "figure", r2Key: "illustrations/x.webp", caption: "A square stretched along two directions", cites: [], generated: true };

afterEach(() => vi.unstubAllGlobals());

describe("Muse Image client", () => {
  it("reads base64 pictures from /images/generations", () => {
    const img = parseImagesResponse({ data: [{ b64_json: PIXEL }], output_format: "webp" });
    expect(img.mime).toBe("image/webp");
    expect(img.bytes).toEqual(base64ToBytes(PIXEL));
    expect([...img.bytes.slice(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46]); // RIFF
    expect(parseImagesResponse({ data: [{ b64_json: PIXEL }], output_format: "jpeg" }).mime).toBe("image/jpeg");
  });

  it("rejects responses without a picture", () => {
    expect(() => parseImagesResponse({ data: [{ url: "https://x" }] })).toThrow(/no picture/);
    expect(() => parseImagesResponse({ nope: true })).toThrow(/no picture/);
  });

  it("asks for the documented request shape", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ model: "muse-image-1.0", n: 1, response_format: "b64_json", output_format: "webp", reasoning_strength: "low" });
      expect(body.size).toMatch(/^\d+x\d+$/);
      return imageReply();
    });
    vi.stubGlobal("fetch", fetcher);
    await generateImage(ctx(), "a square");
    expect(fetcher.mock.calls[0][0]).toBe("https://model.invalid/v1/images/generations");
  });

  it("keeps the house style and bans text in the picture", () => {
    const p = brief("two arrows on a grid");
    expect(p).toContain("two arrows on a grid");
    expect(p).toMatch(/no text/i);
    expect(p).toContain("#0A5CFF");
  });
});

describe("page hero", () => {
  it("is the generated figure at the top", () => {
    expect(heroOf([hero, text])).toBe(hero);
    expect(heroOf([text, hero])).toBeNull();
    expect(heroOf([{ ...hero, generated: false }, text])).toBeNull(); // a figure cut from the slides is not a hero
  });

  it("is placed first and replaced, never duplicated", () => {
    const next: FigureBlock = { ...hero, id: "f2", r2Key: "illustrations/y.webp" };
    expect(withHero([text, exercise], hero).map((b) => b.id)).toEqual(["f1", "t1", "e1"]);
    expect(withHero([hero, text], next).map((b) => b.id)).toEqual(["f2", "t1"]);
  });

  it("only illustrates pages that have text", () => {
    expect(canIllustrate([text])).toBe(true);
    expect(canIllustrate([exercise])).toBe(false);
  });

  it("replaces in place when the student asks for a different picture", () => {
    const redrawn: FigureBlock = { ...hero, r2Key: "illustrations/z.webp" };
    const out = applyPatch([hero, text], [{ op: "replace", blockId: "f1", block: redrawn }]);
    expect(out[0]).toBe(redrawn);
    expect(out[1]).toBe(text); // untouched blocks keep their identity
  });

  it("collects only the teaching text for the brief", () => {
    expect(textOf([hero, text, exercise])).toBe(text.kind === "text" ? text.md : "");
  });
});

describe("makeIllustration", () => {
  const router = (verdicts: boolean[]) => {
    const seen: string[] = [];
    let judged = 0;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/images/generations")) {
        seen.push(JSON.parse(init.body as string).prompt);
        return imageReply();
      }
      const body = JSON.parse(init.body as string);
      const name = body.response_format.json_schema.name;
      if (name === "illustration_plan") return chatReply({ subject: `scene ${seen.length + 1}`, caption: "A square stretched along two directions" });
      const ok = verdicts[judged++] ?? false;
      return chatReply({ ok, reason: ok ? "clear and on topic" : "labels are garbled" });
    });
    vi.stubGlobal("fetch", fetcher);
    return { seen, fetcher };
  };

  it("stores a verified picture as a generated figure with the page's citations", async () => {
    const { seen } = router([true]);
    const made = await makeIllustration(appEnv, ctx(), { title: "Eigenvectors", blocks: [text, exercise] });
    expect(made.block).toMatchObject({ kind: "figure", generated: true, caption: "A square stretched along two directions", cites: text.kind === "text" ? text.cites : [] });
    expect(made.attempts).toBe(1);
    expect(seen).toHaveLength(1);
    const stored = await bindings.FILES.get(made.block!.r2Key);
    expect(stored?.httpMetadata?.contentType).toBe("image/webp");
    expect(made.block!.r2Key).toMatch(/^illustrations\/[0-9a-f]{64}\.webp$/);
  });

  it("sends the reviewer's reason back and tries once more", async () => {
    const { seen } = router([false, true]);
    const made = await makeIllustration(appEnv, ctx(), { title: "Eigenvectors", blocks: [text] });
    expect(made.attempts).toBe(2);
    expect(made.block).not.toBeNull();
    expect(seen).toHaveLength(2);
  });

  it("adds nothing when both pictures are rejected", async () => {
    router([false, false]);
    const made = await makeIllustration(appEnv, ctx(), { title: "Eigenvectors", blocks: [text] });
    expect(made).toMatchObject({ block: null, attempts: 2, reason: "labels are garbled" });
  });

  it("does not call a model for a page without text", async () => {
    const { fetcher } = router([true]);
    const made = await makeIllustration(appEnv, ctx(), { title: "Practice", blocks: [exercise] });
    expect(made.block).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the same id when redrawing a selected picture", async () => {
    router([true]);
    const made = await makeIllustration(appEnv, ctx(), { title: "Eigenvectors", blocks: [hero, text], blockId: "f1", request: "draw it differently" });
    expect(made.block?.id).toBe("f1");
  });

  it("stores identical pictures once", async () => {
    const img = parseImagesResponse({ data: [{ b64_json: PIXEL }] });
    expect(await storeImage(appEnv, img)).toBe(await storeImage(appEnv, img));
  });
});
