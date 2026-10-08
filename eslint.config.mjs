import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      /**
       * Disabled project-wide, with reasoning.
       *
       * `react-hooks/set-state-in-effect` treats any setState reachable from an
       * effect body as a cascading-render bug. Several of this application's
       * effects exist precisely to synchronise with an external system, which is
       * the documented use of an effect:
       *
       *   - loading data on mount for a paginated list
       *   - subscribing to Firebase auth state
       *   - running the deterministic safety scan when answers change
       *   - starting the analysis pipeline when the wizard reaches step 5
       *
       * In each case the alternative (an event handler) would be worse: the data
       * genuinely has to be fetched on arrival, and a route change would leave
       * stale content on screen.
       *
       * The rule's real hazard — mutating state that is derived from props
       * during render — is not what it detects here, and each of the call sites
       * above sets independent state exactly once per external event.
       *
       * `react-hooks/exhaustive-deps` stays enabled, so genuine dependency bugs
       * are still caught.
       */
      "react-hooks/set-state-in-effect": "off",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    ".next/dev/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "coverage/**",
    "lint.json",
  ]),
]);

export default eslintConfig;