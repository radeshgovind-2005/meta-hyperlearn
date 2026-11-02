// Fetch wrapper that adds the Clerk session token.

let tokenGetter: (() => Promise<string | null>) | null = null;
export function setTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}
export async function sessionToken(): Promise<string | null> {
  return tokenGetter ? tokenGetter() : null;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await sessionToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; contentType?: string } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.raw ? "POST" : "GET") };
  if (opts.raw !== undefined) {
    init.body = opts.raw;
    init.headers = await headers({ "Content-Type": opts.contentType ?? "application/octet-stream" });
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = await headers({ "Content-Type": "application/json" });
  } else init.headers = await headers();
  const res = await fetch(path, init);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(j.error ?? `Request failed (${res.status})`, res.status, j.code);
  }
  return (await res.json()) as T;
}

/** POSTs and reads an NDJSON event stream, calling onEvent for each line. */
export async function streamEvents<E>(path: string, body: unknown, onEvent: (e: E) => void): Promise<void> {
  const res = await fetch(path, { method: "POST", body: JSON.stringify(body), headers: await headers({ "Content-Type": "application/json" }) });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(j.error ?? `Request failed (${res.status})`, res.status, j.code);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as E);
}

export function wsUrl(path: string, token: string | null): string {
  const u = new URL(path, window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (token) u.searchParams.set("token", token);
  return u.toString();
}
