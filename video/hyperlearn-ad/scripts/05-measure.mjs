// Measures each narration line (audio/<voice>/vN.wav), writes src/lib/narration.json used by scenes, captions and the mix.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
const cues = JSON.parse(readFileSync('audio/cues.json', 'utf8'));
const lines = JSON.parse(readFileSync('docs/narration.json', 'utf8'));
mkdirSync('public/audio', { recursive: true });
const out = lines.map((l) => {
  const f = `audio/${cues.voice}/${l.id}.wav`;
  const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
  copyFileSync(f, `public/audio/${l.id}.wav`);
  const start = cues.lines[l.id].start;
  return { id: l.id, text: l.text, start, end: +(start + dur).toFixed(3), dur: +dur.toFixed(3), parts: l.parts ?? [[0, l.text]] };
});
// caption cues: one per sentence part, timed from the pauses measured in the take
const cuesOut = out.flatMap((l) => l.parts.map(([off, text], i) => ({ line: l.id, text, start: +(l.start + off).toFixed(3), end: +(i + 1 < l.parts.length ? l.start + l.parts[i + 1][0] - 0.05 : l.end).toFixed(3) })));
const srtT = (x) => { const ms = Math.round(x * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
mkdirSync('out', { recursive: true });
writeFileSync('out/hyperlearn-ad.srt', cuesOut.map((c, i) => `${i + 1}\n${srtT(c.start)} --> ${srtT(Math.min(c.end + 0.2, cuesOut[i + 1] ? cuesOut[i + 1].start - 0.02 : 30))}\n${c.text}\n`).join('\n'));
for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].end + 0.08) console.warn('OVERLAP', out[i - 1].id, out[i].id);
if (out.at(-1).end > 29.7) console.warn('LATE END', out.at(-1).end);
writeFileSync('src/lib/narration.json', JSON.stringify({ voice: cues.voice, lines: out, cues: cuesOut }, null, 1));
for (const l of out) console.log(l.id, l.start.toFixed(2), '→', l.end.toFixed(2), l.text);
