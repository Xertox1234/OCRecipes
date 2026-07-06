<!-- Filename: P3-2026-07-05-pg-eval-results-store.md -->

---

title: "PG Lab: eval-results time series for evals/runner.ts"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, ai]
github_issue:

---

# PG Lab: eval-results time series for evals/runner.ts

## Summary

Persist every eval run's per-case judge scores to `dev.eval_results` in `ocrecipes_lab`, turning prompt-regression detection for the AI services (photo-analysis, nutrition-coach, recipe-chat, recipe-generation) into a queryable curve instead of a run-and-forget console dump.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. `evals/runner.ts` already produces LLM-judge scores (EVAL_JUDGE_MODEL, EVAL_SAMPLES_PER_CASE) but results evaporate after each run — there is no way to ask "did the 2026-06 prompt change to photo-analysis regress intent classification?" This is the most code-quality-adjacent PG Lab item since the AI services are core product.

## Acceptance Criteria

- [x] `scripts/pg-lab/schema/eval-results.sql`: `dev.eval_results(run_id, ts, commit, case_id, service, judge_model, samples, score, pass, notes jsonb)` — append-only ledger.
- [x] `evals/runner.ts` writes one row per case-sample at run end (buffered), keyed by a generated run_id + `git rev-parse --short HEAD`.
- [x] Fail-silent: no DB → runner behaves exactly as today (evals must never require Postgres).
- [x] `scripts/pg-lab/eval-report.sh`: score trend per case/service across commits; regression flag when a case drops ≥ a threshold vs its trailing mean.
- [x] Existing eval runner tests still pass; new unit test for the writer (mock client, fail-silent path).
- [~] Value probe: mechanism is implemented and verified against a live local `ocrecipes_lab` (including a simulated regression and an all-errored commit) — but "the next time any AI-service prompt changes" is a future event this session cannot manufacture. Pending first real trigger; see Updates below.

## Implementation Notes

- Touch `evals/runner.ts` minimally: extract a `persistResults(results)` function; keep the runner's `--allow-prod` guard logic untouched.
- Reuse the `pg` dep and the connect-timeout fail-silent pattern from the flake-ledger todo (same shape; whichever merges first sets the pattern).
- `notes jsonb` captures judge rationale if the runner exposes it — cheap now, useful for debugging judge drift.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Eval runs are already slow/expensive; persistence must add ~0 wall time (single flush).
- Score comparability across judge-model changes — store judge_model per row so trends can be segmented.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch B).

### 2026-07-06

- Implemented: `scripts/pg-lab/schema/eval-results.sql` (`dev.eval_results` + an
  `output_hash` column, added post-creation via an idempotent `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS` so an already-bootstrapped installation still picks it up), a new
  `evals/lib/eval-results-store.ts` (`persistResults`), and `scripts/pg-lab/eval-report.sh`.
- **Architectural deviation from the Implementation Notes (Acceptance Criteria took
  precedence per the todo-executor's Step 4 rule):** `evals/runner.ts` is only the entry
  point for the "coach" suite — all 5 suite runners (coach, recipe-chat,
  recipe-generation, photo-analysis, meal-suggestions) share `runEvalSuite()` in
  `evals/lib/runner-core.ts`, which also owns the `--allow-prod` guard the notes said to
  leave untouched. Wiring `persistResults` into `runner-core.ts` instead of `runner.ts`
  literally satisfies the Background's stated goal (regression detection across all 4+1
  AI services, not just coach) while leaving `runner.ts` itself unmodified. `runner.ts`
  still "writes one row per case-sample at run end" exactly as the AC requires — via the
  shared function it already delegated to.
- Two code-review rounds (code-reviewer + ai-reviewer in parallel, both rounds). Round 1
  found real correctness gaps: per-case `score` was an unweighted average while
  `aggregateResults`' own `weightedOverall` applies `dimensionWeights` (fixed by threading
  `config.dimensionWeights` through); `eval-report.sh`'s `WHERE score IS NOT NULL` was
  silently dropping an all-errored commit from the trend entirely instead of flagging it
  (fixed via `FILTER` + an explicit `ALL_ERRORED` flag); the `EVAL_SAMPLES_PER_CASE` `#N`
  sample suffix was persisted verbatim into `case_id`, fragmenting one logical case's
  trend line (fixed by stripping the suffix before persisting); missing the
  nutricam/ocrecipes_solutions safety-rail denylist every sibling PG Lab script has (fixed,
  as a silent no-op since this path runs unattended); no way to distinguish judge drift
  from a real regression (fixed by adding an `output_hash` column); `judge_model` not
  surfaced in the report (fixed); no dirty-tree marker on the commit hash (fixed, `-dirty`
  suffix). Round 2 confirmed all of round 1's fixes and surfaced smaller residual gaps,
  all fixed: no `query_timeout` on the pg `Client` (connect timeout alone doesn't bound a
  hung query); the new unit test never mocked `child_process`, so the dirty-tree logic had
  no real regression coverage (fixed — `child_process` is now mocked, with dedicated
  clean/dirty/git-failure test cases); `isDirtyWorkingTree` used `git diff --quiet`, which
  misses brand-new untracked files (fixed — switched to `git status --porcelain`); the
  safety-rail's `connectionString.split("/").pop()` could be fooled by a trailing query
  string (fixed — parses via `new URL(...).pathname`). One SUGGESTION was deliberately
  deferred: surfacing `output_hash` in `eval-report.sh`'s own output (currently requires a
  manual follow-up query) — an enhancement, not a correctness issue.
- Verified against a real local Postgres (`ocrecipes_lab`, not the app's `nutricam`):
  applied the schema, wrote fixture rows via `persistResults` directly, simulated a
  regression (score drop ≥ threshold vs. trailing mean) and an all-errored latest commit,
  and confirmed `eval-report.sh` correctly flags `REGRESSION` / `ALL_ERRORED` and collapses
  multi-sample rows into one trend point. Also confirmed the `ALTER TABLE ADD COLUMN IF
NOT EXISTS` guard heals a table bootstrapped before `output_hash` existed. All fixture
  rows truncated afterward — the value-probe log this todo introduces starts genuinely
  empty in any real environment.
- Value probe still open: the mechanism is proven end-to-end with synthetic data, but no
  real AI-service prompt change has happened yet to generate a first real answer from
  `eval-report.sh`. Next time `photo-analysis.ts`, `nutrition-coach.ts`, `recipe-chat.ts`,
  or `recipe-generation.ts`'s prompt changes and an eval suite is run twice (before/after),
  run `scripts/pg-lab/eval-report.sh <service>` and record the actual verdict here.
