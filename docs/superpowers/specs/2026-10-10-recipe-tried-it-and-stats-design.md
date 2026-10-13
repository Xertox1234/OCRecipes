# Recipe "I tried it" + community stats

**Status:** design approved in chat 2026-10-10; advisor review applied and Q1/Q2 ruled 2026-10-10; awaiting owner approval of this written spec
**Scope:** first social feature. A one-tap "I tried it" endorsement and a small community-stats section on public community recipes.

## 1. Problem and goal

The app has no social signal a user can see. Recipes cannot show that other people cooked or liked them, and the owner cannot tell which recipes are getting attention.

Goals:

1. A user can tell the community "I tried it" with one tap, and take it back with another.
2. Each public recipe shows how many people tried it, favourited it, and remixed it, without competing with the recipe itself.
3. The stored data can later support a recipe leaderboard (e.g. "most tried this week") with no rework.

Success: on a public community recipe, the "I tried it" bar is visible from any scroll position, the count updates instantly, and the stats section near the bottom reflects real, current numbers.

## 2. Owner rulings (2026-10-10)

| #   | Ruling                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Only **publicly available community recipes** get "I tried it" and stats. Private community recipes, the user's own meal-plan recipes and catalog (third-party) previews get neither.                                      |
| R2  | "I tried it" works like a **like button**: one tap on, one tap off, one vote per person. No rating, note or photo.                                                                                                         |
| R3  | **Leaderboard is deferred.** This build stores the data so that a leaderboard can be added later.                                                                                                                          |
| R4  | "Available variants" is **dropped** (no such concept exists in the data). "Community variants" = **public remixes** (`community_recipes.remixedFromId`).                                                                   |
| R5  | Three core stats are always visible: **Tried it · Favourited · Community variants**. ~~A "More stats" drawer (meal-plan adds, Cook-mode logs)~~ **dropped 2026-10-10** (see §10 Q1): neither counter has a working source. |
| R6  | Zero counts become **invitations** ("Be the first", "Not yet", "Remix it ›"), never a bare `0`.                                                                                                                            |
| R7  | The "I tried it" button lives in a **sticky bottom bar** (mockup option C).                                                                                                                                                |
| R8  | The stats section uses **list rows** (mockup option B), placed near the bottom of the recipe.                                                                                                                              |
| R9  | Counts are **computed from rows on read** (approach 1). No stored running totals.                                                                                                                                          |

Decisions made with no objection from the owner:

- Catalog previews are excluded. They are not our rows, and saving one creates a private meal-plan copy.
- The hidden `popularityScore` and its increment-only counters are **not changed**. "I tried it" does not feed the score, because toggling would inflate an increment-only number. The future leaderboard ranks from `recipe_tries` instead.
- Tapping "Community variants" opens a simple list screen of the public remixes.

## 3. Current state (verified 2026-10-10)

- `community_recipes` (`shared/schema.ts` ~828) has `isPublic`, `remixedFromId`/`remixedFromTitle`, and increment-only counters `popularityFavorites`, `popularityMealPlans`, `popularityCookSessions`, `popularityScore`.
- `incrementRecipePopularity` (`server/storage/canonical-recipes.ts:14`) is called on favourite-add (`server/storage/favourite-recipes.ts:117`), meal-plan add (`server/routes/meal-plan.ts:264`) and Cook-mode log (`server/routes/cooking.ts:486`). **Nothing ever decrements a counter**, so favourite → unfavourite → favourite counts twice. `popularityFavorites` must therefore not be shown to users. The visible favourite count comes from `favourite_recipes` rows.
- `favourite_recipes` has `unique(userId, recipeId, recipeType)` and an index on `userId` only. Nothing serves "count by recipe".
- `community_recipes.remixedFromId` has no index.
- `GET /api/recipes/:id` (`server/routes/recipes.ts:321`) returns 404 for a private recipe unless the caller is its author (defense in depth at `:344`). Authors can change sharing (`recipes.ts` ~259).
- The recipe screen is `FeaturedRecipeDetailScreen` → `RecipeDetailContent`. Catalog recipes already have a sticky bottom save bar (`styles.saveBar`, `SAVE_BAR_HEIGHT`, `contentPaddingBottom`). The remix lineage link ("Remixed from …") and the "Remix this recipe" entry already exist in `RecipeDetailContent`.
- The favourite toggle hook (`client/hooks/useFavouriteRecipes.ts:85`) uses an optimistic `onMutate` with rollback. "I tried it" copies this pattern.

