---
title: "RecipeBrowserModal's param contract is unenforced end to end — a declared `date` nothing reads, and a `recipeId` the UI sends that nothing declares"
status: done
priority: medium
created: 2026-08-15
updated: 2026-08-15
assignee:
labels: [react-native, navigation, ai, data-integrity]
github_issue:
human_led: true
blocked_reason: "AC #2 is a product decision, not a spec: whether the coach's 'Add to meal plan' button is meant to carry the recipe into the browser or only open it. Every file in the Scope Contract matches todo-automerge-guard's SAFE_ALLOWLIST and none matches SENSITIVE_OVERRIDE, so without this gate an unattended /todo run would invent the answer, write it up as a settled decision record, and auto-merge it."
---

# RecipeBrowserModal's params are checked by nothing, in both directions

## Summary

`RecipeBrowserScreen` is registered under two route names in two navigators, and the two
declarations disagree. One declares the planned date as `date`, the other as `plannedDate`,
and the screen reads only `plannedDate`. Separately, the coach's "Add to meal plan" button
sends a `recipeId` that is neither declared in the ParamList nor read by the screen — an
`as` cast launders it past the compiler. Params are silently dropped in both directions.

## Background

Surfaced by a `mobile-reviewer` pass during PR #816 (the route-param shadow ESLint rule) and
deliberately left out of scope there — #816 was about the guard, and its own Risks section
said not to reopen screen code.

**This is not the defect that rule catches.** A shadow is a screen restating its params
instead of indexing the canonical ParamList. Here every ParamList is canonical and correctly
indexed — the declarations simply disagree with each other and with their callers. `tsc`
cannot see it either: each side type-checks against its own navigator, and the one place the
two meet is an `as` cast.

Two distinct instances, verified against `50bed11d`:

### 1. `date` is declared and read by nothing

| Where                                                  | What it says                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `client/navigation/RootStackNavigator.tsx:166-172`     | `RecipeBrowserModal: { mealType?; `**`date?`**`; planDays? } \| undefined`    |
| `client/navigation/MealPlanStackNavigator.tsx:26-31`   | `RecipeBrowser: { mealType?; `**`plannedDate?`**`; searchQuery?; planDays? }` |
| `client/screens/meal-plan/RecipeBrowserScreen.tsx:338` | destructures `mealType, plannedDate, searchQuery, planDays`                   |
| `client/screens/meal-plan/RecipeBrowserScreen.tsx:437` | `const isBrowseOnly = !plannedDate \|\| !mealType;`                           |

Anything setting `date` opens the modal in browse-only mode instead of add-to-plan-for-that-
date. This half is a trap rather than a live break — but the field is declared, which is what
makes it look supported.

Callers, enumerated 2026-08-15 against `50bed11d` with
`git grep -n 'RecipeBrowserModal\|"RecipeBrowser"' -- client/` — **22 lines across 14 files**.
Eight are live call sites; the remaining 14 lines are type declarations, tests, and comments:

| Call site                                        | Params passed                         |
| ------------------------------------------------ | ------------------------------------- |
| `components/coach/CoachChat.tsx:411`             | `{ planDays }`                        |
| `components/coach/blocks/RecipeCard.tsx:61`      | `{ recipeId }` — see instance 2       |
| `components/home/RecipeSearchDrawer.tsx:100`     | `{ searchQuery }` (via `MealPlanTab`) |
| `components/home/action-config.ts:46`            | `{}` (via `MealPlanTab`)              |
| `components/profile/library-config.ts:89`        | none                                  |
| `screens/meal-plan/CookbookDetailScreen.tsx:91`  | `{}`                                  |
| `screens/meal-plan/RecipeEntryHubScreen.tsx:248` | `{}`                                  |
| `screens/meal-plan/MealPlanHomeScreen.tsx:1044`  | `{}`                                  |

