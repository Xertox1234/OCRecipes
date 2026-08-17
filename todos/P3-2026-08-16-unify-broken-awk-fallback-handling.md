---
title: "Unify the two divergent broken-awk-backend fallback implementations"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# Unify the two divergent broken-awk-backend fallback implementations

## Summary

`pr-preflight-guard.sh`'s `WORDS_BROKEN` fallback and `guard-outward-cli.sh`'s
BARE/WORDS blank-rendering check both solve the identical "awk is present but not
functional" failure mode, but with structurally different control flow (a 3-way
if/elif/else plus a redundant second `declare -F` re-check, vs. one unified boolean
condition) and different variable names.

## Background

Surfaced in the `/code-review` of PR #850. Two hooks now handle the same underlying
failure with different shapes — a maintainer fixing an edge case in one style (e.g.
adding a third possible rendering, or changing how "broken" is detected) has no shared
code path to update and is likely to fix only the hook they're looking at, leaving the
other's fallback logic stale.

## Acceptance Criteria

- [ ] A single shared helper (e.g. `cmd_words_or_broken` or similar in
      `lib/cmd-detect.sh`) expresses "awk present but non-functional" detection once.
- [ ] Both `pr-preflight-guard.sh` and `guard-outward-cli.sh` call the shared helper.
- [ ] Existing `test-pr-preflight-guard.sh` "awk PRESENT BUT BROKEN" tests and
      `test-guard-outward-cli.sh`'s blank-rendering tests both stay green.

## Implementation Notes

`pr-preflight-guard.sh`'s fallback additionally degrades to a cruder raw-quote-strip
check (`${CMD//[\"\']/}`) rather than `guard-outward-cli.sh`'s crude-smell-test path —
confirm whether these two fallback behaviors are meant to converge too, or are
legitimately hook-specific (each hook's downstream matcher differs), before unifying
more than the detection logic.

## Scope Contract

- **Mechanisms to use:** a new function in `.claude/hooks/lib/cmd-detect.sh`.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/pr-preflight-guard.sh`, `.claude/hooks/guard-outward-cli.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- The two hooks' fallback DEGRADE-TO behavior differs (crude smell test vs. raw-quote
  strip) — unifying detection without preserving each hook's distinct degrade path
  could weaken one hook's fail-closed guarantee.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` reuse/efficiency findings.
