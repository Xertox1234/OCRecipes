# Taste Picks — Preference Elicitation UI

**Date:** 2026-05-10
**Status:** Approved — ready for implementation planning
**Roadmap ref:** `docs/superpowers/plans/2026-05-09-personalization-roadmap.md` — Strategic Backlog (preference elicitation UI)

---

## Context & Goals

OCRecipes personalises carousels, meal suggestions, and coach responses using `cuisinePreferences` from the user's dietary profile. That field is populated manually during onboarding — but most users set it to nothing or one entry, giving the personalization layer weak signal from day one.

Preference elicitation solves the cold-start problem: a short, visual recipe-picking flow seeds `cuisinePreferences` with real taste data before the user has any scan or log history. Because the downstream consumers already read `cuisinePreferences`, zero additional wiring is needed to get the signal flowing to all four surfaces immediately.

A `taste_picks` table preserves the raw recipe-level picks for future collaborative filtering, which is currently blocked on "not enough preference data."

---

## Data Model

### New table: `taste_picks`

```sql
CREATE TABLE taste_picks (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id  INTEGER NOT NULL REFERENCES community_recipes(id) ON DELETE CASCADE,
  picked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipe_id)
);
CREATE INDEX taste_picks_user_idx ON taste_picks (user_id);
```

### Write-through logic (runs inside a single transaction on every PUT)

1. Delete all existing `taste_picks` rows for the user.
2. Insert new rows from the incoming `recipeIds[]`.
3. Query `cuisineOrigin` of all newly-picked recipes (filtering nulls).
4. Derive `derivedCuisines` — deduplicated list of non-null `cuisineOrigin` values across picks.
5. Merge with `profile.cuisinePreferences` (union — manually-set cuisines are preserved and not removed).
6. Write merged list back to `users_profiles.cuisinePreferences`.
7. Fire-and-forget `storage.invalidateSuggestionCacheForUser(userId)` — mirrors the invalidation in `profile.ts` for `cuisinePreferences` changes.

> **Note on removing picks:** Derived cuisines are merged into `cuisinePreferences` and become indistinguishable from manually-set ones. If a user removes all taste picks in settings, previously-derived cuisines remain in `cuisinePreferences`. This is intentional — the write-through is additive amplification, not a strict sync. Users who want to clear derived cuisines can do so via `EditDietaryProfileScreen`.

### Minimum picks

- **Onboarding:** 5 picks required to unlock Continue. Skip always available.
- **Settings edit:** No minimum — user may remove picks freely.

---

## UI Design

### Grid layout

2-column grid of recipe cards. Each card:

- Image (top, fixed height ~60dp)
- Recipe name (bold, single line, ellipsised)
- Cuisine tag (secondary text, muted)
- Selection state: brand-red (`#C94E1A`) border + checkmark overlay in top-right corner when selected

Counter chip below the header text shows live selection count. Chip turns brand-red at 5+ picks.

### Recipe card source

Community recipes, queried via `GET /api/taste-picks/candidates`. Filtered server-side by `dietType` and `allergies` so only compatible recipes appear.

**Image fallback:** `imageUrl` is nullable in the schema. The response uses `imageUrl ?? canonicalImages[0] ?? null`, omitting cards where both are absent.

**Cuisine display:** Each card shows `cuisineOrigin` (a nullable text field, e.g., "Italian") as the secondary label. Cards without a `cuisineOrigin` show no cuisine tag.

Cards are paginated; user scrolls to see more.

---

## Onboarding Integration

**Placement:** Step 7 of 7 — after the existing `PreferencesScreen`.

**Why last:** By step 7 the server has `dietType` and `allergies`, enabling server-side filtering of the candidate grid. It also serves as a satisfying, low-cognitive-effort finish line after the heavier health/goal setup steps.

**Progress bar** shows 7/7 (full) — signals completion is immediate.

**Continue button:** Disabled (greyed) below 5 picks. Activates and turns brand-red at 5+.

**Skip for now:** Always visible below Continue. Navigates forward without saving any picks. Users who skip will have no `taste_picks` rows and unmodified `cuisinePreferences`.

