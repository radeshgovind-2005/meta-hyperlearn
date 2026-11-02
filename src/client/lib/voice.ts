import { sessionToken, wsUrl } from "./api";

export type VoiceSession = { stop: () => void };

/**
 * Streams the microphone (PCM16 at 16 kHz) to our realtime transcription proxy.
 * onText gets the running transcript; onFinal the final text when the user stops.
 */
export async function startVoice(onText: (t: string) => void, onFinal: (t: string) => void, onError: (msg: string) => void): Promise<VoiceSession> {
  const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ws = new WebSocket(wsUrl("/api/voice/realtime", await sessionToken()));
  ws.binaryType = "arraybuffer";
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(media);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  let finalText = "";
  let partial = "";
  let stopped = false;

  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    try {
      const m = JSON.parse(e.data) as { type?: string; transcript?: string; text?: string; final?: boolean; message?: string; error?: string };
      if (m.type === "error" || m.error) return onError(m.message ?? m.error ?? "Transcription error");
      const t = m.transcript ?? m.text;
      if (m.type === "transcript" && typeof t === "string") {
        if (m.final) {
          finalText = `${finalText} ${t}`.trim();
          partial = "";
        } else partial = t;
        onText(`${finalText} ${partial}`.trim());
      }
    } catch {
      // ignore non-JSON frames
    }
  };
  ws.onerror = () => onError("Could not connect to voice input");
  ws.onclose = () => {
    if (stopped) onFinal(`${finalText} ${partial}`.trim());
  };

  proc.onaudioprocess = (ev) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const f = ev.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
    ws.send(pcm.buffer);
  };
  src.connect(proc);
  proc.connect(ctx.destination);

  return {
    stop: () => {
      stopped = true;
      proc.disconnect();
      src.disconnect();
      media.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "endStream" }));
        window.setTimeout(() => ws.close(), 1500);
      } else onFinal(`${finalText} ${partial}`.trim());
    },
  };
}
