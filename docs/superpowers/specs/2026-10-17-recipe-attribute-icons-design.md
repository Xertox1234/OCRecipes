# Recipe attribute icons — design

**Date:** 2026-10-17 · **Todo:** `todos/P2-2026-10-14-standard-recipe-attribute-icons.md` · **Status:** approved in chat by the owner, section by section (2026-10-17); revised after an advisor review (YELLOW: matcher claim, absence-claim gaps, detail text chips, time field, migration ordering) and three further owner rulings (decisions 7–9); awaits the owner's review.

## Overview

One standard way to show recipe facts as icons: the same icon, colour, word and spoken label for the same fact on every screen. This round covers diet, allergen and "quick" icons on real recipes. Spice level follows as its own todo in the same `/todo-fast` run.

## Owner decisions (2026-10-17)

1. **Where first:** real recipes with a checked ingredient list — the home carousel card, Saved recipes, the Recipe browser, and recipe detail (`RecipeDetailContent`). Idea cards (AI guesses) are out of scope for now.
2. **Which facts:** diet, allergens, quick. Spice level is a followup todo, worked right after this one.
3. **When a tag and the ingredients disagree, or the ingredients have not been checked:** hide the diet icon.
4. **Look:** icon plus a short word, on cards and on detail.
5. **Meat check:** add one. Vegetarian and vegan are separate rules (definitions below, confirmed by the owner).
6. **Approach A:** one shared list plus one rule function in `shared/`; the app draws the icons from raw recipe facts. (Rejected: B — the server sends a finished icon list; C — store the finished icon list per recipe, which goes stale when a rule changes.)
7. **Fix the allergen gaps at the root (after advisor review):** the "Wheat/Gluten" allergen misses barley, rye, beer and soy sauce, and "Dairy/Milk" misses pesto. These go into the allergen keyword lists in this round, so the "Safe for me" filter and the icons are both right. See "Allergen keyword additions".
8. **Checkable diet tags appear only as checked icons.** On recipe detail, a `vegan`, `vegetarian`, `gluten-free` or `dairy-free` tag is never shown as a plain text chip. If its icon is hidden, the word is hidden too. Other tags (italian, keto …) stay as text.
9. **Allergen icons on all nine "Contains:" surfaces**, not only the four in scope.

## Goals

- One shared list of attributes (id → icon, colour token, word, spoken label) that every screen uses.
- A diet icon only ever appears when the recipe's ingredients back it up.
- A missing icon never reads as "free of". Unknown stays unknown.
- Every icon has a word and a spoken label, so colour is never the only signal.

## Out of scope

- Idea cards (`client/components/inspired/SuggestionCard.tsx`).
- Spice level (followup todo).
- Diets we cannot check from ingredients — keto, low-carb, high-protein, paleo — and cuisine words stored in `dietTags` ("italian", "asian"). These get no icon and stay as text on recipe detail, as today. (The four checkable diet tags are the opposite: they leave the text chips, per decision 8.)
- `AllergenBadge` inside `recipe-detail/RecipeIngredientsList.tsx`, which shows the _viewer's_ declared allergies by severity. Unchanged.
- Rewriting stored `dietTags`. They are matched when read; old rows are left alone.

## The attributes

| Id                      | Word                                              | Shows when                                                                                                                                       |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vegetarian`            | Vegetarian                                        | tagged vegetarian **or** vegan, checks known, no `meat`, `poultry`, `animal_derived` conflict, and no `fish` or `shellfish` allergen             |
| `vegan`                 | Vegan                                             | tagged vegan, passes `vegetarian`, no `honey` conflict, no `milk` or `eggs` allergen                                                             |
| `gluten_free`           | Gluten-free                                       | tagged gluten-free, checks known, no `wheat` allergen (oats included, owner ruling 2026-10-16; barley, rye, beer and soy sauce added this round) |
| `dairy_free`            | Dairy-free                                        | tagged dairy-free, checks known, no `milk` allergen                                                                                              |
| `quick`                 | Quick                                             | total minutes known and ≤ 30                                                                                                                     |
| `contains:<allergenId>` | the allergen's label (Peanuts, Tree Nuts, Milk …) | listed in the recipe's derived `allergens`                                                                                                       |

When a recipe passes both vegan and vegetarian, only **Vegan** shows; vegan implies vegetarian.

"Checks known" means **both** `allergens` and the new `dietConflicts` are non-null. If either is `null`, no diet icon shows. Allergen ("contains") icons follow today's rule: `null` or `[]` shows nothing, and nothing is ever shown as "allergen-free".

Quick reads one field, `totalTimeMinutes: number | null`, which every feed sends. The server computes it with one shared function, `toTotalTimeMinutes`: `prepTimeMinutes + cookTimeMinutes` when **both** are known; otherwise the minutes parsed from `timeEstimate`; otherwise `null`. Half a time is never treated as the whole, so 10 minutes of prep with an unknown cook time is not "quick". `null` means no quick icon. The 30-minute cut-off is a named constant.

**Why absence claims need extra care.** The allergen keyword lists were built to flag _presence_: a miss was tolerated, and over-flagging was fine. Gluten-free, dairy-free and vegan turn the same lists into _absence_ claims, so every miss becomes a wrong icon. That is why this round audits the wheat, milk and eggs lists (below) and puts must-not-miss probes in the tests. A list miss found later is a safety defect in the allergen list, fixed there.

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

| Id               | Covers (examples — the keyword list lives in code)                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meat`           | beef, pork, bacon, ham, lamb, veal, venison, sausage, salami, pepperoni, chorizo, prosciutto                                                                                                                                                        |
| `poultry`        | chicken, turkey, duck, goose, quail (but not "quail egg(s)", which is an egg)                                                                                                                                                                       |
| `animal_derived` | gelatin/gelatine, lard, suet, tallow, bone broth, fish sauce, anchovy, Worcestershire sauce, animal rennet; stocks and broths only in animal-specific multi-word form ("chicken stock", "beef broth", "fish stock") — never bare "stock" or "broth" |
| `honey`          | honey                                                                                                                                                                                                                                               |

