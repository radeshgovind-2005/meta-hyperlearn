import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { encryptSecret } from "../lib/crypto";
import { verifyMetaKey } from "../ai/meta";

const month = () => new Date().toISOString().slice(0, 7);

export const me = new Hono<AppEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const env = c.env;
    const [user, key, demo] = await Promise.all([
      env.DB.prepare("SELECT monthly_cap_usd, onboarded FROM users WHERE id = ?").bind(userId).first<{ monthly_cap_usd: number; onboarded: number }>(),
      env.DB.prepare("SELECT last4, verified_at FROM api_keys WHERE user_id = ?").bind(userId).first<{ last4: string; verified_at: number | null }>(),
      env.DB.prepare("SELECT id FROM courses WHERE is_demo = 1 ORDER BY created_at DESC LIMIT 1").first<string>("id"),
    ]);
    const spent = await env.USER_DO.get(env.USER_DO.idFromName(userId)).getSpend(month());
    const demoSpent = await env.USER_DO.get(env.USER_DO.idFromName("demo-global")).getSpend("all");
    return c.json({
      userId,
      mode: key ? "byok" : "demo",
      key: key ? { last4: key.last4, verifiedAt: key.verified_at } : null,
      capUsd: user?.monthly_cap_usd ?? 10,
      spentUsd: spent,
      onboarded: Boolean(user?.onboarded),
      demo: { courseId: demo ?? null, capUsd: Number(env.DEMO_SPEND_CAP_USD || 40), spentUsd: demoSpent, available: Boolean(env.META_API_KEY) },
    });
  })
  .post("/key/verify", async (c) => {
    const { key } = z.object({ key: z.string().min(8).max(400) }).parse(await c.req.json());
    const r = await verifyMetaKey(c.env.META_BASE_URL, key.trim());
    return c.json({ ok: r.ok, status: r.status });
  })
  .put("/key", async (c) => {
    const userId = c.get("userId");
    const { key } = z.object({ key: z.string().min(8).max(400) }).parse(await c.req.json());
    const k = key.trim();
    const r = await verifyMetaKey(c.env.META_BASE_URL, k);
    if (!r.ok) return c.json({ error: r.status === 401 || r.status === 403 ? "That key was rejected by the Meta Model API." : `Could not verify the key (status ${r.status}).` }, 400);
    const { ciphertext, iv } = await encryptSecret(k, c.env.KEY_ENCRYPTION_KEY, userId);
    await c.env.DB.prepare(
      "INSERT INTO api_keys (user_id, ciphertext, iv, last4, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, last4 = excluded.last4, verified_at = excluded.verified_at",
    )
      .bind(userId, ciphertext, iv, k.slice(-4), Date.now(), Date.now())
      .run();
    return c.json({ ok: true, last4: k.slice(-4) });
  })
  .delete("/key", async (c) => {
    await c.env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(c.get("userId")).run();
    return c.json({ ok: true });
  })
  .put("/cap", async (c) => {
    const { usd } = z.object({ usd: z.number().min(1).max(1000) }).parse(await c.req.json());
    await c.env.DB.prepare("UPDATE users SET monthly_cap_usd = ? WHERE id = ?").bind(usd, c.get("userId")).run();
    return c.json({ ok: true });
  })
  .put("/profile", async (c) => {
    const { name, email } = z.object({ name: z.string().max(120).optional(), email: z.string().max(200).optional() }).parse(await c.req.json());
    await c.env.DB.prepare("UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?").bind(name ?? null, email ?? null, c.get("userId")).run();
    return c.json({ ok: true });
  })
  .post("/onboarded", async (c) => {
    await c.env.DB.prepare("UPDATE users SET onboarded = 1 WHERE id = ?").bind(c.get("userId")).run();
    return c.json({ ok: true });
  })
  .get("/usage", async (c) => {
    const userId = c.get("userId");
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const rows = await c.env.USER_DO.get(c.env.USER_DO.idFromName(userId)).usageByModel(start.getTime());
    return c.json({ month: month(), byModel: rows });
  });
