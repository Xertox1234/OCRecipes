---
title: "A measurement belongs to the tree it was taken on — measure, then change, then report is not the same as measure after changing"
track: bug
category: code-quality
tags: [harness, testing, hooks, mutation-testing, bash]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh", "todos/**/*.md", "docs/solutions/**/*.md"]
symptoms: ["A commit message says a figure was measured at this tree and the figure is the previous tree's", "A pass/fail count does not reconcile against a total printed a few lines above it", "A mutation kill count is stated but the suite has gained rows since it was taken", "A count is updated in the place it is defined but not in the two or three places it is narrated", "A residual list quotes figures from before the change it is describing"]
created: 2026-09-13
severity: medium
---

# A measurement belongs to the tree it was taken on

## Problem

A measurement is only true of the exact tree it ran against. The dangerous sequence is not
*forgetting* to measure — it is measuring correctly, **then changing the thing**, then
reporting the earlier number as if it described the new state. Every individual step is
defensible, and the result is a false claim delivered with the confidence of a real
measurement, usually phrased as "measured at this tree".

Measured on PR `#940`: a mutation kill count of **21** was taken at commit `b24144b8`, which
was correct there. The next commit added a row that also dies under that mutation. The 21
was carried into the new commit and its message said "measured at this tree". At that tree
the answer is **22**.

## Symptoms

- A commit message or doc says "measured at this tree" / "re-measured" and the figure
  predates the change it accompanies.
- A stated pass/fail pair does not reconcile against a total already on the page.
- A count is corrected where it is *defined* (a constant, a pin) but not where it is
  *narrated* (a comment, a todo's evidence block, a PR body).
- A "+N" attribution explains fewer rows than actually changed.

## Root Cause

Measuring is expensive and re-measuring feels redundant, especially when the change since
the measurement looks unrelated to it — "I only added a test row, the mutation count is
about the guard." But a kill count is a property of *the suite crossed with the mutant*, not
of the guard alone, so any row that dies under that mutant moves it. The figure's dependency
set is wider than the thing the author was thinking about.

This is the same family as "a count is a property of its corpus, not of the change" —
specialised to the case where the corpus moved underneath a number that had already been
written down.

## Solution

**Re-measure after the last edit, not before it.** The sequence is edit → measure → report,
and any edit after the measurement invalidates it regardless of how unrelated it looks.

Then **reconcile the figure against something already on the page** before writing it down.
The #940 case was catchable with no re-run at all:

```
626 passed + 21 failed = 647
EXPECTED_TOTAL at this tree = 648      # printed four lines above the cell
```

A suite total is the cheapest possible test of whether a carried-forward number belongs to
the tree it sits next to. Any pass/fail pair that does not sum to the current total is from
a different tree, full stop.

**Compute counts from the file rather than retyping them.** Where a number is narrated in
several places, extract and sum them programmatically as part of the edit:

```python
items = [int(m) for m in re.findall(r"^#\s+\+(\d+)\s\s", block, re.M)]
tally = re.search(r"^#\s+((?:\d+ \+ )+\d+) = (\d+)\.", block, re.M)
total = int(re.search(r"^EXPECTED_TOTAL=(\d+)", body, re.M).group(1))
assert sum(items) == sum(terms) == int(tally.group(2)) == total - 596
```

Three separate arithmetic slips in one comment block on this PR are the evidence that
eyeballing it does not work.

**Record which items the delta is made of, not just its size.** "21 → 22" is unverifiable
later; "+1, and it is `vft-vmask`, because under the mutant its own `> -x` is unstripped so
`prev` reads `-x`" can be checked by anyone. Naming the rows also catches the error class
directly: if you cannot name the row that moved the count, you did not re-measure.

## Prevention

- Treat "measured at this tree" as a claim requiring the same rigour as any other — if the
  tree changed after the run, the sentence is false.
- Sweep for every superseded figure after correcting one. On this PR the same stale count
  appeared in six places; five were fixed across two rounds and the sixth sat twenty lines
  above the fifth, inside the block warning about stale counts.
- Keep the wrong number in the record with its cause rather than silently correcting it —
  "21 was measured at `b24144b8`, before this row existed" is more useful to the next
  reader than a clean 22.

## Related Files

- `.claude/hooks/test-guard-outward-cli.sh` — `EXPECTED_TOTAL` and the itemised delta block
  whose arithmetic is now computed rather than transcribed
- `.claude/hooks/repro-outward-cli-corpus.sh` — `EXPECTED_ROWS` / `EXPECTED_DENY_ATTRIB_ROWS`
  and the narrated counts that must move with them
- `todos/archive/P0-2026-09-07-outward-cli-guard-space-separated-redirect-target-forges-auto.md` —
  the mutation table, carrying its correction and the reason for it

## See Also

- [a summary count cannot express a row getting strictly worse](summary-count-cannot-express-a-row-getting-strictly-worse-2026-09-06.md) — diff per-ID sets, never subtract totals
- [a two-sided control can still agree with a broken predicate](a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md) — where "a count is a property of its corpus" was first recorded
- [a pin records its value but must also record whether it is correct](a-pin-records-its-value-but-must-also-record-whether-it-is-correct-2026-09-13.md) — the same PR's other evidence defect
- [a clean zero needs its denominator](a-control-that-runs-before-the-work-cannot-validate-it-2026-09-07.md) — a number that is true of a population of nothing
