/**
 * Listen mode speaks with the browser voice (the Meta Model API has no text-to-speech model).
 * The browser default is often the robotic compact voice, so pick the best English voice installed.
 */
const RANK = [/premium/i, /enhanced/i, /natural/i, /neural/i, /siri/i, /google us english/i, /google/i, /samantha|ava|allison|zoe|evan|nathan/i];

let cached: SpeechSynthesisVoice | null | undefined;

export function bestVoice(): SpeechSynthesisVoice | null {
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

export function utterance(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  const v = bestVoice();
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  return u;
}

// voices load asynchronously in Chrome and Safari
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    cached = undefined;
  });
}
