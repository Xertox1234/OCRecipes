<!-- Filename: P3-2026-07-03-hook-test-runner-single-source.md -->

---

title: "Single-source the hook self-test runner: extract scripts/run-hook-tests.sh called by ci.yml and preflight.sh"
status: backlog
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, ci, tooling]
github_issue:

---

# Single-source the hook self-test runner (ci.yml + preflight.sh call one script)

## Summary

PR #495 fixed hook-test **membership** drift by mirroring `scripts/preflight.sh`'s glob loop
into `.github/workflows/ci.yml`. The review of that PR (finding: PLAUSIBLE) flagged the
residual gap: the **mechanism** is now duplicated — the `env -u GIT_DIR …` strip list, the
`[ -f ]` guard, and the fail-fast semantics live in two places and can drift silently.
Extract a shared `scripts/run-hook-tests.sh` invoked by both.

## Background

- The hook-test step is the only check in the CI `checks` job whose logic (not just
  membership) is duplicated with preflight — every other step shares one npm script or one
  `scripts/check-*.js` file where the logic lives.
- The mechanism has churned before: commit `36f94012` retrofitted the git-env stripping after
  an inherited-`GIT_DIR` hijack (see
  `docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md`).
  Next time the strip list changes (e.g. `GIT_CEILING_DIRECTORIES`), there are two edit sites.
- Divergence is invisible in CI: hosted runners export no `GIT_*` vars, so the CI copy's
  `env -u` prefix is inert there — a stale CI copy produces no red check.
- PR #495's review also added a zero-count guard (fail if the glob matches no files) to the
  **ci.yml copy only**; `preflight.sh`'s loop still fails open on an unmatched glob. The
  shared script should carry the guard to both (see
  `docs/solutions/logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md`).

## Acceptance Criteria

- [ ] `scripts/run-hook-tests.sh` exists and owns the full mechanism: the
      `.claude/hooks/test-*.sh` glob loop, the five-variable `env -u` git-env strip, per-test
      fail-fast, the `▶ <test>` marker, and the zero-count fail-closed guard.
- [ ] `.github/workflows/ci.yml` "Hook self-tests" step is a one-line call to the script
      (matching how the other pattern checks are invoked).
- [ ] `scripts/preflight.sh` full mode calls the script in place of its inline loop
      (lines ~98-104). This todo explicitly lifts PR #495's "preflight.sh comment-only"
      scoping — that constraint belonged to the parity todo, not to this one.
- [ ] Comments in both callers point at `scripts/run-hook-tests.sh` by name (no line-number
      cross-references — they rot).
- [ ] `npm run preflight` green; CI "Lint · Types · Patterns" green on the implementing PR
      with all 15 `▶` markers and the `✓ N hook self-tests passed` line in the step log.

## Implementation Notes

- Files in scope: `scripts/run-hook-tests.sh` (new), `.github/workflows/ci.yml`,
  `scripts/preflight.sh`.
- Keep the script caller-agnostic: no `run()` wrapper dependence (that helper is
  preflight-internal); plain `set -uo pipefail` + explicit `exit 1` so it behaves identically
  under preflight (no `-e`) and GitHub's `bash -eo pipefail`.
- `ran=$((ran+1))` for the counter, NOT `((ran++))` — the latter returns non-zero at 0 and
  kills the step under `-e`.
- Executor note: touches `.github/workflows/` → `todo-automerge-guard.sh` HOLDs the PR for
  individual review (expected).

## Dependencies

- PR #495 must merge first (this refactors the step that PR introduces).

## Risks

- Low. The extraction is behavior-preserving by construction; the AC's step-log assertions
  (15 markers + count line) verify it end-to-end on the implementing PR.

## Updates

### 2026-07-03

- Initial creation. Filed from the PR #495 review (mechanism-duplication finding, verified
  PLAUSIBLE — real fragility, deferred as follow-up rather than blocking the parity fix).
