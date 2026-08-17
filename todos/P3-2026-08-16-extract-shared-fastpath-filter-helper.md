---
title: "Extract the 7x copy-pasted two-stage fast-path filter into a shared lib helper"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# Extract the 7x copy-pasted two-stage fast-path filter into a shared lib helper

## Summary

An 18-line, byte-identical (modulo one needle word) two-stage necessary-substring
fast-path filter is hand-copied into 7 separate `.claude/hooks/*.sh` files instead of
factored into one `lib/cmd-detect.sh` helper (e.g. `cmd_fastpath_has <needle> "$CMD"`).

## Background

Surfaced in the `/code-review` of PR #850 (`fix/cmd-words-quoting-bypass`). This PR
itself demonstrates the propagation risk: `cmd_words` already grew a third quote form
(ANSI-C `$'...'`) mid-branch, and the PR's own critical fix (adding a `$`-strip to the
filter) had to be hand-applied identically to all 7 files. Missing one silently reopens
a bypass in that one hook. The only regression-test safety net
(`test-cmd-detect.sh`'s "EVERY hook's necessary-substring fast path must be
quote-tolerant" section) checks the block's textual _presence_
(`grep -q '_T=\${CMD//'`), not its _correctness_ — a hook could satisfy the meta-test
with a subtly wrong copy (e.g. missing one of the substitutions) and still show green.

## Acceptance Criteria

- [ ] `lib/cmd-detect.sh` gains a shared fast-path filter function (e.g.
      `cmd_fastpath_has <needle...> <<< "$CMD"` or equivalent) implementing the same
      two-stage (raw glob, then quote/backslash/newline/`$`-stripped glob) logic
      currently duplicated in `branch-preflight.sh`, `commit-verify.sh`,
      `core-bare-guard.sh`, `drift-detect.sh`, `drift-detect-update.sh`,
      `guard-outward-cli.sh`, `pr-preflight-guard.sh`.
- [ ] All 7 hooks call the shared helper instead of their own inline copy.
- [ ] `test-cmd-detect.sh`'s fast-path enumeration check is strengthened to assert
      correctness (an executed bypass probe), not just textual presence of the pattern.
- [ ] All existing hook self-tests (`scripts/run-hook-tests.sh`) still pass.

## Implementation Notes

The perf comment in each hook ("four literal substitutions, not one bracket class —
~1450ms vs ~5.5ms under bash 3.2") must survive the extraction; benchmark the helper
function call overhead itself, since these hooks run on every Bash tool call
(`project_per_bash_hook_overhead` memory: ~60-75ms budget across 9 hooks).

## Scope Contract

- **Mechanisms to use:** a new function in `.claude/hooks/lib/cmd-detect.sh`; no new files.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/{branch-preflight,commit-verify,core-bare-guard,drift-detect,drift-detect-update,guard-outward-cli,pr-preflight-guard}.sh`, `.claude/hooks/test-cmd-detect.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- The perf-sensitive bash-3.2 constraint means a naive extraction (e.g. an extra
  function-call layer per hook per Bash call) could reintroduce measurable overhead —
  benchmark before/after.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` reuse/efficiency findings.
