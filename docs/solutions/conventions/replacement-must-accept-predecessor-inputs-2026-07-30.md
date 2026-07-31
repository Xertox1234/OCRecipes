---
title: A replacement must accept everything its predecessors accepted — pin their inputs as regression tests first
track: knowledge
category: conventions
tags: [refactoring, unification, regression-testing, parsers, fixtures, false-green]
module: shared
applies_to: ["shared/lib/**/*.ts", "client/lib/**/*.ts", "server/services/**/*.ts"]
symptoms: ["A 'unification' refactor lands green and something stops working in production", "The new implementation is correct in isolation and a regression in context", "Every test for the new code passes because every test was written for the new code", "A user-facing message becomes false — 'we couldn't read that' when the value was read fine"]
created: 2026-07-30
---

# A replacement must accept everything its predecessors accepted — pin their inputs as regression tests first

## Rule

When one implementation replaces two or more, **its predecessors' accepted
inputs are its first test cases** — written before any new behaviour.

Verifying that the new code does what you intended is not the same as verifying
that it still does what the old code did. Only the second catches a narrowing.

## Smell patterns

- A new module whose tests were all written alongside it.
- A comment asserting the new implementation "matches" or "is exactly what X
  requires", with no test comparing them.
- A consolidation diff that deletes call sites without a table of old-vs-new
  behaviour on real inputs.
- A regex rewritten to be "cleaner" or "safer" than the ones it replaces.

## Why

Two parsers were unified into one `parseLabelServingGrams` so a client gate and
a server gate could not drift apart. The replacement was **stricter than both**:

| input | old server parser | replacement |
|---|---|---|
| `1 package (198g/7oz)` | 198 | **null** |
| `1 slice (43g/1.5oz)` | 43 | **null** |
| `1 tasse (250 mL/8 fl oz)` | 250 | **null** |
| `1 can (355 mL )` | 355 | **null** |
| `250 grams` | 250 | **null** |

The anchor `(?:^|\s)` meant a digit immediately after `(` could never reach the
bare-unit branch, so any parenthetical the paren branch missed was lost
entirely — dual-unit North American packs, and OCR spacing before the closing
bracket, are both extremely common.

The consequence was worse than a rejected input: the gate also suppresses a
notice, so the user was told **"We couldn't find nutrition values on that
photo"** for labels whose calories *and* serving had both been read perfectly.
The refactor made the failure it was written to fix more likely, and every one
of its own tests passed.

A related trap in the same session: a test fixture was **edited** so an
assertion would pass, producing a record simultaneously mis-scaled on calories
and correctly scaled on sugar — a shape no real record has. Editing a fixture to
turn a test green is the tell. Ask whether production can actually produce that
shape before touching it.

## Examples

Pin the predecessors explicitly, in their own block, so the intent survives:

```ts
describe("regression: forms the predecessors accepted", () => {
  it("reads a dual-unit parenthetical", () => {
    expect(parseLabelServingGrams("1 package (198g/7oz)")).toBe(198);
    expect(parseLabelServingGrams("1 tasse (250 mL/8 fl oz)")).toBe(250);
  });

  it("tolerates OCR spacing before the closing paren", () => {
    expect(parseLabelServingGrams("1 can (355 mL )")).toBe(355);
  });

  it("reads a spelled-out unit", () => {
    expect(parseLabelServingGrams("250 grams")).toBe(250);
  });
});
```

Practical procedure:

1. Collect the predecessors' real inputs — from their tests, their call sites,
   and captured production data.
2. Run **old vs new** on each and diff the results before deleting anything.
3. Any input where they disagree is a decision to make deliberately and record,
   not an accident to discover later.

## Exceptions

A deliberate narrowing is legitimate — the same replacement above intentionally
stopped accepting a bare number, because `"Serving Size 1"` parsing to a 1-gram
serving scales every nutrient by 100x. The rule is not "never narrow"; it is
**never narrow by accident**. State the narrowing, test it, and make sure the
caller's failure path is honest about it.

## Related Files

- `shared/lib/label-serving.ts` — the unified parser
- `shared/__tests__/label-serving.test.ts` — the `regression: forms the predecessors accepted` block
- `client/lib/serving-size-utils.ts` and `server/services/barcode-lookup.ts` — the two predecessors, both retained for their own callers

## See Also

- [Relaxing a shared contract requires auditing its dependents](relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — the same blind spot in the opposite direction
- [A disjunctive gate whose alternatives fail to the same root cause](../logic-errors/disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md) — the gate this parser feeds
- [Collapse duplicated branches only after verifying identical behaviour](../best-practices/collapse-duplicated-branches-verify-behaviour-first-2026-05-31.md) — the same principle for collapsing duplicated branches
