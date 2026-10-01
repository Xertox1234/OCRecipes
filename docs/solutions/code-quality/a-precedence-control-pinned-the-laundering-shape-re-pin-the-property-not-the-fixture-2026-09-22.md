---
title: "A precedence control pinned the laundering shape itself — when a security fix turns an existing control red, re-derive which property the control existed for and re-pin it with a non-defective fixture"
track: bug
category: code-quality
module: shared
tags: [harness, hooks, testing, security]
applies_to: [".claude/hooks/test-*.sh", ".claude/hooks/**/*.sh"]
symptoms: ['A fix to a fail-open path turns exactly one pre-existing test red, and that test name describes a legitimate property (precedence, ordering, priority)', 'The red test fixture pairs an objection with a clean delivery and asserts the clean outcome', 'The tempting repair is to delete the control or flip its expectation; both lose the property it guarded']
created: '2026-09-22'
severity: medium
---

# A precedence control pinned the laundering shape itself — when a security fix turns an existing control red, re-derive which property the control existed for and re-pin it with a non-defective fixture

## Problem

`test-review-stamp-writer.sh` case 22 was written as a precedence control when the async
hand-back fallback landed: "when the delivered text ALREADY carries the contract, it must win; a
transcript hand-back saying something different must not override a valid direct report". Its
fixture paired a FINDINGS hand-back with a CLEAN contract-bearing text and asserted `verdict:
clean`. That pairing is, byte for byte, the laundering shape the stamp-writer P1 later closed: an
objection in the transcript, a clean re-issue as text, and the clean text winning. The control
had pinned the bug as the property.

When guard (c) landed (refuse when any hand-back carries an objection and the delivered text
carries the contract), case 22 went red — and it was the only pre-existing failure in a 66-case
suite, which made it look like collateral to delete or flip.

## Symptoms

- A green suite that contains a fixture indistinguishable from the attack the new fix refuses.
- After the fix, a control named for a real property fails, and its assertion reads as the
  inverse of a new case (here, case 37 holds the identical fixture with the opposite verdict).
- The control's comment justifies the assertion by what it protects against ("otherwise the fix
  would silently re-route the sync path through the transcript"), not by what its inputs mean.

## Root Cause

The control conflated two things: the PROPERTY it guarded (a direct contract-bearing report is
the one parsed; the transcript is a fallback, not an override) and the FIXTURE it used to
demonstrate it (a hand-back that "says something different" — chosen as a findings report
because that was the most obviously different thing to hand). Nobody asked whether the fixture's
inputs were a legitimate transcript. A transcript in which the same agent objects and then
certifies is not a precedence question; it is a contradiction, and the safe reading of a
contradiction on a fail-closed gate is to write nothing.

## Solution

Keep the property, change the fixture. Re-pin case 22 with a hand-back that carries NO objection
and describes a DIFFERENT head — a clean report for another sha — and assert both halves of the
precedence property: the record lands at the direct report's sha, and nothing lands at the
hand-back's. The old fixture moved to case 37, asserting the opposite verdict, with the comment
on case 22 saying so:

```
# RE-PINNED 2026-09-22, and the flip is the point: this control used to pair the direct clean
# report with a FINDINGS handback and assert that the direct report won. That pairing is the
# laundering shape guard (c) now refuses … The precedence property survives with a handback
# that carries no objection: a clean report for ANOTHER head.
```

The suite's assertion count did not change; the meaning of one assertion did, and the file says
why in place rather than in a commit message.

## Prevention

- When a fix turns a control red, write down the property the control exists for BEFORE touching
  it. If the fixture is a member of the class the fix refuses, the fixture is wrong, not the fix
  and not the property.
- A control's inputs must themselves be legitimate. "Something different" is not a fixture
  specification; "a clean report for another head" is.
- Keep the flipped fixture in the suite under the new verdict, adjacent, so the pair documents
  the boundary instead of the boundary disappearing into history.
- Grep pre-existing fixtures for the attack shape before writing the fix's own cases — the
  one that already exists is the one most likely to be asserting the wrong verdict.

## Related Files

- `.claude/hooks/test-review-stamp-writer.sh` — case 22 (re-pinned) and case 37 (the old fixture,
  opposite verdict)
- `.claude/hooks/review-stamp-writer.sh` — guard (c)
- `todos/archive/P1-2026-09-22-stamp-writer-takes-contract-bearing-text-over-its-own-objection.md`

## See Also

- [a test named for a property must assert the property, not a literal](test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md) — the same family: a fixture standing in for a property
- [flipping a test's expected outcome after narrowing a multi-gate check](flipped-test-expectation-must-recheck-which-gate-it-now-hits-2026-08-28.md) — why "just flip the expectation" is the wrong reflex
- [a resumed reviewer never stamps; re-adjudicate by fresh dispatch](../conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md) — the laundering shape the control had pinned