Fish, shellfish, milk, eggs and wheat are not repeated here: the allergen cache covers them. Gluten grains moved into the wheat allergen (decision 7), so there is no `gluten_grain` id.

- `deriveRecipeDietConflicts(ingredientNames)` lives next to `deriveRecipeAllergens` and uses the same word-boundary matcher (`getKeywordPattern`: both ends must sit at a space, comma, semicolon, slash, parenthesis, hyphen or string edge, so "ham" does not match "graham", nor "goose" "gooseberry"). **The existing plant-qualifier guard does not carry over.** It applies only to milk, cream, butter and flour (`MODIFIER_SENSITIVE_KEYWORDS`, checked 2026-10-17). So diet conflicts get their own small qualifier list, checked the same way (qualifier + space or hyphen + keyword): `vegan`, `vegetarian`, `veggie`, `plant-based`, `meatless`, `meat-free`, `tofu`, `soy`, `seitan`, `mushroom`, `jackfruit`, `vegetable`. "Veggie bacon", "vegan gelatin" and "plant-based sausage" then do not flag. The suppression rule stays narrow: only space or hyphen joins, as in the allergen guard, because suppression is the dangerous direction.
- "Mince" is left out: alone it is ambiguous ("mince pies"), and "beef mince" or "lamb mince" flag through their own word.
- **An empty ingredient list returns `null`**, not `[]`. `deriveRecipeAllergens([])` returns `[]`, which reads as "checked, nothing found". Requiring a non-null `dietConflicts` for every diet icon closes that gap for a recipe saved with no ingredients.
- **Written** at the same six points that write `allergens`: `server/storage/community-recipes.ts` (2), `server/storage/meal-plan-recipes-crud.ts` (3), `server/storage/recipe-from-chat.ts` (1).
- **Migration** `migrations/0028_recipe_diet_conflicts.sql`: `ADD COLUMN IF NOT EXISTS diet_conflicts jsonb` (nullable, no default), on both tables. **Ordering:** once this code deploys, Drizzle selects the new column on both recipe tables, so every recipe query fails until 0028 is on prod. The owner applies 0028 to prod first. The merge waits for the owner's pasted output of an `information_schema.columns` query showing `diet_conflicts` on both tables. A button answer is not evidence (standing rule).
- **Backfill:** extend `server/scripts/backfill-recipe-allergens.ts` to also fill `diet_conflicts`, and to re-derive `allergens` on every row so the keyword additions below reach old recipes. The owner runs it on prod once after merge, then restarts the server (the search index is built at boot). Until it runs, old recipes show no diet icons (the safe direction), and "Safe for me" still has the old gaps for old rows.

### Allergen keyword additions (decision 7)

A probe on 2026-10-17 (`deriveRecipeAllergens` on single ingredients) found these misses: soy sauce → soy only; beer, barley, pesto → nothing. Every other probe flagged correctly: malt vinegar, couscous, semolina, panko, breadcrumbs, pasta, rye bread → wheat; whey, casein, ghee, lactose, parmesan, yogurt → milk; mayonnaise, meringue, albumin → eggs.

- **Wheat/Gluten**, direct tier: `barley`, `rye`, `triticale`, `farro`, `bulgur`, `beer`, `lager`, `stout`, `soy sauce`, `teriyaki`. Bare "ale" is left out, because "ginger ale" has no gluten. "Gluten-free soy sauce" over-flags; that is the safe direction, and accepted.
- **Dairy/Milk**, direct tier: `pesto`. "Vegan pesto" still flags milk (the diet-conflict qualifiers do not touch allergens), so that recipe gets no vegan or dairy-free icon. That over-flag is the safe direction, and accepted.
- These change the "Safe for me" filter too. Same operations as the oats ruling: an app update, the prod backfill, then a server restart.

### Diet tag matcher

`toCheckableDiets(dietTags: string[])` lowercases each tag and drops non-letters, then maps `vegetarian`, `vegan`, `glutenfree` and `dairyfree` to the four ids. Everything else is ignored. No stored data changes.

### Time parser

