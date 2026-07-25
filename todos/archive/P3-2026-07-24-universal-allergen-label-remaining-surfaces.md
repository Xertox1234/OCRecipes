---
title: "Universal 'Contains: <allergen>' label — remaining surfaces needing data plumbing"
status: done
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, client, server, allergen, safety]
github_issue:
---

# Universal "Contains: <allergen>" label — remaining surfaces needing data plumbing

## Summary

Extend the universal, profile-independent "Contains: <allergen>" label (shipped
in the parent todo, `P2-2026-07-20-universal-contains-allergen-label-recipes`) to
the recipe-display surfaces that could NOT be wired in that PR because their
recipe DTO does not yet carry the derived `allergens` field — each needs
server-side data plumbing (or, for the streaming card, a new pre-persist channel)
first.

## Background

The parent todo (merged as the `RecipeAllergenLabel` component +
`recipe-allergen-label-utils.ts`) wired the universal label into every surface
whose recipe object already carries `allergens: DerivedRecipeAllergen[] | null`:
`RecipeDetailContent`, `FeaturedRecipeDetailScreen`, and `RecipeBrowserScreen`'s
`UnifiedRecipeCard`. Its Scope Contract was client-display-only ("no new
mechanisms," `shared/constants/allergens.ts` read-only), so the surfaces below —
flagged by the `code-reviewer` and confirmed by the `Plan`/advisor pass during
that run — were deliberately deferred here rather than done with forbidden
server changes:

- **`client/components/recipe-chat/RecipeCard.tsx`** — renders a pre-persist
  `StreamingRecipe` (`client/hooks/useChat.ts`). `deriveRecipeAllergens` only runs
  server-side at _save_ time, so this card has no derived array to read. Wiring it
  needs a NEW server-side SSE payload field computed pre-save (a new mechanism the
  parent's Scope Contract excluded). **Note:** this surface was _listed_ in the
  parent todo's "Confirmed recipe display surfaces to cover" but is structurally
  unreachable within that todo's own Scope Contract — an internal contradiction
  surfaced for the human reviewer, resolved by deferring it here.
- **`client/screens/FavouriteRecipesScreen.tsx`** (`ResolvedFavouriteRecipe`,
  `shared/schema.ts`) — the resolved DTO built in
  `server/storage/favourite-recipes.ts` omits `allergens`.
- **`client/screens/meal-plan/CookbookDetailScreen.tsx`**
  (`ResolvedCookbookRecipe`, `shared/schema.ts`) — the resolved DTO built in
  `server/storage/cookbooks.ts` omits `allergens`.
- **`client/components/home/CarouselRecipeCard.tsx`** (`CarouselRecipeCard`,
  `shared/types/carousel.ts`) — the DTO built in
  `server/services/carousel-builder.ts` omits `allergens`.
- **`client/components/coach/blocks/RecipeCard.tsx`** — LLM-authored coach summary
  block (`shared/schemas/coach-blocks.ts`) with no ingredient/allergen data; would
  require the coach-block generator to look up the referenced recipe and attach
  allergens.
- **`client/components/meal-plan/RecipeExtractionReviewCard.tsx`** — pre-save
  extraction review, same class as the streaming card.
- **(SUGGESTION, lower priority)** `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  `MealSlotItem` — a compact slot row, not a full browsing card; sweep alongside
  the above.

This is the parent todo's own named "Surface completeness" risk. It is NOT a
regression (these surfaces render nothing today, exactly as before) and does NOT
violate the fail-dangerous invariant (nothing renders a false "safe" signal) —
it is a coverage extension.

## Acceptance Criteria

- [ ] `FavouriteRecipesScreen`, `CookbookDetailScreen`, and `CarouselRecipeCard`
      render the universal `RecipeAllergenLabel` (reusing the existing component),
      after their resolved-recipe DTOs are extended to carry the already-persisted
      `allergens` cache (`DerivedRecipeAllergen[] | null`) — select/map the column
      in the backing storage/service query; do NOT re-derive client-side.
- [ ] The `null` vs `[]` vs non-empty trichotomy is preserved end-to-end through
      each new DTO (no `?? []` coercion) so the fail-dangerous invariant survives.
- [ ] `recipe-chat/RecipeCard` (streaming) and `RecipeExtractionReviewCard`
      (pre-save): DECIDE per surface whether a pre-persist allergen channel is
      worth the new mechanism; if not, leave them explicitly out of scope with a
      one-line code comment noting why (no persisted derived data). No false "safe"
      signal either way.
- [ ] Coach summary `RecipeCard`: DECIDE whether the coach-block generator should
      attach allergens; if deferred, document why.
- [ ] For any card nested in an `accessible` `Pressable` (as on the browse
      screen), fold the composed allergen text into the card's own
      `accessibilityLabel` via `toRecipeAllergenLabels` — the nested component's
      own a11y container is swallowed by the parent focus stop (see the parent
      PR's fix in `RecipeBrowserScreen` and
      `docs/solutions/logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md`).
- [ ] Server-DTO changes covered by tests; client wiring covered per the parent's
      render-test pattern where a testable surface exists.

## Implementation Notes

- Reuse the shipped `RecipeAllergenLabel` (`client/components/RecipeAllergenLabel.tsx`)
  and `toRecipeAllergenLabels` (`client/components/recipe-allergen-label-utils.ts`)
  — no new component, no re-derivation.
- The server work is the crux: extend the resolved-recipe query builders to
  select and carry `allergens`. Touching `server/storage/*` and
  `server/services/carousel-builder.ts` means this todo is NOT client-only and
  should get `server-reviewer` in its review roster.
- `safety`-labeled → individual human review required; never auto-merge.
- Mind DB-serial concerns only if any schema change is needed (none expected —
  the `allergens` column already exists on `communityRecipes`/`mealPlanRecipes`;
  this is a SELECT/projection change, not a migration).

## Scope Contract

- **Mechanisms to use:** the existing `RecipeAllergenLabel` component +
  `toRecipeAllergenLabels` util + the already-persisted `allergens` column. Extend
  resolved-recipe DTOs/queries to carry the column. No new allergen engine, no
  client-side re-derivation, no schema migration.
- **Files in scope:** the client display components/screens listed above and their
  render tests; the backing server storage/service query builders
  (`server/storage/favourite-recipes.ts`, `server/storage/cookbooks.ts`,
  `server/services/carousel-builder.ts`, and the resolved-recipe DTO types in
  `shared/schema.ts` / `shared/types/carousel.ts`) plus their tests.
- **Out of scope:** changing how `deriveRecipeAllergens` computes allergens; the
  personalized `AllergenWarningBanner`; any DB migration.

## Dependencies

- Soft: parent todo `P2-2026-07-20-universal-contains-allergen-label-recipes`
  (merged) provides the reusable component + util this builds on.

## Risks

- **False safety signal** — same fail-dangerous invariant as the parent: a DTO
  that fails to carry `allergens` must surface as `null` (renders nothing), never
  coerced to `[]` (which reads as "verified, none"). Verify each new plumbing path.
- Scope creep into a re-derivation shortcut — resist; plumb the persisted column.

## Updates

### 2026-07-24

- Filed from the parent todo's `/todo-fast` run. Deferred here because these
  surfaces need server-DTO plumbing (or a new pre-persist channel) that the
  parent's client-only Scope Contract excluded. Surfaced by the `code-reviewer`
  WARNING + advisor scope-boundary review.

### 2026-07-24 (implementation)

- Implemented. `FavouriteRecipesScreen`, `CookbookDetailScreen`, and
  `CarouselRecipeCard` now render `RecipeAllergenLabel`, sourced from their
  resolved-recipe DTOs extended to carry `allergens: DerivedRecipeAllergen[] |
null` — `server/storage/favourite-recipes.ts` and
  `server/storage/cookbooks.ts` select/carry the column; the carousel path
  required touching `server/storage/carousel.ts` (the actual `CAROUSEL_COLUMNS`
  projection) in addition to the named `server/services/carousel-builder.ts`,
  and `client/components/meal-plan/recipe-discovery-utils.ts`'s `toCarouselCard`
  (a second `CarouselRecipeCard` construction site, forced by making the field
  required) — both are mechanism-required extensions of the contract's own
  "extend resolved-recipe DTOs/queries to carry the column" clause, not new
  mechanisms; confirmed by `code-reviewer` and `server-reviewer` (no CRITICAL
  findings). Verified end-to-end: DB column populated on write for both
  mealPlan (`meal-plan-recipes-crud.ts`) and community
  (`community-recipes.ts`) recipes, with `backfill-recipe-allergens.ts` for
  historical rows; server routes pass the DTO straight through
  (`res.json(...)`, no field-picks); client hooks do a bare `res.json()` with
  no Zod response-schema stripping — the field survives the full wire path.
  The a11y-fold pattern (compose the allergen text into the card's own
  `accessibilityLabel`, since an `accessible`-by-default Pressable swallows a
  nested label's own container) is applied to all three required surfaces plus
  a bonus `MealPlanHomeScreen` `MealSlotItem` slot row (full treatment —
  visible label + fold). `recipe-chat/RecipeCard`, `RecipeExtractionReviewCard`,
  and coach `RecipeCard` each got a one-line explanatory comment and were left
  unwired (no persisted derived data pre-save / LLM-authored block, per the
  todo's own framing). Fail-dangerous trichotomy (`null`/`[]`/non-empty, never
  `?? []`) verified with real-DB tests in `favourite-recipes.test.ts`,
  `cookbooks.test.ts`, `carousel.test.ts` (storage), `carousel-builder.test.ts`
  (service), and render-test `accessibilityLabel` assertions in
  `FavouriteRecipesScreen.test.tsx`, `CarouselRecipeCard.test.tsx`, and a new
  `CookbookDetailScreen.test.tsx` (added mid-review in response to a
  `code-reviewer` WARNING about missing coverage on that surface). Review:
  `code-reviewer` + `server-reviewer` + `mobile-reviewer`, zero CRITICAL, one
  WARNING (CookbookDetailScreen coverage gap — fixed), plus SUGGESTIONs — see
  deferred items below.
- **Deferred, out of scope, surfaced for human review** (not fixed in this
  PR): `mobile-reviewer` found a **pre-existing** (confirmed byte-identical
  in the diff, only reindented) accessibility defect in
  `client/screens/meal-plan/CookbookDetailScreen.tsx`'s "Remove" button — it's
  a bare nested `Pressable` inside an `accessible`-by-default card Pressable,
  so it's swallowed the same way `FavouriteRecipesScreen`'s equivalent button
  was before that screen's own (separate, already-merged) `accessibilityActions`
  fix. Not this todo's scope (unrelated to allergen labels); a screen-reader
  user with default motion settings currently has no way to remove a recipe
  from a cookbook via this row. Left for the human to decide/file.
- **Filed as a low-severity follow-up**:
  `todos/P3-2026-07-24-carousel-card-double-period-empty-reason.md` — a
  pre-existing (not introduced here) double-period formatting glitch in
  `CarouselRecipeCard`'s composed `accessibilityLabel` when
  `recommendationReason` is empty.
- **Not covered by a test** (judgment call, `DEFERRED_WARNING`):
  `MealPlanHomeScreen`'s `MealSlotItem` allergen-label wiring — the existing
  `MealPlanHomeScreen.test.tsx` is narrowly scoped to `useSheetBackHandler`
  wiring with `useMealPlanItems` mocked to an empty array, not a drop-in fit
  for asserting on rendered meal-slot items; extending it would require a
  materially different test harness than the other three surfaces' direct
  mirror of `FavouriteRecipesScreen.test.tsx`. This surface is itself listed
  as "(SUGGESTION, lower priority)" in the original Background, not an
  Acceptance Criteria checkbox.
