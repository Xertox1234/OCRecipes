---
title: "NOTE6's explanation of the 167-vs-164 discrepancy is factually wrong about what ALLGAPS counts — the number is right, the reason is not"
status: done
priority: low
created: 2026-09-07
updated: 2026-09-08
assignee:
labels: [deferred, harness, testing]
github_issue:
---

# The 164 is correct. The sentence explaining it is not.

## Summary

`.claude/hooks/repro-outward-cli-corpus.sh`'s NOTE6 block explains why a hand-counted all-path
union of 167 differs from the file's own printed `all-path gaps` of 164, and gives this reason:

> the printed metric counts GAPS (want DENY, got ALLOW) and does not count an ALLOW-expecting
> row that a degraded path denies

**That is not what the code does.** The `ALLGAPS` increment fires on _any_ path mismatch:

```bash
if [ "$p" != "$exp" ] || [ "$j" != "$exp" ] || [ "$l" != "$exp" ] || [ "$a" != "$exp" ]; then
  ALLGAPS=$((ALLGAPS+1))
fi
```

An ALLOW-expecting row that a degraded path denies satisfies that condition and **is** counted.
Measured 2026-09-07: **25** of the 164 are ALLOW-expecting rows the degraded mirror over-denies,
including all four the note names (`decoyfp-auto`, `flagadjfp-andand`, `flagadjfp-roredir`,
`flagadjfp-semi`). All 25 appear in the pinned manifest.

The arithmetic does not close on the note's own terms either: it explains a difference of 3 by
appeal to a set of 4.

## Background

Deferred from PR #933 (the pin). The user explicitly instructed that the 164/167 discrepancy
was not to be "fixed" — both numbers being right for their own definition — and that
instruction was honoured: **the pin asserts `$ALLGAPS` as-is, 164, and no metric was changed.**
This todo is only about the prose.

Both reviewers on that PR flagged the contradiction independently. `code-reviewer` made the
sharper procedural point: PR #933 added a _new_ comment stating (correctly) that the
ALLOW-expecting rows ARE counted, so the file now carries two mutually contradictory statements
about the same variable, and archiving #933's todo removed the only active pointer to the known
defect. Hence this file.

## Acceptance Criteria

- [x] NOTE6's causal sentence is corrected, or explicitly marked SUPERSEDED in place, so the
      file no longer asserts two contradictory things about `ALLGAPS`.
- [x] `ALLGAPS` itself is unchanged and still reports 164 — this is a comment fix, and the pin
      must stay green without a bump.
- [x] If the real origin of the hand-counted 167 can be recovered, it is recorded; if it cannot,
      the note says so rather than inventing a second explanation.

## Implementation Notes

Scope is one paragraph. Do **not** touch the metric, the pin, or the manifests — a green pin
after the edit is the check that nothing behavioural moved.

The correct current statement already exists in the same file, in the `EXPECTED_ALLPATH_GAPS`
pin comment ("this metric counts any row whose expectation is missed on ANY path … 25 of the 164
are ALLOW-expecting"). Reconcile NOTE6 to that rather than re-deriving it.

Note the 167 figure is a _hand count from a two-tree comparison_, not something this file emits,
so it may not be reproducible from the current tree at all. "Origin not recoverable" is an
acceptable outcome and is better than a fresh guess.

## Updates

### 2026-09-08 — closed by marker, not by rewrite

Resolved the way this file's own acceptance criteria allowed for ("corrected, **or** explicitly
marked SUPERSEDED in place"), because the rewrite turned out to be the wrong remedy.

- **The marker landed in `e0e6e886`** (PR #933) and names both false statements explicitly —
  (a) "the four ALLOW-EXPECTING CONTROL ROWS" when there are 25 of 40, and (b) the claim that the
  printed metric excludes over-denied ALLOW rows when `ALLGAPS` increments on any path mismatch.
  It also tells the reader what they are most likely doing when they reach it (attributing a
  manifest movement involving one of those 25) and not to use the paragraph for it.
- **`ALLGAPS` was never touched.** Still 164, still what the pin asserts, pin green with no bump —
  the user's instruction not to "fix" the 164/167 discrepancy is intact.
- **The 167 is not recoverable, and that is now recorded in the file rather than left open.** It
  is a hand count over a two-tree before/after comparison from PR #931 — not a number this file
  emits on any tree — so there is nothing to re-derive and nothing to check a replacement against.
  Saying so is the honest close; inventing a better-reading second explanation is precisely how
  the wrong paragraph came to exist.

**Why not delete or rewrite the paragraph.** Its surrounding block is retained deliberately for
its arithmetic lesson, and the file's convention is to mark superseded blocks in place rather than
excise them. A rewrite would have to assert something about the 167 that cannot be verified, which
would re-create the defect one level down.
