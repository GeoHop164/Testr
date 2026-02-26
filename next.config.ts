import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  ...(isStaticExport
    ? {
        output: "export" as const,
      }
    : {
        async headers() {
          return [
            {
              source: "/sw.js",
              headers: [
                {
                  key: "Cache-Control",
                  value: "no-cache, no-store, must-revalidate",
                },
              ],
            },
            {
              source: "/manifest.webmanifest",
              headers: [
                {
                  key: "Content-Type",
                  value: "application/manifest+json",
                },
                {
                  key: "Cache-Control",
                  value: "public, max-age=0, must-revalidate",
                },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
