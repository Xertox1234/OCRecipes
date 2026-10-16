---
title: "Explore: the ALLOW_OUTWARD_CLI=1 bypass only works as the first text of a Bash command"
status: backlog
priority: low
created: 2026-10-16
updated: 2026-10-16
assignee:
labels: [harness, investigation]
github_issue:
human_led: true
---

# Explore: the ALLOW_OUTWARD_CLI=1 bypass only works as the first text of a Bash command

## Summary

The one-command bypass for the outward-CLI guard is honored only when the Bash command string begins with `ALLOW_OUTWARD_CLI=1 `. Anything in front of it, such as `cd <dir> &&`, a precondition check, or another `VAR=` assignment, makes the guard deny the command as if no bypass were given. The owner wants to explore this in depth and decide whether to change it.

## Background

- **Where:** `.claude/hooks/guard-outward-cli.sh`
  - Decoded path: line ~2078, `case "$CMD" in "ALLOW_OUTWARD_CLI=1 "*) exit 0 ;; esac`.
  - Raw-envelope path, used when jq is missing or extraction fails: `raw_inline_bypass` at line ~2017, `*'"command":"ALLOW_OUTWARD_CLI=1 '*`.
- **Why it reads the string at all** (comment at lines ~2068–2077): a PreToolUse hook runs before the command's shell, so a `VAR=val cmd` prefix never reaches the hook's environment. The literal prefix is the only way to honor "one command". `git-safety.sh`'s `SKIP_WORKTREE_CONTRACT=1` works the same way.
- **Times it caused a failure:**
  - 2026-09-15, #966: a leading `cd` meant the merge was denied.
  - 2026-10-16: a production OTA written as `cd … && git log … && git status … && ALLOW_OUTWARD_CLI=1 npm run update:production …` was denied. Running the bypassed command as its own Bash call worked.
- **What the deny gets wrong:** it says "Bypass: ALLOW_OUTWARD_CLI=1 (one command)", but not that the bypass must come first. A misplaced bypass therefore looks like a bypass that doesn't work.
- **Harness status:** guard hardening has been frozen since 2026-09-22. Guard findings normally go to `docs/harness-residuals.md`, not a todo. The owner asked for a todo explicitly on 2026-10-16, so this file is that exception. It is `human_led` because guard edits need auto mode OFF and an owner decision.

## Questions to explore

- Is first-position-only deliberate safety or an accident of the implementation?
  - Accepting the prefix anywhere would let a bypass on one segment cover every other segment of a compound command, e.g. `harmless && ALLOW_OUTWARD_CLI=1 x && eas update`.
  - Would accepting it only on the segment that triggers the deny be safe? That needs the guard's segment/command-position parser to agree on which segment matched.
- Should a misplaced bypass (present, but not first) get its own deny message, e.g. "ALLOW_OUTWARD_CLI=1 must be the first text of the command; move checks into a separate Bash call"? This is wording only, with no change to what is allowed.
- Does `git-safety.sh`'s `SKIP_WORKTREE_CONTRACT=1` behave the same way? Fix both consistently or document both.
- Is any agent instruction or skill (e.g. `/land`, `docs/AI_WORKFLOW.md`, the OTA steps in `CLAUDE.md`) written in a shape that puts the bypass after a `cd` or check?

## Acceptance Criteria

- [ ] Findings written down: deliberate vs. accidental, and the compound-command risk of each alternative.
- [ ] Owner decision recorded: keep as is, improve the deny message only, or change the matching.
- [ ] If anything changes: a test row in `.claude/hooks/test-guard-outward-cli.sh` for each case below, all passing.
  - Bypass first: allowed.
  - Bypass after `cd … &&`.
  - Bypass on a harmless segment while another segment is outward.
- [ ] If nothing changes: an entry in `docs/harness-residuals.md`, and this todo archived.

## Implementation Notes

- Read the guard's tests and corpus first: `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`.
- Read the guard-work lessons in auto-memory `MEMORY-reference.md` before editing any hook. Narrowing a deny predicate needs a regression test.
- Guard edits need auto mode OFF (owner).

## Scope Contract

- **Mechanisms to use:** the existing inline-bypass checks. Nothing new unless the owner rules for it.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`, `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/repro-outward-cli-corpus.sh`, `docs/harness-residuals.md`; `.claude/hooks/git-safety.sh` only if the owner extends this to `SKIP_WORKTREE_CONTRACT`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Owner decision; auto mode OFF for any guard edit.

## Risks

- Loosening where the bypass is accepted can let it cover an outward command it was not meant for. The 2026-08-16 accidental OTA is the incident this guard exists to prevent.

## Updates

### 2026-10-16

- Filed at the owner's request after the production OTA command was denied for putting the bypass after `cd … &&`.
