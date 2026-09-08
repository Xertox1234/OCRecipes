---
title: "repro-outward-cli-corpus.sh never runs in CI and exits 0 under any drift — every NOTE6 number is a comment about a program nothing executes"
status: done
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

- [x] The corpus runs in CI on every push that touches `.claude/hooks/**`.
- [x] It **exits non-zero** when its own reported totals drift from a pinned expectation —
      at minimum `EXPECTED_ROWS`, `EXPECTED_PRECISE_GAPS`, `EXPECTED_ALLPATH_GAPS`, in the
      same "itemised, must-sum" style `test-guard-outward-cli.sh`'s `EXPECTED_TOTAL` block
      already uses.
- [x] Bumping a pin is a deliberate edit with a dated comment, so the diff is where a
      reviewer confirms the movement was intended — the whole point of the existing
      `EXPECTED_TOTAL` convention.
- [x] A deliberate one-row change to the corpus turns the gate RED (mutation-verified, not
      assumed).
- [x] The runtime cost is measured and stated. This is the real trade-off: the corpus runs
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

## Updates

### 2026-09-07 — implemented (option 2, CI-only), verified by mutation

**Runtime, measured before choosing — darwin/arm64, four full corpus runs:**

| what                                      | wall clock                  |
| ----------------------------------------- | --------------------------- |
| corpus, cold page cache (first run)       | 3m37.4s                     |
| corpus, warm                              | 1m56.1s · 1m58.7s · 2m02.4s |
| `scripts/run-hook-tests.sh`, all 34 tests | 2m18.6s                     |

The warm corpus is _slightly faster_ than the whole existing hook suite, so the todo's
"takes minutes, renaming may be the wrong answer" framing was directionally right but for a
weaker reason than assumed: renaming roughly **doubles** the gate (2m18s → ~4m20s), it does
not multiply it. It still doubles it on **every** push touching `.claude/hooks/`, `.husky/`
or `scripts/*.sh` — the `HOOK_CHANGED` probe in `scripts/preflight.sh` is that broad — for a
signal that does not need to be pre-push. **Option 2 chosen.** CI is always cold, so ~3m30s
is the honest CI budget, not the ~2m warm figure.

**Shipped**

- `.claude/hooks/repro-outward-cli-corpus.sh` — pins `EXPECTED_ROWS=427`,
  `EXPECTED_PRECISE_GAPS=31`, `EXPECTED_ALLPATH_GAPS=164` in the itemised must-sum style,
  **plus a per-ID manifest for each gap set**, and `exit 1` on any drift.
- `.github/workflows/ci.yml` — new always-on `outward-cli-corpus` job, parallel with the
  test shards, no `setup-node`/`npm ci` (neither the guard nor its libs invoke node or npx).

**Counts alone would not have been enough.** The manifests are collected in the _same two
branches_ that increment `GAPS`/`ALLGAPS`, so a count and its ID list cannot drift apart.
Both totals itemise and cross-check inside the run: `14 + 17 = 31` (the same decomposition
the existing attribution note carries), and `31 + 133 = 164` where 133 is independently
printed as the "precise-clean, degraded-dirty" section's row count.

**Mutation-verified, two mutations, both RED (`exit=1`):**

- **A — one-row change** (`fp-ghread` `ALLOW`→`DENY`): counts moved to 32/165 and both
  manifests named `+fp-ghread`. Satisfies the acceptance criterion literally.
- **B — count-preserving swap** (one gapping row's ID renamed, command and expectation
  untouched): `rows=427  precise-path gaps=31  all-path gaps=164` — **every total identical
  to the pin** — and only the membership checks fired, naming
  `-r4brange-tool-easbld` / `+r4brange-tool-easbldZ`. **A count-only pin is green on this
  mutation.** This is the run that proves the ID manifests are load-bearing rather than
  decoration, and it is why they must not be reduced to three integers later.

**Correction to this todo's own Background.** The pin would have caught **none** of the three
PR #931 findings cited above. All three were prose-vs-measurement drift inside a single
commit — a stale `53`/`84` paragraph, a misnamed baseline commit, a present-tense superseded
block — and a pin on rows/gaps goes green through every one of them. The pin catches future
_behavioural_ drift, which is a different and real thing; the filed rationale overstated it.

**Left open, deliberately, for a human**

- The job is **not** one of `main`'s eight required checks, so a red corpus reports on the PR
  but does not block a merge. Making it blocking is a one-line branch-protection change and
  is the user's call; the always-on (un-path-filtered) job shape is what makes it eligible.
- `NOTE6`'s sentence explaining the 167-vs-164 discrepancy is **factually wrong about the
  code**, and was left untouched as instructed. Measured: `ALLGAPS` increments on _any_
  path mismatch, so all four ALLOW-expecting controls (`decoyfp-auto`, `flagadjfp-andand`,
  `flagadjfp-roredir`, `flagadjfp-semi`) **are** inside the 164 — they are in the shipped
  manifest. The note claims the printed metric "does not count" them. The 164 itself is
  correct and is what is pinned; only the explanation is wrong. Not fixed here.
