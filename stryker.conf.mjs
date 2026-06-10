// @ts-check
import { resolveTarget, assertAllowedTarget } from "./stryker.targets.mjs";

const targetName = process.env.MUTATION_TARGET ?? "macro-gap-context";
const target = resolveTarget(targetName);
// Fail-closed at run time, not just in the registry tests — a locally added
// Hard-Exclusion target must not run Stryker without a human-approved plan.
assertAllowedTarget(targetName, target);
const { mutate, testInclude } = target;

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
  // Stryker sandboxes by COPYING the project. Exclude gitignored native/build dirs:
  // copying ios/Pods (CocoaPods hermes.framework) hits ENOTSUP on socket files, and
  // these dirs are irrelevant to the pure server-lib unit targets.
  ignorePatterns: ["ios", "android", ".expo", "server_dist", "coverage"],
  // Skip Stryker's babel-based type-check stripper: it conflicts with the Expo
  // babel.config.js ("decorators" + "decorators-legacy" together). The vitest runner
  // transpiles via esbuild (no type-check), so type-invalid mutants run regardless.
  disableTypeChecks: false,
  mutate,
  // Enforce a per-target mutation-score floor when the registry defines one
  // (goal-safety targets). Stryker exits non-zero when score < break.
  ...(target.breakThreshold != null
    ? { thresholds: { high: 80, low: 60, break: target.breakThreshold } }
    : {}),
  incremental: true,
  incrementalFile: `reports/mutation/incremental-${targetName}.json`,
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: `reports/mutation/${targetName}.html`,
  },
  tempDirName: ".stryker-tmp",
};

export default config;
