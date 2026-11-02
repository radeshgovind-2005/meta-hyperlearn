import { env } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { Hono } from "hono";
import type { AppEnv, Env } from "../src/server/env";
import { BuildCourseWorkflow, type BuildParams } from "../src/server/workflows/buildCourse";
import { BuildSectionWorkflow, type SectionBuildParams } from "../src/server/workflows/buildSection";
import { buildJobs, commitBuild, completedJobs, retryBuild } from "../src/server/course/buildJobs";
import { verifyBlocks, writeSection } from "../src/server/course/build";
import { getBlocks } from "../src/server/lib/blocks";
import { courses } from "../src/server/routes/courses";
import init from "../migrations/0001_init.sql?raw";
import jobsMigration from "../migrations/0002_section_builds.sql?raw";

const bindings = env as unknown as { DB: D1Database; FILES: R2Bucket };
let appEnv: Env;
let calls: number;
let childCalls: number[];
let childParams: SectionBuildParams[];
const params: BuildParams = { courseId: "course", userId: "owner", runId: "attempt", goal: "understand parallel computing" };

// Executes real workflow callbacks, persists completed steps, and rejects implicit model retries.
function steps() {
  const cache = new Map<string, unknown>();
  return {
    do: async (name: string, configOrFn: unknown, fn?: () => Promise<unknown>) => {
      if (cache.has(name)) return cache.get(name);
      if (["outline", "write", "verify", "rewrite", "recheck"].includes(name)) expect(configOrFn).toMatchObject({ retries: { limit: 0 } });
      const result = await (fn ?? configOrFn as () => Promise<unknown>)();
      cache.set(name, result);
      return result;
    },
    sleep: async () => {},
  } as unknown as WorkflowStep;
}
const event = <T>(payload: T) => ({ payload }) as WorkflowEvent<T>;
const parent = (step = steps()) => BuildCourseWorkflow.prototype.run.call({ env: appEnv } as unknown as BuildCourseWorkflow, event(params), step);
const child = (p: SectionBuildParams, step = steps()) => BuildSectionWorkflow.prototype.run.call({ env: appEnv } as unknown as BuildSectionWorkflow, event(p), step);
const ctx = () => ({ env: appEnv, userId: "owner", apiKey: "test", mode: "demo" as const });
const jsonResponse = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: {} });

beforeEach(async () => {
  const tables = (await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results;
  for (const t of tables) await bindings.DB.exec(`DROP TABLE "${t.name}"`);
  // D1 exec expects statements on single lines.
  for (const migration of [init, jobsMigration]) {
    const sql = migration.replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";").filter((s) => s.trim())) await bindings.DB.prepare(statement).run();
  }
  await bindings.DB.prepare("INSERT INTO courses (id, owner_id, title, status, build_attempt, created_at, updated_at) VALUES ('course', 'owner', 'Parallel Computing', 'building', 'attempt', 1, 1)").run();
  await bindings.DB.prepare("INSERT INTO runs (id, user_id, course_id, graph, status, input, created_at) VALUES ('attempt', 'owner', 'course', 'buildCourse', 'running', '{\"goal\":\"understand parallel computing\"}', 1)").run();
  await bindings.DB.prepare("INSERT INTO sources (id, owner_id, title, filename, kind, mime, r2_key, status, created_at) VALUES ('source', 'owner', 'Slides', 'slides.pdf', 'slides', 'application/pdf', 'slides', 'ready', 1)").run();
  await bindings.DB.prepare("INSERT INTO course_sources VALUES ('course', 'source')").run();
  await bindings.DB.prepare("INSERT INTO chunks (id, source_id, ord, text, page) VALUES ('chunk', 'source', 1, 'Parallel tasks run concurrently.', 1)").run();
  calls = 0; childCalls = []; childParams = [];
  appEnv = {
    ...bindings, ILLUSTRATIONS: "off", META_API_KEY: "test", META_BASE_URL: "https://model.invalid/v1", DEMO_SPEND_CAP_USD: "40",
    USER_DO: { idFromName: () => "id", get: () => ({ getSpend: async () => 0, addSpend: async () => {}, addQuota: async () => ({}) }) },
    BUILD_SECTION: { create: async ({ params: p }: { params: SectionBuildParams }) => {
      childParams.push(p);
      const before = calls;
      await child(p);
      childCalls.push(calls - before);
      return {};
    } },
  } as unknown as Env;
});
afterEach(() => vi.unstubAllGlobals());

