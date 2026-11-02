import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./tests/wrangler.test.jsonc" } })],
  resolve: { alias: { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"] },
});
