---
title: A correction inherits the whole cited region — reading part of it replaced a true sentence with a false one
track: bug
category: code-quality
tags: [harness, docs, verification, code-review, guards]
module: shared
applies_to: [".claude/hooks/**", "docs/solutions/**/*.md"]
symptoms: ["A disclosure block tells an implementer to expect N flips and the measured number is larger", "A claim about what a cited file 'does not document' was formed by reading only part of that file", "A correction lands on a sentence adjacent to a genuine error and is itself wrong", "A count is taken over a set, filtered on a semantic criterion, then reported with the unfiltered set's predicate", "An empirical corpus is cited for a claim whose shape the corpus structurally cannot contain"]
created: 2026-09-13
severity: medium
---

# A correction inherits the whole cited region

## Problem

PR #949 added a disclosure block to a P1 todo, telling a future implementer what to expect
when `git-safety.sh`'s hand-written trailing boundary is replaced by `lib/cmd-detect.sh`'s
shared `_CMD_POS_SUFFIX`. It went through two repair rounds. **Both rounds failed the same
way, in opposite directions, and the second failure was introduced by the fix for the
first.**

**Round 1 — measure, filter, then label with the unfiltered predicate.** The author
measured which closer characters newly match, correctly excluded `<` and `>` because they
are *real invocations* (`git commit>log` genuinely runs `git commit`), and then wrote the
sentence as a claim about all newly-matching shapes:

> Its closer class admits `)`, `;`, `&`, backtick, `{`, `}`, `<`, `>`, so **four shapes
> newly match** that the shipped regex missed … An implementer should expect **these four**
> to flip and not chase them.

The class has **nine** characters, not eight — `|` was dropped. Six of the nine flip, not
four. The filter ("and are not real invocations") was correct and was silently dropped from
the label. An implementer who saw `git commit>log` flip would find it outside the sanctioned
list and either chase a non-defect or narrow the boundary class to silence it — and
narrowing it deletes the deliberate 2026-09-01 `<`/`>` catch that made a verb glued to a
redirect visible at all.

**Round 2 — a negative claim from a partial read.** Correcting round 1, the reviewer (me)
read `lib/cmd-detect.sh:100-127`, found only the narrow 2026-09-01 note about `<`/`>` above
`_CMD_POS_SUFFIX`, and replaced the author's justification with:

> Recorded here because **no header covers it.** … So this residual is undocumented upstream
> rather than sanctioned there.

