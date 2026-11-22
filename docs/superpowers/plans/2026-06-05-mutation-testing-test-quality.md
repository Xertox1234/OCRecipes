# Mutation Testing Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Stryker mutation-testing harness on the Vitest suite, prove it on one tiny pure module, then use it on `verification-consensus.ts` to find and kill weak/tautological tests — turning "53% green but untrusted" into an objective, durable signal.

**Architecture:** A target registry (`stryker.targets.mjs`) is the single source of truth mapping a friendly name → `{ mutate, testInclude }`. `stryker.conf.mjs` (pure Node ESM) resolves the target from `MUTATION_TARGET`, sets `mutate`, and hands the test-discovery glob to `vitest.mutation.config.ts` via `process.env.STRYKER_VITEST_INCLUDE` (inherited by Stryker's runner workers). The Vitest config narrows `include` to that one unit-test file so Stryker's dry run is fast and DB-free.

**Tech Stack:** Stryker 9.6.1 (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`), Vitest 4.1.7, Node ESM, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-05-mutation-testing-test-quality-design.md`

---

## ⛔ HARD-EXCLUSION STOP (read before starting)

`.github/copilot-instructions.md:31-44` forbids delegated work on **auth**
(`auth.ts`, `api-key-auth.ts`), **goal-safety** (`goal-calculator.ts`,
`adaptive-goals.ts`), and **IAP** (`receipt-validation.ts`). This plan's delegatable
scope is **only** `macro-gap-context` (Phase 0) and `verification-consensus`
(Phase 1), plus other non-excluded modules in Phase 2. **Do NOT add any excluded
module to `stryker.targets.mjs` or write tests for one.** Task 2 includes a unit
test that fails CI if an excluded path is ever added to the registry.

## Branch setup

From an up-to-date `main`:

```bash
git switch main && git pull --rebase && git switch -c feat/mutation-testing-harness
```

If the working tree carries the unrelated modification to
`.claude/agents/todo-executor.md`, **leave it unstaged** — every commit below uses
explicit `git add <named files>`, never `git add -A`. (The `branch-preflight` hook
blocks commits on `main`; `SKIP_BRANCH_PREFLIGHT=1` is set in the shell that launched
Claude Code if needed.)

---

## Task 1: Install Stryker

**Files:**

- Modify: `package.json` (devDependencies + scripts), `package-lock.json`

- [ ] **Step 1: Install the two Stryker packages pinned to 9.6.1**

Run:

```bash
npm install -D @stryker-mutator/core@9.6.1 @stryker-mutator/vitest-runner@9.6.1
```

- [ ] **Step 2: Verify the binary resolves and reports 9.6.1**

Run: `npx stryker --version`
Expected: `9.6.1`

- [ ] **Step 3: Add the npm script**

In `package.json` `"scripts"`, add after `"test:coverage:ci"`:

```json
    "test:mutation": "stryker run",
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(test): add Stryker mutation-testing deps + test:mutation script"
```

---

## Task 2: Target registry (single source of truth) — TDD

**Files:**

- Create: `stryker.targets.mjs`
- Test: `test/stryker-targets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/stryker-targets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MUTATION_TARGETS,
  DEFAULT_TARGET,
  resolveTarget,
} from "../stryker.targets.mjs";

describe("mutation target registry", () => {
  it("resolves both axes for a known target", () => {
    const t = resolveTarget("verification-consensus");
    expect(t.mutate).toEqual(["server/lib/verification-consensus.ts"]);
    expect(t.testInclude).toEqual([
      "server/lib/__tests__/verification-consensus.test.ts",
    ]);
  });

  it("defaults to macro-gap-context when no name is given", () => {
    expect(resolveTarget()).toBe(MUTATION_TARGETS[DEFAULT_TARGET]);
    expect(DEFAULT_TARGET).toBe("macro-gap-context");
  });

  it("throws a listing error on an unknown target", () => {
    expect(() => resolveTarget("nope")).toThrow(
      /Unknown MUTATION_TARGET "nope"/,
    );
    expect(() => resolveTarget("nope")).toThrow(/macro-gap-context/);
  });

  it("never registers a Hard-Exclusion module (policy guard)", () => {
    const paths = Object.values(MUTATION_TARGETS).flatMap((t) => [
      ...t.mutate,
      ...t.testInclude,
    ]);
    const forbidden =
      /(^|\/)auth\.ts|api-key-auth|goal-calculator|adaptive-goals|receipt-validation|healthkit|(^|\/)health\.ts|jwt-/i;
    for (const p of paths) expect(p).not.toMatch(forbidden);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/stryker-targets.test.ts`
Expected: FAIL — cannot resolve `../stryker.targets.mjs` (module does not exist yet).

- [ ] **Step 3: Create the registry**

Create `stryker.targets.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/stryker-targets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add stryker.targets.mjs test/stryker-targets.test.ts
git commit -m "feat(test): add mutation-target registry with Hard-Exclusion guard"
```

---

## Task 3: Vitest mutation config (scoped discovery)

**Files:**

- Create: `vitest.mutation.config.ts`

- [ ] **Step 1: Create the config**

Create `vitest.mutation.config.ts`:

```ts
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
```

> **Runner behavior (verified against Stryker vitest-runner docs):** the runner
> forces `coverage: { enabled: false }` (non-overridable), so the `coverage.thresholds`
> inherited from `vitest.config.ts` via the spread are **never evaluated** during the
> dry run — no `lines: 49` threshold failure can occur. The runner also **ignores
> `coverageAnalysis`** and always uses `perTest`; the value in `stryker.conf.mjs` is
> kept only to document intent.

- [ ] **Step 2: Verify it type-checks and lints clean**

Run: `npm run check:types && npm run lint`
Expected: both PASS. (This file is inside `tsconfig.check.json`'s `**/*.ts` and the
type-aware ESLint `**/*.{ts,tsx}` block, so it must be clean — it is, because it
imports no `.mjs` and casts the JSON once.)

- [ ] **Step 3: Verify discovery is correctly scoped (manual)**

Run:

```bash
STRYKER_VITEST_INCLUDE='["server/lib/__tests__/macro-gap-context.test.ts"]' \
  npx vitest list --config vitest.mutation.config.ts
```

Expected: only tests from `server/lib/__tests__/macro-gap-context.test.ts` are
listed — NOT the whole suite, and NO storage/Postgres tests.

- [ ] **Step 4: Commit**

```bash
git add vitest.mutation.config.ts
git commit -m "feat(test): add scoped Vitest config for mutation runs"
```

---

## Task 4: Stryker config + gitignore

**Files:**

- Create: `stryker.conf.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Create the Stryker config**

Create `stryker.conf.mjs`:

```js
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
```

- [ ] **Step 2: Ignore Stryker outputs**

Append to `.gitignore`:

```
# Mutation testing (Stryker) — runtime outputs only; baselines live in docs/mutation-testing/
.stryker-tmp/
reports/mutation/
```

- [ ] **Step 3: Commit**

```bash
git add stryker.conf.mjs .gitignore
git commit -m "feat(test): add Stryker config with env-driven target selection"
```

---

## Task 5: Phase 0 — prove the harness on macro-gap-context (DB-free)

**Files:** none changed (this task runs the harness and reads its output).

- [ ] **Step 1: Run the harness on the default target with DATABASE_URL unset**

Run:

```bash
DATABASE_URL= MUTATION_TARGET=macro-gap-context npm run test:mutation
```

(`DATABASE_URL=` sets it empty; `dotenv` won't override an already-present var, so
it stays empty — proving the run needs no database.)

Expected:

- Stryker runs an initial dry run, then mutates `server/lib/macro-gap-context.ts`.
- A clear-text table prints ending with a line like
  `Mutation score: NN.NN%` and counts (Killed / Survived / No coverage / Timeout).
- No Postgres connection error appears; the run completes in seconds.
- `reports/mutation/macro-gap-context.html` is written.

- [ ] **Step 2: Confirm scoping AND env propagation (two opposite failure modes)**

Open `reports/mutation/macro-gap-context.html` (or re-read the clear-text output).
Expected: the only mutated file is `server/lib/macro-gap-context.ts`; the tests run
are only from its unit test.

- **Failure mode A — too much ran** (you see storage/route tests or a Postgres
  error): the `include` override isn't taking effect. STOP and fix Task 3 (likely
  `mergeConfig` slipped back in, or the spread is wrong).
- **Failure mode B — nothing ran** (every mutant reported as **"No coverage"**, or
  "no tests found"): the Design-B env handoff failed — `STRYKER_VITEST_INCLUDE` set
  in `stryker.conf.mjs` did **not** reach the runner worker, so `include` resolved to
  `[]`. Verify by adding a temporary `console.error("INCLUDE:", include)` to
  `vitest.mutation.config.ts` and re-running. **Fallback if env truly doesn't
  propagate:** switch to a direct registry import in `vitest.mutation.config.ts`
  (`import { resolveTarget } from "./stryker.targets.mjs"`) and add a sibling
  `stryker.targets.d.ts` declaration so it type-checks; this trades the env handoff
  for a typed import. Do this only if B is confirmed.

(Reaching the macro-gap-context mutation-score table with a non-zero killed/survived
count proves both the scoping AND env propagation work end-to-end — Task 3 Step 3
alone only proved the config reads the env var, not that the worker inherits it.)

- [ ] **Step 3: Record the raw numbers** (used in Task 6 — no commit yet)

Note the mutation score and the four counts from Step 1's table.

---

## Task 6: Persist the durable baseline artifact

**Files:**

- Create: `docs/mutation-testing/baselines.md`
- Create: `docs/mutation-testing/README.md`

- [ ] **Step 1: Create the README**

Create `docs/mutation-testing/README.md`:

```markdown
# Mutation Testing

Mutation testing measures whether tests _assert_, not just _execute_. Stryker
corrupts each line (e.g. `<=` → `<`, delete a `return`); a **survivor** is a line a
test runs but does not check — a tautological-test signal and a worklist item.

## Run

    MUTATION_TARGET=<name> npm run test:mutation

Targets are defined once in `stryker.targets.mjs`. Default target:
`macro-gap-context`. HTML reports land in `reports/mutation/` (gitignored).

## Scope & policy

Only non-excluded, logic-dense modules are targeted. Auth, goal-safety, IAP,
health-data, secrets, and schema/migrations are Hard Exclusions
(`.github/copilot-instructions.md`) and require a separate human-authored plan.

## Baselines

See `baselines.md` for the tracked mutation scores. Equivalent mutants are
suppressed inline in source with `// Stryker disable next-line <mutator> -- <reason>`.
```

- [ ] **Step 2: Create the baselines file with the Phase 0 result**

Create `docs/mutation-testing/baselines.md` (fill the bracketed numbers from
Task 5 Step 3):

```markdown
# Mutation Testing Baselines

Tracked mutation scores per target. Update when a target is (re)run. No `break`
threshold is enforced until a target has a stable baseline here.

| Date       | Target            | Score | Killed | Survived | No coverage | Timeout |
| ---------- | ----------------- | ----- | ------ | -------- | ----------- | ------- |
| 2026-06-05 | macro-gap-context | [NN%] | [n]    | [n]      | [n]         | [n]     |
```

- [ ] **Step 3: Verify the path is tracked (not gitignored)**

Run: `git check-ignore docs/mutation-testing/baselines.md || echo "tracked OK"`
Expected: `tracked OK`

- [ ] **Step 4: Commit**

```bash
git add docs/mutation-testing/README.md docs/mutation-testing/baselines.md
git commit -m "docs(test): add mutation-testing README + macro-gap-context baseline"
```

---

## Task 7: Phase 1 — baseline verification-consensus

**Files:** none changed (run + record).

- [ ] **Step 1: Run the harness against verification-consensus**

Run:

```bash
DATABASE_URL= MUTATION_TARGET=verification-consensus npm run test:mutation
```

Expected: clear-text table with a mutation score for
`server/lib/verification-consensus.ts`; HTML at
`reports/mutation/verification-consensus.html`. Survivors are expected and normal —
they are the worklist.

- [ ] **Step 2: Append the baseline row**

Add a row to `docs/mutation-testing/baselines.md` (fill from Step 1):

```markdown
| 2026-06-05 | verification-consensus | [NN%] | [n] | [n] | [n] | [n] |
```

- [ ] **Step 3: Commit the baseline**

```bash
git add docs/mutation-testing/baselines.md
git commit -m "docs(test): record verification-consensus mutation baseline"
```

---

## Task 8: Phase 1 — triage survivors and kill genuine gaps

This is the repeatable micro-cycle. Repeat Steps 1–5 once **per survivor** until the
HTML report shows zero un-triaged survivors. A concrete worked example for the most
likely survivor is shown; apply the same shape to the rest.

**Files:**

- Modify: `server/lib/__tests__/verification-consensus.test.ts` (add real assertions)
- Modify (only for equivalent mutants): `server/lib/verification-consensus.ts`
  (inline `// Stryker disable` comments — this module is NON-excluded, so editing a
  comment is allowed)

- [ ] **Step 1: Pick a survivor (or no-coverage mutant) from the HTML report**

Open `reports/mutation/verification-consensus.html`. Each finding shows the file,
line, and the mutation applied. Decide: _genuine gap_ (no test would notice the
corruption) or _equivalent mutant_ (behavior truly unchanged). Note: a function with
no covering test shows its mutants as **"No coverage"** (not "Survived") — these
still lower the score and are real gaps.

- [ ] **Step 2 (worked example — genuine gap): write the missing assertions**

The dedicated unit test imports only `valuesMatch`, `nutritionMatches`, and
`compareWithVerifications` — it has **no describe block for the exported
`computeConsensus`**, so all of that function's mutants (lines 24-57: the
null-skipping accumulation, `Math.round`, `roundToOneDecimal`, and the
`counts.x > 0 ? avg : 0` guards) appear as No-coverage. (`valuesMatch`'s 5% boundary
is already covered by lines 42-63 — confirm in the report rather than re-adding it.)

