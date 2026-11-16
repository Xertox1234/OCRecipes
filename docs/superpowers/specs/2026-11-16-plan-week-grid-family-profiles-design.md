# Plan tab: week grid and family profiles — design

Date: 2026-11-16. Reference: the owner's standalone "Hearth Meal Planner" design (Claude Design,
Planner and Family screens). Ideas only; nothing visual is borrowed.

## Why

The Plan tab shows one day at a time: a calorie ring and that day's meal slots. Planning a week
means tapping through seven days, and there is no way to plan for anyone but the account holder.
The owner judged the interface flawed and prefers Hearth's Planner: the whole week as a grid, days
across and meals down. A person who cooks for a household also needs to say who a meal is for and
to see when a recipe clashes with a family member's allergy.

## Owner decisions (final)

1. **No design or colour changes.** Existing theme, components and tab bar. Hearth's look is not
   borrowed.
2. **The Hearth Planner grid is the interface** for the Plan tab.
3. **Family is a premium option.**
4. **No invite functionality and no family accounts.** Profiles are created by the user and hold
   only what the user types in.
5. **Planning only, for now.** No per-person calorie targets and nothing logged as eaten for a
   profile.
6. **A planned meal is either shared or for one person** (approach B below). It is never for an
   arbitrary subset.
7. **No fasting feature.** Hearth's fasting screen is not brought over.

## My calls (not confirmed by the owner — correct any of these)

- Everyone, free and premium, gets the grid. Free users see a one-person planner.
- Two PRs: the grid first (no database change), family profiles second.
- A profile can be any person the user cooks for, adult or child.
- A profile stores a name, allergies and a short note. **No age or birth date:** with planning only
  it would drive nothing, and it is data about children we would have to protect for no benefit.
- The slot counter ("6 of 28 planned").
- Lapsed-premium behaviour, the filter chips and the audience default (all below).

## Goals

- See and fill a week of meals on one screen.
- Keep every existing Plan-tab capability reachable: add, suggest, confirm as eaten, reorder,
  remove, the calorie ring, and the Recipes / Pantry / Grocery Lists / Cookbooks shortcuts.
- Premium users can keep family profiles, mark a meal shared or for one person, get grocery
  quantities that cover everyone eating, and see allergen clashes per person.

## Non-goals

- Per-person calorie or macro targets; logging what a family member ate.
- Invites, shared households, or a second account seeing the plan.
- Any restyle, the Hearth week-of-dinners card view, or tab bar changes. Fasting is ruled out
  (owner decision 7).
- A meal for an arbitrary mix of people.
- "Fill only the empty slots" AI generation (see Stage 1, actions).

## Anti-goals

- A shared dinner for four showing four portions of calories on the user's ring, or logging four
  portions when confirmed.
- A family member's meal counting toward the user's own nutrition anywhere.
- A profile's details reaching an AI provider or any third party without an explicit owner ruling
  and a privacy-page change.
- Losing confirm, reorder or the calorie ring in the move to a grid.

