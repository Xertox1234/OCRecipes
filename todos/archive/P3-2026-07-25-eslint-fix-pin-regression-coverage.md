---
title: "Assert the eslint-fix relative-path pin, and tidy two test-hygiene nits in test-pr-preflight-guard.sh"
status: done
priority: low
created: 2026-07-25
updated: 2026-08-13
assignee:
labels: [deferred, testing, hooks]
github_issue:
---

# Assert the eslint-fix relative-path pin, and tidy two test-hygiene nits in test-pr-preflight-guard.sh

## Summary

Three non-blocking findings from the pre-merge review of PR #718 (merged as `4e5074a4`).
The load-bearing one: `eslint-fix.sh`'s new relative-path pin guards a **write** path and
has zero regression coverage — removing it entirely leaves the suite green.

## Background

PR #718 made `.claude/settings.json` register hooks by absolute path, and moved
`eslint-fix.sh`'s `npx eslint --fix` into a `cd` to the project root so the eslint binary
and flat config are discovered from the project rather than the agent's cwd.

That `cd` changed what a _relative_ `file_path` resolves against, so the commit added:

```bash
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
```

The reviewer verified empirically that reverting `eslint-fix.sh` to its pre-pin version
still yields **8 passed, 0 failed** in `test-eslint-fix.sh`. The line executes on every
test case, but its _effect_ is never asserted: `test-eslint-fix.sh:66` looks for the needle
`server/foo.ts`, which matches as a suffix of the absolute path either way.

PR #718 exists partly because a test silently stopped testing its own claim
(`test-pr-preflight-guard.sh` test 13). Shipping that fix alongside a new unasserted
write-path behavior is the same footgun one level down — hence this todo.

## Acceptance Criteria

- [ ] `test-eslint-fix.sh` gains a case whose stub `npx` echoes `"$@"`, invoked from a
      **subdirectory** with `file_path: "foo.ts"`, asserting the eslint argument is
      `<subdir>/foo.ts` and NOT `<project-root>/foo.ts`
- [ ] That assertion is mutation-checked: reverting `eslint-fix.sh:30`'s pin turns it RED
      (the whole point — the current suite does not)
- [ ] `test-pr-preflight-guard.sh` test 14's comment corrected — it claims the fixture
      keeps "git + stamp helper still resolve", but since `ROOT` became
      `${BASH_SOURCE[0]}`-derived the `NOLIB` copy's root is the `mktemp` dir's grandparent,
      which has no stamp helper. The DENY still proves "no fail-OPEN on an unsourceable
      lib" but no longer attributes the denial to the lib alone. Documentation accuracy
      only — verified not to be a coverage hole (the fail-open mutation still turns it red).
- [ ] `test-pr-preflight-guard.sh` `EXIT` trap extended to clean `HELPER_T` and `NOLIB`
      (currently inline-only, so an interrupted/SIGTERM'd run leaks two `mktemp -d` trees):
      `trap 'rm -f "$STAMP_FILE"; rm -rf "${HELPER_T:-}" "${NOLIB:-}"' EXIT`, with both vars
      pre-initialized empty near the top to satisfy `set -u`
- [ ] Full `bash scripts/run-hook-tests.sh` green

## Implementation Notes

- Files in scope: `.claude/hooks/test-eslint-fix.sh`, `.claude/hooks/test-pr-preflight-guard.sh`.
  No change to `eslint-fix.sh` itself is expected — the pin is correct, it is only unasserted.
- `test-eslint-fix.sh` already stubs `npx` on PATH (`make_stub_npx`, line ~11) and is
  hermetic; the new case extends that stub to echo its arguments rather than adding a
  new mechanism.
- Keep bash-3.2 compatible (macOS ships 3.2) — no `mapfile`/`declare -A`.
- The convention this enforces is codified in
  `docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`.

## Dependencies

- None. PR #718 is merged (`4e5074a4`).

## Risks

- Low. Test-only changes; no runtime hook behavior is modified.

## Updates

### 2026-07-25

- Filed from the pre-merge review of PR #718. All three findings were rated non-blocking
  by the reviewer, which is why #718 merged without them.

### 2026-08-13 — DONE (PR #808)

All five acceptance criteria met. `bash scripts/run-hook-tests.sh` green.

**AC-1 implemented with one deliberate deviation.** The stated negative needle
(`NOT <project-root>/foo.ts`) can never fire: an unpinned hook emits a bare `--fix foo.ts`,
which does not contain `<project-root>/foo.ts` either, so the assertion would pass in both
directions. Implemented against the form the bug actually produces. The positive assertion
(exact argv via a new `echoargs` stub mode) is independently mutation-proof.

**AC-2 mutation check.** Commenting out `eslint-fix.sh:30` → `9 passed, 2 failed`: both
relative-pin assertions RED, the original 8 and the new absolute-path case GREEN. Review
added two more mutants: dropping the `/` join → 10/1; applying the pin unconditionally →
caught by the absolute-path case.

**AC-4 premise verified rather than assumed.** bash runs the EXIT trap on SIGINT (130) and
SIGTERM (143), so the prescribed plain `EXIT` does deliver the stated "interrupted run"
motivation — no `INT TERM` needed.

**Found and fixed en route (not in the original scope).** The new negative assertion was
itself vacuous: `grep -qF "--fix foo.ts"` parses the needle as an option, exits 2, and
`if grep -q` reads that as "not found" — PASS without searching. Hardened every
variable-needle assert helper in `.claude/hooks/test-*.sh` with `grep -- `, codified the
mechanism as a fourth variant on
`docs/solutions/logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md`,
and added `.claude/hooks/test-assert-needle-dash.sh` to ENFORCE it (static scan, two-sided
controls, non-vacuity check) so the convention cannot decay back into prose.

**Residual, deliberately not fixed.** Test 14 in `test-pr-preflight-guard.sh` remains
one-sided; per this todo's scope only its comment was corrected, and it now states plainly
that its DENY is over-determined. Separately, adding `harness` to the solution doc's tags
removes a categorical routing exclusion but does not yet yield delivery: the doc ranks
#10 of 16 glob-tier matches for `.claude/hooks/test-*.sh`, and that tier truncates to 8
then caps at 4 — a date-ordered truncation ahead of relevance, in the retrieval layer
(`.claude/hooks/inject-patterns.sh:326-345`). Noted, not pursued.
