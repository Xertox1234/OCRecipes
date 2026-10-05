// @ts-check
// Gate-respecting mutation-testing exploration CLI.
//   npm run mutation:explore -- <mutate-glob> <test-glob> [--spike]
// Runs a READ-ONLY Stryker baseline to size a module before adding it to
// stryker.targets.mjs. Refuses Hard-Exclusion paths unless human-approved; --spike
// permits a read-only baseline on an excluded path (banner shown). The gate is ALSO
// enforced in stryker.explore.conf.mjs, so it cannot be bypassed.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isHardExclusion, isApprovedExclusion } from "../stryker.targets.mjs";

/**
 * Decide what an explore run should do for a `mutate` target — pure + testable, runs
 * nothing:
 *   - "run":    non-excluded, OR an approved Hard-Exclusion target.
 *   - "refuse": an unapproved Hard-Exclusion target without --spike (CLI exits 1).
 *   - "spike":  an unapproved Hard-Exclusion target WITH --spike (read-only baseline).
 * @param {string} mutate
 * @param {{ spike?: boolean }} [opts]
 * @returns {{ action: "run" | "refuse" | "spike" }}
 */
export function classifyExploreTarget(mutate, { spike = false } = {}) {
  if (!isHardExclusion(mutate) || isApprovedExclusion(mutate)) {
    return { action: "run" };
  }
  return spike ? { action: "spike" } : { action: "refuse" };
}

function main() {
  const argv = process.argv.slice(2);
  const spike = argv.includes("--spike");
  const [mutate, test] = argv.filter((a) => a !== "--spike");

  if (!mutate || !test) {
    console.error(
      "Usage: npm run mutation:explore -- <mutate-glob> <test-glob> [--spike]",
    );
    process.exit(2);
  }

  const { action } = classifyExploreTarget(mutate, { spike });
  if (action === "refuse") {
    console.error(
      `\n⛔  "${mutate}" is a Hard-Exclusion module and is not human-approved.\n` +
        `   Add a HUMAN_APPROVED_EXCLUSIONS entry (with a plan) to target it, or pass\n` +
        `   --spike for a READ-ONLY baseline (measurement only).\n`,
    );
    process.exit(1);
  }
  if (action === "spike") {
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
}

// Run the CLI only when executed directly (`node scripts/mutation-explore.mjs`), NOT
// when imported by a test — so importing it for unit tests has no side effects.
// Realpath BOTH sides: the ESM loader realpaths the main module (import.meta.url)
// but process.argv[1] keeps the path as given, so a launch through a symlink
// (macOS /var -> /private/var) made the old href comparison false and the
// script exited 0 having done nothing.
const isMain = (() => {
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
})();
if (isMain) {
  main();
}
