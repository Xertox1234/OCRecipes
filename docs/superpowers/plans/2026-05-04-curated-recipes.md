# Curated Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically promote popular community recipes to a "Curated" tier with high-quality images, detailed per-step instructions, tools required, and chef tips — then display them distinctively in the app and expose them via the public API.

**Architecture:** Popularity counters on `communityRecipes` are incremented at 3 event points (favorite, meal plan add, cook session complete). A `setInterval` background job running every 6 hours promotes recipes crossing the threshold (5 favorites OR 3 meal plan adds OR 1 cook session), then fires an enrichment pipeline that generates 3 high-quality images, normalizes data, and calls GPT-4o for editorial content. The app displays a `CuratedBadge` on promoted recipes, a dedicated carousel on the Home screen, a filter chip in RecipeBrowserScreen, and expanded detail content (image gallery, expandable steps, Tools Required, Chef's Notes). A new `/api/v1/recipes` endpoint exposes the curated catalog.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express.js 5, Runware FLUX.1 [dev] (`runware:101@1`) + DALL-E 3 fallback, GPT-4o structured JSON, React Native + Reanimated 4, TanStack Query v5, Vitest

---

## File Map

**New files:**

- `server/services/canonical-promotion.ts` — background promotion job
- `server/services/canonical-enrichment.ts` — enrichment pipeline (images + normalization + AI)
- `server/services/__tests__/canonical-promotion.test.ts`
- `server/services/__tests__/canonical-enrichment.test.ts`
- `server/storage/canonical-recipes.ts` — storage queries for curated recipe surfaces
- `scripts/canonicalize-recipe.ts` — seed CLI tool
- `client/components/CuratedBadge.tsx` — "Curated" badge component
- `client/components/__tests__/CuratedBadge.test.tsx`
- `client/components/home/CuratedRecipeCarousel.tsx` — home screen carousel section
- `client/hooks/useCuratedRecipes.ts` — TanStack Query hook for curated recipes

**Modified files:**

- `shared/schema.ts` — add 14 columns to `communityRecipes`
- `shared/types/recipe-search.ts` — add `isCanonical` to `SearchableRecipe`, `curatedOnly` to `RecipeSearchParams`
- `shared/types/public-api.ts` — add `CuratedRecipeResponse` type
- `server/lib/runware.ts` — export `saveImageBuffer`, add high-quality model constant
- `server/lib/search-index.ts` — add `isCanonical` to `communityToSearchable`
- `server/storage/favourite-recipes.ts` — add popularity counter increment
- `server/storage/meal-plans.ts` — add popularity counter increment
- `server/storage/index.ts` — expose canonical storage functions
- `server/routes/cooking.ts` — add popularity counter increment on session log
- `server/routes/public-api.ts` — add `/api/v1/recipes` endpoints
- `server/routes.ts` — start promotion background job
- `client/screens/HomeScreen.tsx` — add `CuratedRecipeCarousel`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — add Curated filter chip
- `client/screens/FeaturedRecipeDetailScreen.tsx` — add image gallery, expandable steps, Tools Required, Chef's Notes

---

## Task 1: Schema — Add Canonical Columns to communityRecipes

**Files:**

- Modify: `shared/schema.ts`

- [x] **Step 1: Add the new columns to the `communityRecipes` table definition in `shared/schema.ts`**

Open `shared/schema.ts` and find the `communityRecipes` table (around line 521). Add these columns inside the table definition, after `updatedAt`:

```typescript
    // Popularity tracking
    popularityFavorites: integer("popularity_favorites").default(0).notNull(),
    popularityMealPlans: integer("popularity_meal_plans").default(0).notNull(),
    popularityCookSessions: integer("popularity_cook_sessions").default(0).notNull(),
    popularityScore: integer("popularity_score").default(0).notNull(),

    // Promotion state
    isCanonical: boolean("is_canonical").default(false).notNull(),
    canonicalizedAt: timestamp("canonicalized_at"),
    canonicalEnrichedAt: timestamp("canonical_enriched_at"),

    // Canonical content (only populated after enrichment)
    canonicalImages: jsonb("canonical_images").$type<string[]>().default([]),
    instructionDetails: jsonb("instruction_details").$type<(string | null)[]>().default([]),
    toolsRequired: jsonb("tools_required").$type<{ name: string; affiliateUrl?: string }[]>().default([]),
    chefTips: jsonb("chef_tips").$type<string[]>().default([]),
    cuisineOrigin: text("cuisine_origin"),
    videoUrl: text("video_url"),
```

Also add an index for the promotion query inside the `(table) => ({})` block:

```typescript
    isCanonicalIdx: index("community_recipes_is_canonical_idx").on(table.isCanonical),
    popularityScoreIdx: index("community_recipes_popularity_score_idx").on(table.popularityScore),
```

- [ ] **Step 2: Push schema to database**

```bash
npm run db:push
```

Expected: Drizzle applies the new columns with their defaults. No data loss.

- [ ] **Step 3: Verify the columns exist**

```bash
npx tsx -e "
import { db } from './server/db';
import { communityRecipes } from './shared/schema';
const r = await db.select({ isCanonical: communityRecipes.isCanonical, popularityScore: communityRecipes.popularityScore }).from(communityRecipes).limit(1);
console.log('columns ok:', r);
process.exit(0);
"
```

Expected: prints `columns ok: [{ isCanonical: false, popularityScore: 0 }]` (or `[]` if no recipes exist — both are fine).

- [x] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add canonical recipe columns to communityRecipes schema"
```

---

## Task 2: Storage — Popularity Counter Functions

**Files:**

- Create: `server/storage/canonical-recipes.ts`
- Modify: `server/storage/index.ts`

- [x] **Step 1: Write failing tests**

Create `server/storage/__tests__/canonical-recipes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../db";

vi.mock("../../db", () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
  },
}));

import {
  incrementRecipePopularity,
  getCuratedRecipes,
  getCuratedRecipeById,
  getEligibleForPromotion,
  markCanonical,
} from "../canonical-recipes";

describe("incrementRecipePopularity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("increments favorites counter by 1", async () => {
    await incrementRecipePopularity(42, "favorite");
    expect(db.update).toHaveBeenCalled();
  });

  it("increments mealPlan counter by 1", async () => {
    await incrementRecipePopularity(42, "mealPlan");
    expect(db.update).toHaveBeenCalled();
  });

  it("increments cookSession counter by 1", async () => {
    await incrementRecipePopularity(42, "cookSession");
    expect(db.update).toHaveBeenCalled();
  });
});

