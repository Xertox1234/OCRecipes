---
title: "Meal-plan card's shopping step still subtracts the pantry by exact unit"
status: done
priority: low
created: 2026-11-16
updated: 2026-11-16
assignee:
labels: [deferred, api]
github_issue:
---

# Meal-plan card's shopping step still subtracts the pantry by exact unit

## Summary

Coach now has two pantry rules. The grocery card uses the rule from PR 1892 (plural-aware
names, comparable units, "covered / unsure / buy"). The meal-plan card's "also add the
shopping" step still uses the older rule, which matches only on the exact name and exact unit.

## Background

Found in the 2026-11-16 review of Coach's grocery and pantry tools. It was the one item of
that review the owner did not pick, so it was left alone.

- Old rule: `deductPantryFromGrocery` in `server/services/pantry-deduction.ts`, called from
  `server/services/write-cards/plan.ts` (around line 343).
- New rule: `pantryVerdict`, `matchKey` and `unitKey` in `server/services/write-cards/grocery.ts`.

Effect today: with "eggs, 12" in the pantry, the plan card still adds "egg, 2" to the list,
and "2 cups milk" is not covered by "1 litre milk". The grocery card handles both.

## Acceptance Criteria

- [x] `deductPantryFromGrocery` has other callers; list them first and decide, per caller,
      whether the new rule applies. Record the decision in the PR.
- [x] The plan card's shopping step and the grocery card give the same answer for the same
      pantry and the same items, proven by a test that runs both on one fixture.
- [x] One implementation of the name and unit matching, not two.
- [x] Tests first, red before the change.

## Implementation Notes

The new rule can answer "unsure". The grocery card keeps unsure items on the card for the
user to untick; the plan card has no per-item ticks for shopping, so "unsure" most likely
means "buy". Confirm against `docs/superpowers/specs/2026-11-09-coach-write-cards-design.md`.

## Scope Contract

- **Mechanisms to use:** the existing `pantryVerdict` / `matchKey` / `unitKey` helpers.
- **Files in scope:** `server/services/pantry-deduction.ts`,
  `server/services/write-cards/plan.ts`, `server/services/write-cards/grocery.ts`, their
  tests, and the write-cards spec if the rule's wording changes.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Other callers of `deductPantryFromGrocery` (the app's own grocery-list generation) would
  change behaviour if the shared function changes; that is a product change, not a refactor.

## Updates

### 2026-11-16

- Initial creation

### 2026-11-17

- Callers of `deductPantryFromGrocery`: `server/routes/grocery.ts` (the app's own list generation) and `server/services/write-cards/plan.ts`. Decision: the plan card moves to the new rule; the route keeps the old function unchanged (changing it is a product change, per Risks).
- The shared rule (`matchKey`, `unitKey`, `pantryVerdict`, `groupPantryByKey`) now lives in `server/services/pantry-deduction.ts`; `grocery.ts` imports and re-exports `matchKey`/`unitKey` (used by `pantry.ts`).
- Plan card: only "covered" leaves an item off; "unsure" and "buy" are bought (no per-item ticks).
- Criterion 2 evidence: `server/services/write-cards/__tests__/plan.test.ts` "addShopping answers like the grocery card for the same pantry and items" (red before the change).
