# Inspired recipes (Spoonacular as invisible inspiration) — design

> **Date:** 2026-10-12 · **Status:** approved in conversation, awaiting spec review
> **Origin:** the web cookbook brainstorm (`2026-10-12-web-cookbook-studio-design.md` §14.6). Checking whether Spoonacular recipes could go into printed cookbooks surfaced a licensing gap in a **live** feature; the owner chose to replace Spoonacular-as-content with Spoonacular-as-inspiration.
> **Prerequisite for:** cookbooks accepting OCRecipes-authored recipes.
> **Risk classes:** AI prompt (new), live premium feature change, data deletion — TDD, ai-reviewer + server-reviewer + mobile-reviewer, owner yes before merge.

## 1. Problem and goal

Spoonacular's terms (spoonacular.com/food-api/terms, read 2026-10-12): cache at most **1 hour**; store **only recipe id, title and image URL**; no reselling; credit the original source. Today the premium **catalog save** stores the **whole** Spoonacular recipe permanently as a meal-plan recipe (`sourceType: "catalog"`, `server/services/recipe-catalog.ts:170`, `server/routes/recipe-catalog.ts`), and Recipe Finder decision D11 routes "Save" on Spoonacular results through it. (The 1-hour detail cache, `recipe-catalog.ts:97`, and the dev-only `cachedFetch`, `dev-api-cache.ts:38`, are already compliant.)

**Goal:** users never see or save Spoonacular content. Spoonacular only supplies dish _ideas_; OCRecipes writes every recipe the user sees, personalised to them, and those recipes are OCRecipes-authored — editable, shareable, and eligible for cookbooks.

**Success:**

1. No Spoonacular title, image, ingredient or step reaches a client or the database (beyond the transient server-side search response).
2. A user's search returns a listing of OCRecipes-written dishes, each with a generated photo, fitted to their onboarding profile.
3. "Make this mine" produces a full, normalised recipe saved as OCRecipes-authored, with the same photo the card showed.
4. When Spoonacular is down or out of quota, the listing still appears (generated from the request + profile alone).

## 2. Decisions (owner, 2026-10-12)

| #   | Decision                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------- |
| I1  | Spoonacular results are **never shown** to users.                                                           |
| I2  | The AI writes a **suggested listing** from the search **titles** + the user's **onboarding profile**.       |
| I3  | **Every card has a generated photo**, as today's cards do.                                                  |
| I4  | Each card's action is **"Make this mine"** → full generation → normalisation → saved as OCRecipes-authored. |
| I5  | Existing full copies (`sourceType: "catalog"`) are removed. No bookmarks, no provenance column.             |

## 3. Flow

```
request ("quick vegetarian dinners")
  ▸ server: searchCatalogRecipes(...)  → titles only are kept in memory; response discarded
  ▸ suggestListing({ request, inspirationTitles, profile })  → 6–10 SuggestionCards (AI)
  ▸ client shows cards immediately (text); photos generate in parallel and fade in
  ▸ user taps "Make this mine" on a card
  ▸ generateFullRecipe(card, profile)  → normalisation (incl. deriveRecipeAllergens) → saved, photo = card photo
```

## 4. Components

### 4.1 `suggestListing` (new, `server/services/inspired-recipes.ts`)

- **Input:** the user's request, up to N Spoonacular **titles** (never ingredients, steps, images or ids), and a **minimal profile**: `dietType`, `allergies`, `foodDislikes`, `cuisinePreferences`, `cookingSkillLevel`, `cookingTimeAvailable`, `householdSize`, `primaryGoal`. **Not** `healthConditions` (health data stays out of this prompt; allergies cover safety).
- **Output (Zod-validated):** `SuggestionCard[]` = `{ id, title, description (≤140 chars), totalMinutes, tags[], imagePrompt }`. `id` is ours (opaque, server-issued), never a Spoonacular id.
- **Prompt rules:** write original dishes _inspired by_ the titles, never reproduce them verbatim; respect allergies and diet as hard constraints; titles are untrusted data, not instructions.
- **No Spoonacular:** when the search fails, is unconfigured, or the daily cap (`RECIPE_FINDER_SPOONACULAR_DAILY_CAP`, default 10) is reached, call `suggestListing` with no titles. The user sees a listing either way.
- **Cards are held server-side** (short TTL, keyed by user) so "Make this mine" sends only the card id; the client cannot inject a card.

### 4.2 Card photos