## 4. Data model

New table `recipe_tries` in `shared/schema.ts`:

| Column      | Type                                                            | Notes                                          |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `id`        | serial PK                                                       |                                                |
| `userId`    | varchar → `users.id`, `onDelete: cascade`, not null             |                                                |
| `recipeId`  | integer → `community_recipes.id`, `onDelete: cascade`, not null |                                                |
| `createdAt` | timestamptz, default now, not null                              | supports "this week" leaderboard windows later |

Constraints and indexes:

- `unique("recipe_tries_user_recipe_uniq").on(userId, recipeId)`: one vote per person per recipe.
- `index("recipe_tries_recipe_created_idx").on(recipeId, createdAt)`: count by recipe, and count by recipe within a time window.
- A cross-recipe "most tried this week" leaderboard scans every try in a window and wants an index led by `createdAt`. That index is **not** added now. The leaderboard spec adds it, which is purely additive (no data change, no rework).

New indexes on existing tables (additive only):

- `favourite_recipes`: `index("favourite_recipes_recipe_idx").on(recipeId, recipeType)`.
- `community_recipes`: `index("community_recipes_remixed_from_idx").on(remixedFromId)`.

Shipped as a hand-written migration `migrations/00NN_recipe_tries.sql` (next free number; `0018_mfa_totp.sql` is the latest on 2026-10-10), following the header convention in `0017_sign_in_with_apple.sql` (an ORDERING note explaining why early application is safe). It uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Local dev uses `npm run db:push`. No backfill, and no destructive change.

Exported types: `RecipeTry`, `InsertRecipeTry`.

## 5. Server

### 5.1 Storage (`server/storage/recipe-tries.ts`, registered in `server/storage/index.ts`)

- `setRecipeTried(userId, recipeId, tried: boolean): Promise<void>`. `true` is an insert with `onConflictDoNothing`. `false` deletes the `(userId, recipeId)` row. Both are idempotent.
- `getRecipeCommunityStats(recipeId, userId)` returns:
  ```ts
  {
    triedCount: number; // COUNT recipe_tries WHERE recipeId
    triedByMe: boolean; // EXISTS recipe_tries WHERE recipeId AND userId
    favouritedCount: number; // COUNT favourite_recipes WHERE recipeId AND recipeType='community'
    variantCount: number; // COUNT community_recipes WHERE remixedFromId=recipeId AND isPublic
  }
  ```
  The counts run as a `Promise.all` of small, index-backed queries.
- `getRecipeVariants(recipeId, limit = 50)` returns `{ id, title, imageUrl, createdAt }[]` for public remixes, newest first. The author is never included.
- A shared helper `getPublicCommunityRecipeId(recipeId)` returns whether the recipe exists **and** `isPublic = true`. Every endpoint below checks it first.
- **`isPublic` is nullable** (`default(true)` with no `.notNull()`). Everywhere in this feature, "public" means `isPublic = true`. `NULL` counts as private: the recipe gets a 404, and the remix is excluded from `variantCount` and the variants list.
- The lint-staged IDOR check may flag `getRecipeVariants` / `getRecipeCommunityStats` for reading by `recipeId` without a `userId` scope. They are deliberately public aggregates, gated by `getPublicCommunityRecipeId`. Handle the flag with the check's existing allowlist convention rather than a fake `userId` parameter.

### 5.2 Routes (in `server/routes/recipes.ts`, beside `GET /api/recipes/:id`)

All use `requireAuth` + `crudRateLimit`, with `parsePositiveIntParam` on `:id` (400 `VALIDATION_ERROR` when invalid).

| Method   | Path                        | Response                       |
| -------- | --------------------------- | ------------------------------ |
| `PUT`    | `/api/recipes/:id/tried`    | `{ tried: true, triedCount }`  |
| `DELETE` | `/api/recipes/:id/tried`    | `{ tried: false, triedCount }` |
| `GET`    | `/api/recipes/:id/stats`    | the stats object from 5.1      |
| `GET`    | `/api/recipes/:id/variants` | `{ variants: [...] }`          |

Rules:

- A recipe that is not public returns **404 `NOT_FOUND`** for everyone, **including its author**. A private recipe has no community. 404 rather than 403, so the response never confirms that an ID exists (matches `recipes.ts:344`).
- Authors may mark their own public recipe as tried (one vote, no special case).
- No endpoint returns _who_ tried a recipe. Only counts.
- If a recipe goes private after being tried, its `recipe_tries` rows are kept and count again if it is made public again.
- Express route order: these are sub-paths with their own methods, so no existing `/api/recipes/:id` handler can swallow them. Route tests still assert each one is reached.

