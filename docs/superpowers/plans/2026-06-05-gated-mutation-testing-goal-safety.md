# Gated Mutation Testing for the Goal-Safety Domain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (NOT subagent-driven — Tasks 1 and 4–5 touch the Hard-Exclusion gate and author goal-safety test assertions, which are **non-delegatable** per `.github/copilot-instructions.md` Hard Exclusions). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the goal-safety Hard-Exclusion domain (`adaptive-goals.ts` deep + `goal-calculator.ts` ride-along) under mutation testing via a reusable, read-only, human-gated protocol — without ever editing the crown-jewel source.

**Architecture:** Extend `stryker.targets.mjs` into the single source of truth for both the target map **and** the Hard-Exclusion gate (`isHardExclusion`, `isApprovedExclusion`, `assertAllowedTarget` + a `HUMAN_APPROVED_EXCLUSIONS` allowlist). Invert the registry guard test from "forbidden ⇒ fail" to "forbidden-and-unapproved ⇒ fail" (fail-closed). Add a gate-respecting `mutation:explore` CLI for read-only spikes. Triage survivors **tests-only** (source never edited): boundary survivors via on-the-tie inputs, numeric survivors via double-derivation (in-session hand-derivation + a second-channel oracle + a deterministic reference calc), and any genuine equivalents recorded in a tracked allowlist rather than suppressed in source. Enforce via a required, self-scoping PR gate using Stryker `thresholds.break`.

**Tech Stack:** Stryker 9.6.1 (`thresholds.break` verified: `null | percentage`), Vitest 4.1.7, Node ESM (`.mjs`), `tsx` (installed 4.22.3), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-05-gated-mutation-testing-goal-safety-design.md`

---

## ⛔ NON-DELEGATION + READ-ONLY STOP (read before starting)

1. **Never edit `server/services/adaptive-goals.ts` or `server/services/goal-calculator.ts`.** Only their `__tests__` files change. No `// Stryker disable` comments, no dead-code removal. Genuine equivalents go in `docs/mutation-testing/accepted-equivalents.json`; dead code is **escalated to the human**, not removed.
2. **Tasks 1, 4, 5 are authored in-session, never delegated to a subagent/Copilot.** Task 1 inverts the security guard protecting _every_ Hard-Exclusion module; Tasks 4–5 author goal-safety assertions where a wrong expected value locks in an unsafe expectation.
3. **Mismatch rule:** if an independently-derived assertion disagrees with the SUT output, **STOP and escalate to the human** — it is a candidate defect. Never adjust the assertion to match the code.

## Branch setup

From an up-to-date `main` (the `branch-preflight` hook blocks commits on `main`; `SKIP_BRANCH_PREFLIGHT=1` is set in the launching shell if needed):

```bash
git switch main && git pull --rebase && git switch -c feat/gated-mutation-goal-safety
```

Every commit uses explicit `git add <named files>`, never `git add -A`. The Kimi review gate runs automatically on commit (CRITICAL blocks). No `--auto` merge anywhere.

## File structure

- `stryker.targets.mjs` (modify) — add gate helpers + `HUMAN_APPROVED_EXCLUSIONS` + two goal-safety targets. The single source of truth for targets **and** the gate.
- `test/stryker-targets.test.ts` (modify) — invert the policy guard; add fail-closed + pass fixtures.
- `stryker.explore.conf.mjs` (create) — committed read-only exploration config; re-enforces the gate so it can't be bypassed.
- `scripts/mutation-explore.mjs` (create) — gate-respecting CLI; pure ESM (`.mjs`, mirrors `stryker.conf.mjs`) to avoid the `.ts`→`.mjs` type-aware-ESLint trap.
- `package.json` (modify) — add `mutation:explore` script.
- `server/services/__tests__/goal-calculator.test.ts` (modify) — add 2 untested-goal cases (Phase B).
- `server/services/__tests__/adaptive-goals.test.ts` (modify) — strengthen/add assertions to kill 37 survivors (Phase C).
- `.github/workflows/mutation-goal-safety.yml` (create) — required, self-scoping PR gate.
- `docs/mutation-testing/baselines.md` (modify) — before/after rows.
- `docs/mutation-testing/README.md` (modify) — distinguish excluded read-only vs non-excluded inline suppression; list approved targets.
- `docs/mutation-testing/accepted-equivalents.json` (create only if a genuine equivalent survives triage).
- `docs/solutions/best-practices/gated-mutation-testing-hard-exclusion-2026-06-05.md` (create) — codify the protocol.

---

## Task 1: Registry gate helpers + goal-safety targets (TDD) — NON-DELEGATABLE