That is false. The definitional header at **`:67-116`** — 33 lines above where I started
reading — names every one of these closers ("a subshell `)`", "one of the same `;` `&` `|`
backtick operators", `{`/`}` as deliberate defense-in-depth) and then carries a
`KNOWN RESIDUAL (harmless)` analysis that reaches the same conclusion this block reached
independently, including the same named exception (`drift-detect-update.sh`'s suppressive
consumer). **The sentence I "corrected" was closer to true than my correction.**

## Symptoms

- A disclosure document tells an implementer to expect N of something; measuring yields more.
- A claim of the form "nothing documents X" / "no header covers it" / "this is undocumented",
  where the search that produced it was a partial read of the cited region.
- A correction lands on a sentence *adjacent* to a genuine error and is itself wrong — the
  real error primed the reviewer to distrust its neighbours.
- A set is measured, filtered on a semantic criterion, and reported with the predicate of the
  unfiltered set ("four shapes match" instead of "four match and are not real invocations").
- An empirical corpus is cited as evidence for a claim whose shape it structurally cannot
  contain — its zero is an absence, not a measurement.

## Root Cause

**Both rounds stated a claim about a body of evidence without traversing the whole body.**
Round 1's body was the nine-character closer class; it enumerated four. Round 2's body was the
50-line header at `:67-116`; it read `:100-127` — 28 lines, of which only the last **17** fall
inside that header, and the 33 above it were never opened. (The first draft of this sentence
said "read the last 27 lines" of a 50-line region: 28 is the span read, 17 is the overlap. A
figure that does not reconcile against the ranges printed beside it — in the document whose
subject is exactly that — caught in review.)

Three things made round 2 specifically easy to get wrong:

1. **A negative claim is the most expensive kind to verify, and feels like the cheapest.**
   "No header covers this" quantifies over an entire region: it is false if *any* line
   covers it. "Looked and didn't find it" is not a traversal, but it produces the same
   subjective confidence as one.
2. **Finding one real error licenses distrust of its neighbours.** The four-vs-six count was
   genuinely wrong. That made the next sentence feel suspect — and a correction was written
   for it without being verified to the standard the first correction had been.
3. **The narrow note sat exactly where a reader would stop.** `:119-125` is the comment
   *immediately above* the constant. It answers a question about the constant, so reading it
   feels like reading the constant's documentation; the definitional header is further up and
   easy to never reach.

A fourth defect, caught in the same review, is the corpus-scope error: the block cited a
1344-row sweep for "SEEN → MISSED shows zero of those." That corpus is 14 **redirect**
operators × 4 targets × 6 verbs × 4 positions, so it contains **zero rows of the relevant
shape** — bare unmatched punctuation with no operator at all. Its zero was structural absence
masquerading as evidence. (Scope that claim to the corpus that was run, not to the grammar:
`_CMD_REDIR` does model an `{fd}` prefix, so a `{3}>` spelling can put a literal brace in the
closer position — and the todo never enumerates the 14 operators tested, which is itself the
reason the claim cannot be checked. An enumeration you do not print is one nobody can audit.)

## Solution

State the partition, and make it reconcile to the size of the set:

| leg | closers | n |
| --- | --- | --- |
| consumed by `split_segments` before the regex | `;` `&` `\|` | 3 |
| flips, and IS a real invocation (the fix working) | `<` `>` | 2 |
| flips, NOT a real invocation (the over-denial) | `)` `` ` `` `{` `}` | 4 |

**3 + 2 + 4 = 9**, the whole class. A partition that does not sum to the set size is the
cheapest possible tell, and it is visible on one screen.

For the citation, cite the region that actually covers it (`:67-116`), state that upstream is
*not* silent, and replace the invented reason with the real one — the **anchor asymmetry**:
upstream sanctions `)` and backtick as closers because `_CMD_POS_PREFIX` also carries `(` and
backtick as command-position *openers*, so `` `git commit` `` and `(git commit)` are real
invocations the pair legitimately catches. `git-safety.sh`'s hand-rolled prefix has no such
opener — measured, both shapes are MISSED under the shipped *and* the widened regex — so for
that consumer those two closers can only ever close an unbalanced, syntax-error segment.

For the corpus, use the proof that was available all along instead of a sweep: the suffix
alternation is a strict **superset** of the shipped `([[:space:]]|$)`, and `grep -qE` tests
existence of a match, so widening can only ADD matches. SEEN → MISSED is impossible by
construction — no corpus required, and scoped explicitly to the boundary swap, since the
`_CMD_GIT_GLOBALS` half of the change is a different edit that still needs its own rows.

## Prevention

> **RECURRED THE SAME DAY — this prose did not hold.** Hours after this file was committed,
> PR #952 cited `guard-outward-cli.sh:358-372` for a bypass documented there as "CONFIRMED
> LIVE", stopping nine lines short of `:381`'s "CLOSED — and this entry said otherwise for a
> day", and argued a ruling from it. Same author, same defect, caught only in review. The
> reason is structural: the rule below is about **reading**, and the failure happens while
> **writing** — picking a narrow range feels like precision, and nothing in the prose cues
> that a traversal is owed. Prefer a form that cannot express the defect — cite by anchor
> (`_CMD_REDIR`, "the `DOCUMENTED RESIDUALS` entry for …") rather than by line range. See
> [A positional reference decays](a-positional-reference-decays-anchor-instead-2026-09-13.md).

- **A correction is a claim, and inherits the full verification burden of what it
  contradicts.** Before replacing someone's citation, read the *entire* cited region. The
  cost is one `sed -n '67,127p'`; the cost of skipping it is asserting a falsehood in the
  document whose subject is not asserting falsehoods.
- **Never write a negative claim you did not traverse.** "No header covers it", "nothing
  references this", "it is undocumented" quantify over a whole space. Either traverse it and
  say so, or write the positive claim you actually checked ("the note at `:119-125` covers
  only `<`/`>`").
- **When you find one real error, treat the neighbouring sentences as unaudited, not as
  wrong.** The prior is that adjacent text is *unverified*; it is not evidence that it is
  false. Verify each one on its own evidence.
- **If you filter a measured set, the label must carry the filter.** "Four shapes match" and
  "four shapes match and are not real invocations" are different claims. Whoever reads the
  document will measure the unfiltered number, so state it and name the complement.
- **Partition, don't enumerate — and show the sum.** Report all legs of the set with counts
  that reconcile to its size, rather than listing the interesting subset.
- **Before citing a corpus, ask whether it contains rows of the shape you are claiming
  about.** A corpus generated over one axis (redirect operators) cannot evidence a claim
  about another (brace/paren closers); its zero is structural.
- **Prefer a construction proof to a sweep when one exists.** Superset-of-an-alternation
  beats 1344 rows, cannot go stale, and needs no denominator.

## Related Files

- `todos/P1-2026-09-13-a-redirect-between-git-and-its-verb-defeats-the-worktree-contract.md` — the disclosure block, after both rounds
- `.claude/hooks/lib/cmd-detect.sh:67-116` — the definitional header that was not read; `:119-125` the narrow note that was
- `.claude/hooks/git-safety.sh:337,425` — `split_segments` and `MUTATING_GIT_SEG_RE`

## See Also

- [A positional reference decays](a-positional-reference-decays-anchor-instead-2026-09-13.md) — the recurrence of this defect hours after codification, plus the ordinal-drift half this file does not cover and the anchor form that removes both
- [A "metrics are stable" justification that was verified for only one of the cited metrics](../logic-errors/multi-metric-stability-claim-checked-for-one-metric-2026-07-16.md) — the same shape one layer out: a plural claim backed by evidence for one member
- [Re-verifying a stale item's citations is not re-verifying its premise](../logic-errors/citation-refresh-is-not-premise-refresh-2026-08-15.md) — citation work that looks like diligence while leaving the load-bearing claim unchecked
- [A sampled corpus described as generated](a-sampled-corpus-described-as-generated-2026-09-13.md) — the corpus-scope half of this defect, from the sibling PR
- [A two-sided control can still agree with a broken predicate](a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md) — controls that pass on an accident of their one input
- [Widening a permissive text gate reopens the restrictive failure](../logic-errors/widening-a-permissive-text-gate-reopens-the-restrictive-failure-2026-09-12.md) — why the over-denial direction was kept rather than narrowed
