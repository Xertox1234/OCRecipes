# Recipe attribute icons — design

**Date:** 2026-10-17 · **Todo:** `todos/P2-2026-10-14-standard-recipe-attribute-icons.md` · **Status:** approved in chat by the owner, section by section (2026-10-17); this file awaits the owner's review.

## Overview

One standard way to show recipe facts as icons: the same icon, colour, word and spoken label for the same fact on every screen. This round covers diet, allergen and "quick" icons on real recipes. Spice level follows as its own todo in the same `/todo-fast` run.

## Owner decisions (2026-10-17)

1. **Where first:** real recipes with a checked ingredient list — the home carousel card, Saved recipes, the Recipe browser, and recipe detail (`RecipeDetailContent`). Idea cards (AI guesses) are out of scope for now.
2. **Which facts:** diet, allergens, quick. Spice level is a followup todo, worked right after this one.
3. **When a tag and the ingredients disagree, or the ingredients have not been checked:** hide the diet icon.
4. **Look:** icon plus a short word, on cards and on detail.
5. **Meat check:** add one. Vegetarian and vegan are separate rules (definitions below, confirmed by the owner).
6. **Approach A:** one shared list plus one rule function in `shared/`; the app draws the icons from raw recipe facts. (Rejected: B — the server sends a finished icon list; C — store the finished icon list per recipe, which goes stale when a rule changes.)

## Goals

- One shared list of attributes (id → icon, colour token, word, spoken label) that every screen uses.
- A diet icon only ever appears when the recipe's ingredients back it up.
- A missing icon never reads as "free of". Unknown stays unknown.
- Every icon has a word and a spoken label, so colour is never the only signal.

## Out of scope

- Idea cards (`client/components/inspired/SuggestionCard.tsx`).
- Spice level (followup todo).
- Diets we cannot check from ingredients — keto, low-carb, high-protein, paleo — and cuisine words stored in `dietTags` ("italian", "asian"). These get no icon and stay as text on recipe detail, as today.
- `AllergenBadge` inside `recipe-detail/RecipeIngredientsList.tsx`, which shows the _viewer's_ declared allergies by severity. Unchanged.
- Rewriting stored `dietTags`. They are matched when read; old rows are left alone.

## The attributes

| Id                      | Word                                              | Shows when                                                                                                                           |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `vegetarian`            | Vegetarian                                        | tagged vegetarian **or** vegan, checks known, no `meat`, `poultry`, `animal_derived` conflict, and no `fish` or `shellfish` allergen |
| `vegan`                 | Vegan                                             | tagged vegan, passes `vegetarian`, no `honey` conflict, no `milk` or `eggs` allergen                                                 |
| `gluten_free`           | Gluten-free                                       | tagged gluten-free, checks known, no `wheat` allergen (oats included, owner ruling 2026-10-16), no `gluten_grain` conflict           |
| `dairy_free`            | Dairy-free                                        | tagged dairy-free, checks known, no `milk` allergen                                                                                  |
| `quick`                 | Quick                                             | total minutes known and ≤ 30                                                                                                         |
| `contains:<allergenId>` | the allergen's label (Peanuts, Tree Nuts, Milk …) | listed in the recipe's derived `allergens`                                                                                           |

When a recipe passes both vegan and vegetarian, only **Vegan** shows; vegan implies vegetarian.

"Checks known" means **both** `allergens` and the new `dietConflicts` are non-null. If either is `null`, no diet icon shows. Allergen ("contains") icons follow today's rule: `null` or `[]` shows nothing, and nothing is ever shown as "allergen-free".

Quick: `prepTimeMinutes + cookTimeMinutes` when at least one is known (an unknown half counts as 0 only when the other is known), otherwise the minutes parsed from `timeEstimate`. If nothing can be read, there is no quick icon. The 30-minute cut-off is a named constant.

### Icons