## How it works today (what the builder is changing)

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` (1,032 lines): date strip, calorie ring, one
  `MealSlotSection` per meal type for the selected day, four bottom sheets.
- `meal_plan_items` (`shared/schema.ts`): `userId`, `recipeId` XOR `scannedItemId`, `plannedDate`,
  `mealType`, `servings`, `sortOrder`. A slot can hold several items.
- **`servings` is the user's own portion.** It multiplies calories in
  `client/components/meal-plan/meal-plan-utils.ts` (`computeItemMacros`) and
  `server/storage/meal-plan-analytics.ts` (`getPlannedNutritionSummary`), is copied into the daily
  log by `POST /api/meal-plan/items/:id/confirm`, and is also what grocery batches are computed
  from (`getMealPlanIngredientsForDateRange`: ceil(total planned servings / recipe yield)).
  It therefore cannot double as a headcount.
- The plan itself has no premium range limit (90-day query cap for all). `extendedPlanRange` only
  limits grocery-list date ranges (7 vs 90 days).
- AI suggestions (`/api/meal-suggestions`, premium `aiMealSuggestions`) and pantry plan generation
  (`/api/meal-plan/generate-from-pantry`, reachable today only from receipt review) already send
  the user's own allergies to the AI provider behind the AI-sharing consent check.
- User allergies: `user_profiles.allergies` as `{ name, severity }[]` (`allergySchema`). Recipes
  carry a derived `allergens` cache; `shared/constants/allergens.ts` has the safety rules,
  including the "possible" level.

## Approaches considered

**Staging.** One PR for everything, or the grid first and family second. Chosen (my call): two
PRs. The grid touches no data and can be judged in the simulator before a migration is written,
and the big screen gets split during the change that carries the least risk.

**How a meal knows who it's for.**

|                             | Expresses                   | Cost                                         |
| --------------------------- | --------------------------- | -------------------------------------------- |
| A. Any mix of people        | "for Ivy and Leo"           | link table plus a people picker              |
| **B. Shared or one person** | "for everyone" or "for Ivy" | one kind column, one nullable profile column |
| C. Whole-plan headcount     | "I cook for four"           | cheapest; no per-person filter               |

**The owner chose B.** It matches Hearth's filter row and needs no picker. Known cost: a
kids-only dinner is entered once per child.

## Stage 1 — the week grid (no schema change)

```
 [Recipes] [Pantry] [Grocery Lists] [Cookbooks]        (unchanged)
 ‹   November 2026   ›                    6 of 28 planned
            MON 16     TUE 17     WED 18   → scrolls
 Breakfast    +          +          +
 Lunch        +        Grain bowl   +
 Snack        +          +          +
 Dinner     Salmon     Tacos +1    Ragu
 kcal        520       1,150       680
 [ Plan from pantry ]            [ Grocery lists ]