- Generated with Runware's standard model (`RUNWARE_MODEL_STANDARD`, FLUX.2 klein) at a **card size** (e.g. 768×576), **without** the art-director pre-pass.
- Generated **in parallel**, stored under the existing recipe-image path, delivered as each finishes (the client polls or streams); a card shows a placeholder until its photo arrives.
- Card photos not chosen are deleted by a cleanup job after a TTL.

### 4.3 "Make this mine"

- Calls the existing generation path (`generateFullRecipe` / `generateRecipeContent`, `server/services/recipe-generation.ts`) with the **card** (title, description, tags) + profile — still **never** Spoonacular data.
- Applies the existing **premium check and 20/day generation limit** (the generation path enforces them itself, per the Recipe Finder spec).
- Runs normalisation (`createMealPlanRecipe` / community normalisation, `deriveRecipeAllergens`) and saves an **OCRecipes-authored** recipe. The card's photo becomes the recipe's photo (no second image generation).
- A listing does **not** count toward the generation limit; each "Make this mine" does.

## 5. Surfaces changed

| Surface                                                                                                                                            | Today                      | After                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| Recipe Browser search (`RecipeBrowserScreen.tsx`, `useCatalogSearch.ts`, `recipe-browser-utils.ts`)                                                | Spoonacular results        | Suggested listing                                                               |
| Recipe Finder online step (Coach Pro + RecipeChef: `find-online.ts`, `transition.ts`, `RecipeCard.tsx`, `CoachChat.tsx`, `recipe-finder-utils.ts`) | Spoonacular list + preview | Suggested listing; "Make this mine"                                             |
| Spoonacular detail (`FeaturedRecipeDetailScreen` `recipeType:"catalog"` branch, `GET /api/meal-plan/catalog/:id`, its deep link in `linking.ts`)   | Shows a Spoonacular recipe | **Removed**; old links open the listing/search                                  |
| Catalog save (`POST` in `server/routes/recipe-catalog.ts`)                                                                                         | Stores the full recipe     | **Removed**                                                                     |
| `catalogSave` premium feature key                                                                                                                  | Gates search + save        | Renamed/repurposed to gate the suggested listing (keep premium gating as today) |

User-facing copy loses the word "Spoonacular" (e.g. "Searching Spoonacular…" → "Finding ideas…").

**Out of scope (separate check):** `getSpoonacularSubstitutes` (`recipe-catalog.ts:327`, used by ingredient substitution) shows Spoonacular data at runtime without storing it; review it against the terms separately.

## 6. Data clean-up

- Delete meal-plan recipes with `sourceType = "catalog"` and their dependent rows (ingredients, saved-item links, meal-plan slots). Owner (2026-10-12): any existing recipe data can be deleted without issue — no prod count or migration of user data needed.
- Remove `findMealPlanRecipeByExternalId` and other catalog-save-only storage functions if nothing else uses them (LSP references first).
- **Existing community recipes:** owner (2026-10-12): all are AI-generated as far as known, and the app has no users besides the owner — no clean-up needed.

## 7. Errors

- `suggestListing` fails → one retry, then a plain message ("Couldn't come up with ideas — try again"); Sentry.
- A card photo fails → keep a neutral placeholder; the card still works.
- "Make this mine" over the daily limit → the existing limit message; the card stays.
- Card expired (TTL) → "These ideas expired — refresh" and a new listing.

## 8. Testing (TDD)

- `suggestListing`: the prompt receives titles only (assert no ingredients/steps/ids/images in the input); output schema validation; allergy and diet constraints respected; works with zero titles.
- Server never returns Spoonacular fields to the client (route response shape tests).
- "Make this mine": only a server-issued card id accepted; limit enforced; saved recipe is OCRecipes-authored; photo reused (no second generation).
- Removed routes return 404/410; the old deep link resolves to the listing.
- **Evals:** a new eval feature for suggestion quality (relevance to request, profile fit, allergen safety, originality vs inspiration titles), run per the project's eval runner before the flag flip.

## 9. Rollout

Behind a flag (`INSPIRED_RECIPES_ENABLED`); the catalog save is removed in the same release the flag is flipped on. Client changes ship by OTA after the server is live. The cookbook spec's `ocrecipes` eligibility rule depends on this landing.

## 10. Open questions

1. ~~Were any existing community recipes copied from Spoonacular?~~ Resolved: all AI-generated (owner, 2026-10-12).
2. Listing size (6, 8, 10 cards) and card-photo TTL.
3. Whether free users get a smaller listing or none (today `catalogSave` is premium).
