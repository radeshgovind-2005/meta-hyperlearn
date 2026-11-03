// Muse Image: one lineup sheet, then each pose with the lineup as the shared reference.
// Usage: node scripts/02-characters.mjs [lineup|poses]
import { image, dataUrl, spent } from './meta.mjs';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const sb = JSON.parse(await readFile(new URL('../docs/storyboard-spark.json', import.meta.url), 'utf8'));
const STYLE = 'Warm human confident flat geometric illustration with soft rounded shapes on flat pure-white background, restrained and friendly. Matte flat fills, no outlines heavier than hairline, no gradients, no shadows of any kind, flat even lighting.';
const NO = 'Absolutely no text, letters, numbers, logos, signage, UI, brand marks, ground line or floor.';
const who = Object.fromEntries(sb.characters.map((c) => [c.id, c.appearance]));
const order = ['student', 'worker', 'teacher', 'learner'];
const dir = new URL('../public/gen/', import.meta.url);
const save = async (name, r) => { const f = new URL(`${name}.${r.ext}`, dir); await writeFile(f, r.bytes); console.log(name, r.cached ? '(cached)' : '(new)', r.meta.size ?? '', r.meta.background ?? ''); return f; };

const step = process.argv[2] ?? 'lineup';
if (step === 'lineup') {
  const people = order.map((id, i) => `${i + 1}. ${who[id]}`).join(' ');
  const r = await image('lineup', `${STYLE} Character design lineup: four people standing in one row left to right, evenly spaced with wide white gaps between them, same scale and same eye level, each full body from head to shoes, front three-quarter view, relaxed natural stance. ${people} Generous white margin around everyone. ${NO}`, { size: '2048x1024' });
  await save('lineup', r);
}
if (step === 'poses') {
  const ref = await dataUrl(new URL('lineup.png', dir).pathname);
  const poses = [
    ['student-walk', 'student', 'walking forward mid-stride, body turned to face right in profile three-quarter, confident easy pace, arms swinging naturally'],
    ['student-pause', 'student', 'standing still, body turned to face right, paused and thoughtful, one hand resting on a backpack strap, head slightly tilted while looking ahead, upright and calm, not sad'],
    ['student-go', 'student', 'stepping forward with a small smile, body turned to face right, energised, looking ahead'],
    ['worker-walk', 'worker', 'walking forward mid-stride, body turned to face right, calm assured pace'],
    ['teacher-walk', 'teacher', 'walking forward mid-stride, body turned to face right, kind and assured'],
    ['learner-walk', 'learner', 'walking forward mid-stride, body turned to face right, curious and upbeat'],
  ];
  for (const [name, id, pose] of poses) {
    if (process.argv[3] && process.argv[3] !== name) continue;
    if (existsSync(new URL(`${name}.png`, dir)) && !process.argv[3]) { console.log(name, 'exists'); continue; }
    const r = await image(name, `${STYLE} Use the reference image only to match this exact character's face, hair, clothing, colors and illustration style: ${who[id]}. Draw only this one person, alone, full body from head to shoes, centered with a generous white margin, ${pose}. ${NO}`, { size: '1024x1536', images: [ref] });
    await save(name, r);
  }
}
console.log('spent so far $', (await spent()).toFixed(4));
