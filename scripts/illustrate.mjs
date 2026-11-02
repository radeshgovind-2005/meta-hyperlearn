#!/usr/bin/env node
// Draws the picture at the top of every page of the demo course (or --course <id>) that has none yet.
// Muse Image costs $0.01 a picture. Usage: npm run illustrate:prod
import { readFileSync } from "node:fs";

const remote = process.argv.includes("--remote");
const BASE = process.env.SEED_BASE ?? (remote ? "https://hyperlearn.radesh-govind.com" : "http://localhost:5173");
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const TOKEN = process.env.SEED_TOKEN ?? vars.SEED_TOKEN;
if (!TOKEN) throw new Error("SEED_TOKEN missing in .dev.vars");

async function call(path, method = "GET") {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: { "X-Seed-Token": TOKEN, "Content-Type": "application/json" },
    body: method === "POST" ? "{}" : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const flag = process.argv.indexOf("--course");
let courseId = flag > 0 ? process.argv[flag + 1] : undefined;
if (!courseId) {
  const list = await call("/courses");
  courseId = list.items.find((c) => c.is_demo)?.id;
  if (!courseId) throw new Error("no demo course found; pass --course <id>");
}
const { sections } = await call(`/courses/${courseId}`);
console.log(`${sections.length} sections in ${courseId}`);
let added = 0;
for (const s of sections) {
  const t = Date.now();
  try {
    const r = await call(`/courses/${courseId}/sections/${s.id}/illustrate`, "POST");
    if (r.added) added++;
    console.log(`${r.added ? "drew" : "kept"} ${s.title} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`FAILED ${s.title}: ${err.message}`);
  }
}
console.log(`${added} pictures added`);
