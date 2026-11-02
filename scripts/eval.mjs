#!/usr/bin/env node
// LangSmith eval: runs real "change anything" requests on the demo course (then undoes them)
// and scores citation faithfulness: the share of rewritten sentences that an independent
// judge (Muse Spark, not the open-weight verifier used inside the loop) finds supported by
// the cited source passages. Usage: node scripts/eval.mjs [--remote]
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { RunTree } from "langsmith/run_trees";

const remote = process.argv.includes("--remote");
const BASE = process.env.SEED_BASE ?? (remote ? "https://hyperlearn.radesh-govind.com" : "http://localhost:5173");
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const TOKEN = vars.SEED_TOKEN;
const client = new Client({ apiKey: vars.LANGSMITH_API_KEY });
const DATASET = "hyperlearn-mutations";

const REQUESTS = [
  "This is too complex. Simplify it.",
  "Simplify it and give me an interactive example I can play with.",
  "Explain it with an analogy.",
  "Show me more worked examples.",
  "Focus this on what the exam asks.",
  "I don't get the notation. Explain the symbols first.",
  "Make it shorter.",
  "Give me an interactive example.",
  "Rewrite this for someone who missed the lecture.",
  "Explain why this works, step by step.",
  "Too dense. Break it into simpler sentences.",
  "Simpler please, and add a plot I can play with.",
  "Explain it like I'm new to linear algebra.",
  "What should I write on the exam for this?",
  "Use a concrete example with numbers.",
  "This is confusing. Simplify it.",
  "Connect this to the previous section.",
  "Make it more precise.",
];

