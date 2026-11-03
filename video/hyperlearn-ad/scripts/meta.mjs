// Server-side Meta Model API client for asset work. Reads ../../.dev.vars with dotenv's parser.
// Never prints keys, headers or signed URLs. Every successful response is cached by request hash,
// and every billed call is appended to cache/usage.jsonl (provider-reported tokens + estimate).
import { parse } from 'dotenv';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = parse(await readFile(path.resolve(ROOT, '../../.dev.vars')));
const BASE = env.META_BASE_URL || 'https://api.meta.ai/v1';
const KEY = env.META_API_KEY;
if (!KEY) throw new Error('META_API_KEY missing in .dev.vars');

// Verified 2026-11-03: dev.meta.ai/docs/image-generation ($0.01 per image) and the repo's models.ts (Spark $1.25 / $4.25 per M tokens).
export const PRICES = { 'muse-spark-1.3': [1.25, 4.25], imageEach: 0.01 };
export const SPEND_CAP_USD = 3;

const CACHE = path.join(ROOT, 'cache');
await mkdir(CACHE, { recursive: true });
const USAGE = path.join(CACHE, 'usage.jsonl');

export async function spent() {
  if (!existsSync(USAGE)) return 0;
  return (await readFile(USAGE, 'utf8')).trim().split('\n').filter(Boolean).reduce((s, l) => s + JSON.parse(l).estUsd, 0);
}

async function post(route, body, { tries = 3, label }) {
  const hash = createHash('sha256').update(route + JSON.stringify(body)).digest('hex').slice(0, 24);
  const file = path.join(CACHE, `${label}-${hash}.json`);
  if (existsSync(file)) return { json: JSON.parse(await readFile(file, 'utf8')), cached: true };
  if ((await spent()) >= SPEND_CAP_USD - 0.05) throw new Error('Spend cap reached; refusing new calls');
  let last;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(BASE + route, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const json = await res.json();
      await writeFile(file, JSON.stringify(json));
      return { json, cached: false };
    }
    last = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`Meta API ${route} failed: ${last}`);
}

/** Muse Spark chat completion. `content` may be a string or an OpenAI-style content array (text + image_url). */
export async function spark(label, messages, { schema, effort = 'medium', model = 'muse-spark-1.3' } = {}) {
  const body = { model, messages, reasoning_effort: effort };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: label.replace(/\W/g, '_'), schema, strict: true } };
  const { json, cached } = await post('/chat/completions', body, { label: `spark-${label}` });
  const u = json.usage ?? {};
  if (!cached) {
    const [pi, po] = PRICES[model];
    const estUsd = ((u.prompt_tokens ?? 0) * pi + (u.completion_tokens ?? 0) * po) / 1e6;
    await appendFile(USAGE, JSON.stringify({ at: new Date().toISOString(), kind: 'chat', model, label, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, providerUsage: u, estUsd }) + '\n');
  }
  const text = json.choices?.[0]?.message?.content ?? '';
  return schema ? JSON.parse(text) : text;
}

/** One Muse Image picture. `images` are optional reference images as data URLs. Returns { bytes, ext, meta }. */
export async function image(label, prompt, { size = '1536x1024', images, format = 'png', effort = 'high' } = {}) {
  const body = { model: 'muse-image-1.0', prompt, n: 1, size, response_format: 'b64_json', output_format: format, reasoning_strength: effort };
  if (images?.length) body.images = images.map((u) => ({ image_url: u }));
  const route = images?.length ? '/images/edits' : '/images/generations';
  const { json, cached } = await post(route, body, { label: `image-${label}`, tries: 2 });
  if (!cached) await appendFile(USAGE, JSON.stringify({ at: new Date().toISOString(), kind: 'image', model: 'muse-image-1.0', label, providerUsage: json.usage ?? null, estUsd: PRICES.imageEach }) + '\n');
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('Muse Image returned no picture');
  return { bytes: Buffer.from(b64, 'base64'), ext: json.output_format ?? format, cached, meta: { size: json.size, background: json.background, quality: json.quality, usage: json.usage } };
}

export const dataUrl = async (file) => `data:image/${path.extname(file).slice(1).replace('jpg', 'jpeg')};base64,${(await readFile(file)).toString('base64')}`;
export { ROOT };

/** Muse Voice Transcribe (speech → text), same request shape as src/server/ai/asr.ts. WAV mono 16-bit, 16 kHz. */
export async function transcribe(label, wavPath) {
  const wav = await readFile(wavPath);
  const hash = createHash('sha256').update(wav).digest('hex').slice(0, 24);
  const file = path.join(CACHE, `asr-${label}-${hash}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', mode: 'ENDPOINTING', audioEncoding: 'WAV' })], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  const res = await fetch(BASE + '/asr/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form });
  if (!res.ok) throw new Error(`ASR failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  await writeFile(file, JSON.stringify(json));
  const estUsd = ((json.audioDurationMs ?? 0) / 3_600_000) * 0.18;
  await appendFile(USAGE, JSON.stringify({ at: new Date().toISOString(), kind: 'asr', model: 'muse-voice-transcribe-1.0', label, audioMs: json.audioDurationMs, estUsd }) + '\n');
  return json;
}
