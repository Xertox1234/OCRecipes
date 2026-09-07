---
title: "A special case that only prevents a FALSE POSITIVE is not worth a recurring defect surface — measure what it is worth before defending it"
track: bug
category: code-quality
tags: [harness, security, shell-quoting, testing]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["The same code arm produces a defect in every review round", "Each fix adds another condition to the same test rather than removing it", "The arm exists to avoid an over-denial / over-report, never to prevent a miss", "Nobody has measured how often the case it protects actually occurs"]
created: 2026-09-07
severity: high
---

# A special case that only prevents a false positive is not worth a recurring defect surface

## Problem

`cmd_words_vanished` deletes shell constructs that can expand to empty, so a verb split by one
rejoins. Adding a bare-paren depth counter made `$((arithmetic))` look like a balanced
substitution, which would delete it — and arithmetic is *never* empty, so deleting it
manufactures `foo` from `f$((1+2))oo` (real argv `f3oo`).

So an arm was added to copy `$((...))` out verbatim. Over three review rounds it produced
**four defects**, each found by a different reviewer:

1. its end-finder was **quote-blind** — a quoted paren ran the walk past the true end (CRITICAL);
2. then **comment-blind** — a `#` did the same;
3. then **command-list-blind** — `$((X) ; (Y))` balanced and passed the evidence test;
4. then **separator-blind** — `$((X)|(Y))` and six other spellings.

Each repair added another condition to the same test. The fourth finding is where it broke:
**the arm was what preserved seven live bypasses.** `$((X)|(Y))` is a command *substitution*
bash executes; without the arm the ordinary paren counter deletes the span and the verb
rejoins and the guard denies. The special case was protecting the attacker.

## Symptoms

- The same arm appears in finding after finding, each time via a different character.
- Every fix is "add one more thing to the void list" rather than "should this exist?".
- The arm's purpose is to avoid a **false positive** — an over-denial, an over-report, a noisy
  warning — never to prevent a miss.
- Nobody can say how often the case it protects actually happens.

## Root Cause

Two things compounded.

**The arm was answering an undecidable question.** "Is this text arithmetic?" cannot be settled
by balance, adjacency or a character blacklist — bash decides by *trying to parse it*. Every
textual approximation is a new guess, and the file already recorded four earlier guesses that
had failed.

**Its value was never measured, so it was defended reflexively.** When finally measured: across
**3,883 unique commands** in the project's real history, the mid-token `$((` shape it protects
appears **twice** — and both are the test suite's own fixtures. Real-world value: zero.

The asymmetry is what makes this a rule rather than a war story. The arm could only ever
*prevent an over-denial*; it could never *prevent a miss*. So every defect it produced was
strictly worse than the thing it was preventing.

## Solution

**Delete the special case.** ~110 lines including the whole helper. All seven bypass spellings
closed. The cost — arithmetic mid-token in a gated command now over-denies — is pinned
explicitly in the tests rather than hidden, and the false-positive harvest over 1,658 real
commands found **no decision change at all**.

Before defending a special case, ask three questions in this order:

1. **Which direction does it fail?** If it only ever prevents a false positive, its worst-case
   value is bounded and its defect budget should be near zero.
2. **How often does the case it protects actually occur?** Harvest real inputs and count. "It
   would be wrong on X" is not a reason to keep it if X has never happened.
3. **Is it answering a decidable question?** If the real answer requires the runtime's own
   parser, every textual approximation is a guess, and guesses accumulate.

If (1) is "false positive only" and (2) is near zero, delete it — do not add the next condition.

## Prevention

- **Count the defects an arm has produced.** Three from one arm is a design signal, not bad
  luck. The fix for the fourth should be considered alongside removal, not instead of it.
- **A blacklist that grows every round is the tell.** Each added exclusion narrows a guess that
  was never sound; it does not converge.
- **Measure the protected case against real inputs before the argument, not after.** The
  measurement here took minutes and inverted the conclusion.
- Watch for the inversion specifically: a special case whose *presence* preserves the bug the
  surrounding code exists to catch. That is the strongest possible signal to remove it.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — `cmd_words_vanished`, whose arithmetic arm and
  `arith_end()` helper were removed.
- `.claude/hooks/test-cmd-detect.sh` — the rows that now pin the over-denial cost openly, plus
  the seven separator spellings the removal closes.

## See Also

- [A new helper re-derived the grammar the same change was fixing](../logic-errors/new-helper-re-derived-the-grammar-the-same-change-was-fixing-2026-09-06.md) — the arm's first two defects, and the union rule.
- [A test pin normalised by a later pipeline stage is a decoration](test-pin-normalised-by-a-later-pipeline-stage-is-a-decoration-2026-09-06.md) — why the arm's own pins stayed green over its defects: every one used a "clean" input.
- [A fast-path pre-filter's superset proof must be re-verified](../conventions/dollar-sigil-not-stripped-by-fastpath-prefilter-2026-08-17.md) — the same "a claim of coverage is a test obligation" shape.