**Files:**

- Modify: `stryker.targets.mjs`
- Modify: `test/stryker-targets.test.ts`

- [ ] **Step 1: Rewrite the policy-guard test (inverted) + add fixtures**

In `test/stryker-targets.test.ts`, update the import block and **replace** the existing `"never registers a Hard-Exclusion module (policy guard)"` test with the block below. Keep the other three tests (`resolves both axes`, `defaults to macro-gap-context`, `throws … unknown target`) unchanged.

```ts
import { describe, it, expect } from "vitest";
import {
  MUTATION_TARGETS,
  DEFAULT_TARGET,
  resolveTarget,
  isHardExclusion,
  isApprovedExclusion,
  assertAllowedTarget,
  HUMAN_APPROVED_EXCLUSIONS,
} from "../stryker.targets.mjs";

describe("Hard-Exclusion gate", () => {
  it("flags excluded paths and clears non-excluded ones", () => {
    expect(isHardExclusion("server/middleware/auth.ts")).toBe(true);
    expect(isHardExclusion("server/services/goal-calculator.ts")).toBe(true);
    expect(isHardExclusion("server/services/adaptive-goals.ts")).toBe(true);
    expect(isHardExclusion("server/lib/verification-consensus.ts")).toBe(false);
    expect(isHardExclusion("server/lib/macro-gap-context.ts")).toBe(false);
  });

  it("every registered target passes the approval gate", () => {
    for (const [name, target] of Object.entries(MUTATION_TARGETS)) {
      expect(() => assertAllowedTarget(name, target)).not.toThrow();
    }
  });

  it("throws for an unapproved Hard-Exclusion target", () => {
    expect(() =>
      assertAllowedTarget("fake-auth", {
        mutate: ["server/middleware/auth.ts"],
        testInclude: ["server/__tests__/auth.test.ts"],
      }),
    ).toThrow(/HUMAN_APPROVED_EXCLUSIONS/);
  });

  it("fail-closed: an approval entry with an empty note does NOT count", () => {
    const approvals = {
      "server/middleware/auth.ts": {
        approvedOn: "x",
        planPath: "p",
        note: "   ",
      },
    };
    expect(() =>
      assertAllowedTarget(
        "fake-auth",
        {
          mutate: ["server/middleware/auth.ts"],
          testInclude: ["server/__tests__/auth.test.ts"],
        },
        approvals,
      ),
    ).toThrow();
  });

  it("passes for an approval entry with non-empty note + planPath", () => {
    const approvals = {
      "server/middleware/auth.ts": {
        approvedOn: "2026-06-05",
        planPath: "docs/mutation-testing/README.md",
        note: "approved for a test",
      },
    };
    expect(() =>
      assertAllowedTarget(
        "fake-auth",
        {
          mutate: ["server/middleware/auth.ts"],
          testInclude: ["server/__tests__/auth.test.ts"],
        },
        approvals,
      ),
    ).not.toThrow();
  });

  it("the two goal-safety modules are approved with provenance", () => {
    for (const src of [
      "server/services/goal-calculator.ts",
      "server/services/adaptive-goals.ts",
    ]) {
      expect(isApprovedExclusion(src)).toBe(true);
      expect(HUMAN_APPROVED_EXCLUSIONS[src].planPath.trim()).not.toBe("");
      expect(HUMAN_APPROVED_EXCLUSIONS[src].note.trim()).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/stryker-targets.test.ts`
Expected: FAIL — `isHardExclusion`, `assertAllowedTarget`, etc. are not exported yet.

- [ ] **Step 3: Add gate helpers + approval map + targets to the registry**

In `stryker.targets.mjs`: extend the typedef block, add the two goal-safety targets to `MUTATION_TARGETS`, and append the gate code. Replace the typedef line and add the new target entries:

```js
/** @typedef {{ mutate: string[], testInclude: string[], breakThreshold?: number }} MutationTarget */
/** @typedef {{ approvedOn: string, planPath: string, note: string }} ApprovalEntry */
```

Add to `MUTATION_TARGETS` (after `verification-consensus`):

```js
  "goal-calculator": {
    mutate: ["server/services/goal-calculator.ts"],
    testInclude: ["server/services/__tests__/goal-calculator.test.ts"],
  },
  "adaptive-goals": {
    mutate: ["server/services/adaptive-goals.ts"],
    testInclude: ["server/services/__tests__/adaptive-goals.test.ts"],
  },
```

Append at the end of the file (after `resolveTarget`):

