import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build for the production studio container (slim, self-contained
  // server.js). outputFileTracingRoot points at the monorepo root so file
  // tracing resolves correctly from apps/web.
  output: "standalone",
  outputFileTracingRoot: path.join(appDir, "..", ".."),
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    const backend = process.env.WGOS_API_TARGET || `http://127.0.0.1:${process.env.WGOS_BACKEND_PORT || "4200"}`;
    return [
      {
        source: "/workgraph-os/:path*",
        destination: `${backend}/workgraph-os/:path*`
      },
      {
        source: "/health",
        destination: `${backend}/health`
      }
    ];
  }
};

export default nextConfig;
