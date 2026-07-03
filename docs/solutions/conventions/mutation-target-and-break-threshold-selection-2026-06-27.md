---
title: Selecting mutation-testing targets and break thresholds
track: knowledge
category: conventions
module: server
tags: [mutation-testing, stryker, test-quality, break-threshold, ci-gate]
applies_to: [stryker.targets.mjs, stryker.conf.mjs, .github/workflows/mutation-*.yml]
created: '2026-06-27'
---

# Selecting mutation-testing targets and break thresholds

## Rule

When adding a module to the mutation registry (`stryker.targets.mjs`) and gating it in CI:

1. **Target branching/arithmetic logic, not regex-pattern modules.** Run a read-only
   baseline (`npm run mutation:explore -- <src> <test>`) *before* registering — "looks
   pure" is not enough; the survivor *shape* decides whether the module is worth gating.
2. **Set `breakThreshold` below the achieved score, with margin** for the residual you
   can't or shouldn't kill: timeouts, provable equivalents, dev-only diagnostics.

## Why

**Regex-dominated modules are poor targets.** Stryker's `Regex` mutator emits dozens of
mutants per pattern (`\s+`→`\s`/`\S+`, char-class tweaks) that are equivalent or killable
only by contrived inputs. A regex-list module (e.g. `ai-safety`: prompt-injection +
dangerous-advice pattern arrays) baselined at **45% with 182 survivors, ~80% Regex
noise**. On a *security* module this is worse than no gate: the score reads as "protected"
while it's dominated by whitespace pedantry, and excluding the `Regex` mutator leaves only
a constant string — so the gate stays green even if every safety pattern were gutted. The
behavior that matters (e.g. a 799-vs-800-calorie boundary) is covered better by
function-level unit tests than by mutating regex internals. Prefer modules where the logic
*branches and computes*.

**Break thresholds need margin.** A threshold set *at* the achieved score is fragile on a
required gate that fires forever. `chat-history-truncate` scored 90.58% with **2
timeouts**; timeout classification is the least deterministic dimension — a mutant that
times out locally (counted as killed) can complete and *survive* on a faster runner,
dropping the score ~2 points. break was set to **88** (matching the `macro-gap-context`
88% precedent): it still catches a ~5-mutant backslide but absorbs the nondeterministic
tail. Read the threshold off a **clean** run (CI, or `mutation:explore` which forces
`incremental:false`), never a locally-cached `incremental:true` registered-target run —
that cache desyncs across rapid threshold-flip reruns and reports phantom pass/fail.

## Examples

- **`ai-safety` — evaluated, NOT added** (45%, regex noise). The rejection is recorded in
  `docs/mutation-testing/baselines.md` so it is not re-attempted.
- **`cook-session-merge` — 100% with zero test changes.** Bidirectional (`Math.max` tested
  in both directions) and on-boundary (capacity at exactly the limit) existing tests
  already kill every mutant. This is the ideal target shape.
- **`chat-history-truncate` — 73.54%→90.58%, break=88.** The "**4-char boundary string**"
  technique killed the CJK classification mutants: a *single* CJK char costs 1 token
  whether classified CJK or ASCII, so a single-char test can't distinguish them; a 4-char
  string costs 4 (CJK) vs `ceil(4/4)=1` (ASCII), making the classification observable and
  the range-boundary mutant killable. General principle: **to kill a classification-boundary
  mutant, feed an input where the class change alters an observable output, not just
  internal state.** Skip the unkillable residual (a `NODE_ENV`-gated dev `console.warn`,
  redundant guards) — chasing it via spies is the same pedantry trap as regex whitespace.
- **`macro-gap-context` — 88.37%→100%.** The lone residual was a provable equivalent
  (`<= 0`→`< 0`: target===0 makes ratio `0/0`=NaN, which fails the `> threshold` guard
  either way), suppressed inline with `// Stryker disable next-line`. Note Stryker has no
  per-replacement granularity: disabling `EqualityOperator` drops the whole family, so
  confirm the other replacements are already killed before suppressing.

## Exceptions

- **Hard-Exclusion modules** (auth, goal-safety, IAP, health-data, secrets, schema) follow
  the separate gated read-only protocol — never edit their source, only tests.
- **break=100 is fine when zero equivalents/timeouts remain** (`cook-session-merge`,
  `verification-consensus`). Margin is only needed when the residual is nonzero.
- Keep the general (non-excluded) gate **separate** from the goal-safety gate so it stays
  free of the Hard-Exclusion read-only ceremony.

## Related Files

- `stryker.targets.mjs` — registry: `{ mutate, testInclude, breakThreshold }` per target
- `stryker.conf.mjs` — honors `breakThreshold` via `thresholds.break`
- `.github/workflows/mutation-non-excluded.yml` — required, self-scoping general gate
- `docs/mutation-testing/baselines.md` — tracked scores + the `ai-safety` rejection note

## See Also

- [gated mutation testing for Hard-Exclusion modules](../best-practices/gated-mutation-testing-hard-exclusion-2026-06-05.md) — the protocol for excluded (auth/goal-safety) targets
- [pipefail echo|grep condition fails open](../logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — a fail-open in the self-scoping gate's change-detection
