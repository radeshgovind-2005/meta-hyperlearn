import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/server/lib/crypto";

const master = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("key encryption", () => {
  it("round-trips and never stores plaintext", async () => {
    const { ciphertext, iv } = await encryptSecret("sk-meta-secret-123", master, "user_1");
    expect(ciphertext).not.toContain("secret");
    expect(await decryptSecret(ciphertext, iv, master, "user_1")).toBe("sk-meta-secret-123");
  });
  it("is bound to the user id", async () => {
    const { ciphertext, iv } = await encryptSecret("k", master, "user_1");
    await expect(decryptSecret(ciphertext, iv, master, "user_2")).rejects.toThrow();
  });
  it("uses a fresh IV each time", async () => {
    const a = await encryptSecret("k", master, "u");
    const b = await encryptSecret("k", master, "u");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it("rejects a master key of the wrong size", async () => {
    await expect(encryptSecret("k", btoa("short"), "u")).rejects.toThrow(/32 bytes/);
  });
});
