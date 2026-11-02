#!/usr/bin/env node
// Builds the demo material in seed/: two slide decks and a past exam (PDF via Playwright),
// plus a synthetic lecture recording (macOS `say` + ffmpeg). Usage: npm run seed:make
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { COURSE, EXAM, L06, L07, NARRATION } from "./seed-content.mjs";

const out = join(process.cwd(), "seed");
mkdirSync(out, { recursive: true });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FOOT = "Written for HyperLearn · CC BY 4.0";

function deckHtml(deck) {
  const pages = deck.slides
    .map(
      (s, i) => `<section class="slide">
  <h1>${esc(s.h)}</h1>
  <ul>${s.b.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
  <footer><span>${esc(COURSE)} · ${esc(deck.title)}</span><span>${FOOT}</span><span>${i + 1}</span></footer>
</section>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 1280px 720px; margin: 0; }
body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; color: #1c2b33; }
.slide { width: 1280px; height: 720px; box-sizing: border-box; padding: 72px 96px; position: relative; page-break-after: always; }
h1 { font-size: 46px; margin: 0 0 40px; color: #0a2a66; }
ul { margin: 0; padding-left: 36px; }
li { font-size: 30px; line-height: 1.45; margin-bottom: 18px; }
footer { position: absolute; left: 96px; right: 96px; bottom: 36px; display: flex; justify-content: space-between; font-size: 16px; color: #5b6b7a; }
</style></head><body>${pages}</body></html>`;
}

function examHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 22mm 20mm; }
body { font-family: "Times New Roman", serif; color: #111; font-size: 13pt; line-height: 1.5; }
h1 { font-size: 20pt; margin: 0 0 4pt; } .sub { color: #444; margin-bottom: 14pt; }
.q { margin: 14pt 0; } .pts { float: right; font-weight: bold; } .foot { margin-top: 30pt; font-size: 9pt; color: #666; }
</style></head><body>
<h1>${esc(EXAM.title)}</h1>
<div class="sub">${EXAM.instructions.map(esc).join("<br>")}</div>
${EXAM.questions.map((q, i) => `<div class="q"><span class="pts">[${q.pts} pts]</span><strong>Question ${i + 1}.</strong> ${esc(q.q)}</div>`).join("\n")}
<div class="foot">${FOOT}</div>
</body></html>`;
}

async function pdf(browser, html, file, opts) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: join(out, file), printBackground: true, ...opts });
  await page.close();
  console.log("wrote", file);
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
await pdf(browser, deckHtml(L06), L06.file, { width: "1280px", height: "720px" });
await pdf(browser, deckHtml(L07), L07.file, { width: "1280px", height: "720px" });
await pdf(browser, examHtml(), EXAM.file, { format: "A4" });
await browser.close();

if (process.platform === "darwin") {
  const aiff = join(out, "L07_lecture.aiff");
  const m4a = join(out, "L07_lecture.m4a");
  execFileSync("say", ["-v", "Samantha", "-r", "165", "-o", aiff, NARRATION.join(" [[slnc 700]] ")]);
  if (existsSync(m4a)) rmSync(m4a);
  execFileSync("ffmpeg", ["-loglevel", "error", "-i", aiff, "-ac", "1", "-c:a", "aac", "-b:a", "64k", m4a]);
  rmSync(aiff);
  console.log("wrote L07_lecture.m4a (synthetic narration)");
} else {
  console.log("skipping the recording: needs macOS `say`");
}
writeFileSync(join(out, "LICENSE.txt"), "The demo material in this folder was written for HyperLearn and is released under CC BY 4.0.\nThe lecture recording is a synthetic narration (macOS text-to-speech) of the L07 slides.\n");
