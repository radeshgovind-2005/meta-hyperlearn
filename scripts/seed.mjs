#!/usr/bin/env node
// Seeds the demo course from seed/ through the admin API (acting as the demo owner).
// Usage: npm run seed:prod   (or seed:local against http://localhost:5173)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const remote = process.argv.includes("--remote");
const BASE = process.env.SEED_BASE ?? (remote ? "https://hyperlearn.radesh-govind.com" : "http://localhost:5173");
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const TOKEN = process.env.SEED_TOKEN ?? vars.SEED_TOKEN;
if (!TOKEN) throw new Error("SEED_TOKEN missing in .dev.vars");

async function call(path, opts = {}) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    method: opts.method ?? (opts.body || opts.raw ? "POST" : "GET"),
    headers: { "X-Seed-Token": TOKEN, ...(opts.raw ? { "Content-Type": opts.type ?? "application/octet-stream" } : { "Content-Type": "application/json" }) },
    body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KIND = (f) => (/\.(m4a|mp3|wav)$/i.test(f) ? "audio" : /midterm|exam/i.test(f) ? "exam" : "slides");
const files = readdirSync("seed").filter((f) => /\.(pdf|m4a|mp3|wav)$/i.test(f)).sort();
const work = mkdtempSync(join(tmpdir(), "hyperlearn-seed-"));
const ids = [];

for (const f of files) {
  const path = join("seed", f);
  const kind = KIND(f);
  const mime = kind === "audio" ? "audio/mp4" : "application/pdf";
  const { id } = await call("/sources", { body: { filename: f, kind, mime, size: statSync(path).size } });
  console.log(`source ${f} → ${id}`);
  if (kind === "audio") {
    // 16 kHz mono WAV parts of at most 9 minutes (the transcription API takes up to 10)
    execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "segment", "-segment_time", "540", "-c:a", "pcm_s16le", join(work, `${id}-%03d.wav`)]);
    const parts = readdirSync(work).filter((p) => p.startsWith(id)).sort();
    for (let k = 0; k < parts.length; k++) {
      await call(`/sources/${id}/segments/${k}?offsetMs=${k * 540_000}`, { method: "PUT", raw: readFileSync(join(work, parts[k])), type: "audio/wav" });
    }
  } else {
    execFileSync("pdftoppm", ["-r", "110", "-png", path, join(work, id)]);
    const pages = readdirSync(work).filter((p) => p.startsWith(id) && p.endsWith(".png")).sort();
    for (const p of pages) {
      const n = Number(p.match(/-(\d+)\.png$/)[1]);
      await call(`/sources/${id}/pages/${n}`, { method: "PUT", raw: readFileSync(join(work, p)), type: "image/png" });
    }
  }
  await call(`/sources/${id}/file`, { method: "PUT", raw: readFileSync(path), type: mime });
  await call(`/sources/${id}/ingest`, { body: {} });
  ids.push(id);
}

for (;;) {
  const states = await Promise.all(ids.map((id) => call(`/sources/${id}`).then((r) => r.source)));
  console.log(states.map((s) => `${s.filename}: ${s.status}${s.progress ? ` (${s.progress})` : ""}`).join(" | "));
  if (states.some((s) => s.status === "failed")) throw new Error("ingest failed");
  if (states.every((s) => s.status === "ready")) break;
  await sleep(5000);
}

const course = await call("/courses", { body: { title: "Linear Algebra, MAT201", sourceIds: ids, goal: "follow the lectures closely; exam: Midterm 2025" } });
console.log("course", course.id);
for (;;) {
  const r = await call(`/courses/${course.id}`);
  console.log(`course: ${r.course.status}${r.course.progress ? ` (${r.course.progress})` : ""}`);
  if (r.course.status === "failed") throw new Error("course build failed");
  if (r.course.status === "ready") break;
  await sleep(6000);
}
await call(`/courses/${course.id}/demo`, { body: {} });
console.log(`demo course ready: ${BASE}/courses/${course.id}`);
