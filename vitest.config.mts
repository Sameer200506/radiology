import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest configuration.
 *
 * Two projects:
 *  - `unit`        pure modules only. No network, no credentials. Always runs.
 *  - `integration` real calls to OpenRouter. Skipped entirely unless
 *                 OPENROUTER_API_KEY is set, so `npm test` stays hermetic.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next.js aliases this to an empty module for server bundles. Reproduce
      // that so server-only modules can be imported under Vitest.
      "server-only": fileURLToPath(new URL("./tests/__mocks__/server-only.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL(".", import.meta.url)),
            "server-only": fileURLToPath(
              new URL("./tests/__mocks__/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/**"],
        },
      },
      {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL(".", import.meta.url)),
            "server-only": fileURLToPath(
              new URL("./tests/__mocks__/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Loads .env.local so OPENROUTER_API_KEY is discoverable. The suite
          // still skips itself when the key is absent.
          setupFiles: ["tests/setup-env.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Live model calls are slow; running files sequentially keeps the
          // request rate inside the free tier's limits.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [
        "lib/medical/triage.ts",
        "lib/medical/reconcile-urgency.ts",
        "lib/security/**/*.ts",
        "lib/ai/schemas.ts",
        "lib/ai/extract-json.ts",
        "lib/medical/fallback-questions.ts",
      ],
    },
  },
});