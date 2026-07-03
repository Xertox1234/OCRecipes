---
title: Gated read-only mutation testing for Hard-Exclusion "crown jewel" modules
track: knowledge
category: best-practices
module: server
tags: [mutation-testing, stryker, testing, goal-safety, hard-exclusion, security, ci]
applies_to: [stryker.targets.mjs, scripts/mutation-explore.mjs, server/services/adaptive-goals.ts, server/services/goal-calculator.ts]
created: '2026-06-05'
---

# Gated read-only mutation testing for Hard-Exclusion "crown jewel" modules

## When this applies

Bringing a `.github/copilot-instructions.md` **Hard Exclusion** (auth, goal-safety, IAP,
health-data, secrets, schema/migrations) under mutation testing. These require a
human-authored plan and human review; this is the reusable protocol. Builds on
[[stryker-vitest4-mutation-testing-harness-2026-06-05]] (harness mechanics) and
[[mutation-testing-suppress-only-equivalent-mutants-2026-06-05]] (triage integrity).

## The governing rule: READ-ONLY on excluded source

Mutation testing is policy-permissible on excluded modules **only because it is
read-only on production code** (Stryker mutates ephemeral copies). Preserve that:

| Operation | Edits excluded source? | Allowed? |
| --- | --- | --- |
| Mutate ephemeral copy / baseline spike | No | Yes (freely) |
| Add / strengthen a **test** | No (test file only) | Yes — the gated authoring act |
| Suppress an equivalent (`// Stryker disable`) | **YES** | **NO** — record in `accepted-equivalents.json` instead |
| Remove dead code | **YES** | **NO** in triage — escalate to a human as a finding |

Consequence: a genuinely-equivalent mutant on an excluded module cannot be killed
(no input distinguishes it) and cannot be suppressed (read-only) → it survives
permanently → the target's score may legitimately be < 100%. Set CI `break` to the
achieved score (e.g. `adaptive-goals` = 99, with margin so any NEW survivor drops
below it). Record the equivalent in `docs/mutation-testing/accepted-equivalents.json`.