**On Continue (sequenced — order matters):**

1. `POST /api/user/dietary-profile` — persists the draft profile from `OnboardingContext` state (creates the profile row so the write-through in step 2 has a row to update).
2. `PUT /api/taste-picks` — saves picks and triggers cuisine write-through against the now-persisted profile.
3. `updateUser({ onboardingCompleted: true })` — marks onboarding done.

This replaces the existing `completeOnboarding()` call in `OnboardingContext` for users who reach step 7. `OnboardingContext.totalSteps` must be incremented from 6 to 7.

**Candidates filtering during onboarding:** Because the profile has not been persisted when `TastePicksScreen` first loads (step 7, before Continue), `GET /api/taste-picks/candidates` must accept optional `?dietType=&allergies[]=` query params. The screen passes these from `OnboardingContext.data` (client state). The endpoint falls back to the stored profile when params are absent (Settings flow).

### New files

- `client/screens/onboarding/TastePicksScreen.tsx` — onboarding variant (shows progress bar, Continue/Skip buttons)
- `client/navigation/OnboardingNavigator.tsx` — add `TastePicks` as step 7

---

## Settings Integration

**Entry point:** New row in `SettingsScreen.tsx`, positioned between "Edit Profile" and "Apple Health". Row subtitle shows current pick count ("8 recipes picked") so users see it's already seeded.

**Destination:** `TasteProfileScreen` — reuses the same grid component as `TastePicksScreen`, pre-populated with existing picks. Navigation header shows "Taste Profile" with an explicit "Save" button (top-right) and a "Save Changes" primary button at the bottom. Changes are not auto-saved on tap — only committed on explicit save.

**No minimum in settings:** Users may remove picks freely (e.g., reduce to 0).

**On save:** Calls `PUT /api/taste-picks`, updates `cuisinePreferences` via write-through, pops back to Settings.

### New files

- `client/screens/TasteProfileScreen.tsx` — settings variant (no progress bar, Save Changes button)
- `client/navigation/ProfileStackNavigator.tsx` — add `TasteProfile` screen to same stack as `SettingsScreen`

### Shared component

Both `TastePicksScreen` and `TasteProfileScreen` use a shared `TastePicksGrid` component:

```
client/components/TastePicksGrid.tsx
  props:
    candidates: RecipeCandidate[]        — full paginated list
    selectedIds: Set<number>             — controlled selection state
    onToggle: (recipeId: number) => void
```

---

## API

### `GET /api/taste-picks/candidates`

Returns paginated community recipes filtered by `dietType` and `allergies`.

**Query params:**

- `page` (default 1), `limit` (default 30)
- `dietType` (optional string) — overrides stored profile; used by onboarding before profile is persisted
- `allergies[]` (optional string array) — overrides stored profile; same reason

When override params are absent, the endpoint resolves filters from the user's stored profile.

**Response:**

```json
{
  "candidates": [
    {
      "id": 42,
      "title": "Greek Salad",
      "imageUrl": "...",
      "cuisineOrigin": "Mediterranean"
    }
  ],
  "total": 180,
  "page": 1
}
```

`imageUrl` is the resolved image: `imageUrl ?? canonicalImages[0] ?? null`. Cards with no image are excluded from results.

### `GET /api/taste-picks`

Returns the user's current picks.

**Response:**

```json
{
  "picks": [
    {
      "recipeId": 42,
      "title": "Greek Salad",
      "imageUrl": "...",
      "cuisineOrigin": "Mediterranean"
    }
  ]
}
```

### `PUT /api/taste-picks`

Replaces the user's full pick set and triggers the write-through to `cuisinePreferences`.

**Body:** `{ "recipeIds": [42, 17, 93, ...] }`

**Response:** `{ "picks": [...], "cuisinePreferences": ["Mediterranean", "Italian", "Asian"] }`

**Side effect:** fires-and-forgets `storage.invalidateSuggestionCacheForUser(userId)` if `cuisinePreferences` changed (mirrors `profile.ts` behaviour).

**Idempotent:** Sending the same `recipeIds` twice produces the same state.

---

## Downstream Wiring

