<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "branch-preflight.sh's lib-unsourceable fallback still misses subshell/newline/runner-word/-c-group bypasses"
status: backlog
priority: medium
created: 2026-08-29
updated: 2026-08-29
assignee:
labels: [deferred, harness]
github_issue:

---

# branch-preflight.sh's lib-unsourceable fallback still misses subshell/newline/runner-word/-c-group bypasses

## Summary

`.claude/hooks/branch-preflight.sh`'s Check 1 fallback path (used only when the shared
`lib/cmd-detect.sh` is unsourceable) silently ALLOWS a detached-HEAD `git commit` through
this BLOCKING, data-loss-prevention gate when the commit is wrapped in a subshell, spread
across a newline-separated compound, prefixed with a runner word, or (for
`COMPOUND_COMMIT_RE` specifically) uses a `-c key=value` group. All four confirmed
pre-existing and live-reproduced; not introduced or worsened by PR #874.

## Background

Surfaced independently by `code-reviewer` and `security-auditor` during PR #874's review
round (2026-08-29), as a sibling of the already-known, already-accepted `|` (pipe) gap in
this same fallback. PR #874 corrected the fallback's comment to name all five gaps
explicitly (previously it implied `|` was the only omission) but deliberately did not
widen the fallback's regexes further — that's out of #874's Scope Contract (which was
specifically about the brace/backtick/bang widening shared with the primary path).

Constructed and verified live (against a real detached-HEAD scratch repo, lib made
unsourceable, piped through the actual hook):

```
(git commit -m oops)                          → SILENT (no deny)
$'git status\ngit commit -m oops'  (real \n)   → SILENT (no deny)
env FOO=1 git commit -m oops                   → SILENT (no deny)
true && git -c user.email=x commit -m oops     → SILENT (no deny)
```

All four are real, non-adversarial-looking invocations a user could plausibly type by
accident, not exotic obfuscation. Rated Medium (not High) because it requires BOTH
preconditions to combine: the shared lib being unsourceable (a rare, degraded-install
scenario — the common path already handles all four shapes correctly) AND one of these
four specific shapes.

## Acceptance Criteria

- [ ] `GIT_COMMIT_RE` and `COMPOUND_COMMIT_RE` in `branch-preflight.sh`'s fallback widened
      to also recognize `(` as a valid opener (subshell) — verify no false-positive on a
      quoted mention (`echo "(git commit -m x)"` must still not trip a bare-string match
      outside the intended context, matching the existing fail-closed acceptance already
      established for `` ` ``/`{`/`!`).
- [ ] Newline-separated compounds recognized — `[[ "$CMD" =~ $RE ]]` has no per-line `^`
      the way `grep -E` does; either loop over `$CMD` split on newlines, or switch the
      match to `grep -E` (consistent with how `COMPOUND_COMMIT_RE` is already checked via
      `grep -qE`, just extend `GIT_COMMIT_RE`'s check the same way).
- [ ] Runner-word absorption (`env`/`command`/`builtin`/`exec`/`nohup`/`setsid`) added,
      matching whatever pattern the primary path's `_CMD_POS_PREFIX` uses for the same
      purpose (grep `lib/cmd-detect.sh` for its own runner-word handling as reference).
- [ ] `COMPOUND_COMMIT_RE` gains the same `-c key=value` group `GIT_COMMIT_RE` already has,
      so `true && git -c user.email=x commit -m x` denies via the compound path too.
- [ ] `|` (the originally-deferred gap) closed in the same pass if convenient, or
      explicitly re-deferred with the same reasoning if not — don't leave the comment
      naming a 5th gap that's still open after this todo closes the other four.
- [ ] `test-branch-preflight.sh` gains two-sided regression pins (RED before, GREEN after)
      for all four repro cases above, following the existing Test 10/10b NOLIB harness
      pattern.
- [ ] Full `scripts/run-hook-tests.sh` suite still passes.

## Implementation Notes

The fallback only ever runs when `. lib/cmd-detect.sh` fails to source — this is the
`NOLIB` test harness's exact precondition (see `test-branch-preflight.sh` Test 10/10b for
the pattern to extend). Read `docs/rules/harness.md`'s Bash section first — `set -u`
empty-array handling, `$(...)` errexit suspension, and `[[ =~ ]]` anchoring semantics are
all directly relevant here.

## Scope Contract

- **Mechanisms to use:** widen the existing `GIT_COMMIT_RE`/`COMPOUND_COMMIT_RE` character
  classes and matching calls in `branch-preflight.sh`'s fallback only — no new detection
  mechanism, no changes to the primary (lib-sourced) path, no changes to
  `lib/cmd-detect.sh` itself.
- **Files in scope:** `.claude/hooks/branch-preflight.sh`,
  `.claude/hooks/test-branch-preflight.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None — self-contained fallback-path hardening.

## Risks

- A parsing mistake in the fallback (unlike the primary path) fails toward a data-loss gate
  either firing on a real, non-adversarial command (false-DENY — annoying but safe) or
  missing a real commit (false-ALLOW — the exact defect this todo fixes). Verify every new
  regex change against both a positive repro AND the existing negative controls before
  committing.

## Updates

### 2026-08-29

Filed during PR #874's review-repair cycle. `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`'s Unresolved section has the full finding writeup and the exact constructed repro cases.