> **Caveat (don't over-trust the score gate):** a score `break` catches any run that
> *adds* a survivor, but it cannot catch a **swap** — a future refactor that drops the
> recorded equivalent and introduces a new gap at the same count keeps the score
> unchanged and passes. No *test* can cause this (the equivalent is unkillable), but a
> *source refactor* can. The CI gate runs precisely when the source changes, so
> **re-triage from the report (not just the score) on any edit to a listed module**, and
> re-verify `accepted-equivalents.json` line numbers (they drift with the source).

## The registry-approval gate (relax the guard without losing it)

`stryker.targets.mjs` is the single source of truth for targets AND the gate:
`isHardExclusion(path)`, `isApprovedExclusion(path)`, `assertAllowedTarget(name, target)`,
plus a `HUMAN_APPROVED_EXCLUSIONS` allowlist (`path -> {approvedOn, planPath, note}`,
non-empty planPath+note required — **fail-closed**). The guard test
(`test/stryker-targets.test.ts`) asserts every registered target passes
`assertAllowedTarget`, so an *unapproved* excluded module still fails CI; an approved
one passes with provenance in code. A target flagged only by a `testInclude` path with
empty `mutate` is rejected (no source to key approval to).

## Triage as a decision tree (the oracle governs only the numeric minority)

Bucket survivors by mutator; ~80% is conventional work, not the heavy branch:

- **Boundary** (`EqualityOperator` / `ConditionalExpression` / `LogicalOperator`):
  feed the **on-the-tie input** and assert the documented branch (e.g. `weightChange`
  exactly `0` to pin `> 0`; `daySpan` exactly `14` to pin `< 14`; deviation exactly
  `0.1` to pin `< 0.1`; weight logs `length` exactly `4` vs `3`).
- **Numeric output** (`ArithmeticOperator` producing a returned number): **double-
  derivation** — hand-derivation + a deterministic reference calc + a second-channel
  oracle (verification-only delegation, user-authorized for this health-adjacent
  module). Commit the expected value only when all agree.
- **Weak-assertion / structural** (`ObjectLiteral`→`{}`, `MethodExpression`,
  `ArrowFunction`): strengthen the assertion to pin the derived value, or assert a
  mock-call shape (`toHaveBeenCalledWith(..., objectContaining({ from: ... }))`) to
  kill a dropped query param / window-arithmetic mutant.

**Mismatch-escalation rule (inverts the non-excluded convention):** if an
independently-derived assertion disagrees with the SUT output, **STOP and escalate**
— it is a candidate defect in safety-critical code. Never adjust the assertion to
match the code. Verification chain: oracle+reference agree (arithmetic) → SUT-run
passes (constant relayed correctly) → human/spec sign-off (business-constant intent).

## Gotchas discovered

1. **Stryker has no numeric-literal mutator.** It mutates operators/structure/strings,
   NOT magnitudes — `1200 -> 1201`, `1.375 -> 1.376` are not mutants. Mutation testing
   guards formula *structure*, not constant *values*; pin constants with value tests.
2. **Stale incremental cache lies.** `incremental: true` can report a target as still
   "Survived" after the killing test is added (object-literal mutants mis-attribute
   coverage). A registry run showed `goal-calculator` stuck at 95.24% while a fresh run
   (`incremental: false`, via `npm run mutation:explore`) showed the true 100%. When a
   score looks stale, delete `reports/mutation/incremental-<target>.json` or use the
   explore CLI. CI is immune (fresh `npm ci`, no persisted cache).
3. **A spike on an excluded module is read-only and thus allowed** — `mutation:explore`
   default-denies excluded paths but `--spike` permits a read-only baseline (banner
   shown). Approved targets (in `HUMAN_APPROVED_EXCLUSIONS`) run without `--spike`.
4. **Default-equals-user hides `|| default` mutants.** `DEFAULT_NUTRITION_GOALS` macros
   (150/250/67) equal a common user fixture; the `user.x || DEFAULT.x` mutant only dies
   when the user value differs from the default. Pick a fixture value ≠ default.

## CI: required, self-scoping gate

`.github/workflows/mutation-goal-safety.yml` runs on every PR (so it always reports a
status — safe to mark **required**) but self-scopes: a merge-base..head diff
(`base.sha...head.sha`, three-dot) decides whether the target files changed; if not, it
reports success in seconds. Only on a real change does it `npm ci` + run both targets
with their `break`. DB-free.

## Reusability is modest

Transferable to other Hard Exclusions: the registry-approval gate, the explore CLI, the
CI self-scoping pattern, the triage/integrity rules. **NOT transferable:** double-
derivation is a numeric-module technique — it does not help `auth.ts` ("independent
derivation of returns-401-on-expired-token"?) or IAP crypto, whose hard part is the
*harness* (Express/jwt/storage mocks, module-load side effects, JWS stubs). Each of
those needs its own human-authored plan focused on harness construction.

## Related Files

- `stryker.targets.mjs` (gate + targets), `stryker.conf.mjs` (per-target `break`)
- `scripts/mutation-explore.mjs`, `stryker.explore.conf.mjs` (gate-respecting spikes)
- `.github/workflows/mutation-goal-safety.yml` (required self-scoping gate)
- `docs/mutation-testing/baselines.md`, `docs/mutation-testing/accepted-equivalents.json`
- `server/services/__tests__/{goal-calculator,adaptive-goals}.test.ts` (the killing tests)

## See Also

- [Stryker + Vitest 4 harness](stryker-vitest4-mutation-testing-harness-2026-06-05.md)
- [Suppress only equivalent mutants](../conventions/mutation-testing-suppress-only-equivalent-mutants-2026-06-05.md)
