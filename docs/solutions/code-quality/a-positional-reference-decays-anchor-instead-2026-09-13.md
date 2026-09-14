---
title: A positional reference decays — a line range excludes what it does not span, an ordinal moves when anything is inserted above it
track: bug
category: code-quality
tags: [harness, docs, verification, code-review, todos]
module: shared
applies_to: ["docs/solutions/**/*.md", "docs/rules/**/*.md", "todos/**/*.md", ".claude/hooks/**", ".claude/agents/**/*.md"]
symptoms: ["A cited line range captures a claim and excludes the retraction that follows it in the same comment block", "An ACn / 'Acceptance Criterion N' cross-reference resolves to the wrong item, or to the bullet doing the pointing", "A citation was correct when written and is false now, with no edit to the citing sentence", "A reviewer re-derives a cross-reference by counting list items and lands somewhere the author did not mean", "Two independent branches start replacing line numbers with symbol names in the same week", "An assertion greps for a literal that no longer occurs in either operand, so it cannot fire against any input"]
created: 2026-09-13
severity: medium
---

# A positional reference decays

## Problem

A reference by **position** — `file.sh:358-372`, `AC4`, "Acceptance Criterion 4" — names a
coordinate, not a thing. The coordinate is correct at the instant it is written and carries no
link to what lives there. Two independent failures follow, and they have **opposite causes**:

**A line range excludes whatever falls outside it — including a retraction.** In PR #952 a
decision record justified a ruling by citing `guard-outward-cli.sh:358-372`, a comment block
documenting a bypass as "UNHANDLED GAP, CONFIRMED LIVE". Nine lines below the cited range, at
`:381`, the same block reads:

> CLOSED — and this entry said otherwise for a day.

The citation captured the claim and excluded its retraction. The ruling then argued from a
bypass that had been closed six days earlier. A sibling example in the same document cited
`todos/archive/P0-…-interior-redirect-…md` as a live defect; that file is `status: done`.

**An ordinal moves when anything is inserted above it.** The same document's companion todo
said "AC4's binary spelling dimension must be instantiated with package names." Two criteria
were later inserted above the corpus criterion, walking it AC4 → AC5 → AC6 — so by the time it
was read, `AC4` resolved to *the bullet doing the pointing*. The reference pointed at itself.
Nothing edited the citing sentence; the document moved underneath it.

**And the same decay in EXECUTABLE code, where it costs enforcement rather than accuracy.**
A fail-closed assertion in `guard-outward-cli.sh` asserted that the narrow (grant-shaped)
flag grammar had not been widened back to the wide one, by testing for a literal:

```sh
printf '%s' "$_OUT_GH_GLOBALS_GRANT" | grep -qF -- '|-[^[:space:]]+)'
```

That string was the wide form's generic arm **as spelled the day the assertion was written**.
When the wide arm later gained an optional value token — becoming
`-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?` — the pinned literal stopped
occurring in *either* constant. The operand could no longer fire against any input. It was
not wrong; it was **inert**, and an inert operand in a green suite is indistinguishable from
a passing one.

The decay is identical in kind to `:358-372`: the test names a *spelling* (a coordinate in
text-space) rather than the *property* it cares about. Nothing declares what is supposed to
be there, so nothing can notice that it is not. The difference is only in what is lost — a
reader is misled by a stale citation, whereas a check silently stops protecting.

## Symptoms

- A cited range captures a claim and stops short of a correction, retraction, or "CLOSED" note
  that lives in the same block.
- An `ACn` / "step N" / "item N" cross-reference resolves to the wrong item, to nothing, or to
  the bullet containing the reference.
- A citation that is false now was true when written, and nothing edited the citing sentence.
- A reviewer resolves a cross-reference by counting list items, and lands somewhere the author
  never meant.
- Two **independent branches** begin replacing line numbers with symbol names in the same week.
  Convergence across lines of work that cannot see each other is evidence the positional form is
  the defect rather than one author's habit — but state what the independence actually is. Here
  both branches share a git author and an AI co-author; what is independent is the **work**
  (merge-base `e50a5d08`, neither an ancestor of the other), not the people. "Two authors" would
  overstate the diversity of the evidence, which is this document's own failure mode one level up.

## Root Cause

**A positional coordinate is not a reference to a thing; it is a reference to a place a thing
was.** It has no integrity check. Nothing in `:358-372` or `AC4` says what is supposed to be
there, so nothing can detect that it has drifted, and re-reading the citing sentence looks
completely fine.

Two distinct decay mechanisms share that root:

| mechanism           | when it breaks                              | is careful reading a defence? |
| ------------------- | ------------------------------------------- | ----------------------------- |
| **Exclusion**       | at write time — the span omits what matters | yes, partly                   |
| **Ordinal drift**   | later — items inserted above shift the index | **no**                        |
| **Spelling pin**    | later — the pinned text is re-spelled elsewhere | **no** — and the suite stays green |