Add `computeConsensus` to the existing import block in
`server/lib/__tests__/verification-consensus.test.ts`:

```ts
import {
  valuesMatch,
  nutritionMatches,
  compareWithVerifications,
  computeConsensus,
} from "../verification-consensus";
```

Then add a new describe block (reuse the file's existing `nutrition()` helper, which
builds an all-null `VerificationNutrition` with overrides):

```ts
describe("computeConsensus", () => {
  it("averages non-null values, rounding calories to int and macros to 1dp", () => {
    const result = computeConsensus([
      nutrition({ calories: 100, protein: 10, totalCarbs: 20, totalFat: 5 }),
      nutrition({ calories: 101, protein: 11, totalCarbs: 21, totalFat: 6 }),
    ]);
    // (100+101)/2 = 100.5 -> Math.round -> 101. Kills Math.round removal and the
    // averaging-operator mutants (e.g. `/ counts` -> `* counts`).
    expect(result.calories).toBe(101);
    expect(result.protein).toBe(10.5);
    expect(result.carbs).toBe(20.5);
    expect(result.fat).toBe(5.5);
  });

  it("counts only non-null entries per field when averaging", () => {
    const result = computeConsensus([
      nutrition({ calories: 100 }),
      nutrition({ calories: 200, protein: 10 }),
    ]);
    // calories present twice -> 150; protein present once -> 10. Kills mutants that
    // drop the `!= null` guard or mis-increment the counts.
    expect(result.calories).toBe(150);
    expect(result.protein).toBe(10);
  });

  it("returns 0 (not NaN) for a field when every value is null", () => {
    const result = computeConsensus([nutrition(), nutrition()]);
    // counts.x === 0, so the `counts.x > 0 ? avg : 0` ternary must yield 0. Kills the
    // boundary mutant `counts.x > 0` -> `>= 0`, which would divide 0/0 -> NaN.
    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});
```

