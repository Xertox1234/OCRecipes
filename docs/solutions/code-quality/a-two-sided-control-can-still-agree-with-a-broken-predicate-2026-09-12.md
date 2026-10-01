---
title: "A two-sided control still agrees with a broken predicate when its one input passes for an accidental reason"
track: bug
category: code-quality
tags: [testing, harness, hooks, negative-control, mutation-testing, bash, safety-gate]
module: shared
applies_to: [".claude/hooks/test-*.sh", "scripts/**/*.sh", "scripts/__tests__/**/*.ts"]
symptoms: ["A control row passes against a predicate that is measurably wrong", "A reviewer's generated corpus reddens cases the hand-written control missed", "Every row varies ONE dimension and holds the others fixed at a default", "The fix for a gate defect ships a new defect of the opposite sign, repeatedly"]
created: 2026-09-12
severity: high
---

# A two-sided control still agrees with a broken predicate when its one input passes for an accidental reason

## Problem

Two-sidedness is necessary but not sufficient. A gate test can assert **both** directions —
this payload must deny, that one must allow — and still be blind, because the ALLOW row's
single input happens to satisfy the broken predicate as well as the correct one. The row
does not *discriminate* between the implementation you shipped and the one you meant.

Measured three times in one PR, on the same predicate (`merge-review-guard.sh`, PR #941):

| Control row                                | Passed against                      | Missed                      |
| ------------------------------------------ | ----------------------------------- | --------------------------- |
| `git commit -m "fix highlight for pr merge"` | `=~ gh$` (any token ENDING in gh)   | `through`, `enough`         |
| `${gh_bin}` / `$gh_bin` deny rows          | bare `*'$'*` (ANY dollar token)     | `$var`, `$5`                |
| every miss row, separator fixed at one space | adjacency-only token match          | redirects, glued `;`/`&&`   |

The first row passes only because `for` happens not to end in "gh". The second pair passes
only because both variable *names* happen to contain "gh". In each case a reviewer's
combinatorially generated corpus found the defect immediately: 8 of 18, then 8 of 10, then
248 of 537.

## Symptoms

- A control row passes against a predicate that is measurably wrong.
- Each fix for a gate defect ships a defect of the **opposite sign** — see [widening a permissive text gate](../logic-errors/widening-a-permissive-text-gate-reopens-the-restrictive-failure-2026-09-12.md).
- The test rows vary one dimension (the interesting one) and hold every other at a default.
- A reviewer's generated corpus reddens rows the hand-written suite is green on.

## Root Cause

A hand-written control encodes *the case you already suspected*. Its other properties —
the word you chose, the separator you defaulted to, the variable you named — are incidental,
and incidental properties are exactly where a wrong predicate and a right one still agree.
Mutation testing does not rescue this: mutating the predicate reddens the rows that
discriminate, and there were none, so the suite stays green under mutation too.

## Solution

Ask of every control row: **is there a plausible WRONG implementation this row would still
pass?** If yes, the row is a decoration — replace it.

Concretely:

1. **Generate rows from a product of dimensions**, do not list them. Name the dimensions
   first (binary rendering × separator × position × quoting), then take the product. A
   hand-listed corpus reproduces the author's blind spot and returns a reassuring answer.
2. **Pick inputs that separate the candidate predicates.** Before committing a narrowing,
   write down the predicate you are replacing and the one you are shipping, and choose an
   input on which they *disagree*. `${gh_bin}` cannot separate "any dollar token" from
   "a dollar token naming gh"; `$var` can.
3. **Quote a count with the corpus that produced it.** "63 rows, 0 false positives" is a
   property of those 63 rows, not of the predicate — say which dimensions were varied.

## Prevention

- In review, treat a single-input control as unverified until someone names the wrong
  implementation it would catch.
- When a defect is found by a generated corpus, pin rows from that corpus — not a
  hand-picked representative of it.
- Two-sidedness ([gate test needs a two-sided negative control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md)) is the floor, not the ceiling.

## Related Files

- `.claude/hooks/test-merge-review-guard.sh` — the `KNOWN GAP` / `prose must never be denied` block. It is a hand-listed TRIPWIRE, **not** the generated product this doc prescribes: it pins today's known-incomplete behaviour so the eventual fix must come back and convert it. Generating it from the dimensions is acceptance criterion 4 of the linked P1 todo. (An earlier draft of this line claimed it was written as a product — it is not, and the correction is itself an instance of the rule: a claim about test quality needs checking against the test.)
- `todos/archive/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md` — carries the 537-row corpus and the table of what each withdrawn version broke

## See Also

- [gate test needs a two-sided negative control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — the weaker prerequisite this refines
- [a control that runs before the work cannot validate it](a-control-that-runs-before-the-work-cannot-validate-it-2026-09-07.md) — a control invalid for a different reason
- [an uncontrolled ambient input makes the check agree with what it checks](../logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md)
- [a test pin normalised by a later pipeline stage is a decoration](test-pin-normalised-by-a-later-pipeline-stage-is-a-decoration-2026-09-06.md)
