---
title: "lock preflight stamp-path worktree cwd-invariance with a discriminating test"
status: done
priority: low
created: 2026-06-28
updated: 2026-06-28
assignee:
labels: [deferred, ci, tooling]
github_issue:
---

# lock preflight stamp-path worktree cwd-invariance with a discriminating test

## Summary

`.claude/hooks/test-preflight-stamp-path.sh` case 3 ("same repo, different cwd → same
path") uses a **subdirectory** as the cwd-invariance proxy. That proxy does NOT discriminate
the correct `git rev-parse --git-common-dir` keying from a regression to `--git-dir`: a subdir
canonicalizes to `<repo>/.git` under BOTH implementations, so the test passes either way. The
property the whole fix (PR #478) hinges on — that the stamp path is identical from the main
checkout AND every linked worktree — is currently verified only by a one-time manual check,
not by the regression net. A future swap to `--git-dir` would go green in CI and silently
reintroduce the `/todo` MCP-create false-DENY that PR #478 fixed.

## Background

Raised during the PR #478 wrap-up (the per-repo stamp-path fix). The advisor traced that only
a REAL linked worktree distinguishes the two implementations:

- subdir under `--git-dir`: root `.git` and subdir `../.git` both canonicalize to `<repo>/.git`
  → same key → regression NOT caught.
- linked worktree under `--git-dir`: main `<repo>/.git` vs worktree `<repo>/.git/worktrees/<n>`
  → different keys → regression caught.

Self-healing / low-probability (the helper carries a prominent comment explaining WHY
common-dir is used), hence low priority — but it's cheap to lock and it pins the one design
decision that's easy to "simplify" wrongly.

## Acceptance Criteria

- [x] `.claude/hooks/test-preflight-stamp-path.sh` adds a case that, in a temp git repo with at
      least one commit, runs `git worktree add` to create a linked worktree, then asserts
      `preflight_stamp_path` resolves to the SAME path from the main checkout and from the linked
      worktree (i.e. `key_in <main>` == `key_in <linked-worktree>`).
- [x] The new case provably FAILS if the helper is changed from `--git-common-dir` to
      `--git-dir` (verify once by hand during implementation, then revert).
- [x] Temp worktree + repo are cleaned up via the existing `trap ... EXIT`; no real paths touched.
- [x] Test stays hermetic (own temp repo, inherited git env stripped as in `key_in`).

## Implementation Notes

- Pattern mirrors the existing `key_in()` helper and case-13 `--allow-empty` commit in
  `test-pr-preflight-guard.sh` (a worktree needs a HEAD to attach).
- `git worktree add` needs a commit first: `git -c user.email=t@t -c user.name=t commit
--allow-empty -m init` in the temp repo, then `git worktree add "$WT_DIR"`.
- Strip inherited git env (`env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR ...`) for the
  inner resolution, exactly like `key_in`.
- Files: `.claude/hooks/test-preflight-stamp-path.sh` only. No source change.

## Risks

- `git worktree add` is slightly heavier than the subdir proxy; keep the temp dirs small and
  ensure cleanup so the CI runner isn't left with stray worktrees.

## Updates

### 2026-06-28

- Initial creation. Surfaced in the PR #478 (`1c6c86e`) wrap-up review.

### 2026-07-05 (resolution)

- Added case 5 to `.claude/hooks/test-preflight-stamp-path.sh`: builds a temp repo with an
  `--allow-empty` init commit, runs `git worktree add`, and asserts `key_in <main>` ==
  `key_in <linked-worktree>`.
- Verified by hand: temporarily changed `scripts/lib/preflight-stamp-path.sh` from
  `--git-common-dir` to `--git-dir` — case 3 (subdir proxy) still passed, case 5 (real
  worktree) correctly FAILED with a "worktree drift" message. Reverted; `git diff` on the
  helper confirms no residual change.
- Code review (`code-reviewer`) raised one WARNING: the new case's mutating setup (commit +
  worktree add) didn't strip inherited git env at the file level, unlike the `key_in()`
  resolution step — a residual risk only if the file is run directly outside the
  env-stripping wrapper (`scripts/run-hook-tests.sh`). Fixed inline by adding a file-level
  `unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR` +
  `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` guard at the top of the script,
  mirroring the established precedent in `.claude/hooks/test-core-bare-guard.sh`.
- Full hook-test suite (`scripts/run-hook-tests.sh`, 16 tests) and project-wide
  `check:types`/`lint`/`test:run` all pass.