- [ ] **Step 3: Confirm the new assertions pass against the real code**

Run: `npx vitest run server/lib/__tests__/verification-consensus.test.ts`
Expected: PASS. If an assertion fails, its expected value is wrong — fix the
assertion, never the production code (this module is goal-adjacent only in name; it
is non-excluded, but its _behavior_ is still authoritative — do not "correct" it to
match a test).

- [ ] **Step 4 (alternative — equivalent mutant): suppress with a reason**

If a survivor is genuinely equivalent (e.g. a mutant that cannot change observable
output), add an inline comment above the line in
`server/lib/verification-consensus.ts`:

```ts
// Stryker disable next-line ArithmeticOperator -- equivalent: counts.x is >0 here, so the operator can't change the rounded result
```

Use the exact mutator name shown in the report. Do **not** suppress a mutant you
could instead kill with an assertion.

- [ ] **Step 5: Re-run the harness and confirm the mutant is dead**

Run:

```bash
DATABASE_URL= MUTATION_TARGET=verification-consensus npm run test:mutation
```

Expected: the survivor from Step 1 is now `Killed` (or absent); mutation score is
higher. Stryker's `incremental` cache makes re-runs fast.

- [ ] **Step 6: When zero un-triaged survivors remain, update the baseline + commit**

Update the `verification-consensus` row in `docs/mutation-testing/baselines.md` to
the final score, then:

