# Recipe Favourites, Share & Save-to-Cookbook

**Date:** 2026-04-08
**Status:** Draft
**Scope:** New favourites system, share action, repositioned save-to-cookbook — spanning DB, API, and client UI

---

## Problem

Users browsing recipes have no quick way to bookmark ones they like. The existing "Save to Cookbook" flow requires opening a modal and choosing a cookbook — too much friction for casual saving. There's also no way to share a recipe externally. The thumbs up/down on recipe cards serves no functional purpose and should be replaced with actionable controls.

## Design Decisions

- **Favourites are separate from Cookbooks.** A heart is a quick, low-friction "I like this" action. Cookbooks are for intentional organization. They serve different user intents.
- **Separate `favouriteRecipes` table** following the existing `favouriteScannedItems` pattern — simple userId + recipeId toggle.
- **Share uses native share sheet** with deep link + recipe image attached.
- **All three actions (favourite, share, save-to-cookbook) available to all logged-in users**, with free-tier rate limits on favourites.

---

## 1. Data Model

### New Table: `favouriteRecipes`

| Column       | Type                                     | Constraints                           |
| ------------ | ---------------------------------------- | ------------------------------------- |
| `id`         | serial                                   | PK                                    |
| `userId`     | integer                                  | FK → users (cascade delete), not null |
| `recipeId`   | integer                                  | not null                              |
| `recipeType` | text enum: `"mealPlan"` \| `"community"` | not null                              |
| `createdAt`  | timestamp                                | default `now()`                       |

**Constraints:**

- `UNIQUE(userId, recipeId, recipeType)` — prevents duplicate favourites
- Index on `userId` for fast lookups

**Pattern:** Polymorphic FK (no DB-level foreign key on `recipeId`). Resolved at app level with partitioned batch fetch, same as `cookbookRecipes`. Orphaned rows cleaned eagerly during reads.

### Tier Limits

Add `maxFavouriteRecipes` to `PremiumFeatures` in `shared/types/premium.ts`:

| Tier    | Limit                         |
| ------- | ----------------------------- |
| Free    | 20                            |
| Premium | unlimited (`UNLIMITED_SCANS`) |

---

## 2. API Endpoints

### Favourite Recipes

| Method | Endpoint                        | Body / Query               | Response                                              | Notes                                                                                                  |
| ------ | ------------------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/favourite-recipes`        | `?limit=50`                | `ResolvedFavouriteRecipe[]`                           | Resolved with title, image, difficulty, etc. Ordered by `createdAt DESC`                               |
| `POST` | `/api/favourite-recipes/toggle` | `{ recipeId, recipeType }` | `{ favourited: boolean }`                             | Toggle on/off. Returns new state. Checks tier limit on add (403 + `LIMIT_REACHED` if exceeded)         |
| `GET`  | `/api/favourite-recipes/check`  | `?recipeId=X&recipeType=Y` | `{ favourited: boolean }`                             | Single-recipe check for detail screen                                                                  |
| `GET`  | `/api/favourite-recipes/ids`    | —                          | `{ ids: { recipeId: number, recipeType: string }[] }` | All favourited recipe IDs for the user. Used by browse lists to render heart state without N+1 queries |

### Recipe Share

| Method | Endpoint                                   | Response                                     | Notes                                                                                                        |
| ------ | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/recipes/:recipeType/:recipeId/share` | `{ title, description, imageUrl, deepLink }` | Returns share payload. `deepLink` is `ocrecipes://recipe/:recipeId?type=:recipeType`. Available to all users |

### Validation Schemas (Zod)

```
toggleFavouriteSchema: { recipeId: z.number().int().positive(), recipeType: z.enum(["mealPlan", "community"]) }
checkFavouriteSchema (query): { recipeId: z.coerce.number().int().positive(), recipeType: z.enum(["mealPlan", "community"]) }
```

---

## 3. Storage Layer

### New File: `server/storage/favourite-recipes.ts`

Functions:

| Function                                              | Description                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toggleFavouriteRecipe(userId, recipeId, recipeType)` | Transactional: check if exists → delete (return `false`) or insert with tier limit check (return `true`, or `null` if limit reached)                                              |
| `getUserFavouriteRecipeIds(userId)`                   | Returns all `{ recipeId, recipeType }` pairs for the user                                                                                                                         |
| `isRecipeFavourited(userId, recipeId, recipeType)`    | Returns boolean                                                                                                                                                                   |
| `getResolvedFavouriteRecipes(userId, limit)`          | Partitions by recipe type, batch-fetches from `mealPlanRecipes` and `communityRecipes`, merges results. Fire-and-forget cleans orphaned rows. Returns `ResolvedFavouriteRecipe[]` |
| `getFavouriteRecipeCount(userId)`                     | Returns count for tier limit display                                                                                                                                              |

**Pattern:** Follows `server/storage/cookbooks.ts` for the resolved recipe fetch pattern (partitioned batch fetch + Map lookup + orphan cleanup).

**Race condition handling:** Toggle uses unique constraint — if concurrent toggle attempts both try to insert, the second gets a constraint violation and falls through to delete path. Same pattern as `toggleFavouriteScannedItem`.

---

## 4. Client Hooks

### New File: `client/hooks/useFavouriteRecipes.ts`

| Hook                                          | Description                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useFavouriteRecipes(limit?)`                 | `useQuery` — fetches resolved favourite recipes list                                                                                                                                              |
| `useFavouriteRecipeIds()`                     | `useQuery` — fetches all favourited IDs for local heart-state lookup. Refetches on mount                                                                                                          |
| `useToggleFavouriteRecipe()`                  | `useMutation` — calls toggle endpoint. **Optimistic update** on the `ids` query cache for instant heart feedback. Invalidates both `ids` and list queries on settle. Shows alert if limit reached |
| `useIsRecipeFavourited(recipeId, recipeType)` | Derived hook — reads from `useFavouriteRecipeIds()` cache and returns boolean. No extra network call                                                                                              |
| `useShareRecipe()`                            | Fetches share payload from API, then calls `Share.share()` with title, message (description + deep link), and image URL                                                                           |