**No caller in `client/` passes `date`.** Scoped deliberately: it is not an unqualified
"nothing sets it", because the coach's navigate action reaches `navigation.navigate` through
a blanket `z.record(z.unknown())` and an `as` cast (see "Why the boundary does not catch
either"), so the model can emit `date` without any `client/` code doing so.

The command and its real output are written down because a bound with nothing behind it is an
opinion — and both earlier drafts of this todo got this bound wrong. See the Updates section.

### 2. `recipeId` is sent and declared by nothing — this one fires today

`client/components/coach/blocks/RecipeCard.tsx:57-64`, the "Add to meal plan" button:

```ts
onAction?.({
  type: "navigate",
  screen: "RecipeBrowserModal",
  params: { recipeId: recipe.recipeId },
});
```

`recipeId` is not in `RootStackParamList["RecipeBrowserModal"]`, and
`RecipeBrowserScreen` never reads `route.params.recipeId` (its `recipeId` occurrences at
lines 115/432/545/554/563 are a callback parameter, a favourites-set key, and outgoing
mutation arguments). It survives compilation only because
`client/components/coach/CoachChat.tsx:383-388` dispatches through an unchecked cast:

```ts
navigation.navigate(
  "RecipeBrowserModal",
  params as RootStackParamList["RecipeBrowserModal"],
);
```

So tapping "Add to meal plan" on a coach recipe card navigates to the browser having
discarded the recipe it was about. **Decide whether that is the intent** — if the button is
only meant to open the browser, the param is dead and should go; if the recipe is meant to
carry through, this is a user-visible loss.

### Why the boundary does not catch either

`shared/schemas/coach-blocks.ts:28` lists `RecipeBrowserModal` in `NAVIGABLE_SCREENS`, but
`screenParamSchemas` (~line 44) has entries only for `NutritionDetail`,
`FeaturedRecipeDetail` and `RecipeChat`. Everything else falls through to the blanket
`params: z.record(z.unknown()).optional()` — so the **model** can emit any object shape for
this screen with no validation, and so can the UI.

## Acceptance Criteria

- [x] `RecipeBrowserModal` and `RecipeBrowser` agree on the planned-date field name, OR the
      screen reads both. Do not leave a declared field with no consumer.
- [x] `recipeId` is either honoured (declared + read) or removed from `RecipeCard`'s action.
      Decide deliberately and record which.
- [x] `screenParamSchemas` has a `RecipeBrowserModal` entry constraining what the AI may emit
      for it, so an unknown or misspelled field is rejected at the boundary instead of
      silently dropped.
- [x] A test pins the dispatch path end to end: a navigate action carrying a planned date
      (and a recipe, if honoured) arrives as a value the screen actually reads. Asserting the
      navigate call's arguments does not prove the screen reads them — the existing test at
      `client/components/coach/__tests__/CoachChat.branches.test.tsx:670-673` does assert a
      precise shape (`toHaveBeenCalledWith("RecipeBrowserModal", { planDays: [] })`), and is
      still satisfied by a screen that ignores the param entirely. Satisfied two-sided: a
      screen-level test drives `RecipeBrowserScreen`'s `isBrowseOnly` fork off `plannedDate`
      directly, and `server/services/__tests__/coach-tools.test.ts`'s
      "returns schema-aligned navigation proposal actions" now asserts the producer emits
      `plannedDate` and validates the resulting proposal through `actionCardSchema`.
- [x] `docs/solutions/conventions/align-route-params-dual-navigator-screens-2026-05-13.md` is
      updated. It already codifies this class and names `planDays` as the aligned field, but
      misses the `date`/`plannedDate` divergence sitting in its own subject matter — a
      convention doc that walks past an instance in front of it is the gap worth closing.

## Implementation Notes

- Renaming `date` → `plannedDate` in `RootStackParamList` is the smaller change and matches
  the MealPlanStack shape. `tsc --noEmit` finds every caller.
- **Do not reach for an intersection type.** The `FavouriteRecipesScreen` precedent
  (`client/types/navigation.ts`, and
  `docs/solutions/design-patterns/intersection-type-dual-stack-screen-registration-2026-05-13.md`)
  works because that screen has the _same_ route name in both stacks. These two use different
  route names, so `RouteProp<A & B, K>` cannot index across them.
- The `as` cast at `CoachChat.tsx:383-388` is the mechanism that hides instance 2 from the
  compiler. A per-screen Zod schema whose inferred type feeds the navigate call would remove
  the cast rather than just narrowing it — worth considering while in there.
- While in `screenParamSchemas`, check the other unschema'd `NAVIGABLE_SCREENS` entries
  (`GroceryListsModal`, `PantryModal`, `CookbookListModal`) — same blanket-`z.record`
  exposure, better decided together than one at a time.

## Scope Contract

- **Mechanisms to use:** the existing ParamList declarations and the existing
  `screenParamSchemas` Zod map — nothing new.
- **Files in scope:** `client/navigation/RootStackNavigator.tsx`,
  `shared/schemas/coach-blocks.ts`, `client/components/coach/CoachChat.tsx`,
  `client/components/coach/blocks/RecipeCard.tsx`,
  `client/screens/meal-plan/RecipeBrowserScreen.tsx` (only if the chosen fix requires it),
  their tests, and
  `docs/solutions/conventions/align-route-params-dual-navigator-screens-2026-05-13.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #816 is merged and unrelated — its rule structurally cannot catch this class.

## Risks

- Tightening `screenParamSchemas` could start rejecting coach actions that previously passed.
  Check the coach prompt and eval set before narrowing.
- Renaming a route param touches the deep-link surface.
  `grep -n "RecipeBrowser\|date" client/navigation/linking.ts` returned nothing on 2026-08-15,
  so no deep link maps either name — re-run it before renaming rather than trusting this line.
- Instance 2 is a product decision, not just a type fix. Do not silently delete the
  `recipeId` param to make types line up — that would erase the evidence of intent.

## Updates

### 2026-08-15

- Filed at the user's request after being surfaced during PR #816's review rounds.
- The originating review report stated the in-app callers "only pass `planDays` or nothing".
  That was wrong: `RecipeCard.tsx:61` passes `{ recipeId }`. Every fact in this todo was
  re-verified against the files at `50bed11d` rather than taken from the report — which is
  how instance 2, the half that actually fires, was found.

### 2026-08-30

- **`human_led` gate.** Overridden once, in-session, by the user on 2026-08-30 after being
  shown the gate reason above. The override applied to that run, not to the file —
  `human_led: true` and `blocked_reason` are left exactly as filed. Only `status` was changed,
  to `done`.

- **AC #2 resolution — recorded verbatim.** Asked what the "Add to meal plan" button on a
  coach recipe card should do, the user answered: _"That button should add the recipe to an
  existing meal plan or kick off the creation of a new meal plan..."_. So `recipeId` is
  **honoured**, not deleted. The reasoning that follows from that answer: a meal plan is not
  an entity in this schema — there is no `meal_plans` table to attach a recipe to or create.
  `meal_plan_items` rows are keyed by `(userId, plannedDate, mealType)`. So "add to an
  existing plan" and "start a new one" collapse to the **same operation**: pick a day and a
  meal-type slot, then write the row. There is no branch between the two halves of the user's
  answer at the data layer — the UI does not need to ask "existing or new."

- **This todo's own Background was wrong — the most important thing to record.** Section 1
  called the `date` half "a trap rather than a live break" and stated "No caller in `client/`
  passes `date`." The second sentence was true and stayed true; the conclusion drawn from it
  did not follow. The caller enumeration was run as `git grep ... -- client/`, path-scoped to
  the client tree. The real producer was on the other side of the API boundary:
  `server/services/coach-tools.ts`'s `add_to_meal_plan` tool handler built its navigate
  proposal with `params: { date: parsed.data.plannedDate ?? ... }` — reading a variable named
  `plannedDate` and writing it out under the key `date`. So the coach's "add to meal plan"
  proposal had been opening `RecipeBrowserScreen` in browse-only mode all along: tapping the
  recipe in the browser opened its detail screen instead of adding it to the plan. This was
  live, user-facing breakage, not a dormant trap — the todo's own severity read on it was
  wrong. Worse, `server/services/__tests__/coach-tools.test.ts` carried a test named
  "returns schema-aligned navigation proposal actions" that asserted
  `params: { date: "2026-04-29", ... }` — a test that pinned the bug while its name claimed to
  verify the opposite. Both are fixed in commit `04ebb015` (producer now emits `plannedDate`;
  test now asserts `plannedDate` and additionally validates the proposal through
  `actionCardSchema`). This is the durable lesson: a caller enumeration scoped to one side of
  an API boundary proves nothing about producers on the other side, however precisely the
  command and its bound are written down.

- **Scope widening.** Two files landed beyond this todo's Scope Contract ("No new mechanisms,
  files, or abstractions beyond those listed"): `client/components/coach/
plan-slot-picker-utils.ts` and `client/components/coach/PlanSlotPickerSheet.tsx`. Reason:
  AC #2's resolution requires picking a day and a meal-type slot, and no reusable picker for
  that existed — `MealPlanHomeScreen`'s `DateStripItem` is screen-local to that screen, not an
  extractable component.

- **Secondary decisions.**
  - "Add to Plan" renders on a coach recipe card only when `recipe.source === "spoonacular"`
    — the add flow needs a Spoonacular catalog id to call
    `POST /api/meal-plan/catalog/:id/save`, which a community-sourced card cannot supply.
  - A free user tapping "Add to Plan" gets the existing `UpgradeModal`, because the underlying
    capability (`catalogSave`) is premium-gated the same way elsewhere in the app.
  - The new `add_recipe_to_plan` action is **client-local** — it is not added to
    `blockActionSchema` and the coach system prompt was not changed, so the AI model gains no
    new capability from this work; the picker is reached only through the existing recipe
    card UI.

- **Verification note on AC #4.** "Pins the dispatch path end to end" is satisfied two-sided
  rather than by one single test: a screen-level test drives `RecipeBrowserScreen`'s
  `isBrowseOnly` fork directly off `plannedDate` (proving the screen reads what the producer
  now sends), and the corrected `coach-tools.test.ts` case proves the producer sends it and
  that the resulting proposal still validates against `actionCardSchema`.
