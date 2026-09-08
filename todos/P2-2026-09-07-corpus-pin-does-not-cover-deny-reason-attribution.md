---
title: "The corpus pin compares verdicts and per-path outcomes, but never deny-REASON attribution — a row can start denying from the wrong check and the gate stays green"
status: backlog
priority: medium
created: 2026-09-07
updated: 2026-09-07
assignee:
labels: [deferred, harness, testing, security]
github_issue:
---

# A green pin is not evidence the intended check fired

## Summary

`.claude/hooks/repro-outward-cli-corpus.sh` now pins three things: row count, the two gap
totals, and per-ID manifests carrying each dirty row's four per-path verdicts. It pins
**nothing about _why_ a row denied.**

`reason()` (same file) already computes the deny-reason fingerprint for every DENY row, and
the script prints a whole `=== deny-reason attribution (which check actually fired) ===`
section from it. The pin never reads those strings. So a refactor that keeps every verdict
identical while making a row deny through a **different check** leaves
`rows=427  precise-path gaps=31  all-path gaps=164` and both manifests byte-identical — green.

## Background

Filed 2026-09-07 from the code review of PR #933 (the PR that added the pin), **merged
2026-09-08 as `e0e6e886`** — that commit is the baseline for this work. Raised independently by
`code-reviewer`; not a defect that PR introduced — the previous state pinned nothing at all —
but a gap the new pin's own framing could hide.

**Still open, and confirmed so by a second review round.** PR #933's follow-up review re-examined
this deliberately: the reviewer endorsed disclosure-plus-todo over fixing it in that PR, on the
grounds that the two costs named under Implementation Notes below (`reason()` re-invocation, and
the `cut -c1-72` collision risk) make a rushed fix either wrong or runtime-doubling for a gate
whose whole value is being cheap enough that nobody disables it. Nothing here is superseded.

This is the hazard the corpus file already documents in prose and has been bitten by before.
Its `co-mask-c1` note says it outright: _"on the pre-fix tree this row DENIES, but for an
unrelated reason … Read this row's ATTRIBUTION line, never its verdict alone."_ The same
caveat is repeated for `flagvcasearm-ghadmin`, which reports `ok` while denying from the "no
REAL `--auto`" rule rather than the check its family name implies. Both are cases where the
verdict was right and the attribution was the only thing that revealed what was actually
happening.

The pin as shipped therefore encodes an assurance the file's own notes tell you not to make.
The `HOW TO BUMP` block now says so explicitly, so this is disclosed rather than silent — but
disclosure is not coverage.

## Acceptance Criteria

- [ ] The pin fails when a row's deny-reason fingerprint changes while its verdict does not.
- [ ] The expected attribution is stored in the same "deliberate, dated, reviewable diff"
      style as the existing manifests — a reviewer must be able to read _which_ check each
      row is expected to fire, not confirm an opaque hash.
- [ ] Mutation-verified: change one row's deny path (not its verdict) and show the gate goes
      RED. Assumed-correct is not acceptable here — that is the whole point of the file.
- [ ] The runtime cost is measured and stated. `reason()` re-invokes the guard per DENY row,
      so a naive implementation could add a large multiple to the ~2m10s CI run.

## Implementation Notes

The cheap shape is to extend the existing all-path manifest entries, which already carry
per-path verdicts, with the precise-path reason fingerprint — the same `id p=.. j=.. l=.. a=..`
line gaining a reason field. Watch out for two things:

1. **Reason strings are truncated to 72 chars by `reason()` (`cut -c1-72`).** Two different
   checks whose messages share a long prefix would collapse to the same fingerprint. Verify
   the current reason set is distinguishable at 72 chars before pinning it, or widen the cut.
2. **Cost.** The main loop already calls `decide` 4x per row (1708 invocations). Adding a
   `reason` call per DENY row is a real increase; the file's existing attribution section
   already pays it once, so consider capturing the reason during the existing pass rather
   than re-invoking.

Do not pin a digest of the attribution section: an opaque hash cannot be confirmed by a
reviewer reading the diff, which is the property the pin convention exists for.

Related: `todos/P2-2026-09-07-corpus-note6-allgaps-explanation-is-wrong.md` (same file,
comment accuracy).
