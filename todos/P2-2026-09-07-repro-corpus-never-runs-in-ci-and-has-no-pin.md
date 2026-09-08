---
title: "repro-outward-cli-corpus.sh never runs in CI and exits 0 under any drift — every NOTE6 number is a comment about a program nothing executes"
status: backlog
priority: medium
created: 2026-09-07
updated: 2026-09-07
assignee:
labels: [deferred, harness, testing]
github_issue:
---

# The corpus is unguarded, and that is why its numbers keep going stale

## Summary

`.claude/hooks/repro-outward-cli-corpus.sh` is the executable ground truth for the outward-CLI
guard — 427 rows across four execution paths. **Nothing runs it.** `scripts/run-hook-tests.sh`
globs `.claude/hooks/test-*.sh`, which the corpus's filename does not match, so it never runs
locally in the gate and never runs in CI. It also has **no pin**: it prints
`rows=… precise-path gaps=… all-path gaps=…` and exits `0` under any drift whatsoever.

## Background

Filed 2026-09-07 from the code review of PR #931. Not a hypothetical: **three of that review's
twelve confirmed findings exist only because nothing executes this file.**

- The `NOTE6` paragraph explaining the closure count said `The 53 … hence the 84 denominator`
  while the measured values were `59` and `90` — a paragraph left behind by the very commit
  that updated the numbers two lines above it.
- The block attributing the measurement named no baseline tree at all, and the nearest commit
  it did name (`b01fcff2`) was the _previous_ change's baseline, so a reader re-deriving the
  numbers would have diffed the wrong tree.
- A superseded inventory block sat in the **present tense** between two blocks that contradict
  it, forty lines above a line that already reconciles its own number.

Each was found by a human-driven review re-running the file by hand. A pin would have caught
all three the moment they drifted, and they will regenerate: the same review round then had to
update the same numbers again (`404 → 427`, `90 → 102`, `59 → 71`) for the flag-adjacent axis.

## Acceptance Criteria

- [ ] The corpus runs in CI on every push that touches `.claude/hooks/**`.
- [ ] It **exits non-zero** when its own reported totals drift from a pinned expectation —
      at minimum `EXPECTED_ROWS`, `EXPECTED_PRECISE_GAPS`, `EXPECTED_ALLPATH_GAPS`, in the
      same "itemised, must-sum" style `test-guard-outward-cli.sh`'s `EXPECTED_TOTAL` block
      already uses.
- [ ] Bumping a pin is a deliberate edit with a dated comment, so the diff is where a
      reviewer confirms the movement was intended — the whole point of the existing
      `EXPECTED_TOTAL` convention.
- [ ] A deliberate one-row change to the corpus turns the gate RED (mutation-verified, not
      assumed).
- [ ] The runtime cost is measured and stated. This is the real trade-off: the corpus runs
      427 rows × 4 execution paths and takes minutes, which is why "just rename it to
      `test-*.sh`" may be the wrong answer.

## Implementation Notes

Two candidate shapes, and the choice is a genuine trade-off — do not just pick the first:

1. **Rename to `test-outward-cli-corpus.sh`** so the existing glob picks it up. One line,
   but it puts the full corpus in the per-push `preflight:fast` path for every hook change.
2. **Add it explicitly to CI only** (a separate job, or a step in `Lint · Types · Patterns`)
   and leave the fast local gate alone. Keeps the push loop quick; costs a longer feedback
   cycle when it does drift.

Measure the runtime first, then choose. Whichever is chosen, the **pin** is the part that
matters — a job that runs the corpus and ignores its output is worth nothing.

Watch out for: the 31 remaining precise-path gaps are **deliberate** documented residuals,
not failures. The pin must assert the _expected_ gap count, not zero, or it will be
permanently red and get disabled. The four ALLOW-expecting control rows that are
precise-clean/degraded-dirty on both trees are likewise expected — see the corpus's own
`NOTE6` 2026-09-07 block for why the two all-path denominators legitimately differ by 3.

Related, same file, both already tracked separately:
`todos/P0-2026-09-07-outward-cli-guard-space-separated-redirect-target-forges-auto.md`,
`todos/P1-2026-09-07-outward-cli-guard-narrow-deny-shape-b-closer-misses-redirect.md`.
