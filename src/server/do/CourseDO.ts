import { DurableObject } from "cloudflare:workers";
import { Command } from "@langchain/langgraph";
import type { Env } from "../env";
import type { RunEvent, Section } from "../../shared/types";
import { getAiCtx } from "../ai/meta";
import { DurableSaver, type CheckpointStore } from "../graphs/checkpointer";
import { buildMutateGraph, MUTATE_STEPS } from "../graphs/mutate";
import { ADAPT_STEPS, buildAdaptGraph } from "../graphs/adapt";
import { endTrace, startTrace } from "../lib/tracing";
import { finishRun, recordRunTrace } from "../lib/runs";
import { MODEL_LABELS } from "../ai/models";
import { flushQuota, meteredEnv } from "../lib/quota";

export type MutateInput = { runId: string; userId: string; courseId: string; sectionId: string; blockId: string; request: string; concept: string; before: Section };
export type AdaptInput = {
  runId: string;
  userId: string;
  courseId: string;
  isOwner: boolean;
  question: { prompt: string; concept: string; sectionId: string | null };
  grade: { feedback: string; mistake: string; errorConcept: string };
};

const CHUNK = 900_000;

/** One per course: live sync over WebSockets, agent runs, and LangGraph checkpoints. */
export class CourseDO extends DurableObject<Env> {
  private saver: DurableSaver;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    (this as unknown as { env: Env }).env = meteredEnv(env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, graph TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL)");
    const store: CheckpointStore = {
      load: () => {
        const rows = sql.exec<{ k: string; v: string }>("SELECT k, v FROM kv WHERE k LIKE 'lg:%' ORDER BY k").toArray();
        return rows.length ? rows.map((r) => r.v).join("") : null;
      },
      save: (s) => {
        sql.exec("DELETE FROM kv WHERE k LIKE 'lg:%'");
        for (let i = 0, n = 0; i < s.length; i += CHUNK, n++) sql.exec("INSERT INTO kv (k, v) VALUES (?, ?)", `lg:${String(n).padStart(4, "0")}`, s.slice(i, i + CHUNK));
      },
    };
    this.saver = new DurableSaver(store);
  }

  // ---- WebSockets (hibernation API) ----

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const userId = request.headers.get("X-User-Id") ?? "anon";
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [userId]);
      pair[1].serializeAttachment({ userId });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, "closing");
    } catch {
      // already closed
    }
  }

  private broadcast(event: RunEvent, onlyUser?: string) {
    const data = JSON.stringify(event);
    for (const ws of onlyUser ? this.ctx.getWebSockets(onlyUser) : this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // socket gone
      }
    }
  }

  /** Called by the Worker after a course version changes (followers get live updates). */
  async notifyVersion(courseId: string, version: number, summary: string) {
    this.broadcast({ type: "course.version", courseId, version, summary });
  }

  // ---- Agent runs, streamed as NDJSON while they run ----

  private stream(userId: string, run: (emit: (e: RunEvent) => void) => Promise<void>): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let open = true;
    const emit = (e: RunEvent) => {
      this.broadcast(e, userId);
      // owners' kept changes are live for every follower
      if (e.type === "run.done" && e.status === "kept" && e.courseVersion) this.broadcast({ type: "course.version", courseId: "", version: e.courseVersion, summary: e.message ?? "" });
      if (open) writer.write(enc.encode(`${JSON.stringify(e)}\n`)).catch(() => { open = false; });
    };
    const work = run(emit)
      .catch((err) => {
        console.error("run failed", err);
        emit({ type: "run.done", runId: "", status: "failed", message: friendlyError(err) });
      })
      .finally(() => {
        open = false;
        writer.close().catch(() => {});
      });
    this.ctx.waitUntil(work);
    return new Response(readable, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  }

  async startMutate(input: MutateInput): Promise<Response> {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO runs (id, graph, user_id, status) VALUES (?, 'mutate', ?, 'running')", input.runId, input.userId);
    return this.stream(input.userId, async (emit) => {
      emit({ type: "run.start", runId: input.runId, graph: "mutate", steps: MUTATE_STEPS });
      await this.invokeGraph("mutate", input.runId, input.userId, emit, input);
    });
  }

  async startAdapt(input: AdaptInput): Promise<Response> {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO runs (id, graph, user_id, status) VALUES (?, 'adapt', ?, 'running')", input.runId, input.userId);
    return this.stream(input.userId, async (emit) => {
      emit({ type: "run.start", runId: input.runId, graph: "adapt", steps: ADAPT_STEPS });
      await this.invokeGraph("adapt", input.runId, input.userId, emit, input);
    });
  }

  /** Keep / Undo: resumes the interrupted graph. */
  async resume(runId: string, userId: string, decision: "keep" | "undo"): Promise<Response> {
    const row = this.ctx.storage.sql.exec<{ graph: string; user_id: string; status: string }>("SELECT graph, user_id, status FROM runs WHERE id = ?", runId).toArray()[0];
    if (!row) return Response.json({ error: "Run not found" }, { status: 404 });
    if (row.user_id !== userId) return Response.json({ error: "Not your run" }, { status: 403 });
    if (row.status !== "waiting") return Response.json({ error: `Run is ${row.status}` }, { status: 409 });
    return this.stream(userId, async (emit) => {
      await this.invokeGraph(row.graph as "mutate" | "adapt", runId, userId, emit, new Command({ resume: decision }));
    });
  }

  private async invokeGraph(graph: "mutate" | "adapt", runId: string, userId: string, emit: (e: RunEvent) => void, input: unknown) {
    const ctx = await getAiCtx(this.env, userId);
    const trace = startTrace(this.env, `${graph}Graph`, { runId, resume: input instanceof Command }, { runId, userId, mode: ctx.mode });
    ctx.trace = trace.root;
    let cost = 0;
    const models = new Set<string>();
    ctx.onCall = (model, usd) => {
      cost += usd;
      models.add(model);
    };
    const config = { configurable: { thread_id: runId }, recursionLimit: 40 };
    let status = "failed";
    try {
      const compiled =
        graph === "mutate"
          ? buildMutateGraph({ env: this.env, ctx, emit, sources: await this.sourcesFor((input as MutateInput).courseId ?? (await this.courseIdOf(runId))), defer: (p) => this.ctx.waitUntil(p) }, this.saver)
          : buildAdaptGraph({ env: this.env, ctx, emit, defer: (p) => this.ctx.waitUntil(p) }, this.saver);
      const result = (await compiled.invoke(input as never, config)) as { __interrupt__?: unknown[]; decision?: string };
      if (result.__interrupt__?.length) status = "waiting";
      else status = result.decision === "keep" ? "kept" : result.decision === "undo" ? "undone" : "done";
    } finally {
      this.ctx.storage.sql.exec("UPDATE runs SET status = ? WHERE id = ?", status, runId);
      const labels = [...models].map((m) => MODEL_LABELS[m] ?? m);
      if (labels.length) await recordRunTrace(this.env, runId, { label: `Models used: ${labels.join(", ")}` });
      await finishRun(this.env, runId, status, undefined, cost);
      if (status !== "waiting") await this.saver.deleteThread(runId);
      this.ctx.waitUntil(endTrace(trace, { status, cost }));
      this.ctx.waitUntil(flushQuota(this.env));
    }
  }

  private async courseIdOf(runId: string): Promise<string> {
    return (await this.env.DB.prepare("SELECT course_id FROM runs WHERE id = ?").bind(runId).first<string>("course_id")) ?? "";
  }

  private async sourcesFor(courseId: string) {
    const { results } = await this.env.DB.prepare("SELECT s.id, s.filename, s.kind FROM sources s JOIN course_sources cs ON cs.source_id = s.id WHERE cs.course_id = ?")
      .bind(courseId)
      .all<{ id: string; filename: string; kind: string }>();
    return new Map(results.map((r) => [r.id, { filename: r.filename, kind: r.kind }]));
  }
}

function friendlyError(err: unknown): string {
  const e = err as { message?: string; status?: number };
  if (e?.status === 402) return e.message ?? "Spending limit reached";
  if (e?.status === 401) return "The Meta API rejected the key. Check it in Settings → AI and usage.";
  return `Something went wrong: ${String(e?.message ?? err).slice(0, 200)}`;
}
