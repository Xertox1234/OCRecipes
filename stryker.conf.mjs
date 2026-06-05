// @ts-check
import { resolveTarget } from "./stryker.targets.mjs";

const targetName = process.env.MUTATION_TARGET ?? "macro-gap-context";
const { mutate, testInclude } = resolveTarget(targetName);

// Hand the resolved test-discovery glob to vitest.mutation.config.ts. Stryker
// evaluates this config in the main process before spawning runner workers, which
// inherit process.env — so the Vitest config (loaded in a worker) reads it. The
// registry stays the single source of truth: targets are defined exactly once.
process.env.STRYKER_VITEST_INCLUDE = JSON.stringify(testInclude);

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  coverageAnalysis: "perTest",
  mutate,
  incremental: true,
  incrementalFile: `reports/mutation/incremental-${targetName}.json`,
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: `reports/mutation/${targetName}.html`,
  },
  tempDirName: ".stryker-tmp",
};

export default config;
