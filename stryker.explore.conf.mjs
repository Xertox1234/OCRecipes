// @ts-check
// Committed read-only exploration config for `npm run mutation:explore`. Reads the
// target from env (set by scripts/mutation-explore.mjs) and RE-ENFORCES the
// Hard-Exclusion gate so it cannot be bypassed by invoking this config directly.
// Produces a baseline only — it never authors or edits anything.
import { isHardExclusion, isApprovedExclusion } from "./stryker.targets.mjs";

const mutate = process.env.STRYKER_EXPLORE_MUTATE;
const test = process.env.STRYKER_EXPLORE_TEST;
const spike = process.env.STRYKER_EXPLORE_SPIKE === "1";

if (!mutate || !test) {
  throw new Error(
    "mutation:explore requires <mutate-glob> <test-glob> (set via scripts/mutation-explore.mjs)",
  );
}
if (isHardExclusion(mutate) && !isApprovedExclusion(mutate) && !spike) {
  throw new Error(
    `Refusing to mutate Hard-Exclusion path "${mutate}" without approval. ` +
      `Add a HUMAN_APPROVED_EXCLUSIONS entry (with a human-authored plan) or pass --spike for a READ-ONLY baseline.`,
  );
}

process.env.STRYKER_VITEST_INCLUDE = JSON.stringify([test]);

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.ts" },
  coverageAnalysis: "perTest",
  ignorePatterns: ["ios", "android", ".expo", "server_dist", "coverage"],
  disableTypeChecks: false,
  mutate: [mutate],
  incremental: false,
  reporters: ["clear-text", "progress"],
  tempDirName: ".stryker-tmp",
};
