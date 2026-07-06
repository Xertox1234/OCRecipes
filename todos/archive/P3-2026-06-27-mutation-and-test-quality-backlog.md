<!-- Filename: P3-2026-06-27-mutation-and-test-quality-backlog.md -->

---

title: "Mutation-testing backlog (candidate targets + deferred features)"
status: done
priority: low
created: 2026-06-27
updated: 2026-07-05
assignee:
labels: [deferred, testing, tooling]
github_issue:

---

# Mutation-testing backlog (candidate targets + deferred features)

## Summary

Capture the testing work NOT done in the #468 mutation-scope expansion (which shipped 4
enforced non-excluded targets + the goal-safety gate) so it isn't lost. Mostly: baseline +
onboard the few _pure-logic_ modules still worth gating, plus a handful of deferred
mutation/test-quality features.

## Background

#468 (`0f7d1ae3`) enforced 4 non-excluded targets (cook-session-merge, chat-history-truncate,
macro-gap-context, verification-consensus) + goal-calculator via two required self-scoping
gates. ~40 other modules have unit tests but aren't targeted — **most are poor mutation
fits** (AI/IO/regex-heavy services), exactly the profile that got `ai-safety` rejected
(45% / 182 Regex-noise survivors). The real remaining backlog is the small pure-logic
subset, not all 40. See the codified rule:
`docs/solutions/conventions/mutation-target-and-break-threshold-selection-2026-06-27.md`.

## Acceptance Criteria

- [x] Baseline the pure-logic candidates with `npm run mutation:explore` and onboard the
      ones with a clean, high-value survivor profile (target ~90%+ achievable). Candidates:
      `server/lib/recipe-normalization.ts`, `server/services/cooking-adjustment.ts`,
      `server/services/notebook-budget.ts`, `server/services/carousel-builder.ts`,
      `server/services/subscription-tier-cache.ts`. (Baseline RESULTS recorded in Updates below.)
- [x] Each onboarded target: register in `stryker.targets.mjs` with a `breakThreshold`
      below achieved (margin), add to `mutation-non-excluded.yml`, record in `baselines.md`.
- [x] Decision recorded (onboard / reject-with-reason) for every candidate, so rejected
      ones aren't re-evaluated — mirror the `ai-safety` rejection note in `baselines.md`.

## Implementation Notes

**Deferred items beyond the candidate baselines (decide per-item, may split into own todos):**

