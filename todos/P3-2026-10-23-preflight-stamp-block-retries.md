---
title: "Find why the PR preflight-stamp block gets retried, and fix the cause or the message"
status: backlog
priority: low
created: 2026-10-23
updated: 2026-10-23
assignee:
labels: [harness, deferred]
github_issue:
human_led: true
---

# Find why the PR preflight-stamp block gets retried, and fix the cause or the message

## Summary

The PR-creation guard blocked 28 times in 12 sessions since 2026-10-12, with two sessions retrying 6 times
each. Work out what the agent kept doing wrong and fix that cause, so a PR goes through on the first or
second try.

## Background

From the 2026-10-23 harness review (each blocked tool call counted once): `Blocked: no fresh preflight
pass-stamp for HEAD` = **28 blocks, 12 sessions, top sessions 6 and 6**. Most messages show `(found: )`,
meaning no stamp at all, not a stale one.

The message (`.claude/hooks/pr-preflight-guard.sh:166`) already says "Push the branch first". So the
retries probably aren't caused by unclear wording. Likely causes to check: worktree pushes where hooks
did not run (`core.hooksPath` empty — memory `reference_worktree_hooks_did_not_run.md`); a push skipped
because HEAD was already stamped somewhere else; a peer session overwriting the stamp
(`project_pr_preflight_guard_worktree_head.md`); or a preflight that refused to stamp because Postgres was
unreachable.

Adds no CI time (local guard and message only).

## Acceptance Criteria

- [ ] Join each block to its command and to the preceding `git push` / `preflight:fast` output in the same
      transcript. Report the cause per block, with the denominator.
- [ ] If one cause dominates, fix it at that root (e.g. the guard detects an empty `core.hooksPath` and
      says to run `npm run preflight:fast` by hand). Otherwise make the message name the specific
      missing condition it found.
- [ ] Test rows in `.claude/hooks/test-pr-preflight-guard.sh` for each new message branch.
- [ ] No change to what the guard accepts. It still requires a fresh HEAD-matching stamp.

## Implementation Notes

- Read `project_preflight_and_worktree_guard_mechanics.md` and `project_pr_preflight_guard_worktree_head.md`
  (memory) before touching the guard.
- Auto mode must be OFF to edit the guard.

## Scope Contract

- **Mechanisms to use:** the existing stamp path helpers (`.claude/hooks/lib/review-stamp-path.sh`, the
  preflight stamp path) — nothing new.
- **Files in scope:** `.claude/hooks/pr-preflight-guard.sh`, `.claude/hooks/test-pr-preflight-guard.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Auto mode OFF.

## Risks

- Loosening acceptance by accident. The acceptance criteria forbid it, so keep the existing deny rows intact.

## Updates

### 2026-10-23

- Created from the harness-effectiveness review.
