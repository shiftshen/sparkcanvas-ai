import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.VITE_API_TARGET || "http://localhost:4100";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the workspace package from source so a cold `vite build` (rolldown)
      // doesn't require the package to be prebuilt to dist first.
      "@sparkcanvas/ai-design-language": fileURLToPath(new URL("../../packages/ai-design-language/src/index.ts", import.meta.url))
    }
  },
  server: {
    host: "0.0.0.0",
    port: 3200,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (pathname) => pathname.replace(/^\/api/, "")
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 3200
  }
});
