// Muse Spark reviews the full-timeline contact sheets against the art direction and the factual constraints.
import { spark, dataUrl, spent } from './meta.mjs';
import { writeFileSync } from 'node:fs';
const tag = process.argv[2] ?? 'r1';
const str = { type: 'string' };
const schema = { type: 'object', additionalProperties: false, required: ['overall', 'issues'], properties: {
  overall: str,
  issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['time', 'orientation', 'severity', 'problem', 'fix'], properties: { time: str, orientation: str, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: str, fix: str } } },
} };
const out = await spark(`review-${tag}`, [
  { role: 'system', content: 'You are a demanding creative director reviewing a 30-second product film before release. Be concrete and brief. Only report problems you can actually see in the frames; do not invent issues. Frames are timestamped (seconds, yellow label top-left; that label and its black box are a review overlay, not part of the film).' },
  { role: 'user', content: [
    { type: 'text', text: `Film: HyperLearn (turns a student's own material into an adaptive, source-cited course). Brand blue #0A5CFF, ink #1C2B33, Figtree, generous negative space, no gradients/neon. Story: changing world → different routes, one person pauses at a gap → a bridge becomes the HyperLearn logo → real app footage (citation click to the highlighted source; asking for a simpler explanation) → animated agent graph (Context → Text ‖ Widget → Verify → Save, Repair only if a check fails) → real result with an interactive plot → practice, re-planned path, share follow/copy → end card. App footage is genuine and must not be altered. Review image 1 (16:9) and image 2 (9:16). List the most important visual, typographic, legibility, continuity or truthfulness issues with a concrete fix each (max 12).` },
    { type: 'image_url', image_url: { url: await dataUrl('out/stills/sheet_RH.jpg') } },
    { type: 'image_url', image_url: { url: await dataUrl('out/stills/sheet_RV.jpg') } },
  ] },
], { schema, effort: 'high' });
writeFileSync(`docs/spark-review-${tag}.json`, JSON.stringify(out, null, 2));
console.log(out.overall); for (const i of out.issues) console.log(`- [${i.severity}] ${i.orientation} ${i.time}: ${i.problem} → ${i.fix}`);
console.log('spent so far $', (await spent()).toFixed(4));
