---
title: "Find why the PR preflight-stamp block gets retried, and fix the cause or the message"
status: done
priority: low
created: 2026-10-23
updated: 2026-10-25
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

- [x] Join each block to its command and to the preceding `git push` / `preflight:fast` output in the same
      transcript. Report the cause per block, with the denominator.
- [x] If one cause dominates, fix it at that root (e.g. the guard detects an empty `core.hooksPath` and
      says to run `npm run preflight:fast` by hand). Otherwise make the message name the specific
      missing condition it found.
- [x] Test rows in `.claude/hooks/test-pr-preflight-guard.sh` for each new message branch.
- [x] No change to what the guard accepts. It still requires a fresh HEAD-matching stamp.

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

### 2026-10-25 — done

- **Measured.** Every PR-guard deny in the transcripts since 2026-10-12, joined to the last
  push before it: **24 unique blocks, 12 sessions** (deduped by tool-use id; the raw marker
  count is 42 because results repeat in the jsonl, and 69 if file reads of the guard count).
  - 16 came before #1436 (2026-10-14T05:09Z), when the guard read the cwd's HEAD instead of the
    PR's branch (`8904143` is denied for two different branches). Already fixed.
  - Of the 8 after it: **5** were pushes from `.claude/worktrees/*` whose output shows no
    pre-push gate at all, even unpiped; 2 were deliberate `--no-verify` pushes; 1 was a U34Bolt
    worktree push with no gate output. In each, the stamp found belonged to another session's
    earlier push.
  - 3 of the retries prefixed `SKIP_PR_PREFLIGHT=1` to the command. The guard reads its own
    environment, so that can never work.
- **Root cause.** `core.hooksPath` is the relative `.husky/_` (husky 9 writes it on every
  npm install). Git resolves it against each worktree's own root, and `.husky/_` is generated and
  gitignored, so a linked worktree has none and git silently runs no hooks. A throwaway repo
  reproduces it on git 2.50.1: relative path, worktree commit runs no hook; absolute path, it runs.
  This also explains the 2026-09-25/26 flip-flop the memory could not trace.
- **Fix (owner chose hooks + message).** `prepare` now runs `scripts/install-git-hooks.sh`:
  husky, then `core.hooksPath` = the main checkout's `.husky/_`, absolute, when those shims exist.
  The guard's deny now names the case "git runs no pre-push hook in this tree, run
  `npm run preflight:fast` here", and says the bypass must be in Claude Code's launching
  environment. What the guard accepts is unchanged (a row pins a fresh stamp still allowing).
- Scope note: the hooks fix touches `package.json` + a new script, outside this todo's listed
  files; the owner chose it over the message-only option.
