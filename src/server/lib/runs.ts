import type { Env } from "../env";
import type { TraceEntry } from "../../shared/types";
import { randomId } from "./crypto";

export async function createRun(env: Env, args: { userId: string; courseId?: string | null; graph: string; input: unknown; id?: string }): Promise<string> {
  const id = args.id ?? randomId("run");
  await env.DB.prepare("INSERT INTO runs (id, user_id, course_id, graph, status, input, created_at) VALUES (?, ?, ?, ?, 'running', ?, ?)")
    .bind(id, args.userId, args.courseId ?? null, args.graph, JSON.stringify(args.input), Date.now())
    .run();
  return id;
}

/** Appends one human-readable line to "How this was decided". */
export async function recordRunTrace(env: Env, runId: string, entry: TraceEntry): Promise<void> {
  await env.DB.prepare("UPDATE runs SET trace = json_insert(trace, '$[#]', json(?)) WHERE id = ?").bind(JSON.stringify(entry), runId).run();
  if (entry.model) {
    await env.DB.prepare(
      "UPDATE runs SET models = CASE WHEN EXISTS (SELECT 1 FROM json_each(models) WHERE value = ?) THEN models ELSE json_insert(models, '$[#]', ?) END WHERE id = ?",
    )
      .bind(entry.model, entry.model, runId)
      .run();
  }
}

export async function finishRun(env: Env, runId: string, status: string, result?: unknown, costUsd?: number): Promise<void> {
  await env.DB.prepare("UPDATE runs SET status = ?, result = COALESCE(?, result), cost_usd = cost_usd + ?, finished_at = ? WHERE id = ?")
    .bind(status, result === undefined ? null : JSON.stringify(result), costUsd ?? 0, Date.now(), runId)
    .run();
}