### Optimistic Update Strategy

When user taps heart:

1. Immediately update `favourite-recipe-ids` query cache (add or remove the ID)
2. Fire the toggle mutation
3. On error: roll back the cache and show error toast
4. On success: invalidate `favourite-recipes` list query (for the favourites screen)

This ensures the heart icon responds instantly without waiting for the network.

---

## 5. UI Components

### 5a. Recipe Action Bar

**New component: `RecipeActionBar`**

A horizontal row of three icon+label buttons displayed near the top of `FeaturedRecipeDetailScreen`, below the recipe image and above the title.

```
┌──────────────────────────────────────────┐
│  [♡ Favourite]   [📤 Share]   [📚 Save] │
└──────────────────────────────────────────┘
```

| Button           | Icon                                          | Behaviour                                                                                                       |
| ---------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Favourite        | Outlined heart / filled red heart             | Toggle via `useToggleFavouriteRecipe()`. Haptic feedback (`impactMedium`). Optimistic UI. Free-tier limit alert |
| Share            | `square.and.arrow.up` (iOS) / share (Android) | Calls `useShareRecipe()` → opens native share sheet with title, description, deep link, and recipe image        |
| Save to Cookbook | Bookmark / book icon                          | Opens existing `CookbookPickerModal`                                                                            |

**Styling:**

- Uses theme colours and spacing
- Icons from the project's existing icon system
- Buttons evenly spaced with `justifyContent: "space-around"`
- Each button has an accessibility label describing its action and current state (e.g., "Favourite recipe, currently not favourited")

### 5b. Recipe Card Heart Icon

On `RecipeCard` components in browse lists and cookbook views:

- **Remove** existing thumbs up/down buttons
- **Add** a small heart icon, positioned at the trailing edge of the card (or overlaid on the image corner)
- Tapping the heart toggles favourite state with haptic feedback
- Heart state derived from `useFavouriteRecipeIds()` cache — no per-card query
- Pressing the heart does NOT open the detail view (event propagation stopped)

### 5c. Favourites List Screen

**New screen: `FavouriteRecipesScreen`**

- `FlatList` of recipe cards using `useFavouriteRecipes()`
- Pull-to-refresh with haptics
- Empty state: "No favourites yet — heart recipes to save them here"
- Tapping a card navigates to `FeaturedRecipeDetailScreen`
- Heart icon on each card (pre-filled, since all are favourited)
- Skeleton loader while fetching

**Accessible from two places:**

1. **Meal Plan tab** — pinned "Favourites" row at the top of the cookbook list in `CookbookListScreen`, with heart icon and count badge. Always present (not deletable).
2. **Profile tab** — "My Favourites" menu row in `ProfileScreen`.

### 5d. Share Sheet Content

When user taps Share:

1. Fetch share payload from `/api/recipes/:recipeType/:recipeId/share`
2. Call React Native's `Share.share()`:
   - **title:** Recipe name
   - **message:** `"Check out this recipe: {title}\n\n{description}\n\n{deepLink}"`
   - **url:** Recipe image URL (iOS attaches as preview image)
3. Deep link format: `ocrecipes://recipe/:recipeId?type=community` (includes recipeType as query param so the detail screen knows which table to fetch from; defaults to `"community"` if omitted for backwards compatibility)

---

## 6. Navigation Changes

### MealPlanStackNavigator

Add `FavouriteRecipes` screen:

```typescript
MealPlanStackParamList {
  // existing...
  FavouriteRecipes: undefined;
}
```

### ProfileStackNavigator

Add `FavouriteRecipes` as a screen in the ProfileStackNavigator as well. Both stacks get their own registration of the same screen component — this avoids cross-tab navigation which feels jarring on mobile. Each entry point navigates within its own tab's stack.

---

## 7. Testing

### Storage Tests (`server/storage/__tests__/favourite-recipes.test.ts`)

- Toggle on/off cycle
- Tier limit enforcement
- Orphaned recipe cleanup during resolve
- Concurrent toggle race condition handling

### Route Tests (`server/routes/__tests__/favourite-recipes.test.ts`)

- All 4 endpoints: CRUD + auth checks
- 403 on limit reached
- Input validation (invalid recipeType, missing fields)
- IDOR protection (can't access other user's favourites)

### Hook Tests (`client/hooks/__tests__/useFavouriteRecipes.test.ts`)

- Optimistic update and rollback
- `useIsRecipeFavourited` derivation from cache

### Component Tests

- `RecipeActionBar` renders three buttons with correct states
- Heart toggle on recipe cards

---

## 8. Migration Notes

- New `favouriteRecipes` table via Drizzle schema + `db:push`
- Add `maxFavouriteRecipes` to `PremiumFeatures` interface and both tier configs
- Update premium tests to cover new field
- Update `client/navigation/linking.ts` to parse `type` query param on the `recipe/:recipeId` deep link path and pass it as `recipeType` to the screen
- No data migration needed — new table starts empty
