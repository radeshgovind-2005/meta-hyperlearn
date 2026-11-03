import type { Env } from "../env";
import type { AiCtx } from "../ai/meta";
import { getAiCtx } from "../ai/meta";
import { synthesize, VOICE_TAG } from "../ai/tts";
import { assertQuota } from "../lib/quota";
import { listenScript, sha256, type ListenSegment } from "./listen";
import type { Block } from "../../shared/types";

/** Lets a graph hand background work to its host (a Durable Object's waitUntil) without awaiting it. */
export type Defer = (work: Promise<unknown>) => void;

/** One clip is about 25 seconds of speech: quick to make, and the next one is fetched while it plays. */
const CLIP_CHARS = 450;
const MAX_CLIP_CHARS = 900;
const PARALLEL = 4;

/** Splits a spoken segment into clips at sentence ends. */
export function splitForSpeech(text: string): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?;:])\s+/).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + 1 + s.length <= CLIP_CHARS) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  // a sentence with no stops at all is cut at a space instead of being sent whole
  return out.flatMap((c) => {
    const pieces: string[] = [];
    let rest = c;
    while (rest.length > MAX_CLIP_CHARS) {
      const cut = rest.lastIndexOf(" ", MAX_CLIP_CHARS);
      pieces.push(rest.slice(0, cut > 0 ? cut : MAX_CLIP_CHARS));
      rest = rest.slice(cut > 0 ? cut + 1 : MAX_CLIP_CHARS);
    }
    return [...pieces, rest];
  });
}

/** Clips are named by what they say, so the same words are only ever spoken once. */
export async function clipKey(text: string): Promise<string> {
  return `listen/audio/${VOICE_TAG}/${await sha256(text)}.wav`;
}

/** The stored clip for `text`, made now if it is not there yet. null when it cannot be made (the browser voice covers it). */
export async function ensureClip(env: Env, text: string): Promise<string | null> {
  try {
    const key = await clipKey(text);
    if (await env.FILES.head(key)) return key;
    await assertQuota(env, ["storage", "classA"]);
    await env.FILES.put(key, await synthesize(env, text), { httpMetadata: { contentType: "audio/wav" } });
    return key;
  } catch (err) {
    console.error("narration clip failed", (err as Error).message);
    return null;
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export type NarratedSegment = { blockId: string; text: string; clips: { text: string; key: string | null }[] };

/** Makes every clip of a script (existing ones are reused) and returns them in reading order. */
export async function narrate(env: Env, segments: ListenSegment[]): Promise<NarratedSegment[]> {
  const out: NarratedSegment[] = segments.map((s) => ({ blockId: s.blockId, text: s.text, clips: splitForSpeech(s.text).map((text) => ({ text, key: null as string | null })) }));
  const todo = out.flatMap((s) => s.clips);
  const keys = await pool(todo, PARALLEL, (c) => ensureClip(env, c.text));
  todo.forEach((c, i) => (c.key = keys[i]));
  return out;
}

/** The spoken script of a section plus its audio, ready to play. */
export async function prepareNarration(env: Env, ctx: AiCtx, title: string, blocks: Block[]): Promise<{ segments: NarratedSegment[]; cached: boolean }> {
  const script = await listenScript(env, ctx, title, blocks);
  return { segments: await narrate(env, script.segments), cached: script.cached };
}

/**
 * Called whenever a section changes: writes the script and the audio in the background, so
 * pressing Listen never waits for them. Failures are logged; Listen then makes whatever is missing.
 */
export async function warmNarration(env: Env, userId: string, title: string, blocks: Block[]): Promise<void> {
  if (env.NARRATION === "off") return;
  try {
    await prepareNarration(env, await getAiCtx(env, userId), title, blocks);
  } catch (err) {
    console.error("narration warm-up failed", (err as Error).message);
  }
}
