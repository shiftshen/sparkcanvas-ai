import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_TARGET || "http://localhost:4100";

export default defineConfig({
  plugins: [react()],
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
