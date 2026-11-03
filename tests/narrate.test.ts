import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/server/env";
import { speechBytes } from "../src/server/ai/tts";
import { clipKey, ensureClip, narrate, splitForSpeech, warmNarration } from "../src/server/course/narrate";

const bindings = env as unknown as { FILES: R2Bucket };
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // "RIFF" + a few bytes
const b64 = btoa(String.fromCharCode(...WAV));

/** A Workers AI binding that answers like MeloTTS and counts its calls. */
function fakeEnv(reply: unknown = { audio: b64 }) {
  const run = vi.fn(async () => reply);
  const appEnv = {
    ...bindings,
    AI: { run },
    USER_DO: { idFromName: () => "id", get: () => ({ getQuota: async () => ({}), addQuota: async () => ({}) }) },
  } as unknown as Env;
  return { appEnv, run };
}

describe("splitForSpeech", () => {
  it("packs sentences into clips without changing the words", () => {
    const text = "Power is P. It grows with V squared times f. So doubling f is costly! Cooling fails.";
    const clips = splitForSpeech(text);
    expect(clips).toEqual([text]);
  });

  it("starts a new clip when the next sentence would make it too long", () => {
    const sentence = `${"word ".repeat(40).trim()}.`; // ~200 characters
    const clips = splitForSpeech(`${sentence} ${sentence} ${sentence}`);
    expect(clips).toEqual([`${sentence} ${sentence}`, sentence]);
    expect(clips.join(" ")).toBe(`${sentence} ${sentence} ${sentence}`);
  });

  it("cuts a sentence with no stops at a space", () => {
    const clips = splitForSpeech("word ".repeat(400).trim());
    expect(clips.length).toBeGreaterThan(1);
    expect(clips.every((c) => c.length <= 900)).toBe(true);
    expect(clips.join(" ")).toBe("word ".repeat(400).trim());
  });

  it("returns nothing for blank text", () => {
    expect(splitForSpeech("  \n ")).toEqual([]);
  });
});

describe("speechBytes", () => {
  it("reads MeloTTS base64 audio", async () => {
    expect([...(await speechBytes({ audio: b64 }))]).toEqual([...WAV]);
  });
  it("reads raw bytes and streams", async () => {
    expect([...(await speechBytes(WAV))]).toEqual([...WAV]);
    expect([...(await speechBytes(new Response(WAV).body))]).toEqual([...WAV]);
  });
  it("rejects an empty answer", async () => {
    await expect(speechBytes({})).rejects.toThrow(/no audio/);
    await expect(speechBytes({ audio: "" })).rejects.toThrow(/no audio/);
  });
});

describe("narration clips", () => {
  it("makes a clip once and reuses it for the same words", async () => {
    const { appEnv, run } = fakeEnv();
    const text = `Eigenvalues are stretch factors ${crypto.randomUUID()}.`;
    const key = await ensureClip(appEnv, text);
    expect(key).toBe(await clipKey(text));
    expect(key).toMatch(/^listen\/audio\/melo-en-v1\/[0-9a-f]{64}\.wav$/);
    expect(await ensureClip(appEnv, text)).toBe(key);
    expect(run).toHaveBeenCalledTimes(1);
    const stored = await bindings.FILES.get(key!);
    expect(stored?.httpMetadata?.contentType).toBe("audio/wav");
    expect([...new Uint8Array(await stored!.arrayBuffer())]).toEqual([...WAV]);
  });

  it("returns null instead of throwing when the voice model fails", async () => {
    const { appEnv, run } = fakeEnv();
    run.mockRejectedValueOnce(new Error("model down"));
    expect(await ensureClip(appEnv, `Unlucky sentence ${crypto.randomUUID()}.`)).toBeNull();
  });

  it("narrates a script, only making clips that do not exist yet", async () => {
    const { appEnv, run } = fakeEnv();
    const a = `First paragraph ${crypto.randomUUID()}.`;
    const b = `Second paragraph ${crypto.randomUUID()}.`;
    const first = await narrate(appEnv, [{ blockId: "b1", text: a }, { blockId: "b2", text: b }]);
    expect(first.map((s) => s.blockId)).toEqual(["b1", "b2"]);
    expect(first.every((s) => s.clips.every((c) => c.key))).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    // one paragraph changed: only that one is spoken again
    const c = `Third paragraph ${crypto.randomUUID()}.`;
    await narrate(appEnv, [{ blockId: "b1", text: a }, { blockId: "b2", text: c }]);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("warmNarration", () => {
  const blocks = [{ id: "t1", kind: "text" as const, md: "Eigenvectors keep their direction.", cites: [], origin: "source" as const }];

  it("does nothing while narration is switched off", async () => {
    const { appEnv, run } = fakeEnv();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await warmNarration({ ...appEnv, NARRATION: "off" }, "owner", "Eigen", blocks);
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never throws when the script cannot be written", async () => {
    const { appEnv, run } = fakeEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    await expect(warmNarration({ ...appEnv, META_API_KEY: "test", META_BASE_URL: "https://model.invalid/v1", DEMO_SPEND_CAP_USD: "40" } as Env, "owner", `Eigen ${crypto.randomUUID()}`, blocks)).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
