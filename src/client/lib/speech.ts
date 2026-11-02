import type { TtsIn, TtsOut } from "./tts.worker";

/**
 * Listen mode voice. The Meta Model API has no text-to-speech model, so the voice is Kokoro-82M
 * (open weights) running on the student's GPU in a Web Worker. Until it has loaded, or if it
 * cannot load, the browser voice reads instead.
 */

// ---- Kokoro in a worker ----

type Clip = { samples: Float32Array; rate: number };

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
const progress = new Set<(pct: number) => void>();
let audio: AudioContext | null = null;

function send(m: TtsIn) {
  worker!.postMessage(m);
}

/**
 * Starts loading the neural voice (call it from a click so audio is allowed to play).
 * Resolves true when it can speak, false when the browser voice has to be used.
 */
export function prepareVoice(onProgress?: (pct: number) => void): Promise<boolean> {
  audio ??= new AudioContext();
  void audio.resume();
  if (onProgress) progress.add(onProgress);
  ready ??= new Promise<boolean>((resolve) => {
    try {
      worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return resolve(false);
    }
    worker.onmessage = (e: MessageEvent<TtsOut>) => {
      const m = e.data;
      if (m.type === "progress") progress.forEach((f) => f(m.pct));
      else if (m.type === "ready") resolve(true);
      else if (m.type === "failed") resolve(false);
      else {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.type === "audio") w?.resolve({ samples: m.samples, rate: m.rate });
        else w?.reject(new Error(m.message));
      }
    };
    worker.onerror = () => resolve(false);
    send({ type: "load" });
  });
  return ready.finally(() => onProgress && progress.delete(onProgress));
}

function synth(text: string): { id: number; clip: Promise<Clip> } {
  const id = nextId++;
  const clip = new Promise<Clip>((resolve, reject) => waiting.set(id, { resolve, reject }));
  send({ type: "speak", id, text });
  return { id, clip };
}

/** Short pieces keep the first sound quick and let the next sentence render while this one plays. */
export function sentences(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?;:])\s+(?=["'([A-Z0-9])/);
  const out: string[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.length < 40) out[out.length - 1] = `${last} ${p}`;
    else if (p) out.push(p);
  }
  return out;
}

// ---- browser voice fallback ----

const RANK = [/premium/i, /enhanced/i, /natural/i, /neural/i, /siri/i, /google us english/i, /google/i, /samantha|ava|allison|zoe|evan|nathan/i];

let cached: SpeechSynthesisVoice | null | undefined;

function bestVoice(): SpeechSynthesisVoice | null {
  if (cached !== undefined) return cached;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return null; // not loaded yet; try again next time
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const lang = navigator.language.toLowerCase();
  const score = (v: SpeechSynthesisVoice) => {
    const r = RANK.findIndex((re) => re.test(v.name));
    return (r === -1 ? RANK.length : r) * 2 + (v.lang.toLowerCase() === lang ? 0 : 1);
  };
  cached = [...en].sort((a, b) => score(a) - score(b))[0] ?? null;
  return cached;
}

function browserSpeak(text: string, onStart?: () => void, onEnd?: () => void): () => void {
  const synth = window.speechSynthesis;
  if (!synth) {
    onEnd?.();
    return () => undefined;
  }
  const u = new SpeechSynthesisUtterance(text);
  const v = bestVoice();
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  let stopped = false;
  u.onstart = () => onStart?.();
  u.onend = () => !stopped && onEnd?.();
  synth.cancel();
  synth.speak(u);
  return () => {
    stopped = true;
    synth.cancel();
  };
}

// voices load asynchronously in Chrome and Safari
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    cached = undefined;
  });
}

// ---- one voice at a time ----

let current: (() => void) | null = null;

/** Stops whatever is speaking. */
export function stopSpeaking() {
  current?.();
  current = null;
}

/** Whether the neural voice is loaded (for the "voice by" label). */
export async function neuralVoice(): Promise<boolean> {
  return ready ? ready : false;
}

/**
 * Speaks text, replacing anything already speaking. onEnd fires only when it finishes on its own.
 * Returns a stop function.
 */
export function speak(text: string, { onStart, onEnd }: { onStart?: () => void; onEnd?: () => void } = {}): () => void {
  stopSpeaking();
  let stopped = false;
  let stopInner: () => void = () => undefined;
  const queued: number[] = [];
  const stop = () => {
    stopped = true;
    stopInner();
    if (queued.length && worker) send({ type: "cancel", ids: queued });
  };
  current = stop;

  void (async () => {
    if (!(await neuralVoice()) || !audio) {
      if (!stopped) stopInner = browserSpeak(text, onStart, () => current === stop && onEnd?.());
      return;
    }
    const parts = sentences(text);
    let next = parts.length ? synth(parts[0]) : null;
    if (next) queued.push(next.id);
    for (let i = 0; next && !stopped; i++) {
      let clip: Clip | null;
      try {
        clip = await next.clip;
      } catch {
        clip = null;
      }
      next = i + 1 < parts.length ? synth(parts[i + 1]) : null;
      if (next) queued.push(next.id);
      if (stopped) return;
      if (i === 0) onStart?.();
      if (clip?.samples.length) await play(clip, (s) => (stopInner = s));
      else await new Promise<void>((resolve) => (stopInner = browserSpeak(parts[i], undefined, resolve))); // the browser voice covers a failed sentence
    }
    if (!stopped && current === stop) {
      current = null;
      onEnd?.();
    }
  })();
  return stop;
}

function play(clip: Clip, setStop: (s: () => void) => void): Promise<void> {
  const ctx = audio!;
  const buf = ctx.createBuffer(1, clip.samples.length, clip.rate);
  buf.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  return new Promise((resolve) => {
    src.onended = () => resolve();
    setStop(() => {
      try {
        src.stop();
      } catch {
        resolve();
      }
    });
    src.start();
  });
}
