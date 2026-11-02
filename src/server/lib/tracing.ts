import { Client } from "langsmith/client";
import { RunTree } from "langsmith/run_trees";
import type { Env } from "../env";

// Explicit RunTrees (no AsyncLocalStorage), flushed by the caller inside waitUntil.

export type Trace = { root: RunTree | null; client: Client | null };

export function startTrace(env: Env, name: string, inputs: Record<string, unknown>, metadata: Record<string, unknown> = {}): Trace {
  if (env.LANGSMITH_TRACING !== "true" || !env.LANGSMITH_API_KEY) return { root: null, client: null };
  const client = new Client({ apiKey: env.LANGSMITH_API_KEY, manualFlushMode: true, autoBatchTracing: true });
  const root = new RunTree({
    name,
    run_type: "chain",
    inputs,
    metadata,
    project_name: env.LANGSMITH_PROJECT ?? "hyperlearn",
    client,
    tracingEnabled: true,
  });
  void root.postRun().catch(() => {});
  return { root, client };
}

export async function traceChild<T>(
  parent: RunTree | null | undefined,
  name: string,
  runType: "llm" | "tool" | "chain" | "retriever",
  inputs: Record<string, unknown>,
  fn: () => Promise<T>,
  outputsOf: (r: T) => Record<string, unknown> = (r) => ({ output: r as unknown }),
): Promise<T> {
  if (!parent) return fn();
  const child = parent.createChild({ name, run_type: runType, inputs });
  void child.postRun().catch(() => {});
  try {
    const result = await fn();
    await child.end(outputsOf(result));
    void child.patchRun().catch(() => {});
    return result;
  } catch (err) {
    await child.end(undefined, String(err));
    void child.patchRun().catch(() => {});
    throw err;
  }
}

export async function endTrace(trace: Trace, outputs: Record<string, unknown>, error?: string): Promise<void> {
  if (!trace.root || !trace.client) return;
  try {
    await trace.root.end(outputs, error);
    await trace.root.patchRun();
    await trace.client.flush();
  } catch {
    // tracing must never break a request
  }
}
