import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";

export const runs = new Hono<AppEnv>()
  .get("/:id", async (c) => {
    const row = await c.env.DB.prepare("SELECT id, graph, status, trace, models, cost_usd, created_at, finished_at FROM runs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).first<{ trace: string; models: string } & Record<string, unknown>>();
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ ...row, trace: JSON.parse(row.trace), models: JSON.parse(row.models) });
  })
  .post("/:id/resume", async (c) => {
    const userId = c.get("userId");
    const { decision } = z.object({ decision: z.enum(["keep", "undo"]) }).parse(await c.req.json());
    const run = await c.env.DB.prepare("SELECT course_id FROM runs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).first<{ course_id: string }>();
    if (!run?.course_id) return c.json({ error: "Not found" }, 404);
    const stub = c.env.COURSE_DO.get(c.env.COURSE_DO.idFromName(run.course_id));
    return stub.resume(c.req.param("id"), userId, decision);
  });
