import { Hono } from "hono";
import type { AppEnv } from "../env";
import { sources } from "./sources";
import { courses } from "./courses";

export const DEMO_OWNER = "demo-owner";

/**
 * Seeding API for `npm run seed:*`: the regular source and course routes, acting as the
 * demo owner, behind SEED_TOKEN. Not reachable without the secret.
 */
export const admin = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const token = c.req.header("X-Seed-Token");
    if (!c.env.SEED_TOKEN || token !== c.env.SEED_TOKEN) return c.json({ error: "Not found" }, 404);
    c.set("userId", DEMO_OWNER);
    await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, 'HyperLearn demo', ?)").bind(DEMO_OWNER, Date.now()).run();
    await next();
  })
  .route("/sources", sources)
  .route("/courses", courses)
  .post("/courses/:id/demo", async (c) => {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE courses SET is_demo = 0 WHERE is_demo = 1"),
      c.env.DB.prepare("UPDATE courses SET is_demo = 1 WHERE id = ? AND owner_id = ?").bind(c.req.param("id"), DEMO_OWNER),
    ]);
    return c.json({ ok: true });
  });
