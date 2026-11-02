import type { Env } from "../env";

// App-wide guard that keeps HyperLearn inside the Cloudflare free tiers.
// Counters live in one Durable Object ("quota-global"); limits default to ~80% of each free allowance.

export const CONTACT_EMAIL = "contact@radesh-govind.com";

export class QuotaError extends Error {
  status = 429;
  code = "quota";
  constructor(public what: string) {
    super(`HyperLearn has reached its free ${what} limit. Contact ${CONTACT_EMAIL} to get more.`);
  }
}

type Limits = { storageBytes: number; classA: number; classB: number; vectorsStored: number; vectorQueries: number; aiCalls: number; browserTests: number };

export function limits(env: Env): Limits {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    storageBytes: n(env.QUOTA_STORAGE_GB, 8) * 1024 ** 3, // R2 free: 10 GB
    classA: n(env.QUOTA_R2_CLASS_A, 800_000), // R2 free: 1M / month
    classB: n(env.QUOTA_R2_CLASS_B, 8_000_000), // R2 free: 10M / month
    vectorsStored: n(env.QUOTA_VECTORS, 5_000), // Vectorize free: 5M stored dims = ~6,500 x 768
    vectorQueries: n(env.QUOTA_VECTOR_QUERIES, 30_000), // Vectorize free: 30M queried dims = ~39k x 768 / month
    aiCalls: n(env.QUOTA_AI_CALLS_DAY, 1_500), // Workers AI free: 10k neurons / day
    browserTests: n(env.QUOTA_BROWSER_DAY, 40), // Browser Rendering free: 10 min / day
  };
}

const month = () => new Date().toISOString().slice(0, 7);
const day = () => new Date().toISOString().slice(0, 10);
export const keys = {
  storage: () => "r2:bytes",
  classA: () => `r2:A:${month()}`,
  classB: () => `r2:B:${month()}`,
  vectors: () => "vec:stored",
  vectorQueries: () => `vec:q:${month()}`,
  ai: () => `ai:${day()}`,
  browser: () => `br:${day()}`,
};

const stub = (env: Env) => env.USER_DO.get(env.USER_DO.idFromName("quota-global"));

// ---- per-isolate batching so we don't call the DO on every R2 operation ----

const pending = new Map<string, number>();
let cache: { at: number; values: Record<string, number> } | null = null;

export function count(key: string, amount = 1) {
  pending.set(key, (pending.get(key) ?? 0) + amount);
}

export async function flushQuota(env: Env): Promise<void> {
  if (!pending.size) return;
  const batch = Object.fromEntries(pending);
  pending.clear();
  try {
    const values = await stub(env).addQuota(batch);
    cache = { at: Date.now(), values };
  } catch {
    for (const [k, v] of Object.entries(batch)) count(k, v); // retry next time
  }
}

async function current(env: Env): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < 20_000) {
    const merged = { ...cache.values };
    for (const [k, v] of pending) merged[k] = (merged[k] ?? 0) + v;
    return merged;
  }
  await flushQuota(env);
  const values = await stub(env).getQuota(Object.values(keys).map((f) => f()));
  cache = { at: Date.now(), values };
  return values;
}

export type QuotaCheck = "storage" | "classA" | "classB" | "vectors" | "vectorQueries" | "ai" | "browser";
const WHAT: Record<QuotaCheck, string> = {
  storage: "storage",
  classA: "storage write",
  classB: "file reading",
  vectors: "search index",
  vectorQueries: "search",
  ai: "indexing",
  browser: "example testing",
};

/** Returns the first exhausted quota among `checks`, or null. `extraBytes` is the size about to be stored. */
export async function exhausted(env: Env, checks: QuotaCheck[], extraBytes = 0): Promise<QuotaCheck | null> {
  const v = await current(env);
  const l = limits(env);
  const over: Record<QuotaCheck, boolean> = {
    storage: (v[keys.storage()] ?? 0) + extraBytes > l.storageBytes,
    classA: (v[keys.classA()] ?? 0) >= l.classA,
    classB: (v[keys.classB()] ?? 0) >= l.classB,
    vectors: (v[keys.vectors()] ?? 0) >= l.vectorsStored,
    vectorQueries: (v[keys.vectorQueries()] ?? 0) >= l.vectorQueries,
    ai: (v[keys.ai()] ?? 0) >= l.aiCalls,
    browser: (v[keys.browser()] ?? 0) >= l.browserTests,
  };
  return checks.find((c) => over[c]) ?? null;
}

export async function assertQuota(env: Env, checks: QuotaCheck[], extraBytes = 0): Promise<void> {
  const hit = await exhausted(env, checks, extraBytes);
  if (hit) throw new QuotaError(WHAT[hit]);
}

/** Usage summary for /api/me and /api/health. */
export async function quotaStatus(env: Env) {
  const v = await current(env);
  const l = limits(env);
  const pct = (used: number, cap: number) => Math.round((used / cap) * 100);
  const uploadsBlocked = await exhausted(env, ["storage", "classA", "vectors", "ai"]);
  return {
    contact: CONTACT_EMAIL,
    uploadsBlocked: uploadsBlocked ? WHAT[uploadsBlocked] : null,
    usage: {
      storage: pct(v[keys.storage()] ?? 0, l.storageBytes),
      classA: pct(v[keys.classA()] ?? 0, l.classA),
      classB: pct(v[keys.classB()] ?? 0, l.classB),
      vectors: pct(v[keys.vectors()] ?? 0, l.vectorsStored),
      vectorQueries: pct(v[keys.vectorQueries()] ?? 0, l.vectorQueries),
      ai: pct(v[keys.ai()] ?? 0, l.aiCalls),
      browser: pct(v[keys.browser()] ?? 0, l.browserTests),
    },
  };
}

/** Wraps an R2 bucket so every operation is counted (Class A: put/list/multipart; Class B: get/head). */
export function meterBucket(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value.bind(target) as (...a: unknown[]) => Promise<unknown>;
      if (prop === "put")
        return async (...args: unknown[]) => {
          const r = (await fn(...args)) as R2Object | null;
          count(keys.classA());
          if (r?.size) count(keys.storage(), r.size);
          return r;
        };
      if (prop === "list" || prop === "createMultipartUpload")
        return async (...args: unknown[]) => {
          count(keys.classA());
          return fn(...args);
        };
      if (prop === "get" || prop === "head")
        return async (...args: unknown[]) => {
          count(keys.classB());
          return fn(...args);
        };
      return fn;
    },
  });
}

/** Env with a metered R2 binding; use at every entry point (fetch, DO, workflow). */
const metered = new WeakSet<object>();
export function meteredEnv<E extends Env>(env: E): E {
  if (metered.has(env.FILES)) return env;
  const files = meterBucket(env.FILES);
  metered.add(files);
  return { ...env, FILES: files };
}