No new wiring needed at launch. All four consumers already read `cuisinePreferences`:

| Consumer                                | Current behaviour                                                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carousel-builder.ts`                   | Uses `cuisinePreferences` to generate recommendation reason labels only ("Matches your cuisine preferences"). **Does not affect ranking or filtering.** Carousel ranking improvement is a follow-up item. |
| `coach-context-builder.ts`              | Injects `dietaryProfile.cuisines` into coach system prompt                                                                                                                                                |
| `meal-suggestions.ts`                   | `buildDietaryContext()` includes cuisine list in AI prompt                                                                                                                                                |
| Profile UI (`EditDietaryProfileScreen`) | Renders and edits `cuisinePreferences`                                                                                                                                                                    |

When Phase 1 (`PersonalizationContext`) ships, add `tastePicks: number[]` to the context interface and populate it from a `getTastePicks(userId)` storage query. No migration needed — the table exists and is populated.

---

## Testing

| Layer                                      | Coverage                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Storage — `setTastePicks`                  | Idempotent: re-PUT same IDs yields same rows. Removes IDs not in new set. Handles empty array.                                         |
| Storage — write-through                    | `cuisinePreferences` after PUT is union of existing + derived `cuisineOrigin` values. Pre-existing manual cuisines not removed.        |
| Storage — `getCandidates`                  | Filters by `dietType`/`allergies` query params when present; falls back to stored profile. Excludes recipes with no resolvable image.  |
| Storage — `getCandidates` image resolution | Returns `imageUrl` when non-null; falls back to `canonicalImages[0]`; excludes card when both are absent.                              |
| Route — `PUT /api/taste-picks`             | 400 on missing body. 400 if any `recipeId` doesn't exist. 200 on valid input with correct response shape.                              |
| Route — `PUT /api/taste-picks` cache       | `invalidateSuggestionCacheForUser` is called (fire-and-forget) when `cuisinePreferences` changes.                                      |
| Onboarding — step 7 candidates             | `GET /api/taste-picks/candidates?dietType=vegan&allergies[]=peanuts` returns only diet-compatible recipes before profile is persisted. |
| Onboarding — Continue sequence             | Profile POST fires before taste-picks PUT; both complete before `onboardingCompleted` is set.                                          |
| Client — `TastePicksGrid`                  | Continue button disabled below 5. Enabled at exactly 5. Toggle adds/removes from selection.                                            |
| Client — skip flow                         | Skip navigates forward without calling `PUT /api/taste-picks`.                                                                         |
| Client — settings save                     | Save Changes calls `PUT` with current selection. Back without saving does not call `PUT`.                                              |

---

## Future Hook — Collaborative Filtering

The `taste_picks` table is the prerequisite data source for collaborative filtering (currently blocked in the strategic backlog on "not enough preference data"). Once a meaningful user base has submitted picks:

1. Build user-recipe affinity matrix from `taste_picks` + `favourite_recipes` + `recipe_dismissals`.
2. Item-item similarity from co-occurrence in `taste_picks` across users.
3. Feed into carousel ranking as an additional signal layer on top of `cuisinePreferences`.

No schema changes needed at that point — the table is already in place.

---

## Files Changed

### New

- `server/storage/taste-picks.ts` — `getTastePicks`, `setTastePicks`, `getTastePickCandidates`
- `server/storage/__tests__/taste-picks.test.ts`
- `server/routes/taste-picks.ts` — three endpoints
- `client/components/TastePicksGrid.tsx` — shared grid component
- `client/screens/onboarding/TastePicksScreen.tsx`
- `client/screens/TasteProfileScreen.tsx`

### Modified

- `server/routes.ts` — register taste-picks routes
- `shared/schema.ts` — add `tastePicks` table definition
- `client/navigation/OnboardingNavigator.tsx` — add step 7
- `client/screens/SettingsScreen.tsx` — add Taste Profile row
- `docs/superpowers/plans/2026-05-09-personalization-roadmap.md` — mark preference elicitation as in-progress
- `todos/2026-05-10-strategic-personalization.md` — add feasibility note and implementation link for this item