### 5.3 Data export

`server/storage/export.ts` includes the user's `recipe_tries` rows (`recipeId`, `createdAt`) alongside favourites.

### 5.4 Data inventory

`recipe_tries` is new per-user behavioural data.

- **Privacy policy (hosted page at ocrecipes.com/privacy, outside this repo):** add "recipes you marked as tried" next to favourites in the list of data collected. This is an owner step, listed in the rollout checklist.
- **Retention:** `server/lib/retention-policy.ts` / `server/scripts/cleanup-retention.ts` do not cover favourites (they are kept for the life of the account). Tries follow the same rule, and rows are removed by cascade on account deletion. No retention change.
- **iOS privacy manifest (#1248) and App Store privacy labels:** not checked while writing this spec. During implementation, confirm whether the categories already declared cover a per-user "tried" flag; if not, add one.

## 6. Client

### 6.1 Data hooks (`client/hooks/useRecipeCommunity.ts`)

- `useRecipeCommunityStats(recipeId, enabled)` is a `useQuery` on `["/api/recipes", recipeId, "stats"]` with `meta: { silentError: true }`.
- `useSetRecipeTried()` is a `useMutation` that sends `PUT` or `DELETE` based on the desired state. `onMutate` cancels the query and optimistically sets `triedByMe` and `triedCount ± 1`. `onError` rolls back and shows the toast "Couldn't save — try again". `onSettled` invalidates the stats key.
- `useRecipeVariants(recipeId)` is a `useQuery` on `["/api/recipes", recipeId, "variants"]`.
- The favourite toggle's `onSettled` (`useFavouriteRecipes.ts`) also invalidates `["/api/recipes", recipeId, "stats"]` when `recipeType === "community"`, so the Favourited row stays honest.

### 6.2 `RecipeTriedBar` (new component)

- Rendered by `FeaturedRecipeDetailScreen` **only** when `resolvedRecipeType === "community"` **and** the stats query has succeeded. Absolutely positioned at the bottom, reusing the existing `saveBar` styling and safe-area padding.
- When the bar is shown, `contentPaddingBottom` adds the bar height, the same way the catalog `SAVE_BAR_HEIGHT` is added, so the last step and Ask Coach are not hidden.
- Left: "12 people tried this" / "1 person tried this" / "Be the first to try it". Right: a pill button, outlined as **"✓ I tried it"** and filled as **"✓ Tried"**.
- Press: the optimistic update, `useSuccessPop` + Success haptic on mark (matching the heart), a plain impact haptic on unmark.
- Accessibility: `accessibilityRole="button"` + `accessibilityState={{ selected: triedByMe }}`, the same convention as the catalog save bar's heart (`FeaturedRecipeDetailScreen`). Label: "I tried it, 12 people tried this".

### 6.3 `RecipeCommunityStats` (new component, list rows)

- Rendered inside `RecipeDetailContent` **after the instructions and Chef's notes, before `AskCoachSection`**, only for community recipes whose stats query succeeded. A loading skeleton (three rows) shows while the query is pending. On error, nothing renders.
- Heading: "Community".
- Rows:

  | Row                  | Value > 0                     | Value = 0                                                                                                                                                             |
  | -------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | ✓ Tried it           | "12 people" / "1 person"      | "Be the first"                                                                                                                                                        |
  | ♥ Favourited        | "8 people" / "1 person"       | "Not yet"                                                                                                                                                             |
  | ⇄ Community variants | "3 ›" (opens variants screen) | "Remix it ›" (calls the **same handler** as the existing "Remix this recipe" button in `RecipeDetailContent`, including its premium/quota gate; no second remix path) |

- No "More stats" drawer in this build (R5 amended, §10 Q1).
- Label and zero-state wording live in `client/components/recipe-community-stats-utils.ts` (pure, Vitest-covered).

### 6.4 `RecipeVariantsScreen` (new root-stack screen)

- Registered in `RootStackNavigator` as `RecipeVariants: { recipeId: number; title: string }`. Header: "Community variants".
- A list of rows (photo thumbnail, title, relative date). Tapping a row navigates to `FeaturedRecipeDetail` with that remix's ID and `recipeType: "community"`.
- Empty state (all remixes went private or were deleted since the count): "No community variants yet." Error state: the existing `InlineError` pattern.
- No deep link in this build.

## 7. Error handling

| Situation                                      | Behaviour                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Mark/unmark request fails                      | Optimistic state rolls back; toast "Couldn't save — try again".                                                |
| Rapid double tap                               | Each request carries the desired state; the DB unique constraint makes repeats no-ops. Final state = last tap. |
| Recipe deleted or made private while open      | Stats/tried endpoints return 404 → the bar and section hide; the recipe body is unaffected.                    |
| Stats query fails or is slow                   | Section shows a skeleton, then hides on error; the bar stays hidden. Never blocks the recipe.                  |
| Server not yet deployed when the app OTA lands | Stats endpoint 404 → bar and section hidden. No broken state.                                                  |

## 8. Testing (TDD: each test written failing first)

Server, against Postgres:

- `setRecipeTried(true)` twice → one row, `triedCount` 1.
- `setRecipeTried(false)` removes the row; with no row, it is a no-op.
- `favouritedCount` reflects current `favourite_recipes` rows: favourite → unfavourite → favourite gives 1, while `popularityFavorites` would say 2.
- `variantCount` counts only `isPublic` remixes of this recipe.
- User deletion and recipe deletion cascade away `recipe_tries` rows.
- Routes: 401 without auth; 400 for `:id` = `abc` / `0` / `-1`; 404 for a private recipe **called by its author**; 404 for a missing ID; the response shapes match §5.2.
- Export includes `recipe_tries`.

Client:

- `recipe-community-stats-utils.ts`: pluralisation ("1 person" / "12 people"), zero-state strings, bar caption, accessibility labels.
- `useSetRecipeTried`: optimistic increment/decrement and rollback on error (existing hook-test pattern).

Manual / simulator:

- `verify-ui` on a fresh public community recipe: the bar is visible at the top and at the bottom of the scroll, tapping updates the count, and the section shows the zero-state invitations. A private recipe shows no bar and no section.

## 9. Rollout

- **No feature flag.** The app has no users, and the client already hides everything when the stats endpoint is missing.
- Order: apply the migration to prod **before merging** (the new server bundle reads `recipe_tries`; the old bundle never touches it, so early application is safe) → merge → Railway deploy → client via **OTA** (no native changes). Applying the prod migration is an owner-confirmed step.
- Owner step before or with the OTA: update the hosted privacy policy (§5.4).
- Reversible: hiding the client components is a one-line OTA. The table can stay.

## 10. Open questions for the owner (raised by the spec review, 2026-10-10)

**Q1. The two drawer counters never move, and there is nothing to wire them to.** `popularityMealPlans` and `popularityCookSessions` go up only when the request carries `sourceCommunityRecipeId` (`server/routes/meal-plan.ts:77/261`, `server/routes/cooking.ts:119/483`). A grep of `client/` finds that field only in a type declaration (`client/hooks/useMealPlanRecipes.ts:109`). The owner first chose "wire it up" (2026-10-10). Investigation then showed that option does not exist as framed:

- **Cook mode is not cooking from a recipe.** `useCreateCookSession` (`client/hooks/useCookSession.ts:33`) starts the photograph-your-ingredients flow (`CookSessionCapture`) with no body. No recipe is involved, so there is no source to send.
- **No working path adds a community recipe to a meal plan.** `RecipeBrowserScreen` opens the recipe screen for community results (~581), and the recipe screen has no add-to-plan action. The only path that tries, Quick Add search, is broken (filed: `todos/P2-2026-10-10-quick-add-community-recipe-sends-wrong-id.md`).

Revised options: (a) drop the drawer from this build and re-add it when a real source exists; (b) ship the drawer showing zeros. **Owner ruling 2026-10-10: (a), drop the drawer.** The popularity counters stay as they are (they still feed the hidden score).

**Q2. People may cook from their saved copy, not the community original.** Saving a community recipe makes a private meal-plan copy, and **the copy does not record which community recipe it came from** (no source column; the source ID is only sent, at best, for the counter in Q1). Under R1 the saved copy gets no bar. Showing the bar there would need a new source-link column on `meal_plan_recipes`, which is a larger change. Options: (a) keep R1 as is; (b) add the source link in a follow-up spec. **Owner ruling 2026-10-10: (a), keep R1.**

## 11. Out of scope

- The leaderboard (data is ready; the screen is a later spec).
- Who-tried lists, comments, ratings, photos, notes.
- Notifications ("someone tried your recipe").
- Any change to `popularityScore` or its increment-only counters.
- Stats for catalog previews, private recipes, or meal-plan recipes.
- A deep link to the variants screen.
