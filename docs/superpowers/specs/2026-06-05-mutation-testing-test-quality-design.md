# Mutation Testing to Measure (Then Raise) Test Quality

**Date:** 2026-06-05
**Status:** Approved design (rev. 2 — incorporates spec-review: Hard-Exclusion gating, targeting contract, durable baselines) — pending implementation plan
**Author:** Brainstormed with Claude (superpowers:brainstorming)

## Problem

Two intertwined concerns drove this work:

1. **Coverage is too low** — ~53% lines / ~46% functions / ~44% branches measured
   (honest baseline: `vitest.config.ts` uses a `coverage.include` glob so untested
   source files count as 0% in the denominator).
2. **The tests themselves aren't trusted** — recent history shows repeated removal
   of tautological tests (#294, #309, #317, #318), so a green suite at 53% does not
   inspire confidence that the code is actually verified.

These pull in opposite directions. Chasing the coverage number first incentivizes
the fastest tests to write — which are exactly the tautological ones being removed.
The real target is **coverage you can believe in**, not a higher percentage.

Line coverage is a proxy: it measures which lines _ran_ during tests, not whether
any assertion would _fail_ if a line were wrong. That gap is the root cause of "53%
green but untrusted."

## Approach (chosen): measure test quality first, via mutation testing

Mutation testing inverts the coverage question. Instead of "did this line run?", it
asks "if I corrupt this line — flip `>` to `>=`, swap `&&` for `||`, delete a
`return` — does any test go red?" A **surviving mutant** is a line the suite
executes but does not assert on. That is the precise, automated definition of a
tautological test, and each survivor is a concrete worklist item: a missing
assertion worth writing.

Alternatives considered and deferred (not rejected — sequenced after this):

- **Targeted coverage campaign** (rank modules by risk, manually audit + write
  tests). Faster to start, but relies on human judgement and cannot objectively
  prove a test is strong. Mutation testing supersedes it by _producing_ the ranked
  worklist automatically.
- **CI guardrails first** (coverage-on-changed-lines, auto-ratchet thresholds).
  Stops new bleeding but does not fix the existing backlog or validate existing
  tests. Folded into Phase 2 as an optional follow-on once a baseline exists.

## Hard Exclusions & delegation gating (repo policy)

`.github/copilot-instructions.md:31-44` defines **Hard Exclusions** — domains that
"require a human-authored implementation plan and are not eligible for Copilot
delegation." Relevant to this work:

- **JWT/auth** — `server/middleware/auth.ts`, `server/routes/auth.ts`,
  `server/lib/jwt-*` (and, by extension, `server/middleware/api-key-auth.ts`)
- **Goal-safety behavior** — includes `server/services/goal-calculator.ts`
  (the `MIN_DAILY_CALORIES` floor is literally goal-safety) and
  `server/services/adaptive-goals.ts`
- **IAP receipt validation** — `server/services/receipt-validation.*`
- **Health-data boundaries**, secrets, schema/migrations, production data

**Important nuance:** mutation testing is _read-only on production code_ — Stryker
mutates ephemeral copies in `.stryker-tmp/` and discards them; the source file is
never edited. So the policy does **not** forbid pointing the tool at these files.
What the policy forbids is **delegating the authorship of the killing assertions and
the interpretation of behavior** for these modules. A delegated agent could lock in
an _unsafe_ expectation (e.g. assert the wrong calorie floor) or a subtly-wrong auth
behavior. Therefore:

- **This plan's delegatable scope = non-excluded targets only**:
  `server/lib/macro-gap-context.ts` (Phase 0) and
  `server/lib/verification-consensus.ts` (Phase 1). Both are pure and import no
  auth/health/IAP code (`verification-consensus.ts` imports only `./math`).
- **Excluded targets are GATED**: `goal-calculator.ts`, `adaptive-goals.ts`,
  `auth.ts`, `api-key-auth.ts`, `receipt-validation.ts` may be added to the target
  registry later, but **running Stryker on them and authoring their tests requires a
  separate, human-authored implementation plan with human PR review** — they are out
  of scope for the delegatable plan that this spec produces. The plan must hard-stop
  at this boundary.

## Why the harness is low-risk here

- `@stryker-mutator/vitest-runner@9.6.1` (published 2026-05-13) declares peer
  `vitest: >=2.0.0`. The project is on `vitest@4.1.7`, which qualifies. Vitest 4
  support landed in Stryker PR #5360.
- Using the **Vitest runner** (not Stryker's command runner) means Stryker reuses
  the existing Vitest config: all React Native mock aliases, `setupFiles`, JSX
  transform, and esbuild-based TS transpilation come along for free. No separate
  TypeScript build step is required.
- `test/global-teardown.ts` (the project's `globalSetup`) opens **no DB connection
  at setup** — `setup()` only returns a teardown closure, and that closure
  early-returns when `DATABASE_URL` is unset. A pure-logic pilot run with
  `DATABASE_URL` absent is genuinely DB-free.

## Critical implementation detail: scope test discovery, not just `mutate`

In Stryker, `mutate` and test-discovery are **independent axes**:

- `mutate` controls which source files get mutants.
- Which _tests run_ still follows the Vitest config's `include` (the whole suite).

Stryker performs one required **dry run** up front to learn which tests cover which
code (this is what `coverageAnalysis: "perTest"` builds). Without overriding
`include`, that dry run boots all 386 test files **plus** the real-Postgres storage
integration tests — needing `DATABASE_URL`, taking minutes, and exposing the run to
the documented `retry:2` route-test flake under Stryker's harness.

**Fix:** a dedicated `vitest.mutation.config.ts` that extends the base config but
overrides `include` down to only the target's dedicated unit-test file(s), and drops
`globalSetup`. Stryker's `vitest-runner` is pointed at this config.

Two gotchas captured so they aren't rediscovered:

- **`mergeConfig()` concatenates arrays.** Using it would _keep_ the base
  whole-suite `include` globs and append the target — defeating the scoping.
  Override `include` explicitly (object spread), not via `mergeConfig`.
- **`.ts`→`.mjs` typing is avoided entirely** by the env-handoff above:
  `vitest.mutation.config.ts` never imports the `.mjs` registry, so it type-checks
  and lints cleanly with no tsconfig edits. (This sidesteps the repo's known
  type-aware-ESLint "not found by the project service" failure mode for files
  outside the checked project.)

## Targeting contract (single source of truth)

To avoid hand-editing tracked config between runs (and the resulting drift between
`mutate` and `include`), targets are defined **once** in a registry consumed by both
configs:

- `stryker.targets.mjs` exports `MUTATION_TARGETS`, a map from a friendly target
  name to **both axes**: `mutate` (source files) and `testInclude` (the _dedicated
  unit test_ file(s) only). It also exports `resolveTarget(name)` which throws a
  clear error listing known targets on a miss.
- `stryker.conf.mjs` (pure Node ESM config — no TypeScript) is the **single
  resolver**: it imports the registry, selects the target via
  `process.env.MUTATION_TARGET`, sets `mutate`, and hands the resolved `testInclude`
  to the Vitest config by writing `process.env.STRYKER_VITEST_INCLUDE` (a JSON
  string).
- `vitest.mutation.config.ts` does **not** import the registry (avoids a
  `.ts`→`.mjs` type-resolution / ESLint-project-service dependency). It reads
  `process.env.STRYKER_VITEST_INCLUDE` and sets `include` from it. This works
  because Stryker evaluates `stryker.conf.mjs` in the main process _before_
  spawning runner workers, which inherit `process.env`.
- Operator interface: `MUTATION_TARGET=verification-consensus npm run test:mutation`.
  Default target (no env) is `macro-gap-context`. (For a standalone Vitest run, set
  `STRYKER_VITEST_INCLUDE` explicitly.)

**Mixed-surface modules:** the registry's `testInclude` points at the module's
**dedicated unit test only**, never its route test. Rationale: we are measuring
whether the _unit test_ is trustworthy. (Example: `adaptive-goals` — when later
gated-in — has both `server/services/__tests__/adaptive-goals.test.ts` and
`server/routes/__tests__/adaptive-goals.test.ts`; only the service test would be
listed.) State this in a comment in the registry so the choice is explicit.

## Durable artifacts (tracked source of truth)

The spec/plan folder and HTML reports are gitignored, so baselines need a tracked
home:

- **`docs/mutation-testing/baselines.md`** (this path is **not** gitignored) records,
  per target: date, mutation score, and the mutant tallies
  (killed / survived / no-coverage / timeout). This is the durable reference for any
  future threshold (`break`) decision.
- **Equivalent mutants** in modules we own and that are non-excluded
  (`macro-gap-context.ts`, `verification-consensus.ts`) are suppressed with inline
  `// Stryker disable next-line <mutator> -- <reason>` comments — git-tracked and
  located at the exact line, so the rationale is durable and reviewable.

## Components

### 1. Dependencies (devDependencies)

- `@stryker-mutator/core@9.6.1`
- `@stryker-mutator/vitest-runner@9.6.1`
- (Phase 2, optional) `@stryker-mutator/typescript-checker` — discards
  type-invalid mutants for cleaner survivors, at the cost of type-checking every
  mutant (slower).

### 2. `stryker.targets.mjs`

The target registry (single source of truth). See "Targeting contract".

### 3. `stryker.conf.mjs`

- `testRunner: "vitest"`, `vitest.configFile: "vitest.mutation.config.ts"`
- `coverageAnalysis: "perTest"`
- `mutate` from `resolveTarget(process.env.MUTATION_TARGET)`
- writes `process.env.STRYKER_VITEST_INCLUDE = JSON.stringify(testInclude)`
- `incremental: true`, per-target `incrementalFile`
- `reporters: ["html", "clear-text", "progress"]`, per-target `htmlReporter.fileName`
- `tempDirName: ".stryker-tmp"`
- **No `break` threshold yet** — we do not know the baseline. Add later.

### 4. `vitest.mutation.config.ts`

Extends `vitest.config.ts` (object spread, **not** `mergeConfig`); overrides
`test.include` to `JSON.parse(process.env.STRYKER_VITEST_INCLUDE)`; sets
`globalSetup: []` and `retry: 0`. Keeps every resolve alias and setup file so
RN/esbuild behavior is identical to the normal suite. Does not import the registry.

### 5. npm script + ignores

- `"test:mutation": "stryker run"`
- `.gitignore`: `.stryker-tmp/`, `reports/mutation/`

## The working loop (how survivors are used)

1. Run `MUTATION_TARGET=<name> npm run test:mutation`.
2. Open the HTML report.
3. For each **survivor**, decide:
   - _Genuine gap_ → write a real-SUT assertion that kills the mutant.
   - _Equivalent mutant_ (behavior truly unchanged) → suppress with an inline
     `// Stryker disable next-line` + reason.
4. Re-run; mutation score climbs. Genuine gaps **are** the meaningful-coverage
   worklist — coverage rises as a byproduct of killing real survivors.

## Phasing

### Phase 0 — Prove the harness (delegatable)

- Target `macro-gap-context` → `mutate` = `server/lib/macro-gap-context.ts` (57
  lines, pure, 194-line test); `testInclude` = its one unit test.
- Run with `DATABASE_URL` unset.
- **Success:** a mutation score prints and the HTML report renders, in seconds.
  Validates registry + vitest-runner + config + esbuild-TS end-to-end.
- Persist the macro-gap-context baseline to `docs/mutation-testing/baselines.md`
  before any threshold/gating is considered.

### Phase 1 — First real target: verification-consensus (delegatable)

- Target `verification-consensus` → `mutate` =
  `server/lib/verification-consensus.ts`; `testInclude` =
  `server/lib/__tests__/verification-consensus.test.ts`. Non-excluded, pure,
  branch-dense (`valuesMatch`, `nutritionMatches`, `computeConsensus`), high business
  value (Verified Product API backbone).
- Record baseline mutation score; triage every survivor; kill genuine gaps with
  real-SUT assertions; suppress equivalent mutants with reasons.
- **Success:** baseline recorded; zero un-triaged survivors (each killed or
  suppressed-with-reason); test trust + coverage both rise.

### Phase 2 — Institutionalize (delegatable, non-excluded only)

- Choose cadence (see decision below) and wire CI if applicable.
- Expand the registry to **other non-excluded** pure modules; codify the
  codebase-specific "weak test" shapes discovered into `docs/solutions/` (per
  `.claude/skills/codify/SKILL.md`).
- Optionally add `@stryker-mutator/typescript-checker` and set a `break` threshold
  once a stable baseline exists.

### GATED — separate human-authored plan required (NOT in this plan)

Auth (`auth.ts`, `api-key-auth.ts`), goal-safety (`goal-calculator.ts`,
`adaptive-goals.ts`), and IAP (`receipt-validation.ts`). The harness supports them
technically, but per Hard Exclusions, running mutation testing on them and authoring
their tests is a human-authored, human-reviewed effort outside this plan's scope.

## Cadence decision (Phase 2)

**Recommended:** local on-demand + a manual `workflow_dispatch` CI job mirroring
`e2e-smoke.yml`. Keep mutation testing **off the PR gate** (too slow). Defer a
scheduled run and any auto-gating (`break` threshold) until real runtimes are known.

## Success criteria (overall)

- Phase 0 harness runs green on `macro-gap-context.ts` and emits a mutation score +
  HTML report, **with `DATABASE_URL` unset** (proves DB-free).
- A checked-in baseline for `macro-gap-context.ts` exists in
  `docs/mutation-testing/baselines.md` **before** any score threshold or CI gating.
- Phase 1: a baseline mutation score is recorded for `verification-consensus.ts`,
  every survivor is triaged (killed or suppressed-with-reason), and gaps are closed
  with real-SUT assertions.
- The codebase-specific definition of a "weak test" is documented from real
  findings.
- A cadence is chosen and (if CI) wired; a `break` threshold decision is made once a
  baseline exists.

## Validation plan

1. Phase 0 runs with `DATABASE_URL` unset and the harness still succeeds (consistent
   with `test/global-teardown.ts` no-op-without-DB behavior).
2. The first implementation slice verifies the mutation Vitest config limits
   discovery to the intended unit-test file(s) and removes the inherited
   `globalSetup` — asserted by a small unit test over `resolveTarget` and a manual
   `vitest --config vitest.mutation.config.ts list` check showing only the target
   test file is discovered.
3. One checked-in baseline for `macro-gap-context.ts` is persisted before any
   threshold or CI gating is added.
4. Any later auth / goal-safety / IAP expansion is blocked pending the separate
   human-reviewed plan described under "GATED" above.

## Notes

- This spec lives under `docs/superpowers/` which is **gitignored** (`.gitignore:94`)
  — local-only by project convention, like all existing specs in this folder. The
  implementation plan (`docs/superpowers/plans/`) is likewise local-only; the
  _baselines_ artifact (`docs/mutation-testing/`) is the tracked durable record.