```bash
git add server/lib/__tests__/verification-consensus.test.ts \
        server/lib/verification-consensus.ts \
        docs/mutation-testing/baselines.md
git commit -m "test(verification): kill mutation survivors in verification-consensus"
```

(Omit `verification-consensus.ts` from the `git add` if you added no suppression
comments.)

---

## Task 9: Phase 2 — manual CI workflow + codify

**Files:**

- Create: `.github/workflows/mutation.yml`
- Create: a solution doc under `docs/solutions/` (path per codify skill)

- [ ] **Step 1: Add a manual-dispatch CI workflow**

Create `.github/workflows/mutation.yml` (mirrors `e2e-smoke.yml`'s manual pattern;
DB-free, so no Postgres service):

```yaml
name: Mutation testing

on:
  workflow_dispatch:
    inputs:
      target:
        description: "Mutation target (see stryker.targets.mjs)"
        required: true
        default: "verification-consensus"

jobs:
  mutation:
    name: Stryker (${{ inputs.target }})
    runs-on: ubuntu-latest
    env:
      MUTATION_TARGET: ${{ inputs.target }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Run mutation testing
        run: npm run test:mutation
      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mutation-report-${{ inputs.target }}
          path: reports/mutation/
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `npx --yes @action-validator/cli .github/workflows/mutation.yml 2>/dev/null || node -e "require('js-yaml')" 2>/dev/null; echo "(manual: confirm YAML parses)"`
Expected: no YAML parse error. (If no validator is available, eyeball indentation —
it mirrors `e2e-smoke.yml`.)

- [ ] **Step 3: Commit the workflow**

```bash
git add .github/workflows/mutation.yml
git commit -m "ci(test): add manual-dispatch mutation-testing workflow"
```

- [ ] **Step 4: Codify the findings**

Invoke the codify skill (`.claude/skills/codify/SKILL.md`) to write ONE solution doc
under `docs/solutions/` capturing: (a) the Stryker+Vitest 4 harness recipe, (b) the
`mutate` vs `include` scoping gotcha, (c) the codebase-specific "weak test" shapes
the survivors revealed (e.g. untested boundary conditions). Commit per the skill.

- [ ] **Step 5: Open the PR (no auto-merge — touches test infra)**

```bash
git push -u origin feat/mutation-testing-harness
gh pr create --fill --base main
```

Then watch checks green (`gh pr checks --watch`) before requesting review. Do NOT add
`--auto`.

---

## Validation summary (from the spec)

1. Phase 0 (Task 5) runs with `DATABASE_URL=` empty and still succeeds → DB-free.
2. Task 3 Step 3 proves the mutation Vitest config discovers only the target test
   file and drops `globalSetup`.
3. A checked-in `macro-gap-context` baseline (Task 6) exists before any threshold.
4. No auth / goal-safety / IAP module appears in the registry (enforced by Task 2's
   policy-guard test); expanding to those is blocked pending a separate human plan.

## Self-review notes (author)

- **Spec coverage:** deps (T1), registry+contract (T2), scoped vitest cfg (T3),
  stryker cfg+ignores (T4), Phase 0 DB-free proof (T5), durable baseline (T6),
  Phase 1 baseline (T7) + triage loop (T8), Phase 2 cadence+codify+gate (T9). All
  spec sections map to a task.
- **Type consistency:** `resolveTarget`, `MUTATION_TARGETS`, `DEFAULT_TARGET`,
  `STRYKER_VITEST_INCLUDE`, `MUTATION_TARGET` names are identical across T2/T3/T4.
- **No placeholders** except the intentional `[NN%]/[n]` baseline cells, which are
  runtime measurements filled in T6/T7 (cannot be known before running).