From `MaterialCommunityIcons` (already bundled in `@expo/vector-icons`; every name below was checked against its glyph map on 2026-10-17):

| Id          | Icon                                                                               |
| ----------- | ---------------------------------------------------------------------------------- |
| vegetarian  | `leaf`                                                                             |
| vegan       | `sprout`                                                                           |
| gluten_free | `barley-off`                                                                       |
| dairy_free  | `cheese-off`                                                                       |
| quick       | `timer-outline`                                                                    |
| peanuts     | `peanut`                                                                           |
| tree_nuts   | `nut`                                                                              |
| milk        | `cheese`                                                                           |
| eggs        | `egg-outline`                                                                      |
| wheat       | `barley`                                                                           |
| soy         | `soy-sauce`                                                                        |
| fish        | `fish`                                                                             |
| shellfish   | `jellyfish-outline` — the set has no shellfish glyph; the word carries the meaning |
| sesame      | `seed-outline` — the set has no sesame glyph; the word carries the meaning         |

### Colours

- Diet chips: `success` (WCAG AA on both themes per `client/constants/theme.ts`).
- Quick: `textSecondary`.
- Contains chips: today's `getAllergenBadgeVisuals("mild")` colour and `ALLERGEN_BADGE_FILL_OPACITY`, so the existing contrast test still covers them.

## Data

### New derived cache: `dietConflicts`

A new nullable jsonb column, `diet_conflicts`, on `community_recipes` and `meal_plan_recipes`, type `DietConflictId[] | null`:

| Id               | Covers (examples — the keyword list lives in code)                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `meat`           | beef, pork, bacon, ham, lamb, veal, venison, sausage, salami, pepperoni, chorizo, prosciutto, mince                                          |
| `poultry`        | chicken, turkey, duck, goose, quail                                                                                                          |
| `animal_derived` | gelatin/gelatine, lard, suet, tallow, beef/chicken/fish stock or broth, bone broth, fish sauce, anchovy, Worcestershire sauce, animal rennet |
| `honey`          | honey                                                                                                                                        |
| `gluten_grain`   | barley, rye, triticale, farro, bulgur — any gluten grain not already a `wheat` allergen keyword                                              |

Fish, shellfish, milk, eggs and wheat are not repeated here: the allergen cache already covers them.

- `deriveRecipeDietConflicts(ingredientNames)` lives next to `deriveRecipeAllergens` and reuses its keyword matcher (`ingredientContainsKeyword`, which handles plant qualifiers such as "vegetable broth" and "almond milk"). Keywords need the same plant-qualifier care: "vegetable stock", "mushroom broth" and "vegan gelatin" must not flag.
- **An empty ingredient list returns `null`**, not `[]`. `deriveRecipeAllergens([])` returns `[]`, which reads as "checked, nothing found". Requiring a non-null `dietConflicts` for every diet icon closes that gap for a recipe saved with no ingredients.
- **Written** at the same six points that write `allergens`: `server/storage/community-recipes.ts` (2), `server/storage/meal-plan-recipes-crud.ts` (3), `server/storage/recipe-from-chat.ts` (1).
- **Migration** `migrations/0028_recipe_diet_conflicts.sql`: `ADD COLUMN IF NOT EXISTS diet_conflicts jsonb` (nullable, no default), on both tables. Additive, so it is applied to prod before the PR merges (the 0026 ordering note).
- **Backfill:** extend `server/scripts/backfill-recipe-allergens.ts` to also fill `diet_conflicts`, run on prod once after merge. Until it runs, old recipes show no diet icons, which is the safe direction.

### Diet tag matcher

`toCheckableDiets(dietTags: string[])` lowercases each tag and drops non-letters, then maps `vegetarian`, `vegan`, `glutenfree` and `dairyfree` to the four ids. Everything else is ignored. No stored data changes.

### Time parser

`parseTimeEstimateMinutes(text: string | null)` reads `timeEstimate` text: "30 min", "45 minutes", "1 hr 15 min", "1 hour". It returns `null` for anything else. One shared parser in `shared/`.

