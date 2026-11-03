import { api } from "./api";

/**
 * Listen mode voice. The Meta Model API has no text-to-speech model, so the server speaks with
 * MeloTTS (open weights, Workers AI). Clips are made when a section changes and stored by content,
 * so the reader only downloads and plays them. If a clip is missing, the browser voice reads that
 * piece instead.
 */

export type Clip = { text: string; url: string | null };

let audio: AudioContext | null = null;

/** Call from a click so the browser allows audio to play afterwards. */
export function unlockAudio() {
  audio ??= new AudioContext();
  void audio.resume();
}

async function load(clip: Clip): Promise<AudioBuffer | null> {
  if (!clip.url || !audio) return null;
  try {
    const res = await fetch(clip.url);
    if (!res.ok) return null;
    return await audio.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
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

type Handlers = { onStart?: () => void; onEnd?: () => void };

/** Plays clips in order; the next one downloads while this one plays. onEnd fires only on a natural finish. */
function playClips(clips: Clip[], { onStart, onEnd }: Handlers): () => void {
  let stopped = false;
  let stopInner: () => void = () => undefined;
  void (async () => {
    let next = clips.length ? load(clips[0]) : null;
    for (let i = 0; next && !stopped; i++) {
      const buffer = await next;
      next = i + 1 < clips.length ? load(clips[i + 1]) : null;
      if (stopped) return;
      if (i === 0) onStart?.();
      if (buffer) await play(buffer, (s) => (stopInner = s));
      else await new Promise<void>((resolve) => (stopInner = browserSpeak(clips[i].text, undefined, resolve))); // the browser voice covers a clip that could not load
    }
    if (!stopped) onEnd?.();
  })();
  return () => {
    stopped = true;
    stopInner();
  };
}

/** Speaks ready-made clips, replacing anything already speaking. Returns a stop function. */
export function speakClips(clips: Clip[], { onStart, onEnd }: Handlers = {}): () => void {
  stopSpeaking();
  const stop: () => void = playClips(clips, {
    onStart,
    onEnd: () => {
      if (current === stop) current = null;
      onEnd?.();
    },
  });
  current = stop;
  return stop;
}

/** Speaks free text (a command bar answer): the server makes the clips, the browser voice covers a failure. */
export function speak(text: string, { onStart, onEnd }: Handlers = {}): () => void {
  stopSpeaking();
  let stopped = false;
  let stopPlayback: () => void = () => undefined;
  const stop = () => {
    stopped = true;
    stopPlayback();
  };
  current = stop;
  void (async () => {
    const clips = await api<{ clips: Clip[] }>("/api/voice/speak", { body: { text } }).then((r) => r.clips, (): Clip[] => []);
    if (stopped) return;
    stopPlayback = playClips(clips.length ? clips : [{ text, url: null }], {
      onStart,
      onEnd: () => {
        if (current === stop) current = null;
        onEnd?.();
      },
    });
  })();
  return stop;
}

function play(buffer: AudioBuffer, setStop: (s: () => void) => void): Promise<void> {
  const src = audio!.createBufferSource();
  src.buffer = buffer;
  src.connect(audio!.destination);
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
