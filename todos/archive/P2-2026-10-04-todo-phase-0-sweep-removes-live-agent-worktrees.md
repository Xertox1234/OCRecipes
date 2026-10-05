---
title: "/todo's cleanup sweep deletes a running agent's worktree"
status: done
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

- [x] Phase 0 step 1 skips a worktree that is in use and reports it as skipped (not removed).
- [x] "In use" is measured, not assumed. A worktree is skipped if ANY of these signals fires:
  - another session's worktree-contract registry (`/tmp/claude-worktree-contracts-<other-session-id>/`) lists its path AND files in the worktree changed recently (a crashed executor leaves its registry entry behind, so the entry alone is not proof);
  - the newest file mtime in the worktree (excluding `node_modules`) is within a recent window;
  - a running process has its cwd inside the worktree.
- [x] Do NOT use the worktree's `.git` file mtime (written once at creation) or the index mtime alone (git rewrites it only on `add`/`commit`/`status`, so an editing or test-running agent looks idle).
- [x] Before relying on the process signal, check it against a live `Agent(isolation: "worktree")` subagent: does any process have its cwd inside the worktree between Bash commands? Record the result in the PR description. If it does not, keep the process signal only as a backup check for an agent that is mid-command.
- [x] A worktree that is neither recent nor in use is still removed, as today.
- [x] Phase 5 step 6's crash-backstop sweep applies the same check.

## Implementation Notes

- Sweep loop: `.claude/skills/todo/SKILL.md` Phase 0 step 1 (around line 15), and Phase 5 step 6.
- Registry signal: every executor runs `scripts/declare-worktree.sh` at Step 0, which writes the worktree's absolute path into a file under `/tmp/claude-worktree-contracts-$CLAUDE_CODE_SESSION_ID/`. Phase 0 runs before this run's executors exist, so any match in a registry folder is another session's. In Phase 5, exclude this session's own folder, since all of this run's executors have returned by then.
- File-activity signal: newest mtime under the worktree, e.g. `find "$wt" -path '*/node_modules' -prune -o -type f -newermt "-<N> minutes" -print -quit`. Expect to tune that `find` for BSD/macOS.
- Process signal: `lsof -d cwd` or `ps` against the worktree path.
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
- Re-spec before `/todo-fast`: index mtime replaced by the registry and newest-file-mtime signals. The process signal needs a live check, since in-process subagents may never hold a cwd inside their worktree.
- Implemented in `.claude/skills/todo/SKILL.md`: `wt_in_use` guards Phase 0 step 1 and Phase 5 step 6 (Phase 5 excludes this session's registry folder). Run under bash and zsh. Empirical check: a live `Agent(isolation: "worktree")` subagent has no process with cwd in its worktree between Bash calls (only the per-call shell, lsof, awk during a call), so the process signal is backup only.
