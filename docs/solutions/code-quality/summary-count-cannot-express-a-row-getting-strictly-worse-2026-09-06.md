---
title: "A summary count cannot express a row getting strictly worse — diff the per-ID sets, never subtract the totals"
track: bug
category: code-quality
tags: [harness, verification, testing, code-review]
module: shared
applies_to: [".claude/hooks/**", "scripts/**", "todos/**", "docs/**"]
symptoms: ["A stated delta does not reconcile with the totals printed beside it (\"47 + 29\" against a printed 69)", "A before/after comparison is reported as a subtraction of two integers rather than a set difference of item IDs", "An item is described as newly failing when it was already failing — its failure simply got WIDER", "A fixture's total is unchanged between two runs while individual rows moved in both directions", "A count is quoted verbatim into a PR body or todo, where it outlives the run that produced it"]
created: 2026-09-06
severity: medium
---

# A summary count cannot express a row getting strictly worse

## Problem

A bypass corpus reported `all-path gaps 47 → 69` between two commits. The comment
explaining the delta read:

> 29 rows newly degraded-dirty, and every one is `toolvnest-*` / `toolvdqclose-*` /
> `toolvsqclose-*` / `toolvmixq-*` (4 mechanisms × 7 families) plus `trailclose-ctl`.

Two things are wrong, and the first is visible without running anything: **47 + 29 = 76**,
which is not the **69** printed two lines above it. The real figure is **22** rows
(3 mechanisms × 7 families + 1), and `47 + 22 = 69` exactly.

The fourth mechanism, `toolvmixq-*`, could not be in the delta because it was **already**
all-path-dirty on both sides. What actually happened to it — and to two other mechanisms —
is invisible in any total:

| mechanism | before | after |
| --- | --- | --- |
| `toolvmixq-*` | precise ALLOW, 1 degraded path failing | precise **DENY**, **3** degraded failing |
| `toolvbareparen-*` | precise ALLOW, 1 degraded failing | precise ALLOW, **3** degraded failing |
| `toolvcasearm-*` | precise ALLOW, 1 degraded failing | precise ALLOW, **3** degraded failing |

Each got strictly worse on three axes. The total did not move for any of them.

## Symptoms

- The stated delta and the printed totals do not reconcile.
- "Newly failing" is claimed for an item that was already failing.
- A comparison is expressed as `after − before` rather than as a set difference.
- The number is later quoted into a PR body, where nothing recomputes it.

## Root Cause

A count is a **lossy projection** of a set. It preserves cardinality and discards identity,
so three transitions it cannot represent are exactly the ones that matter in a regression
comparison:

1. **An item crossing in each direction** — one closes, one opens, total unchanged.
2. **An item degrading without crossing the threshold** — already failing, now failing on
   three paths instead of one.
3. **An item being misattributed** — counted as new when it was pre-existing, which is what
   produced the wrong 29 here.

The arithmetic slip is downstream of the same cause: once you are reasoning in integers,
`47 + 29 = 76 ≠ 69` has nothing to check it against. Had the comparison been a set
difference, the mistake could not have been written — `comm` returns the members, and
counting them is the last step, not the first.

## Solution

Diff the per-item ID sets and let the count fall out of the members:

```bash
# emit "<id> <status>" per row from each run, then compare AS SETS
comm -13 before.ids after.ids | wc -l    # opened
comm -23 before.ids after.ids | wc -l    # closed
comm -12 before.ids after.ids            # in both — inspect for widened failures
```

The same discipline settles the strongest claim in the change. Against `main` on a 268-row
corpus: **143 gaps closed, 0 opened**, and the branch's gap set is a strict **subset** of
`main`'s — a statement about membership that no pair of totals can make.

Two guards worth keeping:

- **Reconcile the stated delta against the printed totals** before committing the sentence.
  It costs one addition and catches the whole class.
- **Verify "no pre-existing item changed" explicitly** rather than inferring it from
  `Δtotal == Δrows`. Restrict the after-run to the before-run's IDs and `diff` the status
  lines; identical output is the proof.

Watch the tooling too: a first attempt here used `join -o`, which **errors on BSD** and
printed an empty result that read exactly like "nothing changed". An empty result from a
failed command is not evidence — check the exit status, not just the output.

## Prevention

- Report set differences, not integer deltas, whenever a fixture is compared across commits.
- Treat any number quoted into a PR body or todo as a claim that must be reproducible from
  a command in the repo; if the population is not tracked, say so beside the number.
- When a total is unchanged, ask what moved *inside* it before concluding nothing did.

## Related Files

- `.claude/hooks/repro-outward-cli-corpus.sh` — prints per-ID rows precisely so counts need not be trusted; its `NOTE6` carries the corrected attribution
- `.claude/hooks/guard-outward-cli.sh` — DOCUMENTED RESIDUALS

## See Also

- [a retracted claim survives in every artifact you did not grep](a-retracted-claim-survives-in-every-artifact-you-did-not-grep-2026-09-03.md) — what to do once a wrong number has already been quoted elsewhere
- [a property proven of one expansion form is not a property of its syntax class](../logic-errors/one-form-property-asserted-of-whole-syntax-class-2026-09-06.md) — found in the same review round
- [a coverage ratio whose numerator and denominator come from different populations measures neither](../logic-errors/ratio-over-a-column-mixing-two-corpora-measures-neither-2026-08-08.md) — the other way an aggregate misleads
