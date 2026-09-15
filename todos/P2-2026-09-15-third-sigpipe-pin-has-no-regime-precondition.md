---
title: "THE 64KB SIGPIPE ROW in test-merge-review-guard.sh has no regime precondition, so it can go inert silently"
status: backlog
priority: medium
created: 2026-09-15
updated: 2026-09-15
assignee:
labels: [deferred, harness]
github_issue:
---

# THE 64KB SIGPIPE ROW has no regime precondition

## Summary

The pin protecting the third de-piped SIGPIPE site (`cmd_gh_pr_has_merge`) asserts its DENY
outcome directly, with nothing asserting that its input still exceeds the 64 KB pipe buffer.
If the padding ever drifts below the buffer the row goes green having tested nothing — and
its own comment states that no other row in that file is large enough to reach the buffer, so
the entire class would be unpinned with no signal anywhere.

## Background

Surfaced by the baseline reviewer on PR #976, which named and documented the **regime
precondition** convention (`docs/solutions/code-quality/a-probe-can-run-and-never-enter-the-regime-2026-09-15.md`).
Two of the three de-piped SIGPIPE sites are pinned in `.claude/hooks/test-cmd-detect.sh` and
both carry a precondition row. The third is pinned in a different file and does not.

Deliberately **not** fixed in #976: that PR was documentation plus comments with no behavioural
change, and adding an assertion to a security gate's test file is a different kind of change
needing its own mutation verification. The gap is pre-existing, not introduced by #976.

Measured while filing (2026-09-15):

- `grep -c cmd_gh_pr_has_merge .claude/hooks/test-cmd-detect.sh` → `0`
- The pin lives at `.claude/hooks/test-merge-review-guard.sh`, `THE 64KB SIGPIPE ROW`
- `_big` is `gh pr merge 938 --squash` plus 2,000 padding lines, then asserted directly

## Acceptance Criteria

- [ ] `THE 64KB SIGPIPE ROW` carries its own PASS/FAIL precondition row asserting the input
      still exceeds 65536 bytes.
- [ ] The precondition measures **the value that crosses the boundary** — `cmd_bare_deep`
      output, not the raw `$_big` — per part 2 of the convention. Note the file does not
      currently source `lib/cmd-detect.sh`, and deliberately replaces it with a stub earlier
      in the run (`cp lib/fastpath-filter.sh lib/cmd-detect.sh`); confirm whether it is
      restored before this row, and compute the rendering in a subshell so nothing leaks into
      the test file's global scope.
- [ ] `EXPECTED_TOTAL` is updated with a comment explaining the delta (currently 130).
- [ ] Mutation-verified live: shrink the padding below the buffer and confirm the new row goes
      RED while the behaviour row stays green — that is what attributes the protection to the
      precondition rather than to the outcome assertion.
- [ ] The Related Files section of the solutions doc is updated to drop "Filed, not fixed here."

## Implementation Notes

The two existing implementations to copy are in `.claude/hooks/test-cmd-detect.sh`: the SIGPIPE
pin's `_rg_words` / `_rg_lbl` block and the retarget pin's `_rr_words` / `_rr_sep` block. The
second also asserts the padding carries no `[;&|]` separator; check whether the third site's
read has an equivalent clause cut that would need the same treatment — `cmd_gh_pr_has_merge`
greps `cmd_bare_deep` output directly with no clause cut, so probably not, but verify rather
than assume.

## Scope Contract

- **Mechanisms to use:** the regime-precondition pattern already implemented twice in
  `test-cmd-detect.sh` — nothing new.
- **Files in scope:** `.claude/hooks/test-merge-review-guard.sh`, and the Related Files
  section of `docs/solutions/code-quality/a-probe-can-run-and-never-enter-the-regime-2026-09-15.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- `test-merge-review-guard.sh` stubs `lib/cmd-detect.sh` partway through the run. Sourcing the
  real library for the rendering must not disturb that, and must not run while the stub is in
  place — otherwise the precondition measures the wrong renderer and is itself out of regime.
- This is a security gate's test file; a careless edit wedges the required Outward-CLI guard
  corpus check on every open PR.

## Updates

### 2026-09-15

Filed from PR #976's baseline review. Not started.
