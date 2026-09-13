import type { NextConfig } from "next";

// Where the Django API lives. Dev default: local runserver.
// In production set API_ORIGIN to the Django service URL.
const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // DRF uses trailing slashes; let rewrites pass them through untouched.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // Proxy API calls through Next so the browser sees one origin (no CORS).
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
