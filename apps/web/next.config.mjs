/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    const backend = process.env.WGOS_API_TARGET || `http://localhost:${process.env.WGOS_BACKEND_PORT || "4200"}`;
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