async function admin(path, opts = {}) {
  const res = await fetch(`${BASE}/api/admin${path}`, { method: opts.body ? "POST" : "GET", headers: { "X-Seed-Token": TOKEN, "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return opts.stream ? res : res.json();
}
async function stream(path, body) {
  const res = await admin(path, { body, stream: true });
  const events = [];
  for (const line of (await res.text()).split("\n")) if (line.trim()) events.push(JSON.parse(line));
  return events;
}

// pick a demo course owned by the demo owner, and its text blocks
const courses = (await admin("/courses")).items.filter((c) => c.is_demo || c.role === "owner");
const course = courses[0];
if (!course) throw new Error("no demo course; run npm run seed:* first");
const outline = await admin(`/courses/${course.id}`);
const targets = [];
for (const s of outline.sections) {
  const sec = await admin(`/courses/${course.id}/sections/${s.id}`);
  for (const b of sec.section.blocks) if (b.kind === "text") targets.push({ sectionId: s.id, blockId: b.id, title: s.title, md: b.md });
}
const chunkText = new Map();
for (const src of outline.sources) {
  const d = await admin(`/sources/${src.id}`);
  for (const ch of d.chunks) chunkText.set(ch.id, ch.text);
}

// 18 requests spread over the course's paragraphs
const examples = REQUESTS.map((request, i) => ({ request, ...targets[(i * 7) % targets.length] }));
const inputsOf = (e) => ({ courseId: course.id, sectionId: e.sectionId, blockId: e.blockId, request: e.request, paragraph: e.md });
async function judge(sentence, evidence) {
  const res = await fetch(`${vars.META_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${vars.META_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "muse-spark-1.3",
      max_completion_tokens: 300,
      response_format: { type: "json_schema", json_schema: { name: "v", schema: { type: "object", properties: { supported: { type: "boolean" } }, required: ["supported"] } } },
      messages: [{ role: "user", content: `Evidence:\n${evidence.join("\n---\n")}\n\nIs this sentence supported by the evidence (paraphrase, simplification or direct consequence counts; added facts do not)? Sentence: "${sentence}". Answer JSON.` }],
    }),
  });
  const j = await res.json();
  return JSON.parse(j.choices[0].message.content).supported === true;
}

const target = async (inputs) => {
  const events = await stream(`/courses/${inputs.courseId}/sections/${inputs.sectionId}/mutate`, { blockId: inputs.blockId, request: inputs.request });
  const waiting = events.find((e) => e.type === "run.waiting");
  const start = events.find((e) => e.type === "run.start");
  if (start?.runId && waiting) await stream(`/runs/${start.runId}/resume`, { decision: "undo" });
  if (!waiting) return { changed: [], summary: [], failed: true };
  const before = new Map(waiting.before.blocks.map((b) => [b.id, JSON.stringify(b)]));
  const changed = waiting.section.blocks.filter((b) => b.kind === "text" && before.get(b.id) !== JSON.stringify(b));
  return { changed, summary: waiting.summary, widgets: waiting.section.blocks.filter((b) => b.kind === "widget" && !before.has(b.id)).length };
};

const faithfulness = async ({ outputs }) => {
  let total = 0;
  let ok = 0;
  for (const b of outputs.changed ?? []) {
    const evidence = b.cites.map((c) => chunkText.get(c.chunkId)).filter(Boolean);
    const sentences = b.md.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [b.md];
    for (const s of sentences) {
      total++;
      if (evidence.length && (await judge(s.trim(), evidence))) ok++;
    }
  }
  return { key: "citation_faithfulness", score: total ? ok / total : null, comment: `${ok}/${total} sentences supported` };
};

let sum = 0;
let n = 0;
let supported = 0;
let total = 0;
let experiment;
const rows = [];
try {
  // full LangSmith keys: dataset + experiment
  const existing = await client.hasDataset({ datasetName: DATASET });
  const ds = existing ? await client.readDataset({ datasetName: DATASET }) : await client.createDataset(DATASET, { description: "Real 'change anything' requests on the HyperLearn demo course" });
  if (!existing) await client.createExamples({ datasetId: ds.id, inputs: examples.map(inputsOf) });
  const results = await evaluate(target, { data: DATASET, evaluators: [faithfulness], experimentPrefix: "mutate-verify-loop", maxConcurrency: 2, client });
  experiment = results.experimentName;
  for await (const r of results) {
    const s = r.evaluationResults.results[0]?.score;
    if (typeof s === "number") {
      sum += s;
      n++;
    }
  }
} catch (err) {
  if (!/403|not allowed/i.test(String(err))) throw err;
  // tracing-only keys: run the same eval here and log each scored run as a LangSmith trace
  console.log("LangSmith key is tracing-only; logging eval runs as traces in project hyperlearn-eval");
  experiment = `hyperlearn-eval traces ${new Date().toISOString().slice(0, 16)}`;
  for (const [i, e] of examples.entries()) {
    const inputs = inputsOf(e);
    const rt = new RunTree({ name: "mutate-eval", run_type: "chain", inputs, project_name: "hyperlearn-eval", client, metadata: { example: i } });
    await rt.postRun();
    let outputs;
    let res;
    try {
      outputs = await target(inputs);
      res = await faithfulness({ outputs });
    } catch (err2) {
      outputs = { error: String(err2) };
      res = { score: null, comment: String(err2).slice(0, 200) };
    }
    await rt.end({ ...outputs, citation_faithfulness: res.score, comment: res.comment });
    await rt.patchRun();
    const m = /(\d+)\/(\d+)/.exec(res.comment ?? "");
    if (m) {
      supported += Number(m[1]);
      total += Number(m[2]);
    }
    if (typeof res.score === "number") {
      sum += res.score;
      n++;
    }
    rows.push({ request: e.request, section: e.title, score: res.score, comment: res.comment, summary: outputs.summary });
    console.log(`${i + 1}/${examples.length} ${e.request} → ${res.comment}`);
  }
  await client.awaitPendingTraceBatches?.();
}
const score = n ? sum / n : 0;
console.log(`citation faithfulness: ${(score * 100).toFixed(1)}% mean over ${n} mutations${total ? ` (${supported}/${total} sentences)` : ""}`);
writeFileSync("eval-result.json", JSON.stringify({ score, n, supported, total, experiment, rows, at: new Date().toISOString() }, null, 2));
