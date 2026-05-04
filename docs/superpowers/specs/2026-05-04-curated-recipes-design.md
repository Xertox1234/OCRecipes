# Curated Recipes System

**Date:** 2026-05-04
**Status:** Draft
**Scope:** Automated recipe canonicalization pipeline, enrichment with high-quality content, app display surfaces, public API extension, and seed tooling

---

## Problem

User-generated community recipes vary widely in quality — inconsistent ingredient formatting, single low-resolution AI images, terse one-line instructions. As the recipe library grows, there is no mechanism to elevate standout recipes into a curated tier with professional-grade content, nor to expose that content to a planned second health/meal-planning app via API.

## Goals

1. Automatically promote popular recipes to a "Curated" tier based on engagement signals
2. Enrich promoted recipes with multiple high-quality images, detailed per-step instructions, a Tools Required section, chef tips, and cuisine origin notes
3. Display Curated recipes distinctively throughout the app (badge, carousel, search filter, expandable steps)
4. Expose the full curated recipe catalog via a public API — initially for a second internal app, extensible to third parties later
5. Provide a seed CLI to manually canonicalize recipes for testing the pipeline end-to-end

## Non-Goals

- Admin moderation UI (automated pipeline only for now)
- Video generation (field reserved in schema, implementation deferred)
- Paid API tiers (designed for it, not implemented now)
- Retroactive changes to existing `communityRecipes` rows beyond the new columns

---

## Section 1: Data Model

All changes are additive columns on the existing `communityRecipes` table. No new table, no broken references (cookbook entries, favorites, shared URLs all remain valid).

### New columns

**Popularity tracking:**

| Column                     | Type    | Default | Notes                                            |
| -------------------------- | ------- | ------- | ------------------------------------------------ |
| `popularity_favorites`     | integer | 0       | Incremented on favorite toggle                   |
| `popularity_meal_plans`    | integer | 0       | Incremented on meal plan add                     |
| `popularity_cook_sessions` | integer | 0       | Incremented on cook session complete             |
| `popularity_score`         | integer | 0       | Weighted sum: fav×1 + mealPlan×2 + cookSession×3 |

**Promotion state:**

| Column                  | Type      | Default | Notes                                   |
| ----------------------- | --------- | ------- | --------------------------------------- |
| `is_canonical`          | boolean   | false   | True when promoted to Curated tier      |
| `canonicalized_at`      | timestamp | null    | Set on promotion                        |
| `canonical_enriched_at` | timestamp | null    | Set after enrichment pipeline completes |

**Canonical content (nullable — only populated after promotion):**

| Column                | Type                                            | Notes                                                               |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `canonical_images`    | jsonb `string[]`                                | Hero shot, plated dish, ingredients spread                          |
| `instruction_details` | jsonb `(string \| null)[]`                      | Parallel to `instructions[]`; `null` for steps with no added detail |
| `tools_required`      | jsonb `{name: string, affiliateUrl?: string}[]` | Inferred from instructions                                          |
| `chef_tips`           | jsonb `string[]`                                | 2-3 pro tips for the whole recipe                                   |
| `cuisine_origin`      | text                                            | One-line origin note                                                |
| `video_url`           | text                                            | Reserved for future video generation; nullable                      |

### Promotion threshold

A recipe qualifies for promotion when any of the following is true:

- `popularity_favorites >= 5`
- `popularity_meal_plans >= 3`
- `popularity_cook_sessions >= 1`

The threshold is intentionally lenient during early app growth. It can be raised via a config constant without a schema change.

---

## Section 2: Popularity Scoring

### Event increments

Popularity counters are updated in the hot path of existing user actions — each is a single cheap `UPDATE ... SET col = col + N` with no joins.

| User action               | Counter                    | Score delta  |
| ------------------------- | -------------------------- | ------------ |
| Recipe favorited          | `popularity_favorites`     | +1           |
| Recipe unfavorited        | `popularity_favorites`     | -1 (floor 0) |
| Recipe added to meal plan | `popularity_meal_plans`    | +2           |
| Cook session completed    | `popularity_cook_sessions` | +3           |

`popularity_score` is recomputed as `popularity_favorites + (popularity_meal_plans × 2) + (popularity_cook_sessions × 3)` on each update.

