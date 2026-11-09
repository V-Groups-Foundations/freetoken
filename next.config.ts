import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and dynamic; Cache Components would force a Suspense
  // boundary around each session read for no benefit.
  cacheComponents: false,
  reactCompiler: true,
  serverExternalPackages: ["@electric-sql/pglite"],
  // a phone on the same Wi-Fi reaches the dev server by this computer's private address (the 📱 Phone page)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
