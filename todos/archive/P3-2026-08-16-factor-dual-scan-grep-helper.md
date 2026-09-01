---
title: "guard-outward-cli.sh: factor the repeated \$CMD+\$WORDS dual-scan grep pattern into a helper"
status: done
priority: low
created: 2026-08-16
updated: 2026-09-01
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

- [x] A shared `scan_both <pattern>` (or equivalent) helper in `guard-outward-cli.sh`
      (or `lib/cmd-detect.sh` if other hooks could use it) implements the newline-joined
      dual-rendering scan once, with the seam-forgery warning attached to the helper
      itself rather than duplicated per call site.
- [x] Both existing call sites use it. **Correction:** the two dual-scan sites are the
      `--auto-submit` check and the `--admin` check — not the `--repo`/`-R` egress check
      this AC named, which is implemented via `lib/cmd-detect.sh`'s `cmd_gh_pr_ref` and
      never used the dual-scan pattern at all.
- [x] Existing `test-guard-outward-cli.sh` assertions for both checks stay green
      (248/248, unchanged from baseline; all 34 hook self-test files pass).

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

### 2026-09-01 — DONE

Implemented as `scan_both()` in `guard-outward-cli.sh`, defined immediately after the
blank-rendering detector (so it is visibly downstream of both `$CMD` and `$WORDS`).
Both call sites now delegate; the per-site warning comments collapse to a pointer.

Three things worth recording beyond "it shipped":

1. **The AC's site enumeration was stale.** It named the `--repo`/`-R` egress check as
   one of the two dual-scan sites. There are exactly two, found by grepping for the
   newline-joined heredoc string: the `--auto-submit` check and the `--admin` check.
   The `--repo`/`-R` check is real but goes through `lib/cmd-detect.sh`'s `cmd_gh_pr_ref`,
   a different mechanism. The Background section had also listed `--admin` as a _future_
   copy-paste risk — it was already the second copy.

2. **A third invariant was found and moved onto the helper.** Beyond the newline join,
   these greps are deliberately case-SENSITIVE (no `-i`, unlike every invocation matcher
   in the file), because flag names are case-sensitive to the target CLIs and a
   case-insensitive short flag would false-match ordinary text. That reasoning existed
   only in the file header, ~570 lines from the code it governs. It is now on the helper.

3. **The safety net was verified to fire, not assumed to.** The seam-forgery assertions
   already existed for both sites. Rather than take "248 green" as proof the refactor
   was covered, the join was mutated to concatenation and the suite re-run: exactly the
   two `the $CMD/$WORDS seam cannot forge ...` assertions turned red, and the restore was
   byte-identical. Per `docs/solutions/conventions/a-reviewers-own-probe-is-a-test-and-inherits-its-rules-2026-08-31.md`,
   a green suite over an unmutated refactor is a negative with no positive control behind it.