```js
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
  /(^|\/)auth\.ts|api-key-auth|goal-calculator|adaptive-goals|receipt-validation|healthkit|(^|\/)health\.ts|jwt-/i;

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
 * Hard-Exclusion if any of its paths matches isHardExclusion; it is allowed only if
 * each of its `mutate` source paths is an approved exclusion (fail-closed).
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
  for (const src of target.mutate) {
    if (!isApprovedExclusion(src, approvals)) {
      throw new Error(
        `Hard-Exclusion target "${name}" requires a HUMAN_APPROVED_EXCLUSIONS entry ` +
          `with a non-empty planPath + note for "${src}". A human-authored plan is required first.`,
      );
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/stryker-targets.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Type-check + lint the registry change**

Run: `npm run check:types && npm run lint`
Expected: both PASS. (`stryker.targets.mjs` is `.mjs` with `// @ts-check`; `test/stryker-targets.test.ts` is in the type-aware block.)

- [ ] **Step 6: Commit**

```bash
git add stryker.targets.mjs test/stryker-targets.test.ts
git commit -m "feat(test): gate registry for human-approved Hard-Exclusion targets (goal-safety)"
```

---

## Task 2: Gate-respecting exploration CLI (read-only spikes)

**Files:**

- Create: `stryker.explore.conf.mjs`
- Create: `scripts/mutation-explore.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the committed explore config (gate re-enforced)**

Create `stryker.explore.conf.mjs`:

```js
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
```

- [ ] **Step 2: Create the CLI**

Create `scripts/mutation-explore.mjs`:

```js
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
```

- [ ] **Step 3: Add the npm script**

In `package.json` `"scripts"`, add after `"test:mutation"`:

```json
    "mutation:explore": "node scripts/mutation-explore.mjs",
