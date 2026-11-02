import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getAiCtx, recordSpend } from "../ai/meta";
import { MODELS, PRICES } from "../ai/models";

/**
 * Realtime mic input for the command bar. The browser streams PCM16 16 kHz frames to us;
 * we hold the Meta key and relay to wss://api.meta.ai/v1/asr/realtime, so the key never
 * reaches the client.
 */
export const voice = new Hono<AppEnv>().get("/realtime", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Expected a WebSocket" }, 426);
  const userId = c.get("userId");
  let ctx;
  try {
    ctx = await getAiCtx(c.env, userId);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 402);
  }
  const upstreamUrl = `${c.env.META_BASE_URL}/asr/realtime`;
  const up = await fetch(upstreamUrl, { headers: { Upgrade: "websocket" } });
  const upstream = up.webSocket;
  if (!upstream) return c.json({ error: `Could not reach the transcription service (${up.status})` }, 502);
  upstream.accept();
  // handshake: the key goes in the first frame (the Authorization header is ignored here)
  upstream.send(JSON.stringify({
    authorization: { accessToken: `Bearer ${ctx.apiKey}` },
    model: MODELS.transcribe,
    audioEncoding: "PCM_16KHZ",
    mode: "PUSH_TO_TALK",
    partialMode: "CUMULATIVE",
    emitAudioProgress: false,
  }));

  const pair = new WebSocketPair();
  const client = pair[1];
  client.accept();
  let bytes = 0;
  let closed = false;
  // audio may not be sent until Meta acknowledges the handshake with { sessionId }
  let ready = false;
  let pending: (ArrayBuffer | string)[] = [];
  const toUpstream = (d: ArrayBuffer | string) => (ready ? upstream.send(d) : void pending.push(d));
  const close = async () => {
    if (closed) return;
    closed = true;
    try { upstream.close(); } catch { /* gone */ }
    try { client.close(); } catch { /* gone */ }
    const seconds = bytes / 32000; // 16 kHz * 2 bytes
    await recordSpend(ctx, MODELS.transcribe, (seconds / 3600) * PRICES.transcribePerHour).catch(() => {});
  };
  client.addEventListener("message", (e) => {
    if (typeof e.data === "string") {
      if (e.data.includes("endStream")) toUpstream(JSON.stringify({ type: "endStream" }));
      return;
    }
    bytes += (e.data as ArrayBuffer).byteLength;
    if (bytes > 32000 * 120) return void close(); // 2 minutes max per utterance
    toUpstream(e.data as ArrayBuffer);
  });
  upstream.addEventListener("message", (e) => {
    if (typeof e.data !== "string") return;
    if (!ready && !e.data.includes('"type"') && e.data.includes("sessionId")) {
      ready = true;
      pending.forEach((d) => upstream.send(d));
      pending = [];
      return;
    }
    client.send(e.data);
  });
  client.addEventListener("close", () => void close());
  upstream.addEventListener("close", () => void close());
  upstream.addEventListener("error", () => void close());
  c.executionCtx.waitUntil(new Promise<void>((resolve) => {
    const t = setInterval(() => { if (closed) { clearInterval(t); resolve(); } }, 1000);
  }));
  return new Response(null, { status: 101, webSocket: pair[0] });
});
