/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";

/**
 * Kokoro-82M (open weights, Apache 2.0) speaking on the student's own device through ONNX Runtime WebGPU.
 * The fp32 model (~330 MB) downloads once from Hugging Face and is cached by the browser.
 * WebGPU renders ~4-5x faster than real time on a laptop; single-threaded WASM was ~3x slower than
 * real time (the page is not cross-origin isolated), so without WebGPU the browser voice reads instead.
 * One clip is generated at a time; queued clips can be cancelled before they start.
 */
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";

export type TtsIn = { type: "load" } | { type: "speak"; id: number; text: string } | { type: "cancel"; ids: number[] };
export type TtsOut =
  | { type: "progress"; pct: number }
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "audio"; id: number; samples: Float32Array; rate: number }
  | { type: "error"; id: number; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: TtsOut, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

let model: Promise<KokoroTTS> | null = null;
const load = () =>
  (model ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!(await gpu?.requestAdapter())) throw new Error("WebGPU is not available");
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: "fp32",
      device: "webgpu",
      progress_callback: (p) => {
        if (p.status === "progress" && p.file.endsWith(".onnx")) post({ type: "progress", pct: Math.round(p.progress) });
      },
    });
    await tts.generate("Ready.", { voice: VOICE }); // compiles the GPU kernels so the first sentence is quick
    return tts;
  })());

const queue: { id: number; text: string }[] = [];
let busy = false;

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      const tts = await load();
      const out = await tts.generate(job.text, { voice: VOICE });
      const samples = out.audio as Float32Array;
      post({ type: "audio", id: job.id, samples, rate: out.sampling_rate }, [samples.buffer]);
    } catch (err) {
      post({ type: "error", id: job.id, message: (err as Error).message });
    }
  }
  busy = false;
}

scope.onmessage = (e: MessageEvent<TtsIn>) => {
  const m = e.data;
  if (m.type === "load") {
    load().then(
      () => post({ type: "ready" }),
      (err: Error) => post({ type: "failed", message: err.message }),
    );
  } else if (m.type === "speak") {
    queue.push({ id: m.id, text: m.text });
    void drain();
  } else {
    for (let i = queue.length - 1; i >= 0; i--) if (m.ids.includes(queue[i].id)) queue.splice(i, 1);
  }
};
