// Split an ElevenLabs take into the nine narration lines at its natural pauses, check it with
// Muse Voice Transcribe, and write audio/wyman/vN.wav (48 kHz mono) for scripts/05-measure.mjs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { transcribe, spent } from './meta.mjs';

const take = process.argv[2] ?? 'take1';
const src = `audio/elevenlabs/${take}.mp3`;
// speech spans (s) from silencedetect at -38 dB / 180 ms, grouped into the script's lines
const SPANS = {
  take1: [[0, 2.89], [3.30, 6.21], [6.67, 7.94], [8.41, 9.48], [9.83, 11.86], [12.35, 14.84], [15.25, 18.79], [19.21, 23.73], [24.18, 26.72]],
  take2: [[0, 2.82], [3.30, 6.15], [6.59, 7.82], [8.33, 9.42], [9.77, 11.74], [12.24, 14.68], [15.11, 18.70], [19.13, 23.65], [24.12, 26.61]],
}[take];
const PRE = 0.06, POST = 0.16;
mkdirSync('audio/wyman', { recursive: true });
SPANS.forEach(([a, b], i) => {
  const s = Math.max(0, a - PRE), d = b + POST - s;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', s.toFixed(3), '-t', d.toFixed(3), '-i', src, '-af', `afade=t=in:d=0.02,afade=t=out:st=${(d - 0.06).toFixed(3)}:d=0.06`, '-ar', '48000', '-ac', '1', `audio/wyman/v${i + 1}.wav`]);
});
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', `audio/elevenlabs/${take}-16k.wav`]);
const asr = await transcribe(take, `audio/elevenlabs/${take}-16k.wav`);
writeFileSync(`audio/elevenlabs/${take}-asr.json`, JSON.stringify(asr, null, 1));
console.log('ASR transcript:', asr.transcript);
for (const t of asr.turns ?? []) console.log(` ${(t.startMs / 1000).toFixed(2)}–${(t.endMs / 1000).toFixed(2)} ${t.transcript}`);
console.log('spent so far $', (await spent()).toFixed(4));
