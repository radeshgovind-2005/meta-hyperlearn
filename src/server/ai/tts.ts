import type { Env } from "../env";
import { base64ToBytes } from "./image";
import { MODELS } from "./models";
import { assertQuota, count, keys } from "../lib/quota";

/** Names the voice inside cache keys; bump it when the model or its settings change so clips are rebuilt. */
export const VOICE_TAG = "melo-en-v1";

/** MeloTTS answers with `{ audio: <base64 WAV> }`; raw bytes and streams are accepted too. */
export async function speechBytes(out: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const audio = typeof out === "object" && out !== null && "audio" in out ? (out as { audio: unknown }).audio : out;
  if (typeof audio === "string" && audio) return base64ToBytes(audio);
  if (audio instanceof ReadableStream) return new Uint8Array(await new Response(audio).arrayBuffer());
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio.slice(0));
  if (ArrayBuffer.isView(audio)) return new Uint8Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer);
  throw new Error("The voice model returned no audio");
}

/** One clip of speech (WAV) for a short piece of text, from the open-weight MeloTTS model on Workers AI. */
export async function synthesize(env: Env, text: string): Promise<Uint8Array<ArrayBuffer>> {
  await assertQuota(env, ["ai"]);
  count(keys.ai());
  const out = await env.AI.run(MODELS.tts as keyof AiModels, { prompt: text, lang: "en" } as never);
  return speechBytes(out);
}
