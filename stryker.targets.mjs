// @ts-check
/**
 * Single source of truth for mutation-testing targets.
 *
 * Each target maps a friendly name to BOTH axes Stryker must keep in sync:
 *   - mutate:      source file(s) Stryker corrupts with mutants
 *   - testInclude: the DEDICATED unit-test file(s) Vitest should discover
 *
 * `testInclude` is intentionally the unit test ONLY (never a route test): the goal
 * is to measure whether the module's dedicated unit test is trustworthy. For a
 * module with both a service test and a route test, list only the service test.
 *
 * HARD-EXCLUSION POLICY (.github/copilot-instructions.md "Hard Exclusions"):
 * do NOT add auth, goal-safety, IAP, health-data, secrets, or schema/migration
 * modules here. Those require a separate human-authored plan with human review.
 * The registry's unit test enforces this.
 */

/** @typedef {{ mutate: string[], testInclude: string[] }} MutationTarget */

/** @type {Record<string, MutationTarget>} */
export const MUTATION_TARGETS = {
  "macro-gap-context": {
    mutate: ["server/lib/macro-gap-context.ts"],
    testInclude: ["server/lib/__tests__/macro-gap-context.test.ts"],
  },
  "verification-consensus": {
    mutate: ["server/lib/verification-consensus.ts"],
    testInclude: ["server/lib/__tests__/verification-consensus.test.ts"],
  },
};

export const DEFAULT_TARGET = "macro-gap-context";

// Fail fast at import time if DEFAULT_TARGET drifts out of the registry.
if (!MUTATION_TARGETS[DEFAULT_TARGET]) {
  throw new Error(
    `DEFAULT_TARGET "${DEFAULT_TARGET}" is not in MUTATION_TARGETS`,
  );
}

/**
 * Resolve a target by name, throwing a clear, listing error on a miss.
 * @param {string} [name]
 * @returns {MutationTarget}
 */
export function resolveTarget(name = DEFAULT_TARGET) {
  const target = MUTATION_TARGETS[name];
  if (!target) {
    const known = Object.keys(MUTATION_TARGETS).join(", ");
    throw new Error(
      `Unknown MUTATION_TARGET "${name}". Known targets: ${known}`,
    );
  }
  return target;
}
