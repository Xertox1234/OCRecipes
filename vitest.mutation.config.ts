import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// Stryker's dry run (perTest coverage) discovers tests via Vitest's `include`.
// We scope discovery to ONLY the target's dedicated unit test so the dry run stays
// fast and DB-free; otherwise it would boot all 386 test files + real Postgres.
//
// The glob is resolved by stryker.conf.mjs (the single source of truth) and handed
// to us via env: Stryker evaluates its config in the main process before spawning
// runner workers, which inherit process.env. Falls back to [] for a standalone run.
//
// NOTE: object spread, NOT mergeConfig() — mergeConfig CONCATENATES arrays, which
// would keep the base whole-suite `include` globs and defeat the scoping.
const includeEnv = process.env.STRYKER_VITEST_INCLUDE;
const include: string[] = includeEnv
  ? (JSON.parse(includeEnv) as string[])
  : [];

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include,
    // Pure targets need no DB teardown; drop it. Disable retries — a mutant must be
    // killed deterministically, not absorbed by the suite's flake-retry.
    globalSetup: [],
    retry: 0,
  },
});
