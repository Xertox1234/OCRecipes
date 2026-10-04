---
title: "/todo's cleanup sweep deletes a running agent's worktree"
status: backlog
priority: medium
created: 2026-10-04
updated: 2026-10-04
assignee:
labels: [deferred, harness]
github_issue:
---

# /todo's cleanup sweep deletes a running agent's worktree

## Summary

`/todo` Phase 0 step 1 force-removes every `.claude/worktrees/agent-*` worktree and never checks whether one is still in use. If `/todo` starts while another session's `/todo` executor or `/todo-fast` run is still working, that run's worktree is deleted, uncommitted work included.

## Background

The sweep was written for a single session, where any `agent-*` worktree is a crashed leftover. Parallel terminals break that assumption.

- **Near-miss, 2026-09-16:** the sweep matched exactly one worktree, and it was a live one (PR #980, with a guard suite running in it). The user interrupted the call in time. This is recorded only in the auto-memory note `feedback_todo_phase0_sweep_kills_live_agents`.
- **Why it matters more now:** the `/todo-fast` rebuild (2026-10-04) dispatches its executor with `Agent(isolation: "worktree")`, so `/todo-fast` runs now have the same exposure.
- **Deferred from:** the `/todo-fast` rebuild PR, where it was out of scope.

## Acceptance Criteria

- [ ] Phase 0 step 1 skips a worktree that is in use and reports it as skipped (not removed).
- [ ] "In use" is measured, not assumed: at least the worktree's index mtime within a recent window, OR a running process whose cwd is inside the worktree.
- [ ] A worktree that is neither recent nor in use is still removed, as today.
- [ ] Phase 5 step 6's crash-backstop sweep applies the same check.

## Implementation Notes

- Sweep loop: `.claude/skills/todo/SKILL.md` Phase 0 step 1 (around line 15), and Phase 5 step 6.
- Process signal: `lsof -d cwd` or `ps` against the worktree path. Index signal: `stat -f %m <worktree-gitdir>/index`. A gitdir is `.git/worktrees/<name>/` in the common dir.
- Keep the sweep fail-safe: if the liveness check itself errors, skip the worktree rather than remove it.

## Scope Contract

- **Mechanisms to use:** a liveness check inside the existing sweep loops — nothing new.
- **Files in scope:** `.claude/skills/todo/SKILL.md`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- An over-broad "in use" window leaves real crash leftovers on disk. The next run catches them, so this costs disk space, not correctness.

## Updates

### 2026-10-04

- Initial creation (deferred from the `/todo-fast` slim rebuild).
