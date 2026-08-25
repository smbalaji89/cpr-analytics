import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `postgres` (postgres.js) is a Node-only driver. Keep it external so the
  // Next bundler does not attempt to bundle its dynamic requires.
  serverExternalPackages: ["postgres"],
  eslint: {
    // Lint is run explicitly via `npm run lint`; keep production builds fast.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
