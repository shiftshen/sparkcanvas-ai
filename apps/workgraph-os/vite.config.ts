import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3200,
    proxy: {
      "/api": {
        target: "http://localhost:4100",
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