- **Broader Hard-Exclusion coverage** — only `goal-calculator` is under the gated read-only
  protocol. `auth`, IAP (`receipt-validation`), and `jwt-*` could each be brought under the
  same protocol, but **each needs its own human-authored plan** (the gate is deliberate —
  do NOT add them to the registry without one). `adaptive-goals` was retired (#384), don't
  re-add.
- **Mutation features** — whole-directory `mutate` globs (vs one file/target); a systematic
  `mutation:explore` discovery sweep over `server/lib`; mutation-score _trend_ tracking.
- **Broader test-quality (non-mutation)** — property-based testing, API contract/integration
  tests, and E2E expansion now live in their own todo:
  `todos/P3-2026-06-27-broader-test-quality-non-mutation.md`. Pursue there, not here.

**Process reminders (from the #468 session):**

- "Looks pure" ≠ "is pure" — always `mutation:explore` BEFORE registering.
- Set `breakThreshold` below achieved, off a clean `incremental:false` run.
- Read the codified conventions:
  `docs/solutions/conventions/mutation-target-and-break-threshold-selection-2026-06-27.md`.

## Dependencies

- None (standalone enhancement backlog).

## Risks

- Most service candidates may turn out to be AI/IO/regex-heavy (poor fits) — expect to
  reject several after baselining, not onboard all. That's the point of baselining first.
- Service tests that hit real storage (not mocked) will fail the DB-free mutation run —
  only mocked/pure tests are eligible.

## Updates

### 2026-06-27

- Initial creation.
- **Baselines run** (`mutation:explore`, read-only) on the 5 pure-logic candidates:

  | Module                  | Score  | Survived | No-cov | Verdict                                                             |
  | ----------------------- | ------ | -------- | ------ | ------------------------------------------------------------------- |
  | notebook-budget         | 81.82% | 10       | 0      | onboard FIRST — closest to ready (kill 10 → ~90%)                   |
  | carousel-builder        | 76.71% | 14       | 3      | onboard — moderate work                                             |
  | subscription-tier-cache | 71.88% | 4        | 5      | onboard — only 4 survivors, but cover the 5 untested paths first    |
  | recipe-normalization    | 66.19% | 71       | 0      | SKIP — string/parsing noise, weak tests                             |
  | cooking-adjustment      | 51.94% | 61       | 1      | SKIP — survivors are `ObjectLiteral` data-table mutants (low value) |

  None are 100%-out-of-the-box like cook-session-merge; all need test-strengthening. Onboard
  order: notebook-budget → carousel-builder → subscription-tier-cache. Document the SKIP
  rejections in `baselines.md` per the `ai-safety` precedent so they aren't re-evaluated.

- **Blocker found + confirmed fix (relates to `P3-2026-06-27-stryker-worktree-docs-solutions-symlink.md`):**
  `mutation:explore` crashed `ENOTSUP` copying `.claude/worktrees/<other-session>/docs/solutions`
  (a _nested_ worktree's directory symlink). The crash hits the MAIN checkout too — not just
  runs _inside_ a worktree — whenever any worktree exists under `.claude/worktrees/`. CI is
  unaffected (no such worktrees there). **Confirmed fix: add `.claude` to `ignorePatterns` in
  BOTH `stryker.explore.conf.mjs` AND `stryker.conf.mjs`.** (The earlier "docs ignorePattern
  didn't work" attempt edited only `stryker.conf.mjs`, but `mutation:explore` reads
  `stryker.explore.conf.mjs` — wrong file.) Worth a small standalone fix PR; the temp edit used
  to unblock these baselines was reverted.

- **DONE this PR:** (1) the Stryker harness fix shipped — `.claude` + `docs` added to
  `ignorePatterns` in BOTH `stryker.conf.mjs` and `stryker.explore.conf.mjs`, so mutation runs
  locally again from the main checkout and inside worktrees; the sibling
  `P3-…-stryker-worktree-docs-solutions-symlink.md` is **resolved and archived**. (2)
  **notebook-budget onboarded** (81.82% → 90.91%, break=88): killed the 3 recency-boundary +
  separator/arithmetic survivors; the 5 residual are the line-93 redundant-guard equivalents.
  Registered + wired into `mutation-non-excluded.yml` + recorded in `baselines.md`.

- **Remaining onboarding candidates (next):** `carousel-builder` (76.71%, 14+3) and
  `subscription-tier-cache` (71.88%, 4+5). `recipe-normalization` + `cooking-adjustment` stay
  SKIP. Repeat the notebook-budget recipe: kill killable survivors, break ≈ achieved−margin.

### 2026-07-05

- **All three Acceptance Criteria closed.** Re-confirmed the 2026-06-27 baselines are still
  accurate (`recipe-normalization` 66.19%/71 survivors, `cooking-adjustment` 51.94%/61
  survivors+1 no-cov — unchanged) and finished the two remaining onboarding candidates:
  - **`carousel-builder` onboarded** (76.71% → 93.15%, break=90): strengthened
    `server/services/__tests__/carousel-builder.test.ts` with strict-boolean `isRemix`
    assertions, a `timeEstimate: null` case, a legacy-`cuisinePreferences: null` guard case
    (the `&&`-chain guard at line 58 was never exercised with a falsy `cuisinePreferences`),
    a two-element `cuisinePreferences` list ordered to distinguish `.some()` from a mutated
    `.every()`, a "tags exist but none overlap" negative case, and the 30-minute
    quick-and-easy boundary. Residual 5 documented as equivalents/Stryker-placeholder
    artifacts in `baselines.md` (not chased — same pedantry trap as `Regex` whitespace).
  - **`subscription-tier-cache` onboarded** (71.88% → 93.75%, break=90): the 5 no-coverage
    mutants were all in the never-exercised `MAX_CACHE_SIZE` eviction path; one eviction test
    (seed `_testInternals.tierCache` to the 10,000 limit, assert oldest-key eviction + bounded
    size) plus one TTL-exact-boundary test closed 7 of the 9 gaps. Residual 2 documented as
    provable equivalents in `baselines.md`.
  - Both registered in `stryker.targets.mjs`, wired into
    `.github/workflows/mutation-non-excluded.yml` (change-detection regex + two new job
    steps), and recorded in `docs/mutation-testing/baselines.md` alongside the
    `recipe-normalization` / `cooking-adjustment` SKIP decisions (mirroring the `ai-safety`
    rejection note) so neither is re-evaluated.
  - The Implementation Notes' deferred items (broader Hard-Exclusion coverage, whole-directory
    mutate globs, mutation-score trend tracking) remain explicitly out of scope for this todo
    per its own text — not carried into a follow-up todo.
