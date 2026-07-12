import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// Real-DB HTTP integration suite (test/integration/**/*.itest.ts) — see
// test/integration/README.md for what this is and why it is split out.
//
// The `.itest.ts` suffix (not `.test.ts`) already keeps these files out of the
// base config's `include: ["**/*.test.ts", "**/*.test.tsx"]`, so plain
// `vitest`/`vitest run`/`vitest related` (the fast preflight push gate and
// `npm run test:run`) never discover or run them — no `exclude` entry needed
// on either side, and there is nothing for this config to inherit and defeat.
// This config exists purely to give the suite its own `include` glob and its
// own npm script (`test:integration:http`) to run ONLY these files on demand.
//
// NOTE: object spread, NOT mergeConfig() — mergeConfig CONCATENATES arrays,
// which would keep the base whole-suite `include` globs alongside this one.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["test/integration/**/*.itest.ts"],
    // Keep globalSetup (leaked-test-data safety net) and retry (CPU-contention
    // flake absorption) from the base config — unlike vitest.mutation.config.ts,
    // this suite genuinely talks to Postgres and benefits from both.
  },
});
