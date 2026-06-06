// @ts-check
// Gate-respecting mutation-testing exploration CLI.
//   npm run mutation:explore -- <mutate-glob> <test-glob> [--spike]
// Runs a READ-ONLY Stryker baseline to size a module before adding it to
// stryker.targets.mjs. Refuses Hard-Exclusion paths unless human-approved; --spike
// permits a read-only baseline on an excluded path (banner shown). The gate is ALSO
// enforced in stryker.explore.conf.mjs, so it cannot be bypassed.
import { spawnSync } from "node:child_process";
import { isHardExclusion, isApprovedExclusion } from "../stryker.targets.mjs";

const argv = process.argv.slice(2);
const spike = argv.includes("--spike");
const [mutate, test] = argv.filter((a) => a !== "--spike");

if (!mutate || !test) {
  console.error(
    "Usage: npm run mutation:explore -- <mutate-glob> <test-glob> [--spike]",
  );
  process.exit(2);
}

if (isHardExclusion(mutate) && !isApprovedExclusion(mutate)) {
  if (!spike) {
    console.error(
      `\n⛔  "${mutate}" is a Hard-Exclusion module and is not human-approved.\n` +
        `   Add a HUMAN_APPROVED_EXCLUSIONS entry (with a plan) to target it, or pass\n` +
        `   --spike for a READ-ONLY baseline (measurement only).\n`,
    );
    process.exit(1);
  }
  console.error(
    `\n⚠️  SPIKE: read-only baseline on Hard-Exclusion module "${mutate}".\n` +
      `   MEASUREMENT ONLY. Authoring tests for this module requires a human-approved\n` +
      `   plan per the gated protocol. No source is edited.\n`,
  );
}

const result = spawnSync(
  "npx",
  ["stryker", "run", "stryker.explore.conf.mjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      STRYKER_EXPLORE_MUTATE: mutate,
      STRYKER_EXPLORE_TEST: test,
      STRYKER_EXPLORE_SPIKE: spike ? "1" : "0",
    },
  },
);
process.exit(result.status ?? 1);
