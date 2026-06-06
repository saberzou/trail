import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Live agent tests (`*.live.test.ts`) hit a real provider + search API and
// only run when explicitly opted in via `pnpm test:live` (which sets
// TRAIL_TEST_LIVE=1). Excluding them from the default run keeps `pnpm test`
// hermetic and green even when TRAIL_LIVE_* keys are present in the env.
const includeLive = process.env.TRAIL_TEST_LIVE === "1";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ...(includeLive ? [] : ["**/*.live.test.ts"]),
    ],
  },
});
