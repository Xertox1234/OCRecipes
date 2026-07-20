---
title: "When a refactor swaps a matcher/guard for a BROADER one, regression-test the newly-matched inputs — not just the false-positives you set out to remove"
track: knowledge
category: best-practices
tags: [testing, regression-tests, refactor, matcher, guard, hooks, superset, behavior-change, review]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ["A refactor's stated goal is to REMOVE false-positives (or fix a false-DENY), and its tests only assert the newly-rejected inputs now pass silently", "The replacement predicate/regex accepts a strict SUPERSET of the old one, but no test asserts the newly-ACCEPTED inputs still trigger the guard", "A later tightening of the shared helper silently drops coverage with zero red tests"]
created: 2026-07-20
---

# When a refactor swaps a matcher/guard for a BROADER one, regression-test the newly-matched inputs — not just the false-positives you set out to remove

## When this applies

A change replaces a bespoke matcher (regex, `case` glob, string test) with a
**shared or more general** one, and the new matcher's accept-set is a **superset**
of the old — it matches everything the old one did, *plus* forms the old one
missed. This is common when consolidating N hand-rolled matchers onto one shared
helper: the shared helper is usually written to be *more* correct (wider command
grammar, more separators, quote-awareness), so the port silently BROADENS what
fires.

The stated goal of such a port is almost always the **narrowing** side (stop a
false-positive / false-DENY). The tests written for it naturally cover that side.
The **broadening** side — the new true-positives — is a real, unstated behavior
change that ships untested.

## Smell patterns

- The PR description / commit says "stop false-firing on X" and every new test
  asserts `X → silent`; none assert a `newly-matched Y → still fires`.
- The replacement is a shared predicate whose separator/keyword grammar is
  visibly wider than the removed one (e.g. `(^|[;&|(])` replacing `(&&|\|\||;)`).
- The removed matcher and the new one are compared for the *removed* cases in
  review, but the diff of their accept-sets is never enumerated.

## Why

The newly-matched inputs are a behavior change with no test anchoring it, so a
future edit to the *shared* helper — a tightened prefix, a dropped separator, a
performance rewrite — can silently regress them, and the whole point of a shared
helper is that such edits happen later and far away. For a **blocking guard**
this is the dangerous direction: the broadening is usually the guard now catching
real cases it used to miss (e.g. `(git commit)` / `foo | git commit`), so a silent
regression re-opens exactly the hole the shared helper was supposed to close —
and no red test warns you. Testing only the narrowing gives false confidence: the
suite is green, the "fix" is proven, and half the behavior delta is uncovered.

## Examples

The 2026-07-20 port of the git-state hooks (`branch-preflight.sh`,
`drift-detect*.sh`, `core-bare-guard.sh`) onto the shared quote-aware
`cmd-detect.sh` predicates. The stated goal: stop quoted mentions
(`git status -m "…; git commit …"`) from false-firing. The shared prefix
`_CMD_POS_PREFIX` uses separator class `(^|[;&|(])`, **wider** than each hook's
old `COMPOUND_RE` (`&&|\|\||;`), so the port also began matching `(git commit)`,
`foo | git commit`, single-`&`/`|` compounds, and multiline forms the old regex
missed — all *correct* new denials on a detached HEAD.

The first cut shipped tests only for the narrowing (`quoted mention → silent`).
Review (`/code-review`) flagged the gap; the fix added the missing anchors:

```bash
# test-branch-preflight.sh — regression tests for the BROADENING, on detached HEAD
OUT=$(run_hook '(git commit -m oops)')
assert_deny "subshell '(git commit)' on detached HEAD is denied" "$OUT"
OUT=$(run_hook 'true | git commit -m oops')
assert_deny "piped 'true | git commit' on detached HEAD is denied" "$OUT"
```

Concretely, before writing tests for a broadening port: **enumerate the accept-set
delta** (`new_matches − old_matches`) and add one assertion per representative
new form, in addition to the narrowing assertions.

## Exceptions

- If the replacement is a strict *equivalent* (same accept-set, e.g. a pure
  readability rename), there is no broadening to test — assert equivalence once
  and move on.
- If the broadening is genuinely unreachable in the guard's context (dead input
  class), a comment naming why beats a test that can never fail meaningfully.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — the shared predicates whose wider grammar is the broadening source
- `.claude/hooks/test-branch-preflight.sh` — the added `(git commit)` / `| git commit` regression tests (the broadening anchors)

## See Also

- [Widening a shared helper's dependency surface — verify callers' tests, not just the unit's](widening-helper-dependency-surface-test-blast-radius-2026-05-25.md) — sibling axis: a widened *dependency* surface (test the callers) vs this file's widened *accept* set (test the new inputs)
- [Widening an allowlist root turns it into a hand-maintained denylist that fails open](widening-allowlist-root-creates-hand-maintained-denylist-2026-07-08.md) — same "a widening silently shifts the safe/unsafe boundary" family
- [../logic-errors/partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md](../logic-errors/partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md) — the sibling harness lesson on how a matcher swap regresses a gate where the new model has a hole
- [../logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md](../logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md) — the root quote-aware-scanner work this port applied