```

(Pure ESM JS — `node` runs it directly; no `tsx` needed.)

- [ ] **Step 4: Verify all three gate modes**

Run (non-excluded → runs a baseline):

```bash
DATABASE_URL= npm run mutation:explore -- server/lib/macro-gap-context.ts server/lib/__tests__/macro-gap-context.test.ts
```

Expected: a clear-text mutation table prints (no refusal).

Run (excluded, no `--spike` → refused):

```bash
npm run mutation:explore -- server/middleware/auth.ts server/__tests__/auth.test.ts
```

Expected: the `⛔` refusal banner; exit code 1; **no Stryker run**.

Run (excluded, `--spike` → read-only baseline with banner):

```bash
DATABASE_URL= npm run mutation:explore -- server/services/adaptive-goals.ts server/services/__tests__/adaptive-goals.test.ts --spike
```

Expected: the `⚠️` SPIKE banner, then a mutation table (this is the same read-only baseline used to size this plan).

- [ ] **Step 5: Type-check + lint**

Run: `npm run check:types && npm run lint`
Expected: both PASS (both new files are `.mjs`, outside the `**/*.{ts,tsx}` type-aware block).

- [ ] **Step 6: Commit**

```bash
git add stryker.explore.conf.mjs scripts/mutation-explore.mjs package.json
git commit -m "feat(test): add gate-respecting mutation:explore CLI for read-only spikes"
```

---

## Task 3: goal-calculator ride-along — kill the 2 untested-goal survivors (Phase B)

The baseline is 95.24% / 2 survivors, both `ObjectLiteral`: `MACRO_SPLITS.eat_healthier` and `MACRO_SPLITS.manage_condition` → `{}` (those goals are never passed to `calculateGoals`). Both are non-safety (untested goal variants), so no double-derivation is required — just exercise the goals. **Tests only; never edit `goal-calculator.ts`.**

**Files:**

- Modify: `server/services/__tests__/goal-calculator.test.ts`

- [ ] **Step 1: Record the baseline**

Run: `DATABASE_URL= MUTATION_TARGET=goal-calculator npm run test:mutation`
Expected: `Mutation score: 95.24%`, 2 survived (the two `ObjectLiteral` mutants at `goal-calculator.ts:66` and `:67`). Note the numbers for Task 7.

- [ ] **Step 2: Add the two failing-against-mutant tests**

In `server/services/__tests__/goal-calculator.test.ts`, inside `describe("calculateGoals", …)`, add after the existing `"calculates fat using 9 calories per gram"` test:

```ts
it("applies the eat_healthier macro split (45% carbs / 30% protein / 25% fat)", () => {
  const profile: UserPhysicalProfile = {
    weight: 70,
    height: 175,
    age: 30,
    gender: "male",
    activityLevel: "moderate",
    primaryGoal: "eat_healthier",
  };

  const goals = calculateGoals(profile);

  // Ratios written independently of the source (0.45/0.30/0.25); the ObjectLiteral
  // mutant `eat_healthier: {}` makes split.* undefined -> NaN, which fails toBe.
  expect(goals.dailyProtein).toBe(Math.round((goals.dailyCalories * 0.3) / 4));
  expect(goals.dailyCarbs).toBe(Math.round((goals.dailyCalories * 0.45) / 4));
  expect(goals.dailyFat).toBe(Math.round((goals.dailyCalories * 0.25) / 9));
});

it("applies the manage_condition macro split (30/40/30; no NaN)", () => {
  const profile: UserPhysicalProfile = {
    weight: 70,
    height: 175,
    age: 30,
    gender: "male",
    activityLevel: "moderate",
    primaryGoal: "manage_condition",
  };

  const goals = calculateGoals(profile);

  // `manage_condition: {}` -> NaN macros; these exact-value assertions kill it.
  expect(goals.dailyProtein).toBe(Math.round((goals.dailyCalories * 0.3) / 4));
  expect(goals.dailyCarbs).toBe(Math.round((goals.dailyCalories * 0.4) / 4));
  expect(goals.dailyFat).toBe(Math.round((goals.dailyCalories * 0.3) / 9));
});
```

- [ ] **Step 3: Confirm the new tests pass against real code**

Run: `npx vitest run server/services/__tests__/goal-calculator.test.ts`
Expected: PASS (26 tests). If a value assertion fails, the expected value is wrong — fix the assertion, never the source.

- [ ] **Step 4: Re-run mutation to confirm 100%**

Run: `DATABASE_URL= MUTATION_TARGET=goal-calculator npm run test:mutation`
Expected: `Mutation score: 100%`, 0 survived. Note for Task 7.

- [ ] **Step 5: Commit**

```bash
git add server/services/__tests__/goal-calculator.test.ts
git commit -m "test(goals): cover eat_healthier + manage_condition macro splits (mutation 95.24% -> 100%)"
```

---

## Task 4: adaptive-goals baseline (Phase C, gated) — NON-DELEGATABLE

**Files:** none changed (run + record).

- [ ] **Step 1: Run the baseline**

Run: `DATABASE_URL= MUTATION_TARGET=adaptive-goals npm run test:mutation`
Expected: `Mutation score: ~75.82%`, ~37 survived, 0 no-coverage (the service test mocks `../../storage`, so it is DB-free). HTML report at `reports/mutation/adaptive-goals.html`.

- [ ] **Step 2: Record raw numbers for Task 7**

Note score + the four counts. Open the HTML report (or re-read the clear-text `[Survived]` lines) — this is the worklist for Task 5. Bucket each survivor by mutator: `EqualityOperator`/`ConditionalExpression`/`LogicalOperator` → boundary; `ArithmeticOperator` → numeric (or operator-flip); `ObjectLiteral`/`MethodExpression`/`ArrowFunction`/`StringLiteral` → weak-assertion/structural. (No commit — baseline is committed in Task 7.)

---

## Task 5: adaptive-goals triage micro-cycle (Phase C, GATED) — NON-DELEGATABLE

Repeat the micro-cycle **once per survivor** until the report shows zero un-triaged survivors. **Tests only — never edit `adaptive-goals.ts`.** Three worked examples (one per decision-tree branch) share a single `computeAdaptiveGoals` setup; apply the same shapes to the rest. All three are real survivor locations from the baseline.

**Files:**

- Modify: `server/services/__tests__/adaptive-goals.test.ts`

> **The micro-cycle (per survivor):**
>
> 1. Pick a survivor from the report; note `file:line:mutator`.
> 2. **Classify** via the decision tree (boundary / numeric / weak-assertion / equivalent).
> 3. **Author a test** that kills it (below). For **numeric** survivors, run the double-derivation (Step "numeric example"). For **boundary** survivors, feed the on-the-tie input. For **weak-assertion** survivors, pin the derived value.
> 4. **Run the unit test** against real code; it must PASS. If your independently-derived expected value disagrees with the SUT, **STOP and escalate to the human** (candidate defect) — do not change the assertion to match.
> 5. **Re-run mutation**; confirm the survivor is now `Killed`. Commit per small batch.
> 6. If a survivor is a **genuine equivalent** (no input distinguishes it), do **NOT** suppress in source — note it for `accepted-equivalents.json` (Task 7) and move on.

- [ ] **Step 1 (shared setup): import the helper used by the examples**

The existing test mocks `../../storage`. Confirm the import block includes `computeAdaptiveGoals` (it does). The examples below add `it()` blocks inside the existing `describe("computeAdaptiveGoals", …)`, each setting its own mocks via the file's existing `vi.mocked(storage.*)` pattern.

- [ ] **Step 2 (BOUNDARY example — `adaptive-goals.ts:186` `daySpan < 14`, EqualityOperator):**

At exactly 14 days the guard must **proceed** (14 days = "at least 2 weeks"); the mutant `<= 14` would wrongly `return null`. Feed a span of exactly 14 days with ≥4 logs and >10% deviation, and assert a recommendation **is** returned.

```ts
it("proceeds at exactly 14 days of data (daySpan boundary)", async () => {
  const day = (n: number) => new Date(2026, 0, 1 + n).toISOString(); // n days after Jan 1 2026
  vi.mocked(storage.getUser).mockResolvedValue({
    dailyCalorieGoal: 2000,
    dailyProteinGoal: 100,
    dailyCarbsGoal: 100,
    dailyFatGoal: 100,
  } as any);
  vi.mocked(storage.getUserProfile).mockResolvedValue({
    primaryGoal: "maintain",
  } as any);
  vi.mocked(storage.getWeightLogs).mockResolvedValue([
    { weight: "80", loggedAt: day(0) },
    { weight: "79", loggedAt: day(5) },
    { weight: "78.5", loggedAt: day(10) },
    { weight: "78", loggedAt: day(14) }, // span = exactly 14 days
  ] as any);

  const result = await computeAdaptiveGoals("user-1");

  // weightChange = -2kg over 14d -> tdee = 2000 - (-2*7700/14) = 3100;
  // deviation = |3100-2000|/2000 = 0.55 > 0.1 -> a recommendation is returned.
  // `daySpan < 14` (14<14 false) proceeds; mutant `<= 14` returns null -> killed.
  expect(result).not.toBeNull();
});
```

- [ ] **Step 3 (NUMERIC example — `adaptive-goals.ts:246` `Math.round(weeklyRate * 100) / 100`, ArithmeticOperator) — DOUBLE-DERIVATION:**

`weightTrendRate` is a numeric output → run the double-derivation before committing the expected value:

- **Derivation A (in-session hand):** `weeklyRate = (weightChange / daySpan) * 7 = (-2 / 14) * 7 = -1.0`; `weightTrendRate = Math.round(-1.0 * 100) / 100 = Math.round(-100) / 100 = -1`.
- **Derivation B-oracle (second channel):** ask the oracle to compute `weightTrendRate` from the formula `round((weightChange/daySpan)*7 * 100)/100` with `weightChange=-2, daySpan=14`, **without** the SUT. Expect `-1`.
- **Derivation B-reference (deterministic):** `node -e "console.log(Math.round((-2/14)*7*100)/100)"` → `-1`.
- All three agree → assert `-1`. (Mutants `*100)*100` → `-10000` and `weeklyRate/100` → `~0` both fail.)

Add the assertion to the same `it()` as Step 2 (the setup already yields these numbers):

```ts
// (append inside the daySpan boundary test, after the not-toBeNull assertion)
// Double-derivation agreed: weeklyRate=(-2/14)*7=-1.0 -> round(-100)/100 = -1.
expect(result?.weightTrendRate).toBe(-1);
```

- [ ] **Step 4 (WEAK-ASSERTION example — `adaptive-goals.ts:218` `currentMacros = {…}`, ObjectLiteral):**

The mutant `currentMacros = {}` makes `recomputeMacros` receive `undefined` macros → `NaN` outputs. Pin the recomputed macros so the survivor dies. Derive the expected via double-derivation (numeric outputs): with current macros `{protein:100, carbs:100, fat:100}` and `safeCalories = clampCalories(3100) = 3100`:

- `total = 100*4 + 100*4 + 100*9 = 1700`; `proteinRatio = 400/1700`; `newProtein = Math.round(3100 * (400/1700) / 4) = Math.round(182.35) = 182`. Cross-check with oracle + `node -e "console.log(Math.round(3100*(400/1700)/4))"` → `182`.

```ts
// (append inside the same test) currentMacros must flow into recomputeMacros;
// the `{}` mutant yields NaN. Double-derivation agreed newProtein = 182.
expect(result?.newProtein).toBe(182);
expect(Number.isFinite(result?.newCarbs)).toBe(true);
expect(Number.isFinite(result?.newFat)).toBe(true);
```

- [ ] **Step 5: Run the unit test (real code) for the worked examples**

Run: `npx vitest run server/services/__tests__/adaptive-goals.test.ts`
Expected: PASS. If `weightTrendRate` or `newProtein` disagrees, **escalate** — your derivation or a SUT defect, not an assertion to silently "fix".

- [ ] **Step 6: Work the remaining survivors with the same shapes**

For each remaining survivor in the report, apply the matching branch:

- **Boundary** (`EqualityOperator`/`ConditionalExpression`/`LogicalOperator` at lines 128, 133, 138, 173, 186, 196–198, 203, 212): feed the on-the-tie / both-sides inputs (e.g. `deviation` exactly `0.1` to pin `< 0.1`; `weightLogs.length` exactly `4` and `3`; `goal === "lose_weight"` with `weightChange` exactly `0`) and assert the documented branch.
- **Numeric** (`ArithmeticOperator` at 162, 176, 184, 189, 211, 246): double-derivation (A + oracle + reference) then a `toBe(<number>)`.
- **Weak-assertion/structural** (`ObjectLiteral`/`MethodExpression`/`ArrowFunction`/`StringLiteral` at 162, 167, 175–176, 203, 218): pin the derived value / assert the order-dependent or default behavior (e.g. null profile → `reason`/macros consistent with `"maintain"`).
- **Genuine equivalent:** record for `accepted-equivalents.json` (Task 7). Do **not** suppress in source.

Re-run `DATABASE_URL= MUTATION_TARGET=adaptive-goals npm run test:mutation` after each small batch (incremental cache makes this fast); commit per batch:

```bash
git add server/services/__tests__/adaptive-goals.test.ts
git commit -m "test(goals): kill adaptive-goals mutation survivors (boundary/numeric batch N)"
```

- [ ] **Step 7: Final confirmation**

Run: `DATABASE_URL= MUTATION_TARGET=adaptive-goals npm run test:mutation`
Expected: every survivor is `Killed`, OR is in the accepted-equivalents list. Record the final score for Task 7. Confirm `git diff --stat` shows **no change to `server/services/adaptive-goals.ts`**.

---

## Task 6: Required, self-scoping PR gate (Phase D)

**Files:**

- Modify: `stryker.targets.mjs` (add `breakThreshold` to the two goal-safety targets)
- Modify: `stryker.conf.mjs` (honor `breakThreshold`)
- Create: `.github/workflows/mutation-goal-safety.yml`

- [ ] **Step 1: Add `breakThreshold` to the goal-safety targets**

In `stryker.targets.mjs`, set the achieved scores from Tasks 3 & 5 (use the **final** numbers; `100` for goal-calculator, and the adaptive-goals final — `100` if every survivor was killed):

```js
  "goal-calculator": {
    mutate: ["server/services/goal-calculator.ts"],
    testInclude: ["server/services/__tests__/goal-calculator.test.ts"],
    breakThreshold: 100,
  },
  "adaptive-goals": {
    mutate: ["server/services/adaptive-goals.ts"],
    testInclude: ["server/services/__tests__/adaptive-goals.test.ts"],
    breakThreshold: 100, // set to the residual score if genuine equivalents remained
  },
```

- [ ] **Step 2: Honor `breakThreshold` in the Stryker config**

In `stryker.conf.mjs`, change the resolve line and add `thresholds`:

```js
const targetName = process.env.MUTATION_TARGET ?? "macro-gap-context";
const target = resolveTarget(targetName);
const { mutate, testInclude } = target;
```

In the exported `config` object, add (after `mutate,`):

```js
  ...(target.breakThreshold != null
    ? { thresholds: { high: 80, low: 60, break: target.breakThreshold } }
    : {}),
```

(Stryker `thresholds.break` is `null | percentage`; verified. Targets without `breakThreshold` — `macro-gap-context`, `verification-consensus` — keep no break, unchanged behavior.)

- [ ] **Step 3: Verify the break gate locally**

Run: `DATABASE_URL= MUTATION_TARGET=goal-calculator npm run test:mutation`
Expected: exit code 0 at 100% (≥ break). (Sanity: if you temporarily lowered a target below break, Stryker would exit non-zero — do not commit that.)

- [ ] **Step 4: Create the self-scoping workflow**

Create `.github/workflows/mutation-goal-safety.yml`:

```yaml
name: Mutation testing (goal-safety)

on:
  pull_request:

jobs:
  mutation-goal-safety:
    name: Mutation (goal-safety)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Detect target changes
        id: changed
        run: |
          git fetch origin "${{ github.base_ref }}" --depth=1
          if git diff --name-only "origin/${{ github.base_ref }}...HEAD" \
            | grep -qE '^(server/services/(goal-calculator|adaptive-goals)\.ts|server/services/__tests__/(goal-calculator|adaptive-goals)\.test\.ts|stryker\.(conf|targets|explore\.conf)\.mjs|vitest\.mutation\.config\.ts)$'; then
            echo "run=true" >> "$GITHUB_OUTPUT"
          else
            echo "run=false" >> "$GITHUB_OUTPUT"
          fi
      - name: Self-scope to success (no goal-safety target changed)
        if: steps.changed.outputs.run == 'false'
        run: echo "No goal-safety target changed; gate self-scopes to success."
      - uses: actions/setup-node@v4
        if: steps.changed.outputs.run == 'true'
        with:
          node-version: 24
          cache: npm
      - name: Install dependencies
        if: steps.changed.outputs.run == 'true'
        run: npm ci
      - name: Mutation test (goal-calculator)
        if: steps.changed.outputs.run == 'true'
        run: MUTATION_TARGET=goal-calculator npm run test:mutation
      - name: Mutation test (adaptive-goals)
        if: steps.changed.outputs.run == 'true'
        run: MUTATION_TARGET=adaptive-goals npm run test:mutation
```

(DB-free — both targets' tests are pure/mocked, and `vitest.mutation.config.ts` drops `globalSetup`. The job always reports — green in seconds when nothing relevant changed — so it is safe to mark **required**.)

- [ ] **Step 5: Lint the registry/config changes + validate YAML**

Run: `npm run check:types && npm run lint`
Expected: PASS. Eyeball the YAML indentation (mirrors `mutation.yml`/`e2e-smoke.yml`).

- [ ] **Step 6: Commit**

```bash
git add stryker.targets.mjs stryker.conf.mjs .github/workflows/mutation-goal-safety.yml
git commit -m "ci(test): required self-scoping goal-safety mutation gate (break=achieved)"
```

> **Post-merge (human, not a code step):** after this PR merges and the check reports once, an admin adds `Mutation (goal-safety)` to `main` branch protection as a required check.

---

## Task 7: Durable records — baselines, README, equivalents, solution doc (Phase D)

**Files:**

- Modify: `docs/mutation-testing/baselines.md`
- Modify: `docs/mutation-testing/README.md`
- Create (only if a genuine equivalent survived Task 5): `docs/mutation-testing/accepted-equivalents.json`
- Create: `docs/solutions/best-practices/gated-mutation-testing-hard-exclusion-2026-06-05.md`

- [ ] **Step 1: Append baseline rows**

Add to the table in `docs/mutation-testing/baselines.md` (fill the bracketed adaptive-goals "after" from Task 5):

```markdown
| 2026-06-05 | goal-calculator (before) | 95.24% | 40 | 2 | 0 | 0 |
| 2026-06-05 | goal-calculator (after) | 100% | 42 | 0 | 0 | 0 |
| 2026-06-05 | adaptive-goals (before) | 75.82% | 116 | 37 | 0 | 0 |
| 2026-06-05 | adaptive-goals (after) | [NN%] | [n] | [n] | 0 | 0 |
```

- [ ] **Step 2: Fix the README contradictions**

In `docs/mutation-testing/README.md`, replace the `## Scope & policy` and `## Baselines` sections with:

```markdown
## Scope & policy

Non-excluded, logic-dense modules are targeted freely. Hard Exclusions (auth,
goal-safety, IAP, health-data, secrets, schema/migrations;
`.github/copilot-instructions.md`) may be targeted ONLY under a human-authored plan
and a `HUMAN_APPROVED_EXCLUSIONS` entry in `stryker.targets.mjs`, and ONLY read-only:
their **source is never edited** (no inline `// Stryker disable`, no dead-code
removal) — see the gated protocol solution doc.

### Approved Hard-Exclusion targets

| Module                               | Approved   | Plan                                 |
| ------------------------------------ | ---------- | ------------------------------------ |
| `server/services/goal-calculator.ts` | 2026-06-05 | Goal-safety gated read-only protocol |
| `server/services/adaptive-goals.ts`  | 2026-06-05 | Goal-safety gated read-only protocol |

## Baselines

See `baselines.md` for tracked scores.

- **Non-excluded** modules: equivalent mutants are suppressed inline in source with
  `// Stryker disable next-line <mutator> -- <reason>`.
- **Hard-Exclusion** modules (read-only): equivalents are NEVER suppressed in source —
  they are recorded in `accepted-equivalents.json` (`file:line:mutator` + reason), and
  CI asserts the surviving set is a subset of that allowlist.
```

- [ ] **Step 3: Create the equivalents allowlist ONLY if needed**

If Task 5 left zero genuine equivalents (adaptive-goals reached 100%), **skip this file** (`breakThreshold: 100` is the gate). If equivalents remained, create `docs/mutation-testing/accepted-equivalents.json`:

```json
{
  "adaptive-goals": [
    {
      "file": "server/services/adaptive-goals.ts",
      "line": 0,
      "mutator": "MutatorName",
      "reason": "Concrete equivalence argument: no input distinguishes mutant from original because …"
    }
  ]
}
```

(If you create this, also lower the adaptive-goals `breakThreshold` to the residual score in Task 6 Step 1 and add a CI step parsing Stryker's JSON report to assert `survivors ⊆ accepted`. Per the spec's fragility note, prefer the empty-allowlist path.)

- [ ] **Step 4: Codify the protocol (solution doc)**

Create `docs/solutions/best-practices/gated-mutation-testing-hard-exclusion-2026-06-05.md` capturing: the operation × rigor matrix (read-only on excluded source); the registry-approval gate (`HUMAN_APPROVED_EXCLUSIONS` + shared `isHardExclusion`/`assertAllowedTarget`); the triage decision-tree (boundary / numeric-double-derivation / weak-assertion); the mismatch-escalation rule (inverts the non-excluded "fix the assertion" convention); the verification chain; the self-scoping required-gate + survivor-set pattern; and the modest-reusability caveat (oracle is numeric-specific; auth/IAP need their own harness plans). Link `[[stryker-vitest4-mutation-testing-harness-2026-06-05]]` and `[[mutation-testing-suppress-only-equivalent-mutants-2026-06-05]]`.

- [ ] **Step 5: Verify tracked paths + commit**

Run: `git check-ignore docs/mutation-testing/baselines.md docs/mutation-testing/README.md || echo "tracked OK"`
Expected: `tracked OK` (the solution doc + this plan/spec are gitignored by convention — expected).

```bash
git add docs/mutation-testing/baselines.md docs/mutation-testing/README.md
# add docs/mutation-testing/accepted-equivalents.json only if you created it
git commit -m "docs(test): record goal-safety mutation baselines + gated read-only README"
```

---

## Task 8: Open the PR (no auto-merge)

- [ ] **Step 1: Push + open**

```bash
git push -u origin feat/gated-mutation-goal-safety
gh pr create --fill --base main
```

- [ ] **Step 2: Watch checks, then request review**

Run: `gh pr checks --watch`
Expected: all required checks green (including the new self-scoping mutation gate, which runs because this PR touches the target files). Do **NOT** add `--auto` — this touches Hard-Exclusion test files and test infra; it is human-reviewed.

---

## Validation summary (from the spec)

1. **Fail-closed gate, both cases:** `assertAllowedTarget` throws for an unapproved excluded target and for an empty-`note` approval; passes for a non-empty `note` + `planPath` (Task 1 Step 1).
2. **`mutation:explore` three modes:** non-excluded runs; excluded-without-`--spike` refused; excluded-with-`--spike` read-only baseline (Task 2 Step 4).
3. **Deliberate-mismatch is operative:** the micro-cycle Step 4/5 escalates on derivation-vs-SUT disagreement rather than silently reconciling (Task 5).
4. **Read-only proven:** `git diff --stat` shows zero changes to `goal-calculator.ts` / `adaptive-goals.ts` (Task 5 Step 7).
5. **Required gate never deadlocks:** self-scopes to green in seconds on unrelated PRs; runs Stryker (with `break`) on target-touching PRs (Task 6 Step 4); admin marks required post-merge.
6. **`check:types` + `lint` pass after the Phase A changes** (Task 1 Step 5, Task 2 Step 5) — the guard against a `.ts`→`.mjs` regression.

## Self-review notes (author)

- **Spec coverage:** registry gate + shared helpers (T1), explore CLI (T2), goal-calculator ride-along (T3), adaptive-goals baseline (T4) + gated triage decision-tree (T5), required self-scoping CI + break (T6), baselines/README/equivalents/solution doc (T7), PR no-auto-merge (T8). Every spec component maps to a task.
- **Type consistency:** `isHardExclusion`, `isApprovedExclusion`, `assertAllowedTarget`, `HUMAN_APPROVED_EXCLUSIONS`, `breakThreshold`, `STRYKER_EXPLORE_MUTATE/TEST/SPIKE` are identical across T1/T2/T6.
- **No placeholders** except the intentional `[NN%]/[n]` adaptive-goals "after" cells (runtime measurements from T5) and the conditional `accepted-equivalents.json` (created only if a genuine equivalent survives — the spec's "reality selects").
- **Read-only invariant** is asserted mechanically (T5 Step 7) and enforced socially (the ⛔ STOP banner + non-delegation labels).