describe("free-tier course builds", () => {
  it("exceeds 50 aggregate requests while each child stays below 50 with repair, JSON and API retries", async () => {
    const attempts = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string);
      const type = body.response_format.json_schema.name;
      if (type === "outline") return jsonResponse({ title: "Parallel Computing", description: "From slides", chapters: [{ title: "Parallelism", sections: Array.from({ length: 6 }, (_, k) => ({ title: `Section ${k}`, concept: "parallelism", pages: [{ sourceId: "source", page: 1 }] })) }] });
      const k = childParams.length;
      const key = `${k}:${type}`;
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      // Both structured-output attempts encounter two retryable server errors.
      const phase = (count - 1) % 6;
      if (phase % 3 < 2) return new Response("temporary error", { status: 500 });
      if (phase === 2) return jsonResponse({ invalid: true });
      if (type === "section") return jsonResponse({ blocks: [
        { kind: "text", md: "Parallel tasks run concurrently.", answer: "", chunkIds: ["chunk"], verbatim: true },
        { kind: "exercise", md: "Explain parallel tasks.", answer: "They run concurrently.", chunkIds: ["chunk"], verbatim: false },
      ] });
      return jsonResponse({ verdicts: [{ i: 1, supported: count > 6, reason: count > 6 ? "supported" : "rewrite" }] });
    }));
    const step = steps();
    await expect(parent(step)).resolves.toEqual({ version: 1 });
    expect(calls).toBe(145); // outline + 6 children × 4 operations × 6 HTTP attempts
    expect(childCalls).toEqual([24, 24, 24, 24, 24, 24]);
    expect((await buildJobs(appEnv, "course", "attempt")).every((j) => j.status === "done")).toBe(true);
    const before = calls;
    await parent(step); // replay all completed steps
    await child(childParams[0]); // duplicate delivery also cannot rewrite
    expect(calls).toBe(before);
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM course_versions").first("n")).toBe(1);
  }, 90000);

  it("isolates each block's cited evidence, batches once, and rejects missing verdicts", async () => {
    await bindings.DB.prepare("INSERT INTO chunks (id, source_id, ord, text, page) VALUES ('other', 'source', 2, 'Only other evidence.', 2)").run();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const prompt = JSON.parse(init.body as string).messages[0].content as string;
      const items = prompt.split(/\n\d+\.\n/).slice(1);
      expect(items).toHaveLength(2);
      expect(items[0]).toContain("Parallel tasks run concurrently.");
      expect(items[0]).not.toContain("Only other evidence.");
      expect(items[1]).toContain("Only other evidence.");
      expect(items[1]).not.toContain("Parallel tasks run concurrently.");
      return jsonResponse({ verdicts: [{ i: 1, supported: true, reason: "matches" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await verifyBlocks(appEnv, ctx(), [
      { id: "a", kind: "text", md: "Tasks run together.", cites: [{ sourceId: "source", chunkId: "chunk" }], origin: "source" },
      { id: "b", kind: "text", md: "Other claim is unsupported.", cites: [{ sourceId: "source", chunkId: "other" }], origin: "source" },
      { id: "c", kind: "text", md: "Uncited claim is unsupported.", cites: [], origin: "rephrased" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ checked: 3, supported: 1 });
    expect(result.blocks.map((b) => b.id)).toEqual(["a"]);
    expect(result.problems.join(" ")).toContain("no verdict returned");
    expect(result.problems.join(" ")).toContain("no cited source");
  });

  it("fails partial builds without publishing and ignores old-attempt results", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const type = JSON.parse(init.body as string).response_format.json_schema.name;
      if (type === "outline") return jsonResponse({ title: "Parallel Computing", description: "", chapters: [{ title: "Tasks", sections: [{ title: "Tasks", concept: "tasks", pages: [{ sourceId: "source", page: 1 }] }] }] });
      return new Response("bad key", { status: 401 });
    }));
    // Workflow creation succeeds even when its asynchronous execution subsequently fails.
    appEnv.BUILD_SECTION = { create: async ({ params: p }: { params: SectionBuildParams }) => { await child(p).catch(() => {}); return {}; } } as unknown as Workflow;
    await expect(parent()).rejects.toThrow(/Could not build.*Tasks/);
    expect(await bindings.DB.prepare("SELECT status FROM courses").first("status")).toBe("failed");
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM course_versions").first("n")).toBe(0);
    const jobs = await buildJobs(appEnv, "course", "attempt");
    expect(jobs[0].status).toBe("failed");
    expect(() => completedJobs(jobs, 1)).toThrow(/Tasks/);
    await bindings.DB.prepare("UPDATE courses SET build_attempt = 'fresh', status = 'building'").run();
    await commitBuild(appEnv, params, [{ ...jobs[0], status: "done", block_hashes: '["old"]' }]);
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM course_versions").first("n")).toBe(0);
    expect(await buildJobs(appEnv, "course", "fresh")).toEqual([]);
    expect(completedJobs([], 1)).toBe(false);
  });

  it("claims only failed owner builds, preserves sources and goal, and starts a fresh attempt", async () => {
    await bindings.DB.prepare("UPDATE courses SET status = 'failed'").run();
    const create = vi.fn(async () => ({}));
    appEnv.BUILD = { create } as unknown as Workflow;
    expect(await retryBuild(appEnv, "course", "stranger")).toBeNull();
    const result = await retryBuild(appEnv, "course", "owner");
    expect(result?.runId).not.toBe("attempt");
    expect(create).toHaveBeenCalledWith({ id: result?.runId, params: { ...params, runId: result?.runId } });
    expect(await retryBuild(appEnv, "course", "owner")).toBeNull();
    expect(await bindings.DB.prepare("SELECT COUNT(*) AS n FROM course_sources").first("n")).toBe(1);
    const app = new Hono<AppEnv>().use("*", async (c, next) => { c.set("userId", "stranger"); await next(); }).route("/", courses);
    expect((await app.request("/course/retry", { method: "POST" }, appEnv)).status).toBe(403);
  });

  describe("picture at the top of each page", () => {
    const route = (images: () => Response) => vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/images/generations")) return images();
      const type = JSON.parse(init.body as string).response_format.json_schema.name;
      if (type === "outline") return jsonResponse({ title: "Parallel Computing", description: "", chapters: [{ title: "Tasks", sections: [{ title: "Tasks", concept: "tasks", pages: [{ sourceId: "source", page: 1 }] }] }] });
      if (type === "section") return jsonResponse({ blocks: [
        { kind: "text", md: "Parallel tasks run concurrently.", answer: "", chunkIds: ["chunk"], verbatim: true },
        { kind: "exercise", md: "Explain parallel tasks.", answer: "They run concurrently.", chunkIds: ["chunk"], verbatim: false },
      ] });
      if (type === "illustration_plan") return jsonResponse({ subject: "three workers building one wall", caption: "Workers sharing one job" });
      if (type === "illustration_judgement") return jsonResponse({ ok: true, reason: "clear" });
      return jsonResponse({ verdicts: [{ i: 1, supported: true, reason: "supported" }] });
    });
    const firstBlocks = async () => {
      const job = await bindings.DB.prepare("SELECT block_hashes FROM section_build_jobs").first<{ block_hashes: string }>();
      return getBlocks(appEnv, JSON.parse(job!.block_hashes));
    };

    it("puts a generated figure first in every new section", async () => {
      appEnv.ILLUSTRATIONS = undefined;
      vi.stubGlobal("fetch", route(() => Response.json({ data: [{ b64_json: "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" }], output_format: "webp" })));
      await expect(parent()).resolves.toEqual({ version: 1 });
      const blocks = await firstBlocks();
      expect(blocks.map((b) => b.kind)).toEqual(["figure", "text", "exercise"]);
      expect(blocks[0]).toMatchObject({ generated: true, caption: "Workers sharing one job" });
      expect(await bindings.FILES.head((blocks[0] as { r2Key: string }).r2Key)).not.toBeNull();
    }, 30000);

    it("still publishes the page when the picture cannot be drawn", async () => {
      appEnv.ILLUSTRATIONS = undefined;
      vi.stubGlobal("fetch", route(() => new Response("overloaded", { status: 503 })));
      await expect(parent()).resolves.toEqual({ version: 1 });
      expect((await firstBlocks()).map((b) => b.kind)).toEqual(["text", "exercise"]);
    }, 30000);
  });

  it("rejects oversized section drafts instead of expanding the request budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ blocks: [
      ...Array.from({ length: 7 }, () => ({ kind: "text", md: "Text.", answer: "", chunkIds: ["chunk"], verbatim: true })),
      { kind: "exercise", md: "Question?", answer: "Answer.", chunkIds: ["chunk"], verbatim: false },
    ] })));
    await expect(writeSection(appEnv, ctx(), { title: "Tasks", concept: "tasks", chunks: [], sources: [], previousTitles: [] })).rejects.toThrow(/validation/);
  });
});
