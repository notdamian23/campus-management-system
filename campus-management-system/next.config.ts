import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App Hosting expects the Next standalone server bundle during deployment.
  output: "standalone",
};

export default nextConfig;
