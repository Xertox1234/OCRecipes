---
title: "Corpus prose still quotes 448/372/281 row counts from an earlier pin, in blocks that read present-tense"
status: backlog
priority: low
created: 2026-09-15
updated: 2026-09-15
assignee:
labels: [deferred, harness, testing]
github_issue:
---

# A cluster of row counts in repro-outward-cli-corpus.sh predates the current pin

## Summary

Several comments in `.claude/hooks/repro-outward-cli-corpus.sh` quote row counts from a
corpus that no longer exists. They are **pre-existing and equally wrong on `origin/main`**,
so this is drift that accumulated across several row-adding PRs rather than a regression
any one change introduced. None of them affects a verdict, a pin, a manifest or any guard
behaviour — the cost is a reader trusting a number.

## Background

Found 2026-09-14 during the verification pass on the cmd-detect case-arm PR. That PR fixed
four comments of a _different_ class (claims about the case-arm gap being open). This
cluster was flagged in the same review as explicitly out of that class and out of that
PR's scope, and is filed rather than folded in.

The `281` instance was fixed in passing, because it sat inside a block that PR was already
rewriting and its correct value was derivable from the same run (`620 - 250 = 370`). The
rest were left alone deliberately — they sit in blocks that PR never touched, and editing
comments you have not re-measured is how this drift started.

## Known instances

| line (at 0a06facb) | text                                                  | note                               |
| ------------------ | ----------------------------------------------------- | ---------------------------------- |
| 1196               | "Capturing here deletes all 448 of those guard"       | present tense                      |
| 1271               | "Same lines, same order, 448 fewer"                   | present tense                      |
| 1356               | "all 448 rows x 4 verdict columns came back"          | past tense, historical measurement |
| 1369               | "372 DENY rows), so nothing is currently colliding"   | "currently"                        |
| 2810               | "the corpus is now 448 rows against `origin/main` at" | "is now", tied to a named baseline |

The live figures at that sha are `rows=620`, `precise-path gaps=31`, `all-path gaps=250`,
`EXPECTED_DENY_ATTRIB_ROWS=522`. On `origin/main` they were `602` / `31` / `243` / `504`,
so the `448` predates both.

## Acceptance Criteria

- [ ] Each instance is either re-derived from an actual run and corrected, or explicitly
      re-tensed as a historical record naming the baseline it was measured against.
- [ ] The distinction is made per-instance, not globally: 1356 reads as a record of a past
      comparison and may be correct as history, while 1196 and 1271 describe what the code
      does now and are simply wrong.
- [ ] Every number written is quoted together with the command that produced it, per this
      file's own standard that a bare count reads as a property of the change when it is a
      property of the inputs.
- [ ] `bash -n` clean, corpus exits 0, and the diff is comment-only — verified by
      canonicalising both revisions through bash's own parser (wrap the file as a function,
      source it, `declare -f`), not by a naive comment strip, which is wrong in both
      directions on this file because `#` appears inside quoted mechanism data.

## Implementation Notes

- Do NOT batch-replace `448`. The instances differ in tense and in what they refer to, and
  a global substitution would turn a correct historical record into a wrong present-tense
  claim — the exact failure this todo exists to undo.
- The numbers move every time a row-adding PR lands, which is why they drifted. Consider
  whether the durable fix is to stop restating them in prose at all and point at the pin
  constants instead, the way the precise-gap composition note now does.

## Risks

- Touching these blocks without re-running the corpus reproduces the original defect.
- Several of these comments are inside the four pin-check rationales the file marks
  DO NOT DELETE; correct the numbers without weakening the structural arguments around them.

## Updates

### 2026-09-15

- Filed from the verification pass on PR #966. Scoped out of that PR because it is a
  different class from the case-arm comments that PR corrects.
