<!-- Filename: P3-2026-07-03-ci-hook-test-parity.md -->

---

title: "Reconcile hook-test coverage: CI runs 5 of 15 hook tests while preflight runs all 15 and claims parity"
status: done
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, ci, tooling]
github_issue:

---

# Reconcile hook-test coverage: CI runs 5 of 15, preflight runs all 15 and claims parity

## Summary

Full `scripts/preflight.sh` runs **all 15** `.claude/hooks/test-*.sh` in a loop, but
`.github/workflows/ci.yml` runs only **5** of them — and preflight.sh's own comment claims CI
runs the suite ("mirror it … no drift"). Either add the missing 10 to CI or correct the claim
and document the intended split. From the 2026-07-02 harness audit (CONSOLIDATE #7, hook-test
half).

## Background

Verified 2026-07-03:

- `scripts/preflight.sh:94-104` loops over every `.claude/hooks/test-*.sh` (15 files today)
  with inherited-git-env stripping, under the comment: _"CI's 'Lint · Types · Patterns' job
  runs the `.claude/hooks/test-_.sh` suite; mirror it … (no drift)."\*
- `.github/workflows/ci.yml` runs only 5, hand-listed: `test-commit-verify`,
  `test-branch-preflight`, `test-pr-verify`, `test-pr-preflight-guard`,
  `test-session-recent-issues`.
- So **10** hook tests run in local preflight but **not** in CI: `core-bare-guard`,
  `drift-detect`, `eslint-fix`, `guard-concurrent-session`, `guard-worktree-isolation`,
  `inject-patterns`, `pre-push`, `precommit-gate`, `preflight-stamp-path`, `worktree-deps`.
  The "mirror it / no drift" comment is therefore inaccurate.

Scope note: the audit's CONSOLIDATE #7 also mentioned a "duplicate whole-repo eslint (runs
twice back-to-back)" in full preflight. That is **not present** in the current `preflight.sh`
(full mode runs `npm run lint` once at :85; the `npx eslint <changed>` calls live in the
fast/staged branches, which `exit` before full mode). So this todo covers only the hook-test
parity half.

## Acceptance Criteria

- [x] Decide the policy and record it: **(a) — run all 15 in CI via a glob loop.** `git blame`
      showed the 5 hand-listed tests were appended incrementally (2026-06-04, 2026-06-19) as
      each workflow-gate test was written — hand-listing drift, not a deliberate subset.
- [x] `ci.yml` runs the hook tests via a **loop** (`for t in .claude/hooks/test-*.sh`) with
      the same `env -u GIT_DIR …` stripping as `preflight.sh:103` — one step replacing the
      five hand-listed ones; new hook tests are picked up automatically.
- [x] The `preflight.sh:94-97` comment matches reality — under (a) it is accurate exactly as
      written, so preflight.sh needed zero changes.
- [x] `npm run preflight` green; the CI "Lint · Types · Patterns" job green on the
      implementing PR (which runs the modified workflow — all 15 `▶` markers in the step log).

## Implementation Notes

- Files in scope: `.github/workflows/ci.yml` (the "Lint · Types · Patterns" job) and
  `scripts/preflight.sh` (comment only — no logic change there).
- The 10 missing tests are cheap (each spins its own temp git repo); running all 15 adds only
  a few seconds. Prefer the loop form in CI to kill the hand-listing drift permanently.
- Executor note: touches `.github/workflows/` and a `.claude/hooks/` comment → HELD for
  individual review by the automerge guard.

## Dependencies

- Overlaps conceptually with `todos/P3-2026-06-28-lock-stamp-path-worktree-invariance-test.md`
  (adds a hermetic real-worktree case to `test-preflight-stamp-path.sh`, one of the 10). Not a
  hard blocker; sequence either way.

## Risks

- Some of the 10 may assume a local-only environment (a real linked worktree, `psql`, or
  provisioned deps) and could be flaky on the CI runner. Verify each runs **hermetically**
  before adding; if one genuinely needs a DB or real worktree, gate/skip it explicitly rather
  than let CI go red. This is the real work — the loop itself is trivial.

## Updates

### 2026-07-03

- Initial creation. Filed from the 2026-07-02 harness audit (CONSOLIDATE #7); scoped to the
  hook-test parity half only — the double-eslint half was already resolved in `preflight.sh`.

### 2026-07-03 (resolution)

- **Policy (a) chosen and implemented**: `ci.yml`'s five hand-listed hook-test steps replaced
  by one loop step mirroring `preflight.sh:98-104` (same glob, same
  `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR`
  prefix, plus a `▶ <test>` marker per test for log readability).
- **Hermeticity sweep of the 10 CI-missing tests: all SAFE on ubuntu-latest.** No DB, network,
  `$HOME`, or gitignored-file dependencies; only external tool is `jq` (already required by
  the 5 in CI; preinstalled). `test-eslint-fix`/`test-pre-push` stub `npx`/`npm`/`gh` via PATH
  shims; `test-precommit-gate` runs `preflight.sh --staged` under `PREFLIGHT_DRY_RUN=1`
  (echo-only). No BSD/GNU issues; no timing flakiness (drift test compares HEAD SHAs, lease
  test uses a year-2000 `touch -t` — no sleeps).
- **Caveats recorded**: (1) `test-drift-detect`, `test-precommit-gate`, `test-worktree-deps`,
  and partially `test-preflight-stamp-path` do NOT self-strip inherited git env — the CI
  loop's `env -u` prefix is load-bearing, keep it if the step is ever rewritten.
  (2) `scripts/lib/preflight-stamp-path.sh:41` soft-depends on `shasum` (Perl) — present on
  hosted runners; revisit only if CI moves to a minimal container image.
- `scripts/preflight.sh` untouched: under (a) its comment is accurate as written.
