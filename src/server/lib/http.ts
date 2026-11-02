import type { Context, MiddlewareHandler } from "hono";
import { getAuth } from "@clerk/hono";
import { verifyToken } from "@clerk/backend";
import type { AppEnv, Env } from "../env";
import { BudgetError, ModelError } from "../ai/meta";
import { QuotaError } from "./quota";

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = getAuth(c);
  let userId = auth?.userId ?? null;
  // WebSocket upgrades can't send headers: accept a session token in the query
  const token = c.req.query("token");
  if (!userId && token) {
    try {
      const claims = await verifyToken(token, { secretKey: c.env.CLERK_SECRET_KEY });
      userId = claims.sub;
    } catch {
      userId = null;
    }
  }
  if (!userId) return c.json({ error: "Sign in required" }, 401);
  c.set("userId", userId);
  await ensureUser(c.env, userId);
  await next();
};

const known = new Set<string>();
async function ensureUser(env: Env, userId: string) {
  if (known.has(userId)) return;
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)").bind(userId, Date.now()).run();
  known.add(userId);
}

export type Access = { role: "owner" | "follower" | "demo"; course: CourseRow };
export type CourseRow = { id: string; owner_id: string; title: string; description: string | null; status: string; progress: string | null; current_version: number; forked_from: string | null; forked_at_version: number | null; is_demo: number; created_at: number; updated_at: number };

export async function courseAccess(env: Env, courseId: string, userId: string): Promise<Access | null> {
  const course = await env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(courseId).first<CourseRow>();
  if (!course) return null;
  if (course.owner_id === userId) return { role: "owner", course };
  if (course.is_demo) return { role: "demo", course };
  const f = await env.DB.prepare("SELECT 1 FROM follows WHERE user_id = ? AND course_id = ?").bind(userId, courseId).first();
  return f ? { role: "follower", course } : null;
}

export function errorResponse(c: Context, err: unknown) {
  if (err instanceof QuotaError) return c.json({ error: err.message, code: "quota" }, 429);
  if (err instanceof BudgetError) return c.json({ error: err.message, code: "budget" }, 402);
  if (err instanceof ModelError) return c.json({ error: err.message }, err.status === 401 ? 401 : 502);
  console.error(err);
  return c.json({ error: (err as Error).message ?? "Unexpected error" }, 500);
}

// ---- signed file URLs (so <img> and <audio> work without auth headers) ----

async function hmacKey(env: Env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`files:${env.KEY_ENCRYPTION_KEY}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signFileUrl(env: Env, key: string, ttlSeconds = 6 * 3600): Promise<string> {
  // round expiry so URLs stay stable (and cacheable) for a while
  const exp = Math.ceil((Date.now() / 1000 + ttlSeconds) / 3600) * 3600;
  const sig = hex(await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(`${key}:${exp}`)));
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig.slice(0, 32)}`;
}

export async function verifyFileSig(env: Env, key: string, exp: string, sig: string): Promise<boolean> {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = hex(await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(`${key}:${exp}`))).slice(0, 32);
  return want === sig;
}
