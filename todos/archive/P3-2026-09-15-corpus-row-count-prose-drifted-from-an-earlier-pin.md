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

**This table is NOT a partition, and an earlier revision of it implied otherwise.** It listed
five rows; an exhaustive grep at the same anchor found three more of the same class, and the
count of what remains is a property of the grep below, not of this list. Re-run it rather than
trusting the table:

```
grep -nE '\b(448|372|581|359|281)\b' .claude/hooks/repro-outward-cli-corpus.sh
```

Then adjudicate each hit by TENSE, which is the whole difficulty — some are correct historical
records and must not be "corrected".

| line (at 0a06facb) | text                                                  | note                               |
| ------------------ | ----------------------------------------------------- | ---------------------------------- |
| 1196               | "Capturing here deletes all 448 of those guard"       | present tense                      |
| 1271               | "Same lines, same order, 448 fewer"                   | present tense                      |
| 1356               | "all 448 rows x 4 verdict columns came back"          | past tense, historical measurement |
| 1369               | "372 DENY rows), so nothing is currently colliding"   | "currently"                        |
| 2810               | "the corpus is now 448 rows against `origin/main` at" | "is now", tied to a named baseline |

Found by the same grep and missing from the original table, all present-tense:

| line (at 0a06facb) | text                                                                  | note               |
| ------------------ | --------------------------------------------------------------------- | ------------------ |
| 58                 | "Three of the 372 pinned reasons contain an em-dash before column 72" | live figure is 522 |
| 82                 | "`cut` lands mid-sentence for 41 of the 372"                          | live figure is 522 |
| 1381               | "the same verdict AND the same reason for all 581 rows"               | live figure is 620 |

DELIBERATELY EXCLUDED as a different class, listed so the next reader does not re-litigate
them. **Quoted, not numbered, and that is deliberate** — an earlier revision gave line numbers
for these four that belonged to a third revision entirely, neither the anchor above nor the
head they were written at, which is the same positional-citation defect this todo records one
level up. Search for the quoted text:

- "Running all 308 rows across" — past-tense experiment record. Quoted this short because the
  full sentence wraps mid-phrase in the corpus and a longer quote returns 0.
- "generated 272 rows from 5 glue POSITIONS" — past-tense experiment record
- "both sides see the same 427 rows" — a differential record, scoped to a named baseline
  (`origin/main` at a9d77417, PR #930) two lines above it [staleness-ok]
- "372, expected" — illustrative error-message text inside quotes, not a live count. Same
  reason for the short quote: the full phrase wraps at "expected".

A SEPARATE COUNT IN THE SAME FAMILY, folded in here because it would otherwise fall between
todos: one site says "none of the current 17 fingerprints does it" while two others say 20.
Quoted rather than numbered — an earlier revision of THIS line carried coordinates valid only
at a mid-PR commit, the same third-revision defect corrected in the exclusions three lines
above. Search for "20 of each over all" and "all 20 fingerprints the corpus reaches". A run
reported 20. It is a fingerprint count rather than a row count, so it
is outside this todo's title, but it is the same present-tense-number-from-an-earlier-state
defect and a reader should not have to pick between two figures three thousand lines apart.
Re-derive it from a run before changing it.

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

### 2026-09-15 (later)

- Table corrected after review: it listed five instances and implied completeness, which is the
  same defect this todo exists to record. Three more added, four explicitly excluded with
  reasons, the implied exhaustiveness replaced by the grep that produced the list, and the
  line-66 fingerprint mismatch folded in.

### 2026-09-15 (even later)

- The four exclusions are now quoted rather than numbered. Their line numbers had been taken
  from a third revision — not the anchor the tables use, and not the head they were written
  at — so they resolved to unrelated text at both. Quoting the string removes the coordinate
  system from the citation entirely.

### 2026-09-15 (fifth)

- Two of the four exclusion quotes did not resolve — both wrapped across a comment break in the
  corpus, so `grep -F` on the full phrase returned 0. Shortened to fragments that survive the
  wrap. Quoting a string removes the coordinate system only if the string fits on one line.
- The fingerprint note carried line numbers valid at neither anchor this file declares. Now
  quoted, like the exclusions above it.
- The mechanical sweep for this whole class is now recorded in the corpus beside NOTE6:
  every line citing a `todos/` or `docs/` path must carry the `.md` on that same line. A
  full-path `grep -F` cannot see a wrapped citation, which is how it has returned a false zero
  six times in this repo.
