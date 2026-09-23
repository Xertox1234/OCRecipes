---
title: "review-stamp-writer.sh guard (c) passes the delivered text to jq as one argv string, so a delivery above the argv limit makes jq fail and writes no record where main stamped"
status: backlog
priority: low
created: 2026-09-22
updated: 2026-09-22
assignee:
labels: [deferred, harness]
github_issue:
---

# A very large delivery fails guard (c)'s jq call and writes no record

## Summary

Guard (c) in `.claude/hooks/review-stamp-writer.sh` runs
`jq -rs --arg cur "$MSG" …` to exclude the delivered text from the prior-report set. `--arg`
puts the whole delivered text into one argv string, so a delivery above the platform's per-string
argv limit makes `jq` fail to start, and the `|| exit 0` that follows writes no record. On
`origin/main` the transcript is never consulted on that path and the same delivery stamps.

Measured during PR #1012's confirmation review (round 3), hook under bash 5.3.15 on macOS
(`getconf ARG_MAX` = 1048576): delivered texts of 195,119 and 975,119 bytes stamp `clean` on both
writers; 1,105,119 bytes → head writes nothing, main writes `clean`. The largest real last
assistant text across 616 subagent transcripts is 45,746 bytes, so this is a regression only in an
unreachable regime today — about 23× above the largest observed delivery. Linux caps each argv
string at 131,072 bytes (`MAX_ARG_STRLEN`), still about 3× the largest real text, unmeasured.

## Background

Fail-closed: no record denies at the gate exactly like a dirty one, so the cost is a re-dispatch,
not a laundered merge. Filed rather than fixed under the 2026-09-17 one-pass decision because the
regime is unreachable and the fix touches the writer's merge-path code again.

## Acceptance Criteria

- [ ] The delivered text reaches jq without passing through argv — `--rawfile cur <tmpfile>` (or
      `--rawfile` on a process substitution), with the temp file cleaned up on every exit path.
- [ ] One over-threshold fixture (a delivery above 1 MiB, printed rather than typed) in
      `test-review-stamp-writer.sh` that stamps `clean`, plus the same fixture at 975,119 bytes as
      the under-threshold control, each printing which side of the limit it is on.
- [ ] `EXPECTED_TOTAL` updated; the writer's residual block names the old limit as closed.

## Implementation Notes

- `--rawfile` keeps the trailing newline of the file; the comparison already normalises trailing
  whitespace on both sides, so no extra strip is needed — but pin it with the fixture, do not
  assume it.
- Bash 3.2 target; the writer must keep failing open and silent on infrastructure errors.

## Scope Contract

- **Mechanisms to use:** the existing guard (c) jq call. No new hook, no change to the record
  format, no change to `merge-review-guard.sh`.
- **Files in scope:** `.claude/hooks/review-stamp-writer.sh`,
  `.claude/hooks/test-review-stamp-writer.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #1012 (guard batch E) introduced the `--arg` call this replaces.

## Risks

- The writer is on the merge path of every PR; a temp-file handling error that fails the jq call
  on ordinary deliveries wedges merges (fail-closed, but expensive).

## Updates

### 2026-09-22

- Filed from the round-3 security confirmation of PR #1012 as a regression in an unreachable
  regime, per the binding one-pass decision.
