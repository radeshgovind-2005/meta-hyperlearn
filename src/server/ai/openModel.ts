import type { Env } from "../env";
import { traceChild } from "../lib/tracing";
import type { RunTree } from "langsmith/run_trees";
import { ModelError } from "./meta";

// Provider-agnostic client for the open-weight model (Modal endpoint or our own tunnel).
// OpenAI-compatible: base URL + model id from env.

export function openModelConfigured(env: Env): boolean {
  return Boolean(env.OPEN_MODEL_BASE_URL && env.OPEN_MODEL_ID);
}

export function openModelLabel(env: Env): string {
  const id = env.OPEN_MODEL_ID ?? "";
  if (/glimmer/i.test(id)) return "Muse Glimmer (open weights)";
  if (/spark/i.test(id)) return "Muse Spark Open (open weights)";
  return id ? `${id} (open weights)` : "open-weight model";
}

function chatUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  if (b.endsWith("/chat/completions")) return b;
  return /\/v\d+$/.test(b) ? `${b}/chat/completions` : `${b}/v1/chat/completions`;
}

export async function openChat(
  env: Env,
  messages: { role: "system" | "user"; content: string }[],
  opts: { maxTokens?: number; trace?: RunTree | null; jsonSchema?: Record<string, unknown> } = {},
): Promise<string> {
  if (!openModelConfigured(env)) throw new ModelError("Open-weight endpoint not configured");
  const body: Record<string, unknown> = {
    model: env.OPEN_MODEL_ID,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: 0,
  };
  if (opts.jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "verdicts", schema: opts.jsonSchema } };
  return traceChild(opts.trace, `open-weight:${env.OPEN_MODEL_ID}`, "llm", { messages }, async () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.OPEN_MODEL_API_KEY) headers.Authorization = `Bearer ${env.OPEN_MODEL_API_KEY}`;
    let res = await fetch(chatUrl(env.OPEN_MODEL_BASE_URL!), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    if (!res.ok && opts.jsonSchema && res.status === 400) {
      // some servers reject json_schema; retry without it and parse leniently
      delete body.response_format;
      res = await fetch(chatUrl(env.OPEN_MODEL_BASE_URL!), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    }
    if (!res.ok) throw new ModelError(`Open-weight endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { choices: { message: { content: string | null; reasoning_content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  });
}

export async function pingOpenModel(env: Env): Promise<boolean> {
  if (!openModelConfigured(env)) return false;
  try {
    const base = env.OPEN_MODEL_BASE_URL!.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
    const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
    const headers: Record<string, string> = {};
    if (env.OPEN_MODEL_API_KEY) headers.Authorization = `Bearer ${env.OPEN_MODEL_API_KEY}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}
