---
title: "THE 64KB SIGPIPE ROW in test-merge-review-guard.sh has no regime precondition, so it can go inert silently"
status: done
priority: medium
created: 2026-09-15
updated: 2026-09-15
assignee:
labels: [deferred, harness]
github_issue:
---

# THE 64KB SIGPIPE ROW has no regime precondition

## Summary

The pin protecting `cmd_gh_pr_has_merge` asserts its DENY outcome directly, with nothing asserting that its input still exceeds the 64 KB pipe buffer.
If the padding ever drifts below the buffer the row goes green having tested nothing — and
its own comment states that no other row in that file is large enough to reach the buffer, so
the entire class would be unpinned with no signal anywhere.

## Background

Surfaced by the baseline reviewer on PR #976, which named and documented the **regime
precondition** convention (`docs/solutions/code-quality/a-probe-can-run-and-never-enter-the-regime-2026-09-15.md`).
Of the three de-piped SIGPIPE sites, the refuse guard (`cmd_gh_pr_write_subcommand`) and the
retarget refusal (`cmd_gh_pr_ref`) are pinned in `.claude/hooks/test-cmd-detect.sh` and both
carry a precondition row. `cmd_gh_pr_has_merge` is pinned in a different file and does not.
(Anchored on function names deliberately: by `lib/cmd-detect.sh`'s own numbering — stated in
the retarget refusal's header, "the THIRD site of the same SIGPIPE family, after the refuse
guard and cmd_gh_pr_has_merge" — the uncovered one is the SECOND, and an earlier draft of this
todo called it the third.)

Deliberately **not** fixed in #976: that PR was documentation plus comments with no behavioural
change, and adding an assertion to a security gate's test file is a different kind of change
needing its own mutation verification. The gap is pre-existing, not introduced by #976.

Measured while filing (2026-09-15):

- `grep -c cmd_gh_pr_has_merge .claude/hooks/test-cmd-detect.sh` → `0`
- The pin lives at `.claude/hooks/test-merge-review-guard.sh`, `THE 64KB SIGPIPE ROW`
- `_big` is `gh pr merge 938 --squash` plus 2,000 padding lines, then asserted directly

## Acceptance Criteria

- [x] `THE 64KB SIGPIPE ROW` carries its own PASS/FAIL precondition row asserting the input
      still exceeds 65536 bytes.
- [x] The precondition measures **the value that crosses the boundary** — `cmd_bare_deep`
      output, not the raw `$_big` — per part 2 of the convention. The file sources nothing at
      all (no `source` or `.` line anywhere), so the rendering has to be obtained
      deliberately; compute it in a subshell so nothing leaks into the test file's global
      scope. There is no stub to work around: the row runs against the real, unmodified
      library.
- [x] `EXPECTED_TOTAL` is updated with a comment explaining the delta (currently 130).
- [x] Mutation-verified live: shrink the padding below the buffer and confirm the new row goes
      RED while the behaviour row stays green — that is what attributes the protection to the
      precondition rather than to the outcome assertion.
- [x] The Related Files section of the solutions doc is updated to drop "Filed, not fixed here."

## Implementation Notes

The two existing implementations to copy are in `.claude/hooks/test-cmd-detect.sh`: the SIGPIPE
pin's `_rg_words` / `_rg_lbl` block and the retarget pin's `_rr_words` / `_rr_sep` block. The
second also asserts the padding carries no `[;&|]` separator; check whether
`cmd_gh_pr_has_merge`'s read has an equivalent clause cut that would need the same treatment — it
greps `cmd_bare_deep` output directly with no clause cut, so probably not, but verify rather
than assume.

## Scope Contract

- **Mechanisms to use:** the regime-precondition pattern already implemented twice in
  `test-cmd-detect.sh` — nothing new.
- **Files in scope:** `.claude/hooks/test-merge-review-guard.sh`, and the Related Files
  section of `docs/solutions/code-quality/a-probe-can-run-and-never-enter-the-regime-2026-09-15.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Sourcing `lib/cmd-detect.sh` into the test file's global scope could collide with the
  hook-under-test, which is invoked as a subprocess by `run()`. Use a subshell. (An earlier
  draft of this todo claimed the file stubs `lib/cmd-detect.sh` partway through the run — it
  does not. Line 953 is `cp A B C "$BROKEN/lib/"`, a multi-file copy of the REAL libraries
  INTO a sandbox for test 38, and `$BROKEN` is removed at line 962, well before this row at 1104. The misreading came from stopping at the line's trailing backslash and taking the
  second argument for the destination.)
- This is a security gate's test file; a careless edit wedges the required Outward-CLI guard
  corpus check on every open PR.

## Updates

### 2026-09-15

Filed from PR #976's baseline review. Not started.

### 2026-09-15 (closed)

Implemented. `THE 64KB SIGPIPE ROW` now carries a regime precondition, and `EXPECTED_TOTAL`
went 130 -> 131 with a delta comment.

One finding changed the shape of the fix: **size was the wrong thing to assert.** The two
sibling pins assert `rendered > 65536` because for them size is the whole regime. Here the
mechanism is line-structured -- `grep` cannot exit mid-line -- so what decides SIGPIPE is how
much the writer still has pending at the first moment `grep` can conclude. A byte-offset
formulation (bytes after the match) passes a shape that never SIGPIPEs: hold the total at
124,024 and grow line 1 to 99,224 bytes, and only 24,800 remain behind it. The row therefore
cuts at the FIRST NEWLINE -- the merge must render onto the first line, and >65536 bytes must
remain behind that line -- which subsumes the size and multi-line checks rather than listing
them separately.

Separator assertion: **not needed, verified not assumed.** `cmd_gh_pr_ref` needs one because
it cuts at `${clause_tail%%[;&|]*}`; `cmd_gh_pr_has_merge` greps the rendering whole.

Mutation-verified live, each restored from a checksummed copy. All four leave the deny row
GREEN and the total pin GREEN (`bad()` increments FAIL, so `PASS + FAIL` is invariant):

| mutation                           | measured               | precondition |
| ---------------------------------- | ---------------------- | ------------ |
| padding cut to 20 lines            | 1,240 behind           | RED          |
| padding folded onto one line       | 0 behind               | RED          |
| merge moved to the last line       | first-line test clears | RED          |
| total held, line 1 grown to 99,224 | 24,800 behind          | RED          |

Full hook suite green with the change in place: `bash scripts/run-hook-tests.sh` -> all 38
test files exit 0.
