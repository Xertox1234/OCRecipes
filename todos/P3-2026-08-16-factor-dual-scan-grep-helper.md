---
title: "guard-outward-cli.sh: factor the repeated \$CMD+\$WORDS dual-scan grep pattern into a helper"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# guard-outward-cli.sh: factor the repeated dual-scan grep pattern into a helper

## Summary

The `$CMD`+`$WORDS` newline-separated dual-rendering grep pattern
(`grep -Eq '...' <<< "$CMD\n$WORDS"`) is hand-rolled twice in `guard-outward-cli.sh`
(the `--repo`/`-R` egress check and the `--auto-submit` flag check), each with its own
near-duplicate "NEWLINE not concatenation" warning comment, rather than factored into
one helper (e.g. `scan_both PATTERN`).

## Background

Surfaced in the `/code-review` of PR #850. A third deny-only flag check added later
(this file already has several, e.g. the `--admin` check) is likely to copy-paste this
pattern again rather than reuse a function. A well-meaning "simplification" that
collapses the two strings with `+`/string concatenation instead of a newline would
silently reopen the seam-forgery bug the comment warns about (`--ad` + `min` =
`--admin`), and only the comment — not the structure — currently prevents that
regression.

## Acceptance Criteria

- [ ] A shared `scan_both <pattern>` (or equivalent) helper in `guard-outward-cli.sh`
      (or `lib/cmd-detect.sh` if other hooks could use it) implements the newline-joined
      dual-rendering scan once, with the seam-forgery warning attached to the helper
      itself rather than duplicated per call site.
- [ ] Both existing call sites (`--repo`/`-R` egress check, `--auto-submit` check) use it.
- [ ] Existing `test-guard-outward-cli.sh` assertions for both checks stay green.

## Implementation Notes

Keep the seam-forgery warning comment (`--ad` + `min` = `--admin`) directly on the
helper function definition so it cannot be separated from the code it explains.

## Scope Contract

- **Mechanisms to use:** a new local function in `.claude/hooks/guard-outward-cli.sh`
  (or a shared `lib/cmd-detect.sh` helper if a second consumer emerges).
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Low — this is a same-file, same-behavior refactor with existing test coverage on both
  call sites.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` reuse/efficiency findings.
