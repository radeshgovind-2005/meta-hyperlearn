import type { AiCtx } from "./meta";
import { metaFetch, recordSpend } from "./meta";
import { MODELS, PRICES } from "./models";
import { traceChild } from "../lib/tracing";

export type AsrTurn = { startMs: number; endMs: number; transcript: string };

/** Batch transcription. Audio must be WAV mono 16-bit PCM, 16 or 24 kHz, at most 10 min / 32 MB. */
export async function transcribeWav(ctx: AiCtx, wav: ArrayBuffer, offsetMs = 0): Promise<{ transcript: string; turns: AsrTurn[]; durationMs: number }> {
  return traceChild(ctx.trace, "voice-transcribe", "llm", { bytes: wav.byteLength, offsetMs }, async () => {
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: MODELS.transcribe, mode: "ENDPOINTING", audioEncoding: "WAV" })], { type: "application/json" }));
    form.append("audio", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    const res = await metaFetch(ctx, "/asr/transcribe", { method: "POST", body: form });
    const json = (await res.json()) as { transcript?: string; audioDurationMs?: number; turns?: { startMs: number; endMs: number; transcript: string }[] };
    const durationMs = json.audioDurationMs ?? 0;
    await recordSpend(ctx, MODELS.transcribe, (durationMs / 3_600_000) * PRICES.transcribePerHour);
    const turns = (json.turns ?? []).map((t) => ({ startMs: t.startMs + offsetMs, endMs: t.endMs + offsetMs, transcript: t.transcript }));
    if (!turns.length && json.transcript) turns.push({ startMs: offsetMs, endMs: offsetMs + durationMs, transcript: json.transcript });
    return { transcript: json.transcript ?? turns.map((t) => t.transcript).join(" "), turns, durationMs };
  });
}
