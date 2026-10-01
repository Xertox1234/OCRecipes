---
title: "A frozen digest or count in a closure record rots on the next edit while still reading as verified — assert the property with the command that proves it instead"
track: bug
category: code-quality
tags: [harness, documentation, testing, verification]
module: shared
applies_to: ["docs/solutions/**/*.md", ".claude/agents/*.md"]
symptoms: ["A reviewer cannot reconcile a digest or count a doc cites", "Two people measure the same thing and get different numbers, and both are right", "A cited digest describes a superseded intermediate commit", "A closure note's numbers were correct when written and are wrong now", "A count reads as a property of the change when it is a property of the extraction"]
created: 2026-09-21
severity: medium
---

# Assert the property, not the snapshot

## Problem

Closure records — an archived todo's "how this was verified" note, a solution doc's
Root Cause, a PR body's test plan — reach for concrete numbers because concrete numbers
read as evidence: a digest, a character count, a row total. Nothing checks them. They are
correct at the instant they are written and silently wrong after the next edit, while
still carrying every visual signal of having been measured.

The failure is not "the number was wrong". It is that the number **described a moment**
when the sentence around it was claiming **a property**.

## Symptoms

- A reviewer reports it cannot reconcile a cited figure and produces a different one.
  Both measurements are correct; they measured different things, and the doc never said
  which.
- A digest in a closure note names a commit that was superseded two commits later — by a
  change the same PR made.
- The claim the number supports is still true when checked directly, so the "finding" is
  only ever about the frozen value.
- The figure survives an edit that changed the very text it counted.

## Root Cause

Measured on PR #1006, which hit this twice, one paragraph apart:

| Frozen value | What went wrong |
| --- | --- |
| `(4101 chars)` for "all five paragraphs" | It was the length of **that extraction** — clause-(3) spans — not of paragraphs as anyone else would delimit them. A reviewer measuring whole blocks got 1875 / 2507 / 10007 and could not reconcile it. Neither party was wrong; the doc never named the corpus. |
| `dcc87d5ea87f` as the "byte-identical after" digest | Measured after the first commit. A **later commit in the same PR** edited that exact line in all four files, moving it to `0e9aca8b8f2e`. The new value was computed in that commit's message and never propagated back. |

The second is the sharper lesson: the character count had *just* been removed, for exactly
this reason, with exactly this reasoning — and two frozen digests were left sitting in the
next paragraph. Applying a standard to the sentence under discussion and not to its
neighbour is how this survives a fix.

Both underlying claims were true throughout. Only the pinned values rotted.

## Solution

State the property and the command that proves it; omit the value.

```markdown
<!-- rots on the next edit -->
The four blocks were byte-identical before (`8db99e8be678`) and after (`dcc87d5ea87f`).

<!-- cannot rot -->
The four blocks are byte-identical to each other, checked by diffing one of them pairwise
against the other three (`diff <(sed -n "${n}p" a) <(sed -n "${n}p" b)`, empty output on
all three pairs).
```

When a number genuinely carries the argument, **bind it to the corpus that produced it** in
the same sentence — the repo's reviewer dispatch prompt already requires this: *quote any
count together with the corpus that produced it, because a bare number reads as a property
of the change when it is a property of the inputs.*

Distinguish the two cases before writing a value:

- **A snapshot that a checker enforces** (a pinned count in a test, a corpus row total) —
  keep it, and re-derive its adjacent prose whenever you bump it. That is a different
  discipline, covered by the companion note below.
- **A snapshot in prose that nothing checks** — do not write it. Write the property and the
  command.

## Prevention

- **Before committing a closure note, grep it for anything that pins a moment**: a short hex
  digest, a character or line count, a line number into a file the change does not freeze.
  For each hit ask whether a future edit can falsify it while the sentence stays true. If
  yes, replace it with the method.
- **When you remove one frozen value, sweep the whole file for its siblings in the same
  pass.** Both instances here were in adjacent paragraphs and were fixed in separate review
  rounds, each costing a full cycle.
- Immutable references are fine and should not be swept away with the rest: a commit SHA
  cited as history, a PR number, a transcript path. Git history cannot be invalidated by a
  later edit. The test is *can the tree move under this value*, not *does it look like a
  hash*.

## Related Files

- `.claude/agents/code-reviewer.md` — the reviewer contract whose closure note carried both
  instances.
- `docs/AI_WORKFLOW.md` — the dispatch prompt that already states the count-with-its-corpus
  rule this note generalises.

## See Also

- [adjacent-decomposition-prose-goes-stale-independent-of-its-own-pin](adjacent-decomposition-prose-goes-stale-independent-of-its-own-pin-2026-09-16.md) — the complementary case: when a pin IS required and a checker enforces it, its narrative paragraph is invisible to that checker and must be recomputed on every bump. That note says how to keep a needed value fresh; this one says not to write one you do not need.
- [../logic-errors/citation-refresh-is-not-premise-refresh](../logic-errors/citation-refresh-is-not-premise-refresh-2026-08-15.md) — the same decay one level up: refreshing the citation without re-deriving the claim it supports.
