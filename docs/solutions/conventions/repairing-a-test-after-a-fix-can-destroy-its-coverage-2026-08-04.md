---
title: When a fix breaks a test, ask what the repaired test still proves
track: knowledge
category: conventions
tags: [testing, vitest, testing-library, assertions, code-review, fixtures, coverage]
module: client
applies_to: [client/**/__tests__/**/*.test.ts, client/**/__tests__/**/*.test.tsx, test/**/*.ts]
created: '2026-08-04'
---

# When a fix breaks a test, ask what the repaired test still proves

## Rule

A correct behaviour fix will break tests that pinned the old behaviour. Repairing them is expected
work — but the repair is a **new assertion**, and it deserves the same scrutiny as the one it
replaced. The cheapest repair is almost always the one that quietly stops asserting.

Before accepting a repaired test, answer one question: **what would now have to break for this to
go red?** If the answer is "less than before", the repair destroyed coverage even though the suite
is green.

Three repairs are the usual suspects:

1. **Flipping an assertion to its negation.** `.toBe(true)` → `.toBe(false)` passes — but so does a
   completely dead code path that returns `false` for an unrelated reason.
2. **Moving the fixture until it passes.** Legitimate when the old fixture no longer exercises the
   behaviour; a coverage hole when it was the *only* fixture on that side of the boundary.
3. **Loosening the query.** `queryByText` → `queryAllByText(…).length > 0` makes the multiple-match
   error go away and also makes the assertion satisfiable by elements you were not testing.

## Smell patterns

- A one-character diff in an assertion accompanying a substantive behaviour change.
- A fixture value edited to the other side of a threshold, with no note saying why the old value stopped being valid.
- `toHaveLength(n)` weakened to `.length > 0`, or an exact string query replaced by a regex.
- A test whose name still describes the old behaviour after its body was rewritten.
- All fixtures for a rule now sit on one side of it — the rule's other branch has no end-to-end coverage left.

## Why

All four examples below are from a single slice (2c of the Nutrition Detail redesign), where a
health warning was being deleted and the tests that should have caught it had pinned the defect as
intended behaviour.

**1. The negation that a dead lookup table also satisfies.** A filter maps `NutrientKind`
(snake_case: `saturated_fat`) to `ConcernNutrient` (camelCase: `saturatedFat`). One test asserted
`isBandedByPanel(saturated_fat, …) === true`. After the rule tightened, it failed. Flipping it to
`.toBe(false)` passes — **and so does a completely broken bridge**, because an unresolved mapping
also returns `false`. The repair would have deleted the only test proving the bridge is alive. The
right repair moved the fixture's band to `"high"` and *kept* `.toBe(true)`.

**2. The loosened query that four elements satisfy.** A test named "shows an em dash for an absent
calorie value" asserted `queryAllByText("—").length > 0`. With all macros undefined, four elements
render `—`: the calorie figure and three macro tiles. Deleting the calorie's em-dash branch
entirely left the test green. Fixing it meant giving the macros real values so exactly one `—`
remains.

**3. The fixture moved across a threshold.** Three screen tests used MEDIUM band fixtures. The
tightened rule made them fail, and moving them to HIGH made them pass — correctly, as it happens,
because a text query genuinely cannot separate the two surfaces at a MEDIUM band. But the move left
**no screen-level test where a disagreeing band leaves the badge standing**, so the end-to-end
wiring is now exercised only in the agreeing direction. That residual was worth recording, not
discovering later.

**4. The fixture that goes red for the wrong reason.** The summary card's copy template for a high
band is literally `` `High in ${word}` `` — byte-identical to the server's badge title. A fixture
banding HIGH and asserting on the visible text goes red when *either* surface renders, so it cannot
tell "the badge survived" from "the standout appeared". The implementer caught this in their own
first draft and switched to a band that produces different copy. A test that fails for a reason
unrelated to its subject is as misleading as one that passes for the wrong reason.

## Examples

```ts
// WRONG — passes, but a dead snake_case → camelCase bridge returns false too.
expect(isBandedByPanel(sugarFlag, bands)).toBe(false);

// RIGHT — keeps the positive assertion, moves the fixture to the band the new rule drops on.
// A dead bridge now makes this fail, which is the property the test exists to hold.
expect(isBandedByPanel(sugarFlag, { concerns: { sugar: { band: "high" } } })).toBe(true);
```

```ts
// WRONG — four elements render "—"; deleting the one under test keeps this green.
expect(queryAllByText("—").length).toBeGreaterThan(0);

// RIGHT — give the other fields real values so exactly one em dash can match.
render(<Card calories={undefined} protein={2} carbs={39} fat={1} />);
expect(queryAllByText("—")).toHaveLength(1);
```

When a test genuinely has no natural RED — a pure coverage addition, or an assertion whose subject
was already correct — **prove its power by mutation instead**: break the implementation, watch that
one test fail, revert, and record both in the report. That is weaker than a real RED but far
stronger than asserting the test exists.

## Exceptions

- **A test whose subject the fix legitimately deleted** has no counterpart, and forcing one is
  worse than removing it. Say so explicitly rather than dropping it silently — this slice had
  exactly one (a "the card is absent when there are no nutrients" test, obsolete because the panel
  now deliberately never vanishes) and it was rewritten to pin the surviving intent.
- **Loosening a query is right when the production markup was the problem** — but then fix the
  markup. Never restructure shipped code so a query resolves; that is the same trade in the other
  direction and this project has rejected it.
- Adding a `testID` that follows an existing convention in the same file is a test *affordance*, not
  markup restructuring, and is fine.

## Related Files

- `client/components/nutrition/__tests__/FlagSections-utils.test.ts` — the negation case; the fixture carries a comment saying why it bands `high`.
- `client/components/nutrition/__tests__/NutritionSummaryCard.test.tsx` — the loosened-query case.
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the moved fixtures, and the assertions re-pointed at a composed accessible name to dodge the string collision.

## See Also

- [Pure-utils extraction tests don't prove wiring](pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — the adjacent gap: a green unit test over a seam the call site never exercises
- [Two objects that are usually field-parallel diverge on the fallback path](../logic-errors/field-parallel-objects-diverge-on-the-fallback-path-2026-08-04.md) — the defect these repairs were made in service of; its fixtures all set both sources equal, which is why the suite never saw it
- [A guard outlives the state layout it was written for](../logic-errors/a-guard-outlives-the-state-layout-it-was-written-for-2026-08-04.md) — where every assertion sat on the suppressed side, so a permanently-on guard passed the whole suite
