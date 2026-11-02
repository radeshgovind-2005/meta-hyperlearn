import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, flushQuota, keys, limits, meterBucket, QuotaError } from "../src/server/lib/quota";
import type { Env } from "../src/server/env";

function fakeEnv(store: Record<string, number>) {
  const quotaStub = {
    addQuota: async (d: Record<string, number>) => {
      for (const [k, v] of Object.entries(d)) store[k] = Math.max(0, (store[k] ?? 0) + v);
      return { ...store };
    },
    getQuota: async () => ({ ...store }),
  };
  return { USER_DO: { idFromName: () => "id", get: () => quotaStub } } as unknown as Env;
}

describe("free-tier quota", () => {
  it("counts R2 class A, class B and stored bytes", async () => {
    const bucket = {
      put: async () => ({ size: 1000 }),
      get: async () => null,
      head: async () => null,
      list: async () => ({ objects: [] }),
      delete: async () => undefined,
    } as unknown as R2Bucket;
    const m = meterBucket(bucket);
    await m.put("a", "x");
    await m.put("b", "y");
    await m.get("a");
    await m.head("a");
    await m.list();
    const store: Record<string, number> = {};
    await flushQuota(fakeEnv(store));
    expect(store[keys.classA()]).toBe(3);
    expect(store[keys.classB()]).toBe(2);
    expect(store[keys.storage()]).toBe(2000);
  });

  it("defaults stay under the free tiers", () => {
    const l = limits({} as Env);
    expect(l.storageBytes).toBeLessThan(10 * 1024 ** 3);
    expect(l.classA).toBeLessThan(1_000_000);
    expect(l.vectorsStored * 768).toBeLessThan(5_000_000);
  });

  it("names the contact address in the error", () => {
    expect(new QuotaError("storage").message).toContain(CONTACT_EMAIL);
  });
});
