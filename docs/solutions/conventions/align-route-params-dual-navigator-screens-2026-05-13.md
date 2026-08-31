---
title: Align route params across dual-navigator screens
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, typescript, route-params, dual-navigator]
applies_to: [client/navigation/**/*.ts, client/navigation/**/*.tsx]
created: '2026-05-13'
---

# Align route params across dual-navigator screens

## Rule

When a screen component is mounted in **two different navigators** with separate param lists (e.g., `RecipeBrowserScreen` as both `RecipeBrowser` in `MealPlanStack` and `RecipeBrowserModal` in `RootStack`), keep the shared param fields synchronized across both `ParamList` types. This complements the intersection-type pattern for the navigation prop — this one covers the **route params**.

## Examples

```typescript
// Both navigators define the SAME field set — screen reads it without casting
export type MealPlanStackParamList = {
  RecipeBrowser: {
    mealType?: string;
    plannedDate?: string;
    searchQuery?: string;
    planDays?: MealPlanDay[]; // also in RootStackParamList
  };
};

export type RootStackParamList = {
  RecipeBrowserModal:
    | {
        mealType?: string;
        plannedDate?: string;
        searchQuery?: string;
        planDays?: MealPlanDay[];
      }
    | undefined;
};

// In the screen — no cast needed
const { mealType, plannedDate, searchQuery, planDays } = route.params || {};
```

```typescript
// Bad: Using `as` cast because the route type doesn't include planDays
const planDays = (route.params as { planDays?: MealPlanDay[] } | undefined)
  ?.planDays;
```

## Why

React Navigation merges params at runtime regardless of TypeScript types. An `as` cast makes it _work_ but defeats the compiler — if someone renames `planDays` in one ParamList but not the other, no type error fires. Aligned types make the compiler your safety net.

## Real instance: `date` / `plannedDate` / `searchQuery` (2026-08-30)

This doc named `planDays` as the field that prompted it and stopped there. It missed an
instance sitting inside its own Examples block: until 2026-08-30,
`RootStackParamList["RecipeBrowserModal"]` declared the planned-date field as `date?` while
`MealPlanStackParamList["RecipeBrowser"]` declared it `plannedDate?`, and
`RecipeBrowserScreen` read only `plannedDate` (it feeds the screen's `isBrowseOnly` fork —
`!plannedDate || !mealType`). The Examples block above showed exactly that divergent shape,
under the comment "screen reads it without casting," without flagging it as wrong. A
convention doc that walks past an instance in front of it is the gap this section closes; the
block above is now the corrected, fully-aligned shape.

`searchQuery?` diverged the same way and for the same duration — present on
`MealPlanStackParamList["RecipeBrowser"]`, absent from
`RootStackParamList["RecipeBrowserModal"]` — and nobody noticed. **The generalised rule:**
when a screen is registered under two route names, the aligned set is **every** field on that
screen's route params, not only the one field that prompted this doc. Auditing "the field I'm
changing" and stopping there is how the next field drifts unnoticed.

**Why the `date` half looked safe but was not — the cross-boundary lesson.** The field being
declared (rather than missing outright) made it look supported, and an enumeration of
callers with a path-scoped `git grep -n 'RecipeBrowserModal\|"RecipeBrowser"' -- client/`
correctly found zero `client/` call sites passing `date` — but that grep cannot see past an
API boundary. The real producer was `server/services/coach-tools.ts`: the coach's
`add_to_meal_plan` tool handler built its navigate proposal with
`params: { date: parsed.data.plannedDate ?? … }` while holding a variable literally named
`plannedDate` — a copy-paste of the field name it read into a hand-built object with the
wrong key. So every "add to meal plan" proposal the AI coach made had been opening
`RecipeBrowserScreen` in browse-only mode instead of add-to-plan-for-that-date, since the
handler was written. **A path-scoped `git grep` proves absence only within that path; a
navigation param's producers can live on the other side of an API boundary the grep never
crossed.** Compounding the miss, `server/services/__tests__/coach-tools.test.ts` had a test
named "returns schema-aligned navigation proposal actions" that asserted
`params: { date: "2026-04-29", … }` — a test whose name promised schema alignment while its
own assertion pinned the exact misalignment it claimed to rule out. (Producer fixed, test
corrected, and strengthened to validate through `actionCardSchema` in commit `04ebb015`.)

**Enforcement added.** `screenParamSchemas.RecipeBrowserModal` in
`shared/schemas/coach-blocks.ts` is now `.strict()` — an unknown or misspelled field the AI
emits for this screen is rejected outright, not silently stripped or passed through. This
schema cannot be derived from the ParamList type, because `shared/` never imports from
`client/` (so it cannot import `client/navigation`'s `RootStackParamList`): a future change to
either `RootStackParamList["RecipeBrowserModal"]` or
`MealPlanStackParamList["RecipeBrowser"]` for this screen must be mirrored into this Zod
schema by hand, and the reverse holds too.

## Exceptions

When to use: a screen registered in two navigators that receives the same data field from both entry points.

## Related Files

- `client/navigation/MealPlanStackNavigator.tsx` — `MealPlanStackParamList["RecipeBrowser"]`
- `client/navigation/RootStackNavigator.tsx` — `RootStackParamList["RecipeBrowserModal"]`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — reads `planDays` without cast; its
  `isBrowseOnly` fork is what a diverged `plannedDate` breaks silently
- `shared/schemas/coach-blocks.ts` — `screenParamSchemas.RecipeBrowserModal`, the hand-synced
  `.strict()` Zod boundary that now rejects an unaligned field from the AI
- `server/services/coach-tools.ts` — the `add_to_meal_plan` proposal builder; the producer
  that diverged across the API boundary a `client/`-scoped grep could not see

## See Also

- [Intersection type for dual-stack screen registration](../design-patterns/intersection-type-dual-stack-screen-registration-2026-05-13.md)
