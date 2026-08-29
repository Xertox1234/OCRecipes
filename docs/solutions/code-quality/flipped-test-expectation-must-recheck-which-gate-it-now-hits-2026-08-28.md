---
title: Flipping a test's expected outcome after narrowing a multi-gate check can silently stop testing the gate it was written for
track: bug
category: code-quality
module: shared
tags: [testing, harness]
applies_to: ["scripts/**/*.test.ts", "server/**/__tests__/**"]
symptoms: ["A test that used to prove gate B's behavior still passes after a change, but for the wrong reason", "Test coverage silently shifts from the intended check to an earlier gate in the same function", "A fixture originally chosen to reach gate B is now rejected at gate A, before B is ever evaluated"]
severity: medium
created: '2026-08-28'
---

# Flipping a test's expected outcome after narrowing a multi-gate check can silently stop testing the gate it was written for

## Problem

`scripts/todo-automerge-guard.sh` evaluates a PR through two sequential gates: a TODO
(priority/security) gate, then a PATH (safe-allowlist) gate. An existing test used a
`priority: medium` fixture specifically to prove the PATH gate allowed a newly-widened
directory — the priority was incidental, chosen only because medium was eligible at the
time. When a later change narrowed eligibility to `priority: low` only, the naive fix would
have been to flip that same test's expectation from "eligible" to "HOLD" — after all, medium
no longer passes.

Doing so would have been wrong: the TODO gate runs *before* the PATH gate, so a medium-
priority fixture now HOLDs at the TODO gate, never reaching the PATH gate at all. The test
would still pass — green — but it would no longer exercise the path-allowlist logic it was
written to prove. A future regression in the PATH gate (e.g. narrowing the allowlist by
accident) could ship with this test still green, because the test now HOLDs for an unrelated
reason before ever reaching the code it claims to cover.

## Symptoms

- A test's fixture and its assertion drift apart in meaning: the fixture was chosen for one
  reason (reaching a specific code path), the assertion was written for a different reason,
  and a change to an unrelated gate breaks that alignment without breaking the test.
- Renaming or flipping `expect(status).toBe(N)` makes CI green again without re-examining
  *which* code path produced that status.

## Root Cause

A multi-gate function's short-circuit order means a fixture's meaning ("this input reaches
gate B") is a property of the CURRENT gate configuration, not a fixed fact about the fixture.
Narrowing an earlier gate can silently repoint every fixture that used to pass through it
into a new, earlier failure — and a bare status-code assertion (`toBe(0)` / `toBe(1)`)
can't distinguish "failed at the gate I'm testing" from "failed at a gate upstream of it."

## Solution

When a gate's eligibility narrows and an existing test's fixture falls out of the newly-
narrowed set:

1. **Re-fixture, don't just re-expect.** Swap the fixture to a still-eligible value that
   preserves what the test was originally proving (here: `GENERIC_LOW_TODO` instead of
   `GENERIC_MEDIUM_TODO`, keeping the PATH-gate assertion intact and true for the right
   reason).
2. **Add a separate, new test** for the now-excluded case, with its own fixture chosen
   specifically to isolate the gate you're actually narrowing — use a path that is
   independently known-safe (already proven eligible by an existing test) so a HOLD can only
   be attributed to the gate under test, not an incidental PATH failure.
3. Where the test harness exposes it, assert on the **reason string**, not just the status
   code (`expect(stdout).toContain("only low todos are batch-merge-eligible")`) — this is the
   only way to positively confirm WHICH gate produced a HOLD, closing the gap a bare status
   code leaves open.

## Prevention

Before flipping any test's expected outcome, ask which specific code path the test's
fixture was chosen to reach, and confirm the narrowed logic still lets it reach that path.
If it doesn't, the fix is a new fixture (and often a new test), not a flipped assertion on
the old one.

## Related Files

- `scripts/todo-automerge-guard.sh` (TODO gate before PATH gate)
- `scripts/__tests__/todo-automerge-guard.test.ts`

## See Also

- [lookalike test of a reimplemented predicate guards nothing](lookalike-test-of-a-reimplemented-predicate-guards-nothing-2026-08-16.md) — sibling rule: a test can stay green while silently no longer exercising the real logic it claims to cover
