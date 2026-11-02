import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

/** Spend counter for one user (or "demo-global"). Buckets are a month like "2026-11" or "all". */
export class UserDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS spend (bucket TEXT PRIMARY KEY, usd REAL NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS calls (ts INTEGER, model TEXT, usd REAL, mode TEXT)`);
    });
  }

  async getSpend(bucket: string): Promise<number> {
    const row = this.ctx.storage.sql.exec<{ usd: number }>("SELECT usd FROM spend WHERE bucket = ?", bucket).toArray()[0];
    return row?.usd ?? 0;
  }

  async addSpend(bucket: string, usd: number, model: string, mode: string): Promise<number> {
    this.ctx.storage.sql.exec(
      "INSERT INTO spend (bucket, usd) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET usd = usd + excluded.usd",
      bucket,
      usd,
    );
    this.ctx.storage.sql.exec("INSERT INTO calls (ts, model, usd, mode) VALUES (?, ?, ?, ?)", Date.now(), model, usd, mode);
    return this.getSpend(bucket);
  }

  async usageByModel(sinceMs: number): Promise<{ model: string; usd: number; calls: number }[]> {
    return this.ctx.storage.sql
      .exec<{ model: string; usd: number; calls: number }>(
        "SELECT model, SUM(usd) AS usd, COUNT(*) AS calls FROM calls WHERE ts >= ? GROUP BY model ORDER BY usd DESC",
        sinceMs,
      )
      .toArray();
  }
}
