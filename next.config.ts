import type { NextConfig } from "next";

/**
 * MedAssist AI — Next.js configuration
 *
 * The application is designed to deploy directly to Vercel with no additional
 * server runtime. All AI calls happen in Route Handlers / Server Components.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Uploads are streamed through Route Handlers with explicit limits enforced in
  // lib/security/upload-policy.ts, so the platform body limit is the only other cap.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
    ],
  },

  // Tailwind v4 ships as a PostCSS-style transform rather than a PostCSS plugin,
  // so it is registered through the Turbopack `*.css` rule. Without this the
  // @theme / @custom-variant at-rules reach PostCSS untransformed and the build
  // fails with "Unknown at rule: @theme".
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;