### Touch points

Three existing storage functions require a counter increment:

- `toggleFavouriteRecipe` in `server/storage/favourite-recipes.ts`
- Meal plan recipe add in `server/storage/meal-plans.ts` (`addRecipeToMealPlan` or equivalent insert function)
- Cook session completion in `server/routes/cooking.ts`

---

## Section 3: Promotion Pipeline

**File:** `server/services/canonical-promotion.ts`

A background service that runs every 6 hours via `setInterval` on server start (consistent with other background jobs in the codebase).

### Promotion job steps

1. Query all non-canonical recipes meeting the threshold (indexed on `is_canonical` + score columns)
2. For each match:
   - Set `is_canonical = true`, `canonicalized_at = now()`
   - Fire-and-forget call to the enrichment pipeline (rate-limited to 2 concurrent enrichments to avoid hammering image APIs)
3. Log count of newly promoted recipes per run

### Concurrency

Enrichment is expensive (3 image generations + 1 GPT-4o call per recipe). The promotion job processes a maximum of 10 recipes per run, prioritising highest `popularity_score` first. Remaining eligible recipes are caught on the next 6-hour cycle.

---

## Section 4: Enrichment Pipeline

**File:** `server/services/canonical-enrichment.ts`

Runs after promotion. Accepts a `recipeId` and executes four sequential steps.

### Step 1 — Image generation

Uses FLUX Pro Ultra via Runware (higher quality than the standard FLUX.2 klein used for community recipes). Generates 3 images with tailored prompts per recipe:

- **Hero shot** — styled overhead of the finished dish, professional food photography lighting
- **Plated dish** — 45° angle, restaurant-style presentation
- **Ingredients spread** — flat lay of all raw ingredients, labelled style

Images saved to disk (R2-compatible path structure, ready for Cloudflare R2 migration). URLs stored in `canonical_images[]`. Falls back to DALL-E 3 if Runware is unavailable.

### Step 2 — Data normalization

- Ingredient units standardized (e.g. "2 tbs" → "2 tablespoons", "100g" → "100 grams")
- Instruction steps cleaned up (consistent sentence casing, trailing punctuation)
- Nutrition values re-verified via existing `nutrition-lookup` pipeline against the ingredient list

### Step 3 — AI content generation

Single GPT-4o call with structured JSON response containing all editorial additions:

```typescript
{
  instructionDetails: (string | null)[],  // one entry per step; null if no detail needed
  toolsRequired: { name: string, affiliateUrl: null }[],
  chefTips: string[],             // 2-3 tips
  cuisineOrigin: string,
}
```

The prompt provides the full recipe (title, ingredients, instructions) and asks for:

- `instructionDetails`: 2-4 sentence expansion per step covering technique, visual cues, and common mistakes
- `toolsRequired`: tools inferred from instructions (e.g. "cast iron skillet", "fine mesh strainer")
- `chefTips`: pro-level tips not already covered in the steps
- `cuisineOrigin`: one sentence on the dish's origin and cultural context

### Step 4 — Mark enriched

Sets `canonical_enriched_at = now()` to confirm pipeline completion. Recipes with `is_canonical = true` but null `canonical_enriched_at` indicate an in-progress or failed enrichment run.

---

## Section 5: App Display

### CuratedBadge component

A shared `client/components/CuratedBadge.tsx` — gold star icon + "Curated" label. Rendered on recipe cards wherever they appear: carousels, search results, cookbook lists, favorites. Accepts a `compact` prop for tight layouts.

### Curated Recipes carousel

A new horizontal scroll section on the Home screen, inserted below the existing featured carousel. Title: "Curated Recipes". Only rendered when at least one canonical recipe exists. Taps open the existing recipe detail screen — no new screen needed.

### Search filter

A "Curated" toggle chip in the recipe browser/search filter bar (alongside existing diet tag and meal type filters). When active, adds `WHERE is_canonical = true` to the query.

### Recipe detail screen — Curated additions

When `isCanonical = true`, three new sections are inserted into the existing recipe detail screen:

**1. Image gallery (replaces single hero image)**
Horizontal `FlatList` of `canonicalImages[]` at the top of the screen. Paginated dots indicator below. Falls back to the existing single `imageUrl` if `canonicalImages` is empty.

