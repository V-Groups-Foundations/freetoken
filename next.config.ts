import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and dynamic; Cache Components would force a Suspense
  // boundary around each session read for no benefit.
  cacheComponents: false,
  reactCompiler: true,
  serverExternalPackages: ["@electric-sql/pglite"],
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
