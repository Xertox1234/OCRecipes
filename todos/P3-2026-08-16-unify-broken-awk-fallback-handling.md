---
title: "Unify the two divergent broken-awk-backend fallback implementations"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-09-01
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

### 2026-09-01 — read both implementations; recommend CLOSE

Read the two fallbacks side by side to execute this. They share less than the summary
suggests, and the part they share is too small to carry an abstraction.

**What is genuinely common is one predicate:** "the rendering came back blank from a
non-blank `$CMD`, so the awk backend is missing or broken." In `guard-outward-cli.sh` that
is one `if` condition; in `pr-preflight-guard.sh` it is the `elif [ -n "${CMD//[[:space:]]/}" ]`
arm. Roughly one line each.

**Everything downstream of that predicate diverges, and the divergence is deliberate:**

|                   | `guard-outward-cli.sh`          | `pr-preflight-guard.sh`                |
| ----------------- | ------------------------------- | -------------------------------------- |
| Degrades to       | `crude_smells_outward` → `deny` | 5-char strip + glob → the stamp gate   |
| Fail-closed means | block the command outright      | demand a preflight stamp               |
| Checks            | both `$BARE` and `$WORDS`       | `$WORDS` only (never computes `$BARE`) |

Those are not two styles of the same thing; they are two different fail-closed
destinations, because each hook's downstream matcher and its notion of "safe direction"
differ. The todo's own Implementation Notes anticipated exactly this ("confirm whether
these two fallback behaviors are meant to converge, or are legitimately hook-specific")
and the answer is: hook-specific.

A shared helper would therefore hold one line of predicate while both call sites kept
their own bespoke degrade path immediately after it. That is the shape
`docs/solutions/best-practices/grep-verify-single-ownership-after-dedup-consolidation-2026-07-02.md`
warns about from the other side: a consolidation that gives one home to the trivial half
while the load-bearing half stays duplicated, leaving the file _looking_ unified. Worse,
the stated risk — "a maintainer fixes one and not the other" — is not actually reduced,
because the thing a maintainer would change (how this hook degrades) is precisely the part
that cannot be shared.

The real coupling is already handled better than a helper would: both hooks carry dated
comments citing each other and the review round that produced them, and both behaviours are
pinned by tests (`test-guard-outward-cli.sh`'s blank-rendering and no-awk assertions,
`test-pr-preflight-guard.sh`'s "awk PRESENT BUT BROKEN" cases, including a working-awk
control).

**Recommendation: close as won't-fix.** Left `status: backlog` pending the owner's call
rather than self-closed, per the consult-before-won't-fix rule.