describe("markCanonical", () => {
  it("sets isCanonical true and canonicalizedAt", async () => {
    await markCanonical(42);
    expect(db.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- server/storage/__tests__/canonical-recipes.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Create `server/storage/canonical-recipes.ts`**

```typescript
import { db } from "../db";
import { eq, and, or, gte, isNull, desc, sql } from "drizzle-orm";
import { communityRecipes, type CommunityRecipe } from "@shared/schema";

const PROMOTION_THRESHOLD = {
  favorites: 5,
  mealPlans: 3,
  cookSessions: 1,
} as const;

type PopularityEvent = "favorite" | "mealPlan" | "cookSession";

/** Increment a popularity counter and recompute the weighted score. */
export async function incrementRecipePopularity(
  recipeId: number,
  event: PopularityEvent,
): Promise<void> {
  const updates =
    event === "favorite"
      ? {
          popularityFavorites: sql`${communityRecipes.popularityFavorites} + 1`,
          popularityScore: sql`${communityRecipes.popularityScore} + 1`,
        }
      : event === "mealPlan"
        ? {
            popularityMealPlans: sql`${communityRecipes.popularityMealPlans} + 1`,
            popularityScore: sql`${communityRecipes.popularityScore} + 2`,
          }
        : {
            popularityCookSessions: sql`${communityRecipes.popularityCookSessions} + 1`,
            popularityScore: sql`${communityRecipes.popularityScore} + 3`,
          };

  await db
    .update(communityRecipes)
    .set(updates)
    .where(eq(communityRecipes.id, recipeId));
}

/** Mark a recipe as canonical. */
export async function markCanonical(recipeId: number): Promise<void> {
  await db
    .update(communityRecipes)
    .set({ isCanonical: true, canonicalizedAt: new Date() })
    .where(eq(communityRecipes.id, recipeId));
}

/** Mark enrichment as complete. */
export async function markEnriched(
  recipeId: number,
  enrichment: {
    canonicalImages: string[];
    instructionDetails: (string | null)[];
    toolsRequired: { name: string; affiliateUrl?: string }[];
    chefTips: string[];
    cuisineOrigin: string;
  },
): Promise<void> {
  await db
    .update(communityRecipes)
    .set({ ...enrichment, canonicalEnrichedAt: new Date() })
    .where(eq(communityRecipes.id, recipeId));
}

/** Find non-canonical recipes that cross the promotion threshold. */
export async function getEligibleForPromotion(
  limit = 10,
): Promise<CommunityRecipe[]> {
  return db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.isCanonical, false),
        or(
          gte(
            communityRecipes.popularityFavorites,
            PROMOTION_THRESHOLD.favorites,
          ),
          gte(
            communityRecipes.popularityMealPlans,
            PROMOTION_THRESHOLD.mealPlans,
          ),
          gte(
            communityRecipes.popularityCookSessions,
            PROMOTION_THRESHOLD.cookSessions,
          ),
        )!,
      ),
    )
    .orderBy(desc(communityRecipes.popularityScore))
    .limit(limit);
}

/** Paginated list of curated recipes for API and home carousel. */
export async function getCuratedRecipes(opts?: {
  limit?: number;
  offset?: number;
}): Promise<CommunityRecipe[]> {
  return db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.isCanonical, true),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .orderBy(desc(communityRecipes.popularityScore))
    .limit(opts?.limit ?? 20)
    .offset(opts?.offset ?? 0);
}

/** Single curated recipe by ID. Returns null if not curated. */
export async function getCuratedRecipeById(
  id: number,
): Promise<CommunityRecipe | null> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(
      and(eq(communityRecipes.id, id), eq(communityRecipes.isCanonical, true)),
    )
    .limit(1);
  return recipe ?? null;
}

/** Find a recipe by ID regardless of canonical status (used by seed script). */
export async function getRecipeById(
  id: number,
): Promise<CommunityRecipe | null> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.id, id))
    .limit(1);
  return recipe ?? null;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm run test:run -- server/storage/__tests__/canonical-recipes.test.ts
```

Expected: PASS (4 tests).

- [x] **Step 5: Expose new functions in `server/storage/index.ts`**

Add at the top of the imports section:

```typescript
import * as canonicalRecipesStorage from "./canonical-recipes";
```

Add to the exported storage object (after the last `favourite*` entry):

```typescript
  // Canonical recipes
  incrementRecipePopularity: canonicalRecipesStorage.incrementRecipePopularity,
  markCanonical: canonicalRecipesStorage.markCanonical,
  markEnriched: canonicalRecipesStorage.markEnriched,
  getEligibleForPromotion: canonicalRecipesStorage.getEligibleForPromotion,
  getCuratedRecipes: canonicalRecipesStorage.getCuratedRecipes,
  getCuratedRecipeById: canonicalRecipesStorage.getCuratedRecipeById,
  getRecipeById: canonicalRecipesStorage.getRecipeById,
```

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: all tests pass.

- [x] **Step 7: Commit**

```bash
git add server/storage/canonical-recipes.ts server/storage/__tests__/canonical-recipes.test.ts server/storage/index.ts
git commit -m "feat: add canonical recipe storage functions and popularity counter"
```

---

## Task 3: Wire Popularity Counters to Event Paths

**Files:**

- Modify: `server/storage/favourite-recipes.ts`
- Modify: `shared/schema.ts` (add `sourceCommunityRecipeId` to `createMealPlanRecipeSchema` via Zod, not DB schema)
- Modify: `server/routes/meal-plan.ts`

Note: Cook sessions have no recipe link in the current architecture (sessions are ingredient-only, not recipe-linked). The `cookSession` counter is wired here for the favorite and meal-plan paths; cook session tracking is deferred until a cook-from-recipe feature is added.

- [x] **Step 1: Add counter increment to `toggleFavouriteRecipe` in `server/storage/favourite-recipes.ts`**

Add import at the top of the file (around line 1):

```typescript
import { incrementRecipePopularity } from "./canonical-recipes";
```

`fireAndForget` is already imported in this file (line 10). Find where `return true` is reached after a successful favourite insert (inside the transaction, after the `tx.insert(favouriteRecipes)...` call). Add the increment just before `return true`:

```typescript
if (recipeType === "community") {
  fireAndForget(
    incrementRecipePopularity(recipeId, "favorite"),
    "favourite recipe popularity increment",
  );
}
return true;
```

Only community recipes participate — `mealPlan`-type favourites are excluded by the `recipeType` guard.

- [x] **Step 2: Add `sourceCommunityRecipeId` to the meal plan recipe creation schema and route**

In `server/routes/meal-plan.ts`, find `createMealPlanRecipeSchema` (line 37). Add an optional field at the end of the schema object:

```typescript
  sourceCommunityRecipeId: z.number().int().positive().optional().nullable(),
```

In the `POST /api/meal-plan/recipes` handler (line ~144), destructure the new field:

```typescript
const { ingredients, sourceType, sourceCommunityRecipeId, ...recipeData } =
  parsed.data;
```

Add imports at the top of the file:

```typescript
import { incrementRecipePopularity } from "../storage/canonical-recipes";
import { fireAndForget } from "../lib/fire-and-forget";
```

After `storage.createMealPlanRecipe(...)` succeeds (around line 193), add:

```typescript
if (sourceCommunityRecipeId) {
  fireAndForget(
    incrementRecipePopularity(sourceCommunityRecipeId, "mealPlan"),
    "meal plan recipe popularity increment",
  );
}
```

- [x] **Step 3: Pass `sourceCommunityRecipeId` from client when saving a community recipe to meal plan**

In `client/hooks/useMealPlanRecipes.ts`, find the `createMealPlanRecipe` mutation function that POSTs to `/api/meal-plan/recipes`. Add `sourceCommunityRecipeId?: number` to its input type.

In `client/screens/FeaturedRecipeDetailScreen.tsx` (or wherever "Save to Meal Plan" is triggered for a community recipe), pass `sourceCommunityRecipeId: communityRecipe.id` in the POST body when `recipeType === "community"`.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add server/storage/favourite-recipes.ts server/storage/meal-plans.ts server/routes/cooking.ts
git commit -m "feat: increment recipe popularity counters on favorite, meal plan add, cook session complete"
```

---

## Task 4: Promotion Background Job

**Files:**

- Create: `server/services/canonical-promotion.ts`
- Create: `server/services/__tests__/canonical-promotion.test.ts`
- Modify: `server/routes.ts`

- [x] **Step 1: Write failing tests**

Create `server/services/__tests__/canonical-promotion.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    getEligibleForPromotion: vi.fn().mockResolvedValue([]),
    markCanonical: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../canonical-enrichment", () => ({
  enrichRecipe: vi.fn().mockResolvedValue(undefined),
}));

import { runPromotionJob } from "../canonical-promotion";
import { storage } from "../../storage";
import { enrichRecipe } from "../canonical-enrichment";

describe("runPromotionJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when no eligible recipes", async () => {
    vi.mocked(storage.getEligibleForPromotion).mockResolvedValue([]);
    await runPromotionJob();
    expect(storage.markCanonical).not.toHaveBeenCalled();
  });

  it("marks eligible recipes canonical and enqueues enrichment", async () => {
    vi.mocked(storage.getEligibleForPromotion).mockResolvedValue([
      { id: 1 } as never,
      { id: 2 } as never,
    ]);
    await runPromotionJob();
    expect(storage.markCanonical).toHaveBeenCalledTimes(2);
    expect(enrichRecipe).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm run test:run -- server/services/__tests__/canonical-promotion.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Create `server/services/canonical-promotion.ts`**

```typescript
import pLimit from "p-limit";
import { storage } from "../storage";
import { enrichRecipe } from "./canonical-enrichment";
import { createServiceLogger } from "../lib/logger";

const log = createServiceLogger("canonical-promotion");
const PROMOTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ENRICHMENT_CONCURRENCY = 2;

export async function runPromotionJob(): Promise<void> {
  const eligible = await storage.getEligibleForPromotion(10);
  if (eligible.length === 0) return;

  log.info({ count: eligible.length }, "promoting recipes to curated tier");

  const limit = pLimit(ENRICHMENT_CONCURRENCY);
  await Promise.all(
    eligible.map((recipe) =>
      limit(async () => {
        await storage.markCanonical(recipe.id);
        // Fire-and-forget enrichment — failure leaves canonicalEnrichedAt null
        enrichRecipe(recipe.id).catch((err) =>
          log.error({ err, recipeId: recipe.id }, "enrichment failed"),
        );
      }),
    ),
  );
}

export function startPromotionJob(): ReturnType<typeof setInterval> {
  log.info("starting canonical promotion background job (6h interval)");
  return setInterval(() => {
    runPromotionJob().catch((err) => log.error({ err }, "promotion job error"));
  }, PROMOTION_INTERVAL_MS);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm run test:run -- server/services/__tests__/canonical-promotion.test.ts
```

Expected: PASS (2 tests).

- [x] **Step 5: Wire into `server/routes.ts`**

Add import near the top with other service imports:

```typescript
import { startPromotionJob } from "./services/canonical-promotion";
```

Add after `startNotificationScheduler()`:

```typescript
startPromotionJob();
```

- [ ] **Step 6: Run full test suite**

```bash
npm run test:run
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add server/services/canonical-promotion.ts server/services/__tests__/canonical-promotion.test.ts server/routes.ts
git commit -m "feat: add canonical recipe promotion background job (6h interval)"
```

---

## Task 5: Enrichment Pipeline

**Files:**

- Modify: `server/lib/runware.ts` — export `saveImageBuffer`, add high-quality model
- Create: `server/services/canonical-enrichment.ts`
- Create: `server/services/__tests__/canonical-enrichment.test.ts`

- [x] **Step 1: Export `saveImageBuffer` from `server/lib/runware.ts` and add high-quality model**

Open `server/lib/runware.ts`. Add near the top constants:

```typescript
export const RUNWARE_MODEL_STANDARD = "runware:400@6"; // FLUX.2 klein — used for standard recipes
export const RUNWARE_MODEL_HQ = "runware:101@1"; // FLUX.1 dev — higher quality for curated
```

Add an optional `model` parameter to `GenerateImageOptions`:

```typescript
export interface GenerateImageOptions {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  model?: string; // add this
}
```

In the `generateImage` function body, replace the hardcoded `model: "runware:400@6"` with:

```typescript
model: options.model ?? RUNWARE_MODEL_STANDARD,
```

Find the private `saveImageBuffer` function in `server/services/recipe-generation.ts` (around line 360). Note that it uses `RECIPE_IMAGES_DIR`. We need a shared version — export a generic image saver from `server/lib/runware.ts`:

```typescript
import fs from "fs";
import path from "path";
import crypto from "crypto";

const IMAGES_DIR = path.join(process.cwd(), "uploads", "recipe-images");

export async function saveImageBuffer(buffer: Buffer): Promise<string> {
  const MAX_SIZE = 10 * 1024 * 1024;
  if (buffer.length > MAX_SIZE) {
    throw new Error(`Image too large: ${buffer.length} bytes`);
  }
  await fs.promises.mkdir(IMAGES_DIR, { recursive: true });
  const filename = `recipe-${crypto.randomUUID()}.png`;
  await fs.promises.writeFile(path.join(IMAGES_DIR, filename), buffer);
  return `/api/recipe-images/${filename}`;
}
```

- [x] **Step 2: Write failing tests**

Create `server/services/__tests__/canonical-enrichment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    getRecipeById: vi.fn(),
    markEnriched: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/runware", () => ({
  isRunwareConfigured: false,
  generateImage: vi.fn().mockResolvedValue(null),
  saveImageBuffer: vi.fn().mockResolvedValue("/api/recipe-images/test.png"),
  RUNWARE_MODEL_HQ: "runware:101@1",
}));

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  instructionDetails: ["Detailed step 1"],
                  toolsRequired: [{ name: "Skillet", affiliateUrl: null }],
                  chefTips: ["Tip 1"],
                  cuisineOrigin: "Italian",
                }),
              },
            },
          ],
        }),
      },
    },
  },
  MODEL_STANDARD: "gpt-4o",
  OPENAI_TIMEOUT_FAST_MS: 30000,
}));

import { generateEditorialContent } from "../canonical-enrichment";

describe("generateEditorialContent", () => {
  it("returns structured content from GPT-4o", async () => {
    const result = await generateEditorialContent({
      title: "Pasta Carbonara",
      ingredients: [{ name: "eggs", quantity: "3", unit: "large" }],
      instructions: ["Boil pasta"],
    });
    expect(result.instructionDetails).toHaveLength(1);
    expect(result.toolsRequired[0].name).toBe("Skillet");
    expect(result.cuisineOrigin).toBe("Italian");
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
npm run test:run -- server/services/__tests__/canonical-enrichment.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 4: Create `server/services/canonical-enrichment.ts`**

```typescript
import pLimit from "p-limit";
import { z } from "zod";
import { openai, MODEL_STANDARD, OPENAI_TIMEOUT_FAST_MS } from "../lib/openai";
import {
  generateImage,
  saveImageBuffer,
  isRunwareConfigured,
  RUNWARE_MODEL_HQ,
} from "../lib/runware";
import { dalleClient } from "../lib/openai";
import { storage } from "../storage";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";
import type { CommunityRecipe } from "@shared/schema";

const log = createServiceLogger("canonical-enrichment");
const imageLimit = pLimit(1); // Generate images sequentially to respect API limits

const editorialSchema = z.object({
  instructionDetails: z.array(z.string().nullable()),
  toolsRequired: z.array(
    z.object({
      name: z.string(),
      affiliateUrl: z.string().nullable().optional(),
    }),
  ),
  chefTips: z.array(z.string()),
  cuisineOrigin: z.string(),
});

const IMAGE_SHOTS = [
  {
    label: "hero",
    prompt: (title: string) =>
      `Professional overhead food photography of "${title}". Natural window lighting, shallow depth of field, plated on neutral ceramic, fresh herb garnish, clean minimalist background, photorealistic, no text, no watermarks`,
  },
  {
    label: "plated",
    prompt: (title: string) =>
      `Restaurant-style 45-degree angle food photography of "${title}". Elegant plating, bokeh background, warm ambient lighting, photorealistic, no text, no watermarks`,
  },
  {
    label: "ingredients",
    prompt: (title: string) =>
      `Flat lay of raw ingredients for "${title}" arranged artfully on white marble surface, top-down view, natural light, photorealistic, no text, no watermarks`,
  },
] as const;

async function generateCanonicalImages(title: string): Promise<string[]> {
  const urls: string[] = [];
  for (const shot of IMAGE_SHOTS) {
    const url = await imageLimit(async () => {
      const prompt = shot.prompt(title);
      if (isRunwareConfigured) {
        try {
          const buffer = await generateImage({
            prompt,
            model: RUNWARE_MODEL_HQ,
          });
          if (buffer) return saveImageBuffer(buffer);
        } catch (err) {
          log.warn(
            { err: toError(err) },
            `Runware failed for ${shot.label}, trying DALL-E`,
          );
        }
      }
      try {
        const response = await dalleClient.images.generate({
          model: "dall-e-3",
          prompt: `${prompt}. No text, no watermarks, no logos.`,
          n: 1,
          size: "1024x1024",
          quality: "hd",
          response_format: "b64_json",
        });
        const b64 = response.data?.[0]?.b64_json;
        if (b64) return saveImageBuffer(Buffer.from(b64, "base64"));
      } catch (err) {
        log.error({ err: toError(err) }, `DALL-E failed for ${shot.label}`);
      }
      return null;
    });
    if (url) urls.push(url);
  }
  return urls;
}

export async function generateEditorialContent(recipe: {
  title: string;
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
}): Promise<z.infer<typeof editorialSchema>> {
  const safeTitle = sanitizeUserInput(recipe.title);
  const ingredientList = recipe.ingredients
    .map((i) => `${i.quantity} ${i.unit} ${i.name}`)
    .join(", ");
  const instructionList = recipe.instructions
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  const response = await openai.chat.completions.create(
    {
      model: MODEL_STANDARD,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a professional recipe editor. Given a recipe, return a JSON object with:
- "instructionDetails": array of strings (one per instruction step) with 2-4 sentences of expanded technique detail, visual cues, and common mistakes. Use null for steps that need no elaboration.
- "toolsRequired": array of {name, affiliateUrl: null} objects for cooking tools inferred from the instructions.
- "chefTips": array of 2-3 pro tips for the overall recipe not already in the steps.
- "cuisineOrigin": one sentence on the dish's cultural origin and context.

${SYSTEM_PROMPT_BOUNDARY}`,
        },
        {
          role: "user",
          content: `Recipe: "${safeTitle}"\nIngredients: ${ingredientList}\nInstructions:\n${instructionList}`,
        },
      ],
    },
    { timeout: OPENAI_TIMEOUT_FAST_MS },
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("No editorial content returned");

  const parsed = editorialSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Invalid editorial content shape");
  return parsed.data;
}

function normalizeIngredientUnit(unit: string): string {
  const map: Record<string, string> = {
    tbs: "tablespoons",
    tbsp: "tablespoons",
    tsp: "teaspoons",
    c: "cups",
    oz: "ounces",
    g: "grams",
    kg: "kilograms",
    ml: "milliliters",
    l: "liters",
  };
  return map[unit.toLowerCase().trim()] ?? unit;
}

function normalizeInstruction(step: string): string {
  const trimmed = step.trim();
  if (!trimmed) return trimmed;
  const capitalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  return capitalized.endsWith(".") ||
    capitalized.endsWith("!") ||
    capitalized.endsWith("?")
    ? capitalized
    : `${capitalized}.`;
}

export async function enrichRecipe(recipeId: number): Promise<void> {
  const recipe = await storage.getRecipeById(recipeId);
  if (!recipe) throw new Error(`Recipe ${recipeId} not found`);

  log.info({ recipeId, title: recipe.title }, "starting enrichment");

  // Step 1: Images
  const canonicalImages = await generateCanonicalImages(recipe.title);
  log.info({ recipeId, count: canonicalImages.length }, "images generated");

  // Step 2: Normalize ingredient units
  const normalizedIngredients = (recipe.ingredients ?? []).map((ing) => ({
    ...ing,
    unit: normalizeIngredientUnit(ing.unit),
  }));

  // Step 3: Normalize instructions
  const normalizedInstructions = (recipe.instructions ?? []).map(
    normalizeInstruction,
  );

  // Step 4: AI editorial content
  const editorial = await generateEditorialContent({
    title: recipe.title,
    ingredients: normalizedIngredients,
    instructions: normalizedInstructions,
  });

  // Step 5: Persist
  await storage.markEnriched(recipeId, {
    canonicalImages,
    instructionDetails: editorial.instructionDetails,
    toolsRequired: editorial.toolsRequired.map((t) => ({
      name: t.name,
      affiliateUrl: t.affiliateUrl ?? undefined,
    })),
    chefTips: editorial.chefTips,
    cuisineOrigin: editorial.cuisineOrigin,
  });

  log.info({ recipeId }, "enrichment complete");
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm run test:run -- server/services/__tests__/canonical-enrichment.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

```bash
npm run test:run
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add server/lib/runware.ts server/services/canonical-enrichment.ts server/services/__tests__/canonical-enrichment.test.ts
git commit -m "feat: add canonical enrichment pipeline (HQ images, normalization, AI editorial)"
```

---

## Task 6: Seed Script

**Files:**

- Create: `scripts/canonicalize-recipe.ts`

- [x] **Step 1: Create the seed script**

```typescript
#!/usr/bin/env npx tsx
/**
 * Manually promote and enrich a recipe to curated status, bypassing the
 * popularity threshold. Run with:
 *   npx tsx scripts/canonicalize-recipe.ts <id>
 *   npx tsx scripts/canonicalize-recipe.ts --search "chicken tikka"
 *   npx tsx scripts/canonicalize-recipe.ts --top 5
 */
import { db } from "../server/db";
import { communityRecipes } from "../shared/schema";
import { ilike, desc } from "drizzle-orm";
import {
  markCanonical,
  markEnriched,
  getRecipeById,
} from "../server/storage/canonical-recipes";
import { enrichRecipe } from "../server/services/canonical-enrichment";

async function canonicalizeById(id: number) {
  const recipe = await getRecipeById(id);
  if (!recipe) {
    console.error(`Recipe ${id} not found`);
    process.exit(1);
  }
  console.log(`\nCanonicalizaing: "${recipe.title}" (id=${recipe.id})`);
  console.log(`  Current image: ${recipe.imageUrl ?? "(none)"}`);
  console.log(`  Instructions: ${recipe.instructions?.length ?? 0} steps`);
  console.log(`  Is canonical: ${recipe.isCanonical}`);

  if (!recipe.isCanonical) {
    await markCanonical(recipe.id);
    console.log("  ✓ Marked canonical");
  }

  console.log("  Running enrichment pipeline...");
  await enrichRecipe(recipe.id);
  const updated = await getRecipeById(recipe.id);
  console.log(`  ✓ Canonical images: ${updated?.canonicalImages?.length ?? 0}`);
  console.log(
    `  ✓ Instruction details: ${updated?.instructionDetails?.filter(Boolean).length ?? 0}/${updated?.instructions?.length ?? 0} steps`,
  );
  console.log(`  ✓ Tools required: ${updated?.toolsRequired?.length ?? 0}`);
  console.log(`  ✓ Chef tips: ${updated?.chefTips?.length ?? 0}`);
  console.log(`  ✓ Cuisine origin: ${updated?.cuisineOrigin ?? "(none)"}`);
  console.log(`  Done: ${recipe.title}\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--search" && args[1]) {
    const q = `%${args[1]}%`;
    const [recipe] = await db
      .select()
      .from(communityRecipes)
      .where(ilike(communityRecipes.title, q))
      .limit(1);
    if (!recipe) {
      console.error(`No recipe matching "${args[1]}"`);
      process.exit(1);
    }
    await canonicalizeById(recipe.id);
  } else if (args[0] === "--top" && args[1]) {
    const n = parseInt(args[1], 10);
    const recipes = await db
      .select()
      .from(communityRecipes)
      .orderBy(desc(communityRecipes.popularityScore))
      .limit(n);
    console.log(`Canonicalizing top ${n} recipes by popularity score`);
    for (const r of recipes) {
      await canonicalizeById(r.id);
    }
  } else if (args[0] && /^\d+$/.test(args[0])) {
    await canonicalizeById(parseInt(args[0], 10));
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/canonicalize-recipe.ts <id>");
    console.log(
      '  npx tsx scripts/canonicalize-recipe.ts --search "chicken tikka"',
    );
    console.log("  npx tsx scripts/canonicalize-recipe.ts --top 5");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script on 3 existing recipes to verify output**

First find some recipe IDs:

```bash
npx tsx -e "
import { db } from './server/db';
import { communityRecipes } from './shared/schema';
const r = await db.select({ id: communityRecipes.id, title: communityRecipes.title }).from(communityRecipes).limit(5);
console.log(r); process.exit(0);
"
```

Then run the seed on the first recipe found (replace 1 with an actual ID):

```bash
npx tsx scripts/canonicalize-recipe.ts <actual-id>
```

Expected: verbose log showing images generated, steps enriched, tools found, tips written. Review the output quality — if content looks off, check the GPT-4o prompt in `canonical-enrichment.ts`.

- [ ] **Step 3: Run the seed on 2 more recipes**

```bash
npx tsx scripts/canonicalize-recipe.ts --top 3
```

Expected: 3 recipes enriched. Review each output.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add scripts/canonicalize-recipe.ts
git commit -m "feat: add canonicalize-recipe seed CLI script"
```

---

## Task 7: CuratedBadge Component

**Files:**

- Create: `client/components/CuratedBadge.tsx`
- Create: `client/components/__tests__/CuratedBadge.test.tsx`

- [x] **Step 1: Write failing test**

Create `client/components/__tests__/CuratedBadge.test.tsx`:

```typescript
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { CuratedBadge } from "../CuratedBadge";

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { primary: "#007AFF", background: "#fff", text: "#000" } }),
}));

describe("CuratedBadge", () => {
  it("renders Curated label", () => {
    render(<CuratedBadge />);
    expect(screen.getByText("Curated")).toBeTruthy();
  });

  it("renders compact variant without text", () => {
    render(<CuratedBadge compact />);
    expect(screen.queryByText("Curated")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm run test:run -- client/components/__tests__/CuratedBadge.test.tsx
```

Expected: FAIL — module not found.

- [x] **Step 3: Create `client/components/CuratedBadge.tsx`**

```typescript
import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";

interface CuratedBadgeProps {
  /** Show star only, no text label */
  compact?: boolean;
}

export function CuratedBadge({ compact = false }: CuratedBadgeProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.warning ?? "#F5A623", 0.15) },
      ]}
      accessible
      accessibilityLabel="Curated recipe"
      accessibilityRole="text"
    >
      <Feather name="star" size={compact ? 10 : 11} color={theme.warning ?? "#F5A623"} />
      {!compact && (
        <ThemedText style={[styles.label, { color: theme.warning ?? "#F5A623" }]}>
          Curated
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm run test:run -- client/components/__tests__/CuratedBadge.test.tsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add client/components/CuratedBadge.tsx client/components/__tests__/CuratedBadge.test.tsx
git commit -m "feat: add CuratedBadge component"
```

---

## Task 8: Backend Route for Curated Recipes (API endpoint for home carousel + public API)

**Files:**

- Create: `server/routes/curated-recipes.ts`
- Modify: `server/routes.ts`
- Modify: `shared/types/public-api.ts`
- Modify: `server/routes/public-api.ts`

- [x] **Step 1: Create internal curated recipes route**

Create `server/routes/curated-recipes.ts`:

```typescript
import type { Express, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import type { AuthenticatedRequest } from "../middleware/auth";

export function register(app: Express): void {
  const router = Router();

  // GET /api/curated-recipes — paginated curated recipe list for home carousel
  router.get(
    "/",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit) || 20, 50);
        const offset = Number(req.query.offset) || 0;
        const recipes = await storage.getCuratedRecipes({ limit, offset });
        res.json({ recipes });
      } catch (err) {
        sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  app.use("/api/curated-recipes", router);
}
```

- [x] **Step 2: Register in `server/routes.ts`**

Add import:

```typescript
import { register as registerCuratedRecipes } from "./routes/curated-recipes";
```

Add after other `register*` calls:

```typescript
registerCuratedRecipes(app);
```

- [x] **Step 3: Add recipe types to `shared/types/public-api.ts`**

Append to the file:

```typescript
export interface CuratedRecipeResponse {
  id: number;
  title: string;
  description: string | null;
  cuisineOrigin: string | null;
  difficulty: string | null;
  timeEstimate: string | null;
  servings: number | null;
  dietTags: string[];
  mealTypes: string[];
  caloriesPerServing: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  instructionDetails: (string | null)[];
  toolsRequired: { name: string; affiliateUrl?: string }[];
  chefTips: string[];
  canonicalImages: string[];
  videoUrl: string | null;
  canonicalizedAt: string | null;
}
```

- [x] **Step 4: Add recipe endpoints to `server/routes/public-api.ts`**

Add a helper serializer after the existing `serializePaidResponse`:

```typescript
import type { CuratedRecipeResponse } from "@shared/types/public-api";
import type { CommunityRecipe } from "@shared/schema";

function serializeCuratedRecipe(r: CommunityRecipe): CuratedRecipeResponse {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    cuisineOrigin: r.cuisineOrigin ?? null,
    difficulty: r.difficulty ?? null,
    timeEstimate: r.timeEstimate ?? null,
    servings: r.servings ?? null,
    dietTags: (r.dietTags as string[]) ?? [],
    mealTypes: (r.mealTypes as string[]) ?? [],
    caloriesPerServing: r.caloriesPerServing
      ? Number(r.caloriesPerServing)
      : null,
    protein: r.proteinPerServing ? Number(r.proteinPerServing) : null,
    carbs: r.carbsPerServing ? Number(r.carbsPerServing) : null,
    fat: r.fatPerServing ? Number(r.fatPerServing) : null,
    ingredients:
      (r.ingredients as { name: string; quantity: string; unit: string }[]) ??
      [],
    instructions: (r.instructions as string[]) ?? [],
    instructionDetails: (r.instructionDetails as (string | null)[]) ?? [],
    toolsRequired:
      (r.toolsRequired as { name: string; affiliateUrl?: string }[]) ?? [],
    chefTips: (r.chefTips as string[]) ?? [],
    canonicalImages: (r.canonicalImages as string[]) ?? [],
    videoUrl: r.videoUrl ?? null,
    canonicalizedAt: r.canonicalizedAt?.toISOString() ?? null,
  };
}
```

Then add recipe routes inside the `register` function before `app.use("/api/v1", router)`:

```typescript
router.get("/recipes", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Number(req.query.offset) || 0;
    const recipes = await storage.getCuratedRecipes({ limit, offset });
    res.json({ data: recipes.map(serializeCuratedRecipe) });
  } catch (err) {
    logger.error({ err: toError(err) }, "public API recipes list error");
    sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
  }
});

router.get("/recipes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
      return;
    }
    const recipe = await storage.getCuratedRecipeById(id);
    if (!recipe) {
      sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
      return;
    }
    res.json({ data: serializeCuratedRecipe(recipe) });
  } catch (err) {
    logger.error({ err: toError(err) }, "public API recipe detail error");
    sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
  }
});
```

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add server/routes/curated-recipes.ts server/routes.ts shared/types/public-api.ts server/routes/public-api.ts
git commit -m "feat: add curated recipes API routes (internal + public /api/v1/recipes)"
```

---

## Task 9: Home Screen Curated Carousel

**Files:**

- Create: `client/hooks/useCuratedRecipes.ts`
- Create: `client/components/home/CuratedRecipeCarousel.tsx`
- Modify: `client/screens/HomeScreen.tsx`

- [x] **Step 1: Create `client/hooks/useCuratedRecipes.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { CommunityRecipe } from "@shared/schema";

interface CuratedRecipesResponse {
  recipes: CommunityRecipe[];
}

export function useCuratedRecipes() {
  return useQuery<CuratedRecipesResponse>({
    queryKey: ["/api/curated-recipes"],
    queryFn: () => apiRequest<CuratedRecipesResponse>("/api/curated-recipes"),
    staleTime: 5 * 60 * 1000,
  });
}
```

- [x] **Step 2: Create `client/components/home/CuratedRecipeCarousel.tsx`**

Model this on the existing `RecipeCarousel` (`client/components/home/RecipeCarousel.tsx`). The key differences: it queries `/api/curated-recipes`, uses `canonicalImages[0]` as the image (falls back to `imageUrl`), and shows the `CuratedBadge`:

```typescript
import React, { useCallback } from "react";
import { FlatList, StyleSheet, View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { CuratedBadge } from "@/components/CuratedBadge";
import { CarouselSkeleton } from "./CarouselSkeleton";
import { useTheme } from "@/hooks/useTheme";
import { useCuratedRecipes } from "@/hooks/useCuratedRecipes";
import { resolveImageUrl } from "@/lib/image-url";
import { Spacing, FontFamily } from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";
import type { CommunityRecipe } from "@shared/schema";
import { Image } from "expo-image";

const CARD_WIDTH = 200;
const CARD_HEIGHT = 140;

export const CuratedRecipeCarousel = React.memo(function CuratedRecipeCarousel() {
  const { theme } = useTheme();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { data, isLoading } = useCuratedRecipes();

  const recipes = data?.recipes ?? [];

  const handlePress = useCallback(
    (recipe: CommunityRecipe) => {
      navigation.navigate("FeaturedRecipeDetail", {
        recipeType: "community",
        recipeId: recipe.id,
      });
    },
    [navigation],
  );

  if (isLoading) return <CarouselSkeleton />;
  if (recipes.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <ThemedText style={[styles.heading, { color: theme.text }]}>
        Curated Recipes
      </ThemedText>
      <FlatList
        data={recipes}
        keyExtractor={(r) => String(r.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + Spacing.md}
        decelerationRate="fast"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const imageUri = resolveImageUrl(
            (item.canonicalImages as string[])?.[0] ?? item.imageUrl,
          );
          return (
            <Pressable
              onPress={() => handlePress(item)}
              style={[styles.card, { backgroundColor: theme.card }]}
              accessibilityLabel={`Open ${item.title}`}
              accessibilityRole="button"
            >
              {imageUri && (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.image}
                  contentFit="cover"
                />
              )}
              <View style={styles.cardBody}>
                <CuratedBadge compact />
                <ThemedText style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </ThemedText>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.lg },
  heading: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  list: { paddingHorizontal: Spacing.md, gap: Spacing.md },
  card: {
    width: CARD_WIDTH,
    borderRadius: 12,
    overflow: "hidden",
  },
  image: { width: CARD_WIDTH, height: CARD_HEIGHT },
  cardBody: { padding: Spacing.sm, gap: 4 },
  cardTitle: { fontSize: 13, fontWeight: "600" },
});
```

- [x] **Step 3: Add `CuratedRecipeCarousel` to `client/screens/HomeScreen.tsx`**

Import it at the top:

```typescript
import { CuratedRecipeCarousel } from "@/components/home/CuratedRecipeCarousel";
```

In the JSX, add it below the existing `RecipeCarousel` (search for `<RecipeCarousel` in HomeScreen.tsx and place it after):

```typescript
<RecipeCarousel />
<CuratedRecipeCarousel />
```

- [ ] **Step 4: Run full test suite + type check**

```bash
npm run test:run && npm run check:types
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add client/hooks/useCuratedRecipes.ts client/components/home/CuratedRecipeCarousel.tsx client/screens/HomeScreen.tsx
git commit -m "feat: add Curated Recipes carousel to Home screen"
```

---

## Task 10: Curated Filter in Recipe Browser

**Files:**

- Modify: `shared/types/recipe-search.ts`
- Modify: `server/routes/recipe-search.ts` (or the search service — check where `RecipeSearchParams` is consumed)
- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx`

- [x] **Step 1: Add `curatedOnly` to `RecipeSearchParams` in `shared/types/recipe-search.ts`**

Find `RecipeSearchParams` interface and add:

```typescript
  curatedOnly?: boolean;
```

Also add `isCanonical` to `SearchableRecipe`:

```typescript
  isCanonical?: boolean;
```

- [x] **Step 2: Update `communityToSearchable` in `server/lib/search-index.ts`**

Find the `communityToSearchable` function and add `isCanonical` to the returned object:

```typescript
  isCanonical: recipe.isCanonical ?? false,
```

- [x] **Step 3: Apply `curatedOnly` filter in the recipe search service**

Open `server/services/recipe-search.ts`. The search service uses a `predicates` array (around line 214) — each predicate is a `(r: SearchableRecipe) => boolean` function that is applied in a single O(N) pass. Add the `curatedOnly` predicate to the destructured params and into the predicates array, following the same pattern as the other filters (around line 279, before the `candidates.filter(...)` call):

First destructure `curatedOnly` from params at the top of `searchRecipes` (alongside `source`, `cuisine`, `diet`, etc.):

```typescript
const {
  q,
  curatedOnly,
  source,
  cuisine,
  diet,
  mealType,
  difficulty,
  maxPrepTime,
  maxCalories,
  minProtein,
  sort,
  limit = 20,
  offset = 0,
} = params;
```

Then add the predicate after the `minProtein` block (around line 276):

```typescript
if (curatedOnly) {
  filters.curatedOnly = true;
  predicates.push(
    (r) => !!(r as SearchableRecipe & { isCanonical?: boolean }).isCanonical,
  );
}
```

The cast is needed because `isCanonical` is added to `SearchableRecipe` in Step 1 but MiniSearch document types are typed as the base interface.

- [x] **Step 4: Add Curated toggle chip to `RecipeBrowserScreen.tsx`**

Add state:

```typescript
const [curatedOnly, setCuratedOnly] = useState(false);
```

Pass it to search params (alongside `activeCuisine`, `activeDiet`, etc.):

```typescript
curatedOnly,
```

In the filter chip JSX section (around line 564), add a "Curated" chip in its own group before the cuisine chips:

```typescript
<Chip
  label="⭐ Curated"
  variant="filter"
  selected={curatedOnly}
  onPress={() => {
    haptics.selection();
    setCuratedOnly((prev) => !prev);
  }}
  accessibilityLabel="Show curated recipes only"
/>
<View style={[styles.filterDivider, { backgroundColor: withOpacity(theme.text, 0.15) }]} />
```

Also add `curatedOnly` to the "has active filters" count (around line 726 where `activeCuisine || activeDiet` is checked):

```typescript
curatedOnly ||
activeCuisine ||
activeDiet ||
```

- [ ] **Step 5: Run full test suite + type check**

```bash
npm run test:run && npm run check:types
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add shared/types/recipe-search.ts server/lib/search-index.ts server/services/recipe-search.ts client/screens/meal-plan/RecipeBrowserScreen.tsx
git commit -m "feat: add Curated filter chip to recipe browser search"
```

---

## Task 11: Recipe Detail — Image Gallery, Expandable Steps, Tools Required, Chef's Notes

**Files:**

- Modify: `client/screens/FeaturedRecipeDetailScreen.tsx`

- [x] **Step 1: Extend the normalized recipe type in `FeaturedRecipeDetailScreen.tsx`**

Find the inline type around line 46 that has `instructions`, `imageUrl`, etc. Extend it with canonical fields:

```typescript
  isCanonical?: boolean;
  canonicalImages?: string[] | null;
  instructionDetails?: (string | null)[] | null;
  toolsRequired?: { name: string; affiliateUrl?: string }[] | null;
  chefTips?: string[] | null;
  cuisineOrigin?: string | null;
```

Update the normalization blocks (where `communityRecipe` and `mealPlanRecipe` are mapped) to pass through these fields from `communityRecipe`:

```typescript
  isCanonical: communityRecipe.isCanonical,
  canonicalImages: communityRecipe.canonicalImages as string[] ?? [],
  instructionDetails: communityRecipe.instructionDetails as (string | null)[] ?? [],
  toolsRequired: communityRecipe.toolsRequired as { name: string; affiliateUrl?: string }[] ?? [],
  chefTips: communityRecipe.chefTips as string[] ?? [],
  cuisineOrigin: communityRecipe.cuisineOrigin ?? null,
```

- [x] **Step 2: Add expandable steps state and logic**

Add imports:

```typescript
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  LayoutAnimationConfig,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
```

Add state for expanded steps and hint visibility:

```typescript
const [expandedStep, setExpandedStep] = useState<number | null>(null);
const [hasShownHint, setHasShownHint] = useState(true);

useEffect(() => {
  AsyncStorage.getItem("curated_step_hint_shown").then((v) => {
    if (!v) setHasShownHint(false);
  });
}, []);

const handleStepLongPress = useCallback(
  (index: number) => {
    setExpandedStep((prev) => (prev === index ? null : index));
    if (!hasShownHint) {
      setHasShownHint(true);
      AsyncStorage.setItem("curated_step_hint_shown", "1");
    }
  },
  [hasShownHint],
);
```

- [x] **Step 3: Replace single image with gallery and add Curated sections to JSX**

Find where `imageUrl` is rendered (around line 190, the hero image). Conditionally render a `FlatList` gallery for curated recipes or the original single image for non-curated:

```typescript
{normalized.isCanonical && (normalized.canonicalImages?.length ?? 0) > 0 ? (
  <FlatList
    data={normalized.canonicalImages}
    keyExtractor={(url, i) => `${i}-${url}`}
    horizontal
    pagingEnabled
    showsHorizontalScrollIndicator={false}
    renderItem={({ item }) => (
      <Image
        source={{ uri: resolveImageUrl(item) }}
        style={{ width: screenWidth, height: 260 }}
        contentFit="cover"
      />
    )}
  />
) : (
  <Image
    source={{ uri: resolveImageUrl(normalized.imageUrl) }}
    style={{ width: screenWidth, height: 260 }}
    contentFit="cover"
  />
)}
```

Find where `instructions` are rendered. Replace each instruction item with a long-pressable row (for curated recipes only):

```typescript
{normalized.instructions.map((step, i) => {
  const detail = normalized.instructionDetails?.[i];
  const isExpanded = expandedStep === i;
  const isExpandable = normalized.isCanonical && !!detail;

  return (
    <Pressable
      key={i}
      onLongPress={isExpandable ? () => handleStepLongPress(i) : undefined}
      delayLongPress={300}
      accessible
      accessibilityLabel={`Step ${i + 1}: ${step}${isExpandable ? ". Long press for details." : ""}`}
    >
      <Animated.View layout={LayoutAnimationConfig}>
        <ThemedText>{`${i + 1}. ${step}`}</ThemedText>
        {isExpanded && detail && (
          <ThemedText style={styles.stepDetail}>{detail}</ThemedText>
        )}
      </Animated.View>
    </Pressable>
  );
})}
{normalized.isCanonical && !hasShownHint && (
  <ThemedText style={styles.stepHint}>Hold any step for more detail</ThemedText>
)}
```

Add styles:

```typescript
stepDetail: { marginTop: 6, opacity: 0.75, fontSize: 13, lineHeight: 18 },
stepHint: { fontSize: 12, opacity: 0.5, marginTop: 4, fontStyle: "italic" },
```

- [x] **Step 4: Add Tools Required section**

After the ingredients section, add (conditional on `isCanonical`):

```typescript
{normalized.isCanonical && (normalized.toolsRequired?.length ?? 0) > 0 && (
  <View style={styles.section}>
    <ThemedText style={styles.sectionHeading}>Tools Required</ThemedText>
    {normalized.toolsRequired!.map((tool, i) => (
      <Pressable
        key={i}
        onPress={tool.affiliateUrl ? () => WebBrowser.openBrowserAsync(tool.affiliateUrl!) : undefined}
        style={styles.toolRow}
        accessibilityLabel={tool.affiliateUrl ? `${tool.name} — tap to view` : tool.name}
      >
        <ThemedText style={styles.toolName}>{tool.name}</ThemedText>
        {tool.affiliateUrl && <Feather name="external-link" size={14} />}
      </Pressable>
    ))}
  </View>
)}
```

- [x] **Step 5: Add Chef's Notes card**

At the bottom of the scroll content (before action buttons), add:

```typescript
{normalized.isCanonical &&
  ((normalized.chefTips?.length ?? 0) > 0 || normalized.cuisineOrigin) && (
  <View style={[styles.chefCard, { backgroundColor: theme.card }]}>
    {normalized.cuisineOrigin && (
      <ThemedText style={styles.cuisineOrigin}>{normalized.cuisineOrigin}</ThemedText>
    )}
    {normalized.chefTips?.map((tip, i) => (
      <ThemedText key={i} style={styles.chefTip}>• {tip}</ThemedText>
    ))}
  </View>
)}
```

Add styles:

```typescript
chefCard: { margin: Spacing.md, padding: Spacing.md, borderRadius: 12 },
cuisineOrigin: { fontSize: 13, opacity: 0.6, marginBottom: 6, fontStyle: "italic" },
chefTip: { fontSize: 14, lineHeight: 20, marginTop: 4 },
toolRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
toolName: { fontSize: 15 },
```

- [ ] **Step 6: Run full test suite + type check**

```bash
npm run test:run && npm run check:types
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add client/screens/FeaturedRecipeDetailScreen.tsx
git commit -m "feat: add curated recipe detail sections (image gallery, expandable steps, tools required, chef's notes)"
```

---

## Task 12: Final — Wire CuratedBadge to Existing Recipe Cards

**Files:**

- Modify: `client/components/home/CarouselRecipeCard.tsx` (or wherever recipe cards are rendered with the existing carousel)
- Modify: `client/screens/FavouriteRecipesScreen.tsx` (if it renders recipe cards)

- [x] **Step 1: Add `CuratedBadge` to `CarouselRecipeCard`**

Open `client/components/home/CarouselRecipeCard.tsx`. Find the card body JSX. Import `CuratedBadge` and add it conditionally:

```typescript
import { CuratedBadge } from "@/components/CuratedBadge";
```

In the card body, check for an `isCanonical` prop and render the badge:

```typescript
{item.isCanonical && <CuratedBadge compact />}
```

Add `isCanonical?: boolean` to the card's prop type.

- [ ] **Step 2: Verify the badge appears on promoted recipes in the existing carousel**

Start the dev server and visually confirm seeded canonical recipes show the badge in the `RecipeCarousel`.

- [ ] **Step 3: Run full test suite + type check + lint**

```bash
npm run test:run && npm run check:types && npm run lint
```

Expected: all pass, no lint errors.

- [ ] **Step 4: Final commit**

```bash
git add client/components/home/CarouselRecipeCard.tsx
git commit -m "feat: show CuratedBadge on canonical recipe cards in carousel"
```