**2. Expandable steps**
The existing `instructions[]` list gains a long-press handler per step. On long-press, the step row expands inline using a Reanimated layout animation to reveal `instructionDetails[i]`. A subtle hint — "Hold any step for details" — appears below the section header on first view only (dismissed via AsyncStorage flag). Steps without a corresponding `instructionDetails` entry do not show the hint and do not expand.

**3. Tools Required section**
Rendered below the ingredients list. Each tool is a tappable row: name on the left, a link icon on the right if `affiliateUrl` is set (opens in-app browser via `expo-web-browser`). The section is hidden entirely if `toolsRequired` is empty.

**Chef's Notes card**
`chefTips[]` rendered as a bulleted card, `cuisineOrigin` as a subtitle above the tips. Positioned at the bottom of the detail screen above the action buttons.

---

## Section 6: Public API

Extends the existing `/api/v1` router in `server/routes/public-api.ts`. Same API key auth, rate limiting, and CORS already in place. Only `is_canonical = true` recipes are exposed.

### Endpoints

```
GET /api/v1/recipes
  ?page=1&limit=20
  ?dietTags=gluten-free,dairy-free
  ?mealTypes=dinner,lunch
  ?maxCalories=600

GET /api/v1/recipes/:id

GET /api/v1/recipes/search?q=chicken tikka
```

### Response shape

```json
{
  "data": {
    "id": 42,
    "title": "Chicken Tikka Masala",
    "description": "...",
    "cuisineOrigin": "British-Indian",
    "difficulty": "medium",
    "timeEstimate": "45 mins",
    "servings": 4,
    "dietTags": ["gluten-free"],
    "mealTypes": ["dinner"],
    "caloriesPerServing": 420,
    "protein": 38,
    "carbs": 22,
    "fat": 14,
    "ingredients": [
      { "name": "chicken breast", "quantity": "500", "unit": "grams" }
    ],
    "instructions": ["Marinate the chicken for at least 2 hours."],
    "instructionDetails": [
      "Longer marination (overnight) produces more tender, flavourful results. The yogurt enzymes break down proteins — don't skip this step."
    ],
    "toolsRequired": [{ "name": "Cast iron skillet", "affiliateUrl": null }],
    "chefTips": ["Use full-fat yogurt in the marinade for best results."],
    "canonicalImages": ["https://cdn.ocrecipes.app/recipes/42/hero.jpg", "..."],
    "videoUrl": null,
    "canonicalizedAt": "2026-05-04T12:00:00Z"
  }
}
```

All fields are returned for all API key holders. Tier-based field gating can be added later without changing the response shape — paid tiers would be additive (e.g., batch endpoints, webhooks).

---

## Section 7: Seed Script

**File:** `scripts/canonicalize-recipe.ts`

CLI tool for manually promoting and enriching specific recipes, bypassing the popularity threshold. Used for testing the pipeline and building the initial curated catalog.

### Usage

```bash
# By ID
npx tsx scripts/canonicalize-recipe.ts 42

# By title search (promotes closest match)
npx tsx scripts/canonicalize-recipe.ts --search "chicken tikka"

# Batch — canonicalize top N recipes by current popularity_score
npx tsx scripts/canonicalize-recipe.ts --top 5
```

### Output

The script prints current recipe state before enrichment, then a step-by-step log as each enrichment stage completes: images generated (with URLs), instruction details written, tools found, tips added. If any stage fails, the script prints the error and leaves `canonical_enriched_at` null so the failure is visible in the DB.

---

## Implementation Order

1. Schema migration (new columns)
2. Popularity counter increments on 3 event paths
3. `canonical-promotion.ts` service + background job
4. `canonical-enrichment.ts` pipeline
5. Seed script (`scripts/canonicalize-recipe.ts`)
6. **Run seed on 3-5 recipes and review output**
7. App display: `CuratedBadge`, Home carousel, search filter
8. App display: expandable steps, Tools Required, Chef's Notes on recipe detail
9. Public API endpoints on `/api/v1/recipes`
10. Tests for scoring logic, promotion threshold, enrichment steps, API endpoints