### Feed changes

| Feed                                                                              | Today                                                       | Adds                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Home carousel (`shared/types/carousel.ts`, `server/services/carousel-builder.ts`) | `allergens`, `prepTimeMinutes` (parsed from `timeEstimate`) | `dietTags`, `dietConflicts`                                      |
| Saved recipes (`ResolvedFavouriteRecipe`, `server/storage/favourite-recipes.ts`)  | `allergens`                                                 | `dietTags`, `dietConflicts`, `totalTimeMinutes`                  |
| Recipe browser (`SearchableRecipe`, `server/lib/search-index.ts`)                 | `dietTags`, `allergens`, times (null for community)         | `dietConflicts`; community times from `parseTimeEstimateMinutes` |
| Recipe detail (`RecipeDetailContentProps`, `FeaturedRecipeDetailScreen`)          | `dietTags`, `allergens`, `timeDisplay` text                 | `dietConflicts`, `totalTimeMinutes`                              |

## Shared pieces

- **`shared/constants/recipe-attributes.ts`**: the attribute list (id, icon, colour token key, word, spoken label) and `getRecipeAttributes(facts)`, which returns `{ diets: AttributeId[], quick: boolean, contains: AllergenId[] }`. This is the only place that decides what shows. It is pure, so it can be tested on its own.
- **`RecipeAllergenLabel` becomes the "Contains:" group, now with icons.** It is used on nine surfaces (grep, 2026-10-17): the four in scope plus `MealPlanHomeScreen`, `CookbookDetailScreen`, `coach/blocks/RecipeCard`, `recipe-chat/RecipeCard` and `meal-plan/RecipeExtractionReviewCard`. Its chips change from `AllergenBadge` (one Feather icon per severity) to the attribute list's per-allergen icon + word, so every surface shows the same allergen icons. `AllergenBadge` itself is unchanged; the ingredient list still uses it.
- **`client/components/RecipeAttributeRow.tsx`**: diet and quick chips (icon + word), followed by `RecipeAllergenLabel` as a separate group, so a "free of" chip never mixes with a "contains" one. Used on the four in-scope surfaces in place of their bare `RecipeAllergenLabel`.
- **Spoken label:** one sentence per row, e.g. "Vegan, gluten-free, quick. Contains: soy." A new `toRecipeAttributeA11ySuffix` builds the diet/quick part and appends today's `toRecipeAllergenA11ySuffix` unchanged, so the "Contains: …" wording stays identical on all nine surfaces. Chips inside an accessible card are hidden from the accessibility tree, the same way `RecipeAllergenLabel` does it today.

## Error handling

- Unknown ids in stored jsonb (`allergens`, `dietConflicts`) are skipped, never dereferenced — the `toRecipeAllergenLabels` precedent. A stale id must not crash a list.
- `null` and malformed data mean no diet icon. They never mean "free of".

## Testing (written first)

- `getRecipeAttributes`: bacon blocks vegetarian; gelatin blocks vegetarian; honey blocks vegan but not vegetarian; eggs block vegan; barley and oats block gluten-free; `null` `dietConflicts` hides every diet; `null` `allergens` hides every diet; a keto tag gives no icon; vegan suppresses vegetarian; 30 minutes is quick and 31 is not; unknown time is not quick.
- `deriveRecipeDietConflicts`: each id from a representative ingredient; plant qualifiers don't flag ("vegetable broth", "vegan gelatin"); an empty list returns `null`.
- `parseTimeEstimateMinutes` and `toCheckableDiets`: the formats listed above.
- One render test of a real card (`CarouselRecipeCard`) showing the row and its spoken label.

## Followup (same run)

Spice level: a new saved field worked out per recipe, plus a backfill, and its icon added to this same list (`chili-mild`, `chili-medium`, `chili-hot`).
