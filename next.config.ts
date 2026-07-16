import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedding cache is a local research artifact. It is never required by
  // the production query route and can contain tens of thousands of vectors.
  outputFileTracingExcludes: {
    "/*": ["./data/embedding-cache/**/*"],
  },
};

export default nextConfig;