`parseTimeEstimateMinutes(text: string | null)` reads `timeEstimate` text: "30 min", "45 minutes", "1 hr 15 min", "1 hour". It returns `null` for anything else. It and `toTotalTimeMinutes` are one shared module in `shared/`, used by every feed. The carousel's own inline regex (`carousel-builder.ts`), which today puts the parsed total into a field named `prepTimeMinutes`, is left alone for its existing prep label. The new `totalTimeMinutes` field comes from the shared function.

### Feed changes

| Feed                                                                              | Today                                                       | Adds                                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Home carousel (`shared/types/carousel.ts`, `server/services/carousel-builder.ts`) | `allergens`, `prepTimeMinutes` (parsed from `timeEstimate`) | `dietTags`, `dietConflicts`, `totalTimeMinutes`                                            |
| Saved recipes (`ResolvedFavouriteRecipe`, `server/storage/favourite-recipes.ts`)  | `allergens`                                                 | `dietTags`, `dietConflicts`, `totalTimeMinutes`                                            |
| Recipe browser (`SearchableRecipe`, `server/lib/search-index.ts`)                 | `dietTags`, `allergens`, times (null for community)         | `dietConflicts`; `totalTimeMinutes` filled for community recipes too (from `timeEstimate`) |
| Recipe detail (`RecipeDetailContentProps`, `FeaturedRecipeDetailScreen`)          | `dietTags`, `allergens`, `timeDisplay` text                 | `dietConflicts`, `totalTimeMinutes`                                                        |

## Shared pieces

- **`shared/constants/recipe-attributes.ts`**: the attribute list (id, icon, colour token key, word, spoken label) and `getRecipeAttributes(facts)`, which returns `{ diets: AttributeId[], quick: boolean, contains: AllergenId[] }`. This is the only place that decides what shows. It is pure, so it can be tested on its own.
- **`RecipeAllergenLabel` becomes the "Contains:" group, now with icons.** It is used on nine surfaces (grep, 2026-10-17): the four in scope plus `MealPlanHomeScreen`, `CookbookDetailScreen`, `coach/blocks/RecipeCard`, `recipe-chat/RecipeCard` and `meal-plan/RecipeExtractionReviewCard`. Its chips change from `AllergenBadge` (one Feather icon per severity) to the attribute list's per-allergen icon + word, so every surface shows the same allergen icons. `AllergenBadge` itself is unchanged; the ingredient list still uses it.
- **`client/components/RecipeAttributeRow.tsx`**: diet and quick chips (icon + word), followed by `RecipeAllergenLabel` as a separate group, so a "free of" chip never mixes with a "contains" one. Used on the four in-scope surfaces in place of their bare `RecipeAllergenLabel`. A new file, because `recipe-detail/RecipeMetaChips.tsx` (time, difficulty, servings) is detail-only and the row is also needed on three card types.
- **Recipe detail text chips:** `RecipeDetailContent` drops every tag that `toCheckableDiets` recognises from its text-chip list (decision 8). Only unrecognised tags render as text.
- **Spoken label:** one sentence per row, e.g. "Vegan, gluten-free, quick. Contains: soy." A new `toRecipeAttributeA11ySuffix` builds the diet/quick part and appends today's `toRecipeAllergenA11ySuffix` unchanged, so the "Contains: …" wording stays identical on all nine surfaces. Chips inside an accessible card are hidden from the accessibility tree, the same way `RecipeAllergenLabel` does it today.

## Error handling

- Unknown ids in stored jsonb (`allergens`, `dietConflicts`) are skipped, never dereferenced — the `toRecipeAllergenLabels` precedent. A stale id must not crash a list.
- `null` and malformed data mean no diet icon. They never mean "free of".

## Testing (written first)

- `getRecipeAttributes`: bacon blocks vegetarian; gelatin blocks vegetarian; honey blocks vegan but not vegetarian; eggs block vegan; barley, beer, soy sauce and oats block gluten-free (through the wheat allergen); pesto blocks dairy-free; `null` `dietConflicts` hides every diet; `null` `allergens` hides every diet; a keto tag gives no icon; vegan suppresses vegetarian; 30 minutes is quick and 31 is not; `null` time is not quick.
- `deriveRecipeDietConflicts`: each id from a representative ingredient; an empty list returns `null`. **Must not flag:** "minced garlic", "graham crackers", "gooseberry", "quail eggs", "vegetable broth", "vegetable stock", "mushroom broth", "vegan gelatin", "veggie bacon", "plant-based sausage".
- Allergen additions: each new keyword flags its allergen; "ginger ale" and "buckwheat" do not flag wheat. The existing allergen and "Safe for me" suites stay green.
- `toTotalTimeMinutes`: both halves known → sum; one half only → falls back to the text; neither → `null`.
- `parseTimeEstimateMinutes` and `toCheckableDiets`: the formats listed above.
- `RecipeDetailContent`: a recognised diet tag never renders as a text chip.
- One render test of a real card (`CarouselRecipeCard`) showing the row and its spoken label.

## Followup (same run)

Spice level: a new saved field worked out per recipe, plus a backfill, and its icon added to this same list (`chili-mild`, `chili-medium`, `chili-hot`).
