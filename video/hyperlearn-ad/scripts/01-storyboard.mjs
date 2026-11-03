// Muse Spark: refine the storyboard and write one consistent art-direction sheet + image prompts.
import { spark, spent } from './meta.mjs';
import { writeFile, readFile } from 'node:fs/promises';

const draft = await readFile(new URL('../docs/storyboard-draft.md', import.meta.url), 'utf8');
const str = { type: 'string' };
const arr = (items) => ({ type: 'array', items });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const schema = obj({
  artDirection: obj({ summary: str, palette: arr(str), illustrationStyle: str, lighting: str, perspective: str, motionPrinciples: arr(str), avoid: arr(str) }),
  characters: arr(obj({ id: str, appearance: str, role: str })),
  imagePrompts: arr(obj({ id: str, purpose: str, size: str, prompt: str })),
  storyboard: arr(obj({ start: { type: 'number' }, end: { type: 'number' }, visual: str, motion: str, sound: str, onScreenText: str, risk: str })),
});

const system = `You are an art director for a 30-second product film. Return only the JSON requested.
The film is for HyperLearn (a study app that turns a student's own material into an adaptive, source-cited course). Brand blue #0A5CFF, ink #1C2B33, body #3E4C59, muted #5B6B7A, border #E3E6EA, sidebar #F6F7F9, highlight #FFF3BF, success #0A7A3D. Fonts: Figtree (UI), Source Serif 4 (course text).
Raster illustrations come from an image model that must NOT draw any text, letters, numbers, logos, UI or brand marks. Text, logos, diagrams and the globe are built separately as vector layers.
Characters must be cut out from a flat pure-white (#FFFFFF) background, full body, no ground shadow, no props touching the frame edge, so they can be keyed and composited.
Use one shared style sentence verbatim at the start of every image prompt so all assets match.
Tone: warm, human, confident; flat geometric illustration with soft shapes; restrained; no neon, no glowing brains, no robots, no particles, no gradients-heavy glass.
Show a temporary pause in progress, never humiliation or inferiority.`;

const out = await spark('storyboard', [
  { role: 'system', content: system },
  { role: 'user', content: `Refine this storyboard. Keep the timing, the narration and the factual constraints exactly. Improve visual continuity and motion ideas only where they can be built with SVG/React animation plus a few character cut-outs. Write 4 characters (diverse ages and backgrounds: a university student, a mid-career worker retraining, a teacher, a younger self-taught learner) and image prompts for: one character lineup sheet (all four, evenly spaced, same scale), and for each character two poses: "walking forward" and "paused, looking at the path ahead, thoughtful" (the pause pose is only needed for the student). Keep prompts under 120 words each.\n\n<draft>\n${draft}\n</draft>` },
], { schema, effort: 'high' });

await writeFile(new URL('../docs/storyboard-spark.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.artDirection, null, 1));
console.log(out.characters.map((c) => `${c.id}: ${c.appearance}`).join('\n'));
console.log(out.imagePrompts.map((p) => `${p.id} [${p.size}]`).join('\n'));
console.log('spent so far $', (await spent()).toFixed(4));
