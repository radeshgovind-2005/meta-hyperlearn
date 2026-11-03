import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // LOCAL_ONLY=1 runs without Cloudflare login (AI, Vectorize and Browser Rendering are then unavailable)
  plugins: [react(), cloudflare({ remoteBindings: !process.env.LOCAL_ONLY })],
  resolve: { alias: { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) } },
  server: { port: 5173 },
});