This distinction is why an existing prevention did not hold.
[A correction inherits the whole cited region](a-correction-inherits-the-whole-cited-region-2026-09-13.md)
was codified **the same day**, and its prevention — "before replacing someone's citation, read
the *entire* cited region" — addresses the exclusion half exactly. The exclusion defect above
was then committed hours later by the same author, and caught only in review.

The reason the advice did not fire is structural, not a lapse of care: **it is a rule about
reading, and the failure happens while writing.** Picking `:358-372` feels like precision. The
prose gives no cue that a traversal is owed, because the citation looks most authoritative
exactly when it is narrowest. Ordinal drift is worse still — no reading discipline at write
time can prevent a reference that is correct when written.

A rule that must be remembered at the right moment is weaker than a form that cannot express
the defect. Anchors are that form.

## Solution

**Cite by anchor — a stable name the target contains — not by coordinate.**

| instead of                     | write                                              |
| ------------------------------ | -------------------------------------------------- |
| `cmd-detect.sh:117`            | `_CMD_REDIR` (in `lib/cmd-detect.sh`)              |
| `guard-outward-cli.sh:358-372` | the `DOCUMENTED RESIDUALS` entry for `gh api`'s method check |
| `AC4`                          | the corpus criterion                                |
| "step 3 above"                 | "the overlap-check step"                            |
| `grep -qF -- '|-[^[:space:]]+)'` | a **probe**: does this grammar span ` -x;y`? does it span ` -t x`? |

An anchor is self-verifying: `grep` for it either finds the thing or proves it moved. A line
number greps to whatever now occupies that line, which is indistinguishable from being right.

Where a line number genuinely helps a reader navigate, **pair it with the anchor and let the
anchor be load-bearing** — `_CMD_POS_SUFFIX` (`lib/cmd-detect.sh:126`). The number is then a
convenience that can go stale without making the sentence false.

When a range is unavoidable, **read to the end of the enclosing block**, not to the end of the
point you wanted — corrections in this codebase are appended *inside* the block they correct,
which is precisely where a range that stops early will miss them.

## Prevention

- **Never cite an ordinal for an item in an ordered list you or anyone else may insert into.**
  `ACn`, "step N", "item N" are guaranteed to drift; phrase-anchor instead ("the corpus
  criterion"). Numbered *headings* (`ruling 4`, `Phase 2`) are stable and are fine — the
  distinction is whether the number is authored or derived from position.
- **Prefer an anchor that fails loudly.** A symbol name, a quoted phrase, a heading. If it
  moves, a grep returns nothing; a stale line number returns the wrong thing silently.
- **When a citation supports a claim about state** ("this is live", "this is open",
  "undocumented"), re-derive the state from the source of truth rather than from the cited
  prose — `status:` frontmatter, a `CLOSED` marker, the current residuals list. Prose in a
  comment block records what was true when written, and this repo appends corrections rather
  than rewriting.
- **In executable checks, assert the PROPERTY by probing, never a spelling by matching.** Feed
  the thing under test an input and check the answer: "does this grammar span a separator?",
  "does it consume a separate value?" A probe survives any re-spelling of what it tests, and
  it fails loudly when the behaviour actually changes. A fixed-string test fails *silently*
  when the spelling changes, which is the direction that removes protection. When retiring
  such an operand, prove the mutant it existed to catch is still caught by something else —
  measure it; do not assume the surviving operands cover it.
- **Treat a same-day solution doc as weak protection against its own defect.** Codification
  records the lesson; it does not install it. If a defect is worth preventing, prefer a form
  that cannot express it (an anchor) or a check that fires (a lint, a review-checklist item)
  over prose that must be recalled at the right moment.

## Related Files

- `todos/P1-2026-09-07-outward-cli-path-wrapper.md` — the decision record; both the excluded-retraction citation and its correction are recorded in place
- `todos/P1-2026-09-13-launcher-family-and-absolute-path-defeat-the-outward-cli-guard.md` — where the `AC4` ordinal drifted twice and was replaced with a phrase anchor
- `.claude/hooks/guard-outward-cli.sh` — the `DOCUMENTED RESIDUALS` block whose entries carry in-place `CLOSED` corrections below the original claim

## See Also

- [A correction inherits the whole cited region](a-correction-inherits-the-whole-cited-region-2026-09-13.md) — the exclusion half, codified the same day; this doc records why its prose prevention did not fire and what form does
- [Re-verifying a stale item's citations is not re-verifying its premise](../logic-errors/citation-refresh-is-not-premise-refresh-2026-08-15.md) — refreshing citations while the load-bearing claim goes unchecked
- [A guard and its mutation test can both be inert while green](a-guard-and-its-mutation-test-can-both-be-inert-while-green-2026-09-13.md) — what an inert operand costs; this doc records one WAY an operand becomes inert, by pinning a spelling
- [An invented enumeration is not the space — ask the tool](../logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md) — the same "name the thing, not a snapshot of it" lesson in the flag-set direction
- [A sampled corpus described as generated](a-sampled-corpus-described-as-generated-2026-09-13.md) — a neighbouring evidence-hygiene defect from the sibling PR
