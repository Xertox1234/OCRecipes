---
title: "A pin records a verdict's VALUE; without recording whether that value is CORRECT it is a trap, and the next person fixes the guard to keep it green"
track: bug
category: code-quality
tags: [harness, hooks, testing, safety-gate, bash, security]
module: shared
applies_to: [".claude/hooks/*.sh", ".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ["A row asserts DENY and the label says the deny is correct, but real argv shows the input was legitimate", "A test row labelled a control stays green under a mutant that deletes the very check it claims to protect", "A correct improvement to a guard turns a pinned row red and is reverted as a regression", "A pinned verdict depends on which shell interprets the string, and nothing says so", "Two rows sit fourteen lines apart, one disclosing its caveat and its sibling silently not"]
created: 2026-09-13
severity: medium
---

# A pin records a verdict's VALUE; it must also record whether that value is CORRECT

## Problem

A regression pin asserts *what the system does today*. That is not the same as asserting
*what the system should do*. When the pinned verdict is itself wrong — an over-denial, an
over-grant, or a verdict that only holds under one interpreter — a pin that does not say so
tells the next maintainer that the current behaviour is the intended behaviour.

The failure is asymmetric and delayed: the row is green today, so nothing surfaces. It
surfaces later, when somebody *correctly improves* the code, the row goes red, and the red
line reads as "you broke something." The likely response is to revert the improvement to
restore green — which is exactly backwards.

Measured over three review rounds on one PR (`#940`, `guard-outward-cli.sh`):

| row | asserted | argv ground truth | the label said | the label should have said |
| --- | --- | --- | --- | --- |
| `&> -b --auto` | DENY | **armed** (`pr merge 42 --auto`) | "control: must still deny" | over-denial, pinned; a red here is intended |
| `>\| -b --auto` | DENY | **armed** | "control: must still deny" | over-denial, pinned; a red here is intended |
| `>! -b --auto` | ALLOW | armed under zsh, **forged under bash** | (disclosed correctly) | — |

The first two also had **zero** control value: the clause cut truncated the input before the
scan ever saw it, so both stayed green under a mutant that deleted the check they claimed to
protect. They pinned a different mechanism than their label named.

## Symptoms

- A row asserts a verdict and its label asserts that verdict is *correct*, but ground truth
  (real argv, real parse, real API response) says the input was legitimate.
- A row labelled "control" survives a mutant that deletes the logic it claims to cover.
- Someone widens a cut, fixes a parser, or corrects a shell assumption — and a pinned row
  goes red with a comment implying they regressed something.
- A verdict that differs by interpreter, platform, or locale is pinned at one of them with
  no note saying which, or why.

## Root Cause

"The test passes" and "the behaviour is right" are different claims, and a green row asserts
only the first. A pin is a *snapshot with an opinion attached*, and the opinion lives in the
label. When the label is written by whoever just made the row green, the natural phrasing —
"must still deny", "control" — smuggles in a correctness claim that was never checked.

The deeper version: the author asks **"does it deny?"** when the question is **"is the deny
correct?"** Those coincide most of the time, which is why the habit survives; they diverge
exactly on the rows that matter.

## Solution

Every pinned row's label carries three things, not one:

1. **The value** — what the system does today.
2. **Whether that value is correct**, measured against ground truth outside the system
   under test (real argv via a stub shell function, not the guard's own opinion).
3. **Which direction a future change should move it**, when (2) is "no".

The third is what converts a trap into a pin:

```bash
# IF THIS GOES RED after someone widens the clause cut correctly, that is the
# INTENDED outcome: move the pin to ALLOW, do not chase the guard back.
assert_deny "clause-cut OVER-DENIAL pin (argv IS armed, so this deny is wrong-but-pinned): ..." \
  "$(json 'gh pr merge 42 &> -b --auto')" "without a REAL --auto flag"
```

For an interpreter-dependent verdict, name the interpreter the pin follows **and** why it is
the right one:

> Pinned at the zsh reading because zsh is the shell the Bash tool actually runs, so that is
> the verdict that decides real merges. Under bash the same text is a forgery.

And keep the disclosure where the reader will be standing: the suite is the file whose red
line a maintainer sees first, so an instruction that lives only in a sibling corpus file
requires a detour precisely when nobody will take one. State it in both.

## Prevention

- Ask of every row: **"is this verdict CORRECT?"** — never "does it match?". Establish
  ground truth outside the system under test.
- Any row labelled a *control* must die under a mutant that deletes the logic it names. If
  it survives, it is pinning something else; find out what, and rename it.
- A pin on a known-wrong verdict states the intended movement direction in the label, not
  in a commit message or a PR body — those are not where the red line sends people.
- When one row in a block discloses a caveat, check its siblings: a disclosure that applies
  to a family and is written on one member reads as completeness, and the omitted member is
  the live one.

## Related Files

- `.claude/hooks/test-guard-outward-cli.sh` — the `clause-cut OVER-DENIAL pin` and
  `vft-bang` rows, both carrying the movement-direction sentence
- `.claude/hooks/repro-outward-cli-corpus.sh` — the same disclosure mirrored into the
  corpus generator, which feeds a required CI check
- `.claude/hooks/guard-outward-cli.sh` — "WHAT THIS BLOCK DOES NOT SETTLE", where the
  shell-divergence residual is stated next to the check it affects

## See Also

- [test pin normalised by a later pipeline stage is a decoration](test-pin-normalised-by-a-later-pipeline-stage-is-a-decoration-2026-09-06.md) — the sibling failure where the pin cannot express the difference at all
- [a two-sided control can still agree with a broken predicate](a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md) — two-sidedness is the floor; this doc is the ceiling
- [a measurement belongs to the tree it was taken on](a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13.md) — the same PR's other evidence defect
- [a deny-reason assertion goes stale when a stricter branch fires first](../logic-errors/deny-reason-assertion-goes-stale-when-a-stricter-branch-fires-first-2026-09-03.md) — a pin whose mechanism silently moved underneath it
- [widening a permissive text gate reopens the restrictive failure](../logic-errors/widening-a-permissive-text-gate-reopens-the-restrictive-failure-2026-09-12.md) — why over-denials in this family are disclosed rather than fixed
