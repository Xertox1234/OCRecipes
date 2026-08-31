---
title: "A test named for a property but asserting a literal snapshot pins the bug it claims to prevent"
track: bug
category: code-quality
tags: [testing, typescript, api, ai-prompting, schema, silent-failure]
module: server
applies_to: [server/services/__tests__/**/*.ts, shared/schemas/__tests__/**/*.ts]
symptoms: ["A test name claims a relationship (schema-aligned, matches the contract, in sync) while its body compares against a hardcoded object", "A defect survives repeated review passes in a file that visibly has test coverage", "Fixing the production bug turns a green test red, and the test looks 'correct' before the fix", "Two artifacts are described as kept in sync by hand, and the only test over them snapshots one side"]
created: '2026-08-31'
severity: medium
---

# A test named for a property but asserting a literal snapshot pins the bug it claims to prevent

## Problem

A test called `"returns schema-aligned navigation proposal actions"` asserted this:

```ts
expect(mealPlanResult).toMatchObject({
  proposal: true,
  action: {
    type: "navigate",
    screen: "RecipeBrowserModal",
    params: { date: "2026-04-29", mealType: "dinner" },   // ← the bug, frozen
  },
});
```

The field is `date`. The screen reads `plannedDate`. The producer was emitting a param nothing
consumed, so the coach's "add to meal plan" proposal opened the browser with no planned date and
silently degraded to browse-only.

The test's **name** asserts a property — alignment with a schema. Its **body** asserts a literal
copy of whatever the function currently returns. Those are different claims, and the second one
is satisfied by any output at all, including wrong output.

## Symptoms

- The defect survived six review passes over the surrounding code. Readers saw a test named for
  the exact property that was violated and moved on — the name did the reassuring, the assertion
  did nothing.
- Fixing the production code made the test **fail**. A snapshot-shaped test inverts the normal
  signal: the red is the fix, not the regression.
- The two artifacts it nominally tied together (a server producer and a client ParamList) are
  hand-synced across a boundary the compiler cannot cross — exactly the situation where a real
  test carries the whole burden.

## Root Cause

`toMatchObject` against a literal answers "does the output still look like this", which is a
**change-detector**. The name promised an answer to "does the output satisfy the contract", which
is a **property**. Nothing in the test framework notices the gap, and a reviewer scanning names
rather than bodies is actively misled — a bare untested function at least looks untested.

The failure needs both halves. A literal assertion under an honest name (`"returns a proposal
with these fields"`) is a fine change-detector. A property name over a real property check is
fine. It is the mismatch that converts absent coverage into apparent coverage.

## Solution

Assert the property the name claims — run the value through the real contract:

```ts
import { actionCardSchema } from "@shared/schemas/coach-blocks";

// Make the name load-bearing: the proposal the server emits must survive the SAME
// boundary validation the client applies via filterValidBlocks. With the screen's
// entry now `.strict()`, a reintroduced `date` fails HERE instead of silently
// opening the browser in browse-only mode.
const asCard = {
  type: "action_card",
  title: "Add to plan",
  subtitle: "Confirm below",
  actionLabel: "Open",
  action: (mealPlanResult as { action: unknown }).action,
};
expect(actionCardSchema.safeParse(asCard).success).toBe(true);
```

Keep the literal assertion too where the exact values matter — they answer different questions.
The property check is what makes the name true.

Two rules of thumb:

1. **Read the name as a specification and ask what would falsify it.** If nothing in the body
   could fail when that property is violated, either fix the body or rename the test to the
   weaker claim it actually makes.
2. **When two artifacts are hand-synced across a boundary, the test must exercise the
   boundary** — parse with the real schema, import the real type, call the real validator. A
   literal transcribed from one side proves only that someone once typed it correctly.

## Prevention

- Treat property-sounding words in a test name — *aligned, in sync, matches, valid, consistent,
  round-trips* — as a promise that some assertion invokes the thing being conformed to. Grep for
  them during review of test files.
- When a fix makes an existing test fail, ask whether the test was pinning the bug before editing
  the expectation. Flipping the literal is the tempting move and it re-arms the same trap.
- A hand-sync comment ("keep these in sync by hand — no compiler check ties them together") is a
  marker that a real conformance test is load-bearing, not optional.

## Related Files

- `server/services/__tests__/coach-tools.test.ts` — the test, now asserting against the schema
- `server/services/coach-tools.ts` — the `add_to_meal_plan` producer whose bug it had frozen
- `shared/schemas/coach-blocks.ts` — the boundary schema the test now runs the output through;
  its own header comment documents the hand-sync that makes this necessary

## See Also

- [A test comment must claim only what its own harness can observe](a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the same mismatch in a comment rather than a test name
- [Flipping a test's expected outcome after narrowing a multi-gate check](flipped-test-expectation-must-recheck-which-gate-it-now-hits-2026-08-28.md) — the failure mode of "just update the expectation"
- [A parity/symmetry test's excluded edge case, documented only in a comment, is unenforced](parity-test-comment-only-exclusion-is-unenforced-2026-08-28.md) — a stated test property with nothing enforcing it
- [Re-verify an agent report's BOUNDING claims](../conventions/agent-report-bounding-claims-need-reverification-2026-08-15.md) — same session; the reason this producer was believed not to be live
