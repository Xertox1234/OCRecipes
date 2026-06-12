---
title: "Guard against parallel-terminal git state drift during Claude sessions"
status: done
priority: low
created: 2026-06-05
updated: 2026-06-05
assignee:
labels: [deferred, tooling]
github_issue:
---

# Guard against parallel-terminal git state drift during Claude sessions

## Summary

Add a HEAD/working-tree drift detector so that when the user edits, commits, or
rebases the same checkout in a parallel terminal mid-session, Claude is warned
_before_ it commits/pushes — instead of silently racing the user or mistaking an
absorbed edit for a lost one.

## Background

During the `feat/gated-mutation-goal-safety` session (2026-06-05) the user was
editing and rebasing the same checkout in a parallel terminal while Claude
worked. This produced three concrete failure modes:

1. **"Vanished" edit** — Claude's edit to `stryker.targets.mjs` disappeared from
   `git diff HEAD`. It had not been lost; the user's parallel rebase had
   _committed_ it. Only a `git log` / `git reflog` check revealed this.
2. **Moving HEAD** — HEAD advanced three times during the session
   (`6263aaf4` → `4ef5e57a` → `0ecd4261`) with no signal to Claude that the repo
   had moved underneath it.
3. **Near-duplicate commit** — Claude independently wrote the same guard + test
   the user had just committed, and nearly committed a redundant copy.

This is a recurring class of friction. Existing memory notes already acknowledge
it (`feedback_verify_branch_before_commit`, `feedback_gh_merge_sweeps_dirty_tree`)
but rely on Claude _remembering_ to re-check — which is exactly what failed here.
A hard signal (hook) beats a soft signal (docs/memory).

## Acceptance Criteria

- [ ] Session records a baseline HEAD SHA (SessionStart hook, or first git op).
- [ ] A PreToolUse hook on `git commit` / `git push` detects when HEAD has
      advanced **externally** (HEAD != last-Claude-observed SHA) and surfaces a
      clear, single-shot `systemMessage`: old SHA → new SHA, "repo moved
      externally — re-check `git log`/`git status` and reconcile before proceeding."
- [ ] The detector distinguishes Claude's own commits from external ones (compare
      against the SHA recorded _after Claude's last git operation_, not just
      session start) to avoid firing on every commit Claude makes itself.
- [ ] Warn, do **not** hard-block — the user is a legitimate co-author; the goal
      is visibility, not a wall.
- [ ] Fires only on actual drift, never per-turn (respect
      `feedback_no_per_turn_hook_output` — no noisy every-commit message).
- [ ] Decide + document whether dedicated worktree isolation should be the default
      for long multi-edit sessions (the project already has worktree provisioning
      via `.husky/post-checkout`; see `project_worktree_provisioning`).
- [ ] Update CLAUDE.md and/or auto-memory with the chosen protocol.

## Implementation Notes

Three candidate approaches (A recommended; B/C as complements):

- **A — Drift-detection hook (recommended).** Store the baseline SHA in a
  per-session temp file (keyed by the session/transcript dir). Update it after
  every Claude-initiated `git commit`/`git push` (PostToolUse). On the next
  `git commit`/`git push` PreToolUse, compare current `git rev-parse HEAD` to the
  stored value; if it changed without Claude having moved it, emit the warning.
  Optionally also flag working-tree files that changed with no matching
  `Edit`/`Write` tool call in the session. Wire into `.claude/settings.json`
  hooks alongside the existing `branch-preflight` / `commit-verify` hooks (good
  reference implementations already in the repo).
- **B — Worktree isolation.** Default long multi-edit sessions into a dedicated
  git worktree so the user's main-checkout edits cannot move Claude's HEAD.
  Trade-off: setup cost + interactive sessions usually want the _same_ checkout
  the user is looking at. Probably opt-in, not default.
- **C — Protocol hardening.** Codify "re-run `git rev-parse HEAD` +
  `git status --porcelain` before any commit/push and after any surprising
  `git diff`." Already partially in memory but insufficient alone — pair with A.

Reference hooks for the pattern: `.claude/hooks/` (branch-preflight, commit-verify,
pr-verify) and their registration in `.claude/settings.json`.

## Dependencies

- None blocking. Builds on the existing `.claude/hooks/` + `settings.json` infra.

## Risks

- **False positives** distinguishing Claude's own commits from external ones —
  the after-last-op SHA comparison is the crux; get it wrong and it either
  over-warns (fatigue) or misses real drift.
- **Hook attribution is heuristic** — git can't truly tell "who" moved HEAD; rely
  on Claude's own recorded op SHAs, not commit author.
- **Notification fatigue** — must be conditional/one-shot, not per-turn.

## Updates

### 2026-06-05

- Initial creation. Motivated by the `feat/gated-mutation-goal-safety` session
  where parallel-terminal rebasing moved HEAD 3× and nearly caused a duplicate
  commit.
