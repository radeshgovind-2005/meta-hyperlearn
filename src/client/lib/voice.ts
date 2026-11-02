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
  // the mic runs at the device rate; we downsample to 16 kHz (some browsers refuse a 16 kHz context)
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(media);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  let finalText = "";
  let partial = "";
  let stopped = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onFinal(`${finalText} ${partial}`.trim());
  };

  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    try {
      const m = JSON.parse(e.data) as { type?: string; transcript?: string; text?: string; final?: boolean; message?: string; error?: string };
      if (m.type === "error" || m.error) {
        done = true;
        return onError(m.message ?? m.error ?? "Transcription error");
      }
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
  ws.onerror = () => {
    if (done) return;
    done = true;
    onError("Could not connect to voice input");
  };
  ws.onclose = () => {
    if (stopped) finish();
    else if (!done) onError("Voice input stopped. Try again.");
  };

  proc.onaudioprocess = (ev) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(toPcm16k(ev.inputBuffer.getChannelData(0), ctx.sampleRate).buffer);
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
        // the final transcript arrives after endStream; the server closes when it is done
        ws.send(JSON.stringify({ type: "endStream" }));
        window.setTimeout(() => {
          finish();
          ws.close();
        }, 8000);
      } else finish();
    },
  };
}

/** Average-downsample float samples to 16 kHz signed 16-bit PCM. */
export function toPcm16k(f: Float32Array, rate: number): Int16Array<ArrayBuffer> {
  const ratio = rate / 16000;
  const out = new Int16Array(new ArrayBuffer(Math.floor(f.length / ratio) * 2));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += f[j];
    out[i] = Math.max(-1, Math.min(1, sum / (b - a))) * 0x7fff;
  }
  return out;
}
