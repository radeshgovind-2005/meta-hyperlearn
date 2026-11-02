import { Hono } from "hono";
import { clerkMiddleware } from "@clerk/hono";
import type { AppEnv } from "./env";
import { requireUser, verifyFileSig } from "./lib/http";
import { me } from "./routes/me";
import { sources } from "./routes/sources";
import { courses } from "./routes/courses";
import { practice } from "./routes/practice";
import { invitePublic, share } from "./routes/share";
import { tutor } from "./routes/tutor";
import { voice } from "./routes/voice";
import { admin } from "./routes/admin";
import { pingOpenModel, openModelConfigured, openModelLabel } from "./ai/openModel";

export { CourseDO } from "./do/CourseDO";
export { UserDO } from "./do/UserDO";
export { IngestWorkflow } from "./workflows/ingest";
export { BuildCourseWorkflow } from "./workflows/buildCourse";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(err);
  if ((err as { name?: string }).name === "ZodError") return c.json({ error: "Invalid request", issues: (err as unknown as { issues: unknown }).issues }, 400);
  return c.json({ error: (err as Error).message ?? "Unexpected error" }, 500);
});

// ---- public ----

app.get("/api/health", async (c) => {
  const env = c.env;
  const check = async (fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      const detail = await fn();
      return { ok: true, ms: Date.now() - t, ...(detail && typeof detail === "object" ? detail : {}) };
    } catch (err) {
      return { ok: false, ms: Date.now() - t, error: String((err as Error).message ?? err).slice(0, 200) };
    }
  };
  const [d1, r2, vectorize, meta, openWeight] = await Promise.all([
    check(() => env.DB.prepare("SELECT COUNT(*) AS n FROM courses").first()),
    check(() => env.FILES.head("health")),
    check(async () => { const d = (await env.VECTORS.describe()) as unknown as { vectorCount?: number; vectorsCount?: number }; return { vectors: d.vectorCount ?? d.vectorsCount }; }),
    check(async () => {
      if (!env.META_API_KEY) throw new Error("META_API_KEY not set");
      const r = await fetch(`${env.META_BASE_URL}/models`, { headers: { Authorization: `Bearer ${env.META_API_KEY}` }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      return {};
    }),
    check(async () => {
      if (!openModelConfigured(env)) throw new Error("OPEN_MODEL_* not set; Muse Spark verifies instead");
      if (!(await pingOpenModel(env))) throw new Error("endpoint not reachable");
      return { model: openModelLabel(env) };
    }),
  ]);
  const checks = { d1, r2, vectorize, meta, openWeight };
  const ok = d1.ok && r2.ok && vectorize.ok && meta.ok;
  return c.json({ ok, checks, time: new Date().toISOString() }, ok ? 200 : 503);
});

app.get("/api/config", (c) => c.json({ clerkPublishableKey: c.env.CLERK_PUBLISHABLE_KEY, widgetsOrigin: c.env.WIDGETS_ORIGIN }));

app.get("/api/files/*", async (c) => {
  const key = decodeURIComponent(c.req.path.slice("/api/files/".length));
  if (!(await verifyFileSig(c.env, key, c.req.query("exp") ?? "", c.req.query("sig") ?? ""))) return c.json({ error: "Link expired" }, 403);
  const range = c.req.header("Range");
  let r2Range: R2Range | undefined;
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? Number(m[1]) : undefined;
    const end = m[2] ? Number(m[2]) : undefined;
    r2Range = start !== undefined ? { offset: start, ...(end !== undefined ? { length: end - start + 1 } : {}) } : { suffix: end ?? 0 };
  }
  const obj = await c.env.FILES.get(key, r2Range ? { range: r2Range } : {});
  if (!obj) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Accept-Ranges", "bytes");
  if (r2Range && "offset" in r2Range) {
    const start = r2Range.offset ?? 0;
    const len = (obj as R2ObjectBody).range && "length" in (obj as R2ObjectBody).range! ? ((obj as R2ObjectBody).range as { length: number }).length : obj.size - start;
    headers.set("Content-Range", `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set("Content-Length", String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
});

app.route("/api/invite", invitePublic);
app.route("/api/admin", admin);

// ---- signed in ----

app.use("/api/*", clerkMiddleware());
app.use("/api/*", requireUser);
app.route("/api/me", me);
app.route("/api/sources", sources);
app.route("/api/courses", courses);
app.route("/api/practice", practice);
app.route("/api/tutor", tutor);
app.route("/api/voice", voice);
app.route("/api", share);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
