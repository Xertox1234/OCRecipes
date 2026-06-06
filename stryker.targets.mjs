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

/** @typedef {{ mutate: string[], testInclude: string[], breakThreshold?: number }} MutationTarget */
/** @typedef {{ approvedOn: string, planPath: string, note: string }} ApprovalEntry */

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
  "goal-calculator": {
    mutate: ["server/services/goal-calculator.ts"],
    testInclude: ["server/services/__tests__/goal-calculator.test.ts"],
    breakThreshold: 100, // all survivors killed (Task 3); no equivalents
  },
  "adaptive-goals": {
    mutate: ["server/services/adaptive-goals.ts"],
    testInclude: ["server/services/__tests__/adaptive-goals.test.ts"],
    // Achieved 99.35% (152/153 killed). The 1 residual survivor is a verified
    // equivalent mutant (`"maintain"` -> `""`, see accepted-equivalents.json) that
    // cannot be killed (no input distinguishes it) and is not suppressed in source
    // (read-only on Hard-Exclusion modules). break=99 leaves margin: any NEW survivor
    // drops the score to ~98.7, below the threshold. No *test* can swap the
    // equivalent for a new gap at the same count; a future refactor of line 203
    // could, so re-triage when the source changes (the CI gate runs exactly then).
    breakThreshold: 99,
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

/**
 * Human-approved Hard-Exclusion targets. An excluded module may be mutation-tested
 * ONLY if its source path appears here with a non-empty planPath + note — recording
 * that a human-authored plan exists. Fail-closed: a stub/empty entry does not count.
 *
 * @type {Record<string, ApprovalEntry>}
 */
export const HUMAN_APPROVED_EXCLUSIONS = {
  "server/services/goal-calculator.ts": {
    approvedOn: "2026-06-05",
    planPath: "docs/mutation-testing/README.md",
    note: "Goal-safety mutation testing under the gated read-only protocol (tests only; source never edited). See README 'Approved Hard-Exclusion targets'.",
  },
  "server/services/adaptive-goals.ts": {
    approvedOn: "2026-06-05",
    planPath: "docs/mutation-testing/README.md",
    note: "Goal-safety mutation testing under the gated read-only protocol (tests only; source never edited). See README 'Approved Hard-Exclusion targets'.",
  },
};

// Hard-Exclusion path matcher (lifted verbatim from the original guard test so the
// CLI, the explore config, and the guard test all share ONE definition — no drift).
const HARD_EXCLUSION_RE =
  /(^|\/)auth\.ts|api-key-auth|goal-calculator|adaptive-goals|receipt-validation|healthkit|(^|\/)health\.ts|jwt-|shared\/schema\.ts|(^|\/)migrations\//i;

/**
 * @param {string} path
 * @returns {boolean} true if `path` is a Hard-Exclusion module/test.
 */
export function isHardExclusion(path) {
  return HARD_EXCLUSION_RE.test(path);
}

/**
 * @param {string} path
 * @param {Record<string, ApprovalEntry>} [approvals]
 * @returns {boolean} true if `path` has a non-empty (planPath + note) approval.
 */
export function isApprovedExclusion(
  path,
  approvals = HUMAN_APPROVED_EXCLUSIONS,
) {
  const a = approvals[path];
  return Boolean(a && a.planPath?.trim() && a.note?.trim());
}

/**
 * Throw unless every Hard-Exclusion target is human-approved. A target is
 * Hard-Exclusion if any of its paths (mutate OR testInclude) matches
 * isHardExclusion; it is allowed only if it has at least one `mutate` source and
 * each `mutate` source is an approved exclusion (fail-closed). A target flagged
 * solely by a `testInclude` path with an empty `mutate` has no source to key an
 * approval to, so it is rejected rather than silently allowed.
 * @param {string} name
 * @param {MutationTarget} target
 * @param {Record<string, ApprovalEntry>} [approvals]
 */
export function assertAllowedTarget(
  name,
  target,
  approvals = HUMAN_APPROVED_EXCLUSIONS,
) {
  const paths = [...target.mutate, ...target.testInclude];
  if (!paths.some(isHardExclusion)) return; // non-excluded → always allowed
  if (target.mutate.length === 0) {
    throw new Error(
      `Hard-Exclusion target "${name}" is flagged via a testInclude path but has no ` +
        `\`mutate\` source to approve. It cannot be allowed (fail-closed).`,
    );
  }
  for (const src of target.mutate) {
    if (!isApprovedExclusion(src, approvals)) {
      throw new Error(
        `Hard-Exclusion target "${name}" requires a HUMAN_APPROVED_EXCLUSIONS entry ` +
          `with a non-empty planPath + note for "${src}". A human-authored plan is required first.`,
      );
    }
  }
}