```

- **Grid.** Meal-type labels stay fixed on the left; the seven day columns scroll sideways, about
  three visible at a time, opening on today. Today's column is marked with the existing accent.
  Week arrows and the swipe-to-change-week behaviour stay.
- **Empty cell.** A "+" button that opens the existing add-item sheet for that date and meal type
  (it already offers suggestions where the plan allows them).
- **Filled cell.** The first item's image, title and calories (the user's portion, as today). A
  slot with more items shows "+N". Scanned items show the same way as recipes. Tapping opens the
  day view.
- **kcal row.** The user's planned calories for the day, same maths as today's ring.
- **Day view.** A new screen holding what the Plan home shows today for one day: day label,
  calorie ring, the four `MealSlotSection`s with confirm, reorder and remove, and the same error
  states. Reached from a day header or any filled cell. This is where every existing per-day
  capability keeps living, unchanged.
- **Actions.** "Grocery lists" opens the existing Grocery Lists screen. "Plan from pantry" opens
  the existing pantry plan screen with its existing premium and AI-consent gates; it is shown only
  to users whose plan allows it and hidden while the plan is unknown (`usePlanCheck`). No new AI
  call type is added.
- **States.** A failed first load keeps today's "Couldn't load your meal plan" treatment in place
  of the grid, with navigation still usable. An empty week is simply an empty grid; the
  "No meals planned yet" card goes away.
- **Accessibility.** Every cell is a button with a full label ("Tuesday dinner, sheet-pan chicken
  tacos, 610 calories" / "Tuesday lunch, empty, add a meal"), 44 pt minimum target, reduced motion
  respected.

Constraints for the builder: `BottomSheetModal`s must stay declared in the screen component (see
the note in the current screen); pure grid logic goes in a `*-utils.ts` file with Vitest tests
written first; split the home screen rather than growing it.

## Stage 2 — family profiles (premium)

### Data

- New table `family_profiles`: `id`, `userId` (cascade), `name` (required, max 50), `allergies`
  (`Allergy[]`, same shape as the user's), `note` (optional, max 200, display only),
  `sortOrder`, `createdAt`. At most 8 per user.
- `meal_plan_items` gains `audience` (`'self' | 'shared' | 'profile'`, not null, default `'self'`)
  and `familyProfileId` (nullable, cascade on profile delete), with a check that the profile id is
  set exactly when `audience = 'profile'`. Every existing row is `'self'`, so nothing changes for
  current data.
- New premium flag `familyProfiles` (free false, premium true).

### What each kind of meal means

|         | In the user's ring and totals              | Can be confirmed as eaten         | Grocery portions                                                 |
| ------- | ------------------------------------------ | --------------------------------- | ---------------------------------------------------------------- |
| self    | yes, × `servings`                          | yes                               | `servings`                                                       |
| shared  | yes, × `servings` (the user's own portion) | yes, logs the user's portion only | `servings` + one per profile the user has when the list is built |
| profile | **no**                                     | **no**                            | `servings` (that person's portions, default 1)                   |

Headcount is never stored on the meal. Adding or removing a profile changes the next grocery list,
not past ones. Deleting a profile deletes that person's own meals (the delete prompt says so) and
leaves shared meals shared.

Every reader of `meal_plan_items` must respect this. Known ones: `computeItemMacros` callers,
`getPlannedNutritionSummary`, the confirm route, `getMealPlanIngredientsForDateRange`,
`server/storage/weekly-reports.ts`, `server/storage/export.ts`, the coach context. The builder
audits the full list.

### Screens

- **Filter chips** above the grid, premium users with at least one profile only:
  `All · Me · Ivy · Leo · +`. All shows everything. Me shows self and shared. A person's chip shows
  that person's meals and shared. "+" opens profile management.
- **Adding a meal** asks one single-choice question, "Who's it for?": Everyone / Just me / each
  profile. Default: the active filter's person, otherwise Everyone. Users with no profiles never
  see it and keep creating `self` meals. An existing meal's audience can be changed from the day
  view.
- **Cells and day rows** show a small marker: a group icon for shared, the person's initial for a
  profile meal.
- **Allergen warning.** A recipe is checked with the existing allergen rules against the user and
  every profile when shared, against that one profile when it is theirs. A clash shows a warning
  marker on the cell and a line in the day view naming who ("Contains tree nuts — Ivy"). This is a
  local check on stored data; no AI is involved. The free-text note is never checked.
- **Managing profiles.** Profile tab → Family, and the "+" chip. Add, rename, edit allergies and
  note, delete.

### Rules

- Server enforces the premium flag on creating or editing a profile and on writing any audience
  other than `self`. A `familyProfileId` must belong to the signed-in user, otherwise 404.
- While the plan is unknown, no lock or upsell is shown (existing `usePlanCheck` ruling).
- Free users: no chips; the Family row opens the existing upgrade modal.
- Lapsed premium: profiles and existing shared/profile meals stay visible and deletable; creating
  profiles and assigning new meals to them is blocked.
- Profiles are included in the data export and removed with the account.
- The privacy page and the Law 25 assessment gain a section on family profile data before this
  ships. This is health data about other people, some of them children: never passed to the kimi
  workers, and the PR gets a security review.

### Open — the owner's decision

**Do AI suggestions take family allergies into account?** Today the suggestion prompt carries the
user's own allergies. For a shared or profile slot there are two options:

1. Send only allergen names, merged into one list with no names or notes attached, so suggestions
   avoid them. Requires extending the AI-sharing disclosure.
2. Send nothing about the family. Suggestions may clash, and the local allergen warning catches it
   after the fact.

The design assumes option 2 until the owner rules.

## Left to the builder

Component breakdown, grid scrolling implementation, API route shapes, migration numbering, exact
copy, and where the audience control sits in the add sheet.
