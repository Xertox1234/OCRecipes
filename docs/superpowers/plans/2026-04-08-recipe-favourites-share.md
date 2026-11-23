# Recipe Favourites, Share & Save-to-Cookbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a favourite (heart) toggle, native share, and repositioned save-to-cookbook action to recipe detail screens and browse cards.

**Architecture:** New `favouriteRecipes` table with polymorphic FK pattern (same as `cookbookRecipes`). Toggle endpoint with transactional tier-limit checks. Client uses optimistic updates on a cached ID set for instant heart feedback. `RecipeActionBar` component surfaces all three actions prominently on recipe detail. Heart icon added to recipe browse cards, replacing thumbs up/down.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express.js routes, Zod validation, TanStack Query v5 hooks, React Native `Share` API, Reanimated for heart animation.

---

## File Structure

### New Files

| File                                                 | Responsibility                                  |
| ---------------------------------------------------- | ----------------------------------------------- |
| `server/storage/favourite-recipes.ts`                | DB operations: toggle, list IDs, resolve, count |
| `server/routes/favourite-recipes.ts`                 | 4 API endpoints for favourites                  |
| `server/routes/__tests__/favourite-recipes.test.ts`  | Route-level tests                               |
| `client/hooks/useFavouriteRecipes.ts`                | TanStack Query hooks + optimistic updates       |
| `client/hooks/__tests__/useFavouriteRecipes.test.ts` | Hook tests                                      |
| `client/components/RecipeActionBar.tsx`              | Favourite + Share + Save-to-Cookbook bar        |
| `client/screens/FavouriteRecipesScreen.tsx`          | Full-screen favourites list                     |

### Modified Files

| File                                              | Change                                                        |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `shared/schema.ts`                                | Add `favouriteRecipes` table + types                          |
| `shared/types/premium.ts`                         | Add `maxFavouriteRecipes` to `PremiumFeatures` + tier configs |
| `shared/__tests__/premium.test.ts`                | Test new premium field                                        |
| `server/storage/index.ts`                         | Wire up favourite-recipes storage                             |
| `server/routes.ts`                                | Register favourite-recipes routes                             |
| `client/components/RecipeDetailContent.tsx`       | Replace save/remix buttons with `RecipeActionBar`             |
| `client/navigation/MealPlanStackNavigator.tsx`    | Add `FavouriteRecipes` screen                                 |
| `client/navigation/ProfileStackNavigator.tsx`     | Add `FavouriteRecipes` screen                                 |
| `client/types/navigation.ts`                      | Add nav prop type for `FavouriteRecipesScreen`                |
| `client/screens/meal-plan/CookbookListScreen.tsx` | Add pinned Favourites row                                     |
| `client/components/profile/library-config.ts`     | Add favourites item to library grid                           |
| `shared/schemas/profile-hub.ts`                   | Add `favouriteRecipes` to library counts schema               |
| `server/storage/profile-hub.ts`                   | Add favourites count subselect                                |
| `client/navigation/linking.ts`                    | Parse `type` query param on recipe deep link                  |

---

## Task 1: Schema & Premium Tier

**Files:**

- Modify: `shared/schema.ts`
- Modify: `shared/types/premium.ts`
- Modify: `shared/__tests__/premium.test.ts`

- [ ] **Step 1: Add `favouriteRecipes` table to schema**

In `shared/schema.ts`, add the table definition after the `favouriteScannedItems` table (after line ~430). Also add the type exports near the other cookbook types (after `ResolvedCookbookRecipe`).

```typescript
// Add after favouriteScannedItems table definition

export const favouriteRecipes = pgTable(
  "favourite_recipes",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id").notNull(),
    recipeType: text("recipe_type").notNull(), // "mealPlan" | "community"
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    uniqueUserRecipe: unique().on(
      table.userId,
      table.recipeId,
      table.recipeType,
    ),
    userIdIdx: index("favourite_recipes_user_id_idx").on(table.userId),
  }),
);

// Add with the other type exports
export type FavouriteRecipe = typeof favouriteRecipes.$inferSelect;

/** Resolved favourite recipe — same shape as ResolvedCookbookRecipe */
export interface ResolvedFavouriteRecipe {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  title: string;
  description: string | null;
  imageUrl: string | null;
  servings: number | null;
  difficulty: string | null;
  favouritedAt: string;
}
```

- [ ] **Step 2: Add `maxFavouriteRecipes` to premium types**

In `shared/types/premium.ts`, add `maxFavouriteRecipes: number;` to the `PremiumFeatures` interface (after `maxSavedItems`), then add values to both tier configs:

```typescript
// In PremiumFeatures interface, after maxSavedItems:
maxFavouriteRecipes: number;

// In TIER_FEATURES.free, after maxSavedItems: 6:
maxFavouriteRecipes: 20,

// In TIER_FEATURES.premium, after maxSavedItems: UNLIMITED_SCANS:
maxFavouriteRecipes: UNLIMITED_SCANS,
```

- [ ] **Step 3: Update premium tests**

In `shared/__tests__/premium.test.ts`, add assertion in the "should have features for free tier" test:

```typescript
expect(freeFeatures.maxFavouriteRecipes).toBe(20);
```

And in the "should have features for premium tier" test:

```typescript
expect(premiumFeatures.maxFavouriteRecipes).toBe(UNLIMITED_SCANS);
```

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run shared/__tests__/premium.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts shared/types/premium.ts shared/__tests__/premium.test.ts
git commit -m "feat: add favouriteRecipes schema and premium tier limit"
```

---

## Task 2: Storage Layer

**Files:**

- Create: `server/storage/favourite-recipes.ts`
- Modify: `server/storage/index.ts`

- [ ] **Step 1: Create storage module**

Create `server/storage/favourite-recipes.ts`:

```typescript
import { db } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  favouriteRecipes,
  mealPlanRecipes,
  communityRecipes,
  users,
  type FavouriteRecipe,
  type ResolvedFavouriteRecipe,
} from "@shared/schema";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import { fireAndForget } from "../lib/fire-and-forget";

/**
 * Toggle a recipe favourite on/off.
 * Returns `true` (favourited), `false` (unfavourited), or `null` (limit reached).
 */
export async function toggleFavouriteRecipe(
  userId: string,
  recipeId: number,
  recipeType: "mealPlan" | "community",
): Promise<boolean | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: favouriteRecipes.id })
      .from(favouriteRecipes)
      .where(
        and(
          eq(favouriteRecipes.userId, userId),
          eq(favouriteRecipes.recipeId, recipeId),
          eq(favouriteRecipes.recipeType, recipeType),
        ),
      );

    if (existing) {
      await tx
        .delete(favouriteRecipes)
        .where(eq(favouriteRecipes.id, existing.id));
      return false;
    }

    // Check tier limit before inserting
    const countResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(favouriteRecipes)
      .where(eq(favouriteRecipes.userId, userId));
    const count = countResult[0]?.count ?? 0;

    const [subRow] = await tx
      .select({ tier: users.subscriptionTier })
      .from(users)
      .where(eq(users.id, userId));
    const tierValue = subRow?.tier || "free";
    const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
    const limit = TIER_FEATURES[tier].maxFavouriteRecipes;

    if (count >= limit) {
      return null;
    }

    try {
      await tx
        .insert(favouriteRecipes)
        .values({ userId, recipeId, recipeType });
      return true;
    } catch (err: unknown) {
      // Concurrent toggle race: unique constraint violation
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "23505"
      ) {
        await tx
          .delete(favouriteRecipes)
          .where(
            and(
              eq(favouriteRecipes.userId, userId),
              eq(favouriteRecipes.recipeId, recipeId),
              eq(favouriteRecipes.recipeType, recipeType),
            ),
          );
        return false;
      }
      throw err;
    }
  });
}

/** Get all favourited recipe IDs for a user (for batch heart-state rendering). */
export async function getUserFavouriteRecipeIds(
  userId: string,
): Promise<{ recipeId: number; recipeType: string }[]> {
  return db
    .select({
      recipeId: favouriteRecipes.recipeId,
      recipeType: favouriteRecipes.recipeType,
    })
    .from(favouriteRecipes)
    .where(eq(favouriteRecipes.userId, userId));
}

/** Check if a single recipe is favourited. */
export async function isRecipeFavourited(
  userId: string,
  recipeId: number,
  recipeType: "mealPlan" | "community",
): Promise<boolean> {
  const [row] = await db
    .select({ id: favouriteRecipes.id })
    .from(favouriteRecipes)
    .where(
      and(
        eq(favouriteRecipes.userId, userId),
        eq(favouriteRecipes.recipeId, recipeId),
        eq(favouriteRecipes.recipeType, recipeType),
      ),
    );
  return !!row;
}

/** Get the count of favourited recipes for a user. */
export async function getFavouriteRecipeCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(favouriteRecipes)
    .where(eq(favouriteRecipes.userId, userId));
  return result[0]?.count ?? 0;
}

/**
 * Resolve favourited recipes with full details from source tables.
 * Uses partitioned batch fetch + orphan cleanup (same pattern as cookbooks).
 */
export async function getResolvedFavouriteRecipes(
  userId: string,
  limit = 50,
): Promise<ResolvedFavouriteRecipe[]> {
  const rows = await db
    .select()
    .from(favouriteRecipes)
    .where(eq(favouriteRecipes.userId, userId))
    .orderBy(sql`${favouriteRecipes.createdAt} DESC`)
    .limit(limit);

  if (rows.length === 0) return [];

  // Partition by recipeType
  const mealPlanIds: number[] = [];
  const communityIds: number[] = [];
  for (const row of rows) {
    if (row.recipeType === "mealPlan") {
      mealPlanIds.push(row.recipeId);
    } else if (row.recipeType === "community") {
      communityIds.push(row.recipeId);
    }
  }

  // Batch fetch from both tables in parallel
  const [mealPlanRows, communityRows] = await Promise.all([
    mealPlanIds.length
      ? db
          .select()
          .from(mealPlanRecipes)
          .where(inArray(mealPlanRecipes.id, mealPlanIds))
      : [],
    communityIds.length
      ? db
          .select()
          .from(communityRecipes)
          .where(inArray(communityRecipes.id, communityIds))
      : [],
  ]);

  // Map lookup for O(1) access
  const mealPlanMap = new Map(mealPlanRows.map((r) => [r.id, r]));
  const communityMap = new Map(communityRows.map((r) => [r.id, r]));

  // Resolve + detect orphans
  const resolved: ResolvedFavouriteRecipe[] = [];
  const orphanIds: number[] = [];

  for (const row of rows) {
    if (row.recipeType === "mealPlan") {
      const recipe = mealPlanMap.get(row.recipeId);
      if (recipe) {
        resolved.push({
          recipeId: recipe.id,
          recipeType: "mealPlan",
          title: recipe.title,
          description: recipe.description ?? null,
          imageUrl: recipe.imageUrl ?? null,
          servings: recipe.servings ?? null,
          difficulty: recipe.difficulty ?? null,
          favouritedAt: row.createdAt.toISOString(),
        });
      } else {
        orphanIds.push(row.id);
      }
    } else if (row.recipeType === "community") {
      const recipe = communityMap.get(row.recipeId);
      if (recipe) {
        resolved.push({
          recipeId: recipe.id,
          recipeType: "community",
          title: recipe.title,
          description: recipe.description ?? null,
          imageUrl: recipe.imageUrl ?? null,
          servings: recipe.servings ?? null,
          difficulty: recipe.difficulty ?? null,
          favouritedAt: row.createdAt.toISOString(),
        });
      } else {
        orphanIds.push(row.id);
      }
    }
  }

  // Fire-and-forget orphan cleanup
  if (orphanIds.length) {
    fireAndForget(
      "favourite-recipe-orphan-cleanup",
      db
        .delete(favouriteRecipes)
        .where(inArray(favouriteRecipes.id, orphanIds)),
    );
  }

  return resolved;
}
```

- [ ] **Step 2: Wire up storage in index**

In `server/storage/index.ts`, add the import and entries:

```typescript
// Add import after the cookbooksStorage import:
import * as favouriteRecipesStorage from "./favourite-recipes";

// Add section after the Cookbooks section (after line ~209):

// Favourite recipes
toggleFavouriteRecipe: favouriteRecipesStorage.toggleFavouriteRecipe,
getUserFavouriteRecipeIds: favouriteRecipesStorage.getUserFavouriteRecipeIds,
isRecipeFavourited: favouriteRecipesStorage.isRecipeFavourited,
getFavouriteRecipeCount: favouriteRecipesStorage.getFavouriteRecipeCount,
getResolvedFavouriteRecipes: favouriteRecipesStorage.getResolvedFavouriteRecipes,
```

- [ ] **Step 3: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/storage/favourite-recipes.ts server/storage/index.ts
git commit -m "feat: add favourite-recipes storage layer"
```

---

## Task 3: API Routes

**Files:**

- Create: `server/routes/favourite-recipes.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Create route file**

Create `server/routes/favourite-recipes.ts`:

```typescript
import type { Express, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { communityRecipes, mealPlanRecipes } from "@shared/schema";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { formatZodError, handleRouteError, parseQueryInt } from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";

const toggleFavouriteSchema = z.object({
  recipeId: z.number().int().positive(),
  recipeType: z.enum(["mealPlan", "community"]),
});

const checkFavouriteQuerySchema = z.object({
  recipeId: z.coerce.number().int().positive(),
  recipeType: z.enum(["mealPlan", "community"]),
});

export function register(app: Express): void {
  // GET /api/favourite-recipes — list resolved favourites
  app.get(
    "/api/favourite-recipes",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, 50, 1, 100);
        const recipes = await storage.getResolvedFavouriteRecipes(
          req.userId,
          limit,
        );
        res.json(recipes);
      } catch (error) {
        handleRouteError(res, error, "list favourite recipes");
      }
    },
  );

  // POST /api/favourite-recipes/toggle — toggle favourite on/off
  app.post(
    "/api/favourite-recipes/toggle",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = toggleFavouriteSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const result = await storage.toggleFavouriteRecipe(
          req.userId,
          parsed.data.recipeId,
          parsed.data.recipeType,
        );

        if (result === null) {
          sendError(
            res,
            403,
            "Favourite recipe limit reached. Upgrade to premium for unlimited favourites.",
            ErrorCode.LIMIT_REACHED,
          );
          return;
        }

        res.json({ favourited: result });
      } catch (error) {
        handleRouteError(res, error, "toggle favourite recipe");
      }
    },
  );

  // GET /api/favourite-recipes/check — check single recipe
  app.get(
    "/api/favourite-recipes/check",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = checkFavouriteQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const favourited = await storage.isRecipeFavourited(
          req.userId,
          parsed.data.recipeId,
          parsed.data.recipeType,
        );
        res.json({ favourited });
      } catch (error) {
        handleRouteError(res, error, "check favourite recipe");
      }
    },
  );

  // GET /api/favourite-recipes/ids — all favourited IDs (for batch heart-state)
  app.get(
    "/api/favourite-recipes/ids",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const ids = await storage.getUserFavouriteRecipeIds(req.userId);
        res.json({ ids });
      } catch (error) {
        handleRouteError(res, error, "get favourite recipe IDs");
      }
    },
  );
}
```

- [ ] **Step 2: Register routes**

In `server/routes.ts`, add the import and registration:

```typescript
// Add import after registerCookbooks:
import { register as registerFavouriteRecipes } from "./routes/favourite-recipes";

// Add registration after registerCookbooks(app); (line ~73):
registerFavouriteRecipes(app);
```

- [ ] **Step 3: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/routes/favourite-recipes.ts server/routes.ts
git commit -m "feat: add favourite-recipes API endpoints"
```

---

## Task 4: Route Tests

**Files:**

- Create: `server/routes/__tests__/favourite-recipes.test.ts`

- [ ] **Step 1: Write route tests**

Create `server/routes/__tests__/favourite-recipes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../favourite-recipes";

vi.mock("../../storage", () => ({
  storage: {
    toggleFavouriteRecipe: vi.fn(),
    getUserFavouriteRecipeIds: vi.fn(),
    isRecipeFavourited: vi.fn(),
    getResolvedFavouriteRecipes: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockResolvedRecipe = {
  recipeId: 10,
  recipeType: "community" as const,
  title: "Pasta Carbonara",
  description: "Classic Roman pasta",
  imageUrl: null,
  servings: 4,
  difficulty: "Medium",
  favouritedAt: new Date().toISOString(),
};

describe("Favourite Recipe Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/favourite-recipes", () => {
    it("returns resolved favourite recipes", async () => {
      vi.mocked(storage.getResolvedFavouriteRecipes).mockResolvedValue([
        mockResolvedRecipe,
      ]);

      const res = await request(app).get("/api/favourite-recipes");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("Pasta Carbonara");
    });

    it("returns empty array when no favourites", async () => {
      vi.mocked(storage.getResolvedFavouriteRecipes).mockResolvedValue([]);

      const res = await request(app).get("/api/favourite-recipes");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("respects limit query param", async () => {
      vi.mocked(storage.getResolvedFavouriteRecipes).mockResolvedValue([]);

      await request(app).get("/api/favourite-recipes?limit=10");

      expect(storage.getResolvedFavouriteRecipes).toHaveBeenCalledWith(
        "user-1",
        10,
      );
    });
  });

  describe("POST /api/favourite-recipes/toggle", () => {
    it("toggles favourite on", async () => {
      vi.mocked(storage.toggleFavouriteRecipe).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "community" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ favourited: true });
    });

    it("toggles favourite off", async () => {
      vi.mocked(storage.toggleFavouriteRecipe).mockResolvedValue(false);

      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "community" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ favourited: false });
    });

    it("returns 403 when limit reached", async () => {
      vi.mocked(storage.toggleFavouriteRecipe).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "community" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("LIMIT_REACHED");
    });

    it("returns 400 for invalid recipeType", async () => {
      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "invalid" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing recipeId", async () => {
      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeType: "community" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/favourite-recipes/check", () => {
    it("returns true when favourited", async () => {
      vi.mocked(storage.isRecipeFavourited).mockResolvedValue(true);

      const res = await request(app).get(
        "/api/favourite-recipes/check?recipeId=10&recipeType=community",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ favourited: true });
    });

    it("returns false when not favourited", async () => {
      vi.mocked(storage.isRecipeFavourited).mockResolvedValue(false);

      const res = await request(app).get(
        "/api/favourite-recipes/check?recipeId=10&recipeType=community",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ favourited: false });
    });

    it("returns 400 for missing query params", async () => {
      const res = await request(app).get("/api/favourite-recipes/check");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/favourite-recipes/ids", () => {
    it("returns all favourited IDs", async () => {
      vi.mocked(storage.getUserFavouriteRecipeIds).mockResolvedValue([
        { recipeId: 10, recipeType: "community" },
        { recipeId: 5, recipeType: "mealPlan" },
      ]);

      const res = await request(app).get("/api/favourite-recipes/ids");

      expect(res.status).toBe(200);
      expect(res.body.ids).toHaveLength(2);
    });

    it("returns empty array when no favourites", async () => {
      vi.mocked(storage.getUserFavouriteRecipeIds).mockResolvedValue([]);

      const res = await request(app).get("/api/favourite-recipes/ids");

      expect(res.status).toBe(200);
      expect(res.body.ids).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run route tests**

Run: `npx vitest run server/routes/__tests__/favourite-recipes.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/routes/__tests__/favourite-recipes.test.ts
git commit -m "test: add favourite-recipes route tests"
```

---

## Task 5: Client Hooks

**Files:**

- Create: `client/hooks/useFavouriteRecipes.ts`
- Create: `client/hooks/__tests__/useFavouriteRecipes.test.ts`

- [ ] **Step 1: Create hooks file**

Create `client/hooks/useFavouriteRecipes.ts`:

```typescript
import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Share, Platform } from "react-native";
import { apiRequest } from "@/lib/query-client";
import type { ResolvedFavouriteRecipe } from "@shared/schema";

const FAVOURITES_KEY = ["/api/favourite-recipes"];
const FAVOURITES_IDS_KEY = ["/api/favourite-recipes/ids"];

interface FavouriteId {
  recipeId: number;
  recipeType: string;
}

export function useFavouriteRecipes(limit?: number) {
  return useQuery<ResolvedFavouriteRecipe[]>({
    queryKey: limit ? [...FAVOURITES_KEY, { limit }] : FAVOURITES_KEY,
    queryFn: async () => {
      const url = limit
        ? `/api/favourite-recipes?limit=${limit}`
        : "/api/favourite-recipes";
      const res = await apiRequest("GET", url);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    refetchOnMount: "always",
  });
}

export function useFavouriteRecipeIds() {
  return useQuery<{ ids: FavouriteId[] }>({
    queryKey: FAVOURITES_IDS_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/favourite-recipes/ids");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    refetchOnMount: "always",
  });
}

export function useIsRecipeFavourited(
  recipeId: number,
  recipeType: "mealPlan" | "community",
): boolean {
  const { data } = useFavouriteRecipeIds();
  return useMemo(
    () =>
      data?.ids.some(
        (f) => f.recipeId === recipeId && f.recipeType === recipeType,
      ) ?? false,
    [data, recipeId, recipeType],
  );
}

export function useToggleFavouriteRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recipeId,
      recipeType,
    }: {
      recipeId: number;
      recipeType: "mealPlan" | "community";
    }) => {
      const res = await apiRequest("POST", "/api/favourite-recipes/toggle", {
        recipeId,
        recipeType,
      });
      if (res.status === 403) {
        const body = await res.json();
        throw new Error(
          body.code === "LIMIT_REACHED" ? "LIMIT_REACHED" : body.error,
        );
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<{ favourited: boolean }>;
    },
    onMutate: async ({ recipeId, recipeType }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: FAVOURITES_IDS_KEY });

      // Snapshot previous value
      const previous = queryClient.getQueryData<{ ids: FavouriteId[] }>(
        FAVOURITES_IDS_KEY,
      );

      // Optimistic update
      queryClient.setQueryData<{ ids: FavouriteId[] }>(
        FAVOURITES_IDS_KEY,
        (old) => {
          if (!old) return { ids: [{ recipeId, recipeType }] };
          const exists = old.ids.some(
            (f) => f.recipeId === recipeId && f.recipeType === recipeType,
          );
          if (exists) {
            return {
              ids: old.ids.filter(
                (f) =>
                  !(f.recipeId === recipeId && f.recipeType === recipeType),
              ),
            };
          }
          return { ids: [...old.ids, { recipeId, recipeType }] };
        },
      );

      return { previous };
    },
    onError: (error, _vars, context) => {
      // Roll back optimistic update
      if (context?.previous) {
        queryClient.setQueryData(FAVOURITES_IDS_KEY, context.previous);
      }
      if (error.message === "LIMIT_REACHED") {
        Alert.alert(
          "Favourites Limit Reached",
          "Upgrade to premium for unlimited favourites.",
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: FAVOURITES_IDS_KEY });
      queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY });
    },
  });
}

export function useShareRecipe() {
  const share = useCallback(
    async (recipeId: number, recipeType: "mealPlan" | "community") => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/recipes/${recipeType}/${recipeId}/share`,
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const payload: {
          title: string;
          description: string;
          imageUrl: string | null;
          deepLink: string;
        } = await res.json();

        const message = `Check out this recipe: ${payload.title}\n\n${payload.description ?? ""}\n\n${payload.deepLink}`;

        await Share.share(
          Platform.OS === "ios"
            ? {
                title: payload.title,
                message,
                url: payload.imageUrl ?? undefined,
              }
            : { title: payload.title, message },
        );
      } catch (error) {
        // User cancelled share sheet — not an error
        if (
          error instanceof Error &&
          error.message.includes("User did not share")
        ) {
          return;
        }
        Alert.alert("Share Failed", "Could not share this recipe.");
      }
    },
    [],
  );

  return { share };
}
```

- [ ] **Step 2: Write hook tests**

Create `client/hooks/__tests__/useFavouriteRecipes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { apiRequest } from "@/lib/query-client";

import {
  useFavouriteRecipes,
  useFavouriteRecipeIds,
  useIsRecipeFavourited,
} from "../useFavouriteRecipes";

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe("useFavouriteRecipes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches resolved favourites", async () => {
    const mockData = [
      {
        recipeId: 1,
        recipeType: "community",
        title: "Test Recipe",
        description: null,
        imageUrl: null,
        servings: 4,
        difficulty: "Easy",
        favouritedAt: new Date().toISOString(),
      },
    ];

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const { result } = renderHook(() => useFavouriteRecipes(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].title).toBe("Test Recipe");
  });
});

describe("useFavouriteRecipeIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches favourite IDs", async () => {
    const mockData = {
      ids: [
        { recipeId: 1, recipeType: "community" },
        { recipeId: 2, recipeType: "mealPlan" },
      ],
    };

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const { result } = renderHook(() => useFavouriteRecipeIds(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.ids).toHaveLength(2);
  });
});

describe("useIsRecipeFavourited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when recipe is in favourites", async () => {
    const mockData = {
      ids: [{ recipeId: 1, recipeType: "community" }],
    };

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const { result } = renderHook(() => useIsRecipeFavourited(1, "community"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when recipe is not in favourites", async () => {
    const mockData = {
      ids: [{ recipeId: 1, recipeType: "community" }],
    };

    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const { result } = renderHook(() => useIsRecipeFavourited(99, "mealPlan"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(false));
  });
});
```

- [ ] **Step 3: Run hook tests**

Run: `npx vitest run client/hooks/__tests__/useFavouriteRecipes.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useFavouriteRecipes.ts client/hooks/__tests__/useFavouriteRecipes.test.ts
git commit -m "feat: add favourite recipe hooks with optimistic updates"
```

---

## Task 6: Share Endpoint

**Files:**

- Modify: `server/routes/favourite-recipes.ts` (add share route here for cohesion, or create a new route file)

- [ ] **Step 1: Add share endpoint to favourite-recipes routes**

Add to the bottom of `server/routes/favourite-recipes.ts`, inside the `register` function, before the closing brace:

````typescript
  // GET /api/recipes/:recipeType/:recipeId/share — share payload
  app.get(
    "/api/recipes/:recipeType/:recipeId/share",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeType = req.params.recipeType;
        if (recipeType !== "mealPlan" && recipeType !== "community") {
          sendError(
            res,
            400,
            "Invalid recipe type",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const recipeId = parseInt(req.params.recipeId, 10);
        if (Number.isNaN(recipeId) || recipeId <= 0) {
          sendError(
            res,
            400,
            "Invalid recipe ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Fetch recipe from the appropriate table
        let title = "";
        let description = "";
        let imageUrl: string | null = null;

        if (recipeType === "community") {
          const [recipe] = await db
            .select({
              title: communityRecipes.title,
              description: communityRecipes.description,
              imageUrl: communityRecipes.imageUrl,
            })
            .from(communityRecipes)
            .where(eq(communityRecipes.id, recipeId));
          if (!recipe) {
            sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
            return;
          }
          title = recipe.title;
          description = recipe.description ?? "";
          imageUrl = recipe.imageUrl ?? null;
        } else {
          const [recipe] = await db
            .select({
              title: mealPlanRecipes.title,
              description: mealPlanRecipes.description,
              imageUrl: mealPlanRecipes.imageUrl,
            })
            .from(mealPlanRecipes)
            .where(eq(mealPlanRecipes.id, recipeId));
          if (!recipe) {
            sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
            return;
          }
          title = recipe.title;
          description = recipe.description ?? "";
          imageUrl = recipe.imageUrl ?? null;
        }

        const deepLink = `ocrecipes://recipe/${recipeId}?type=${recipeType}`;

        res.json({ title, description, imageUrl, deepLink });
      } catch (error) {
        handleRouteError(res, error, "get recipe share payload");
      }
    },
  );

- [ ] **Step 2: Add share route tests to the existing test file**

Add to `server/routes/__tests__/favourite-recipes.test.ts`. First, update the storage mock to include the DB query mock (or mock at a higher level). Since the share route imports `db` directly, we'll need to mock it:

Add these test cases at the bottom of the describe block:

```typescript
describe("GET /api/recipes/:recipeType/:recipeId/share", () => {
  it("returns 400 for invalid recipe type", async () => {
    const res = await request(app).get("/api/recipes/invalid/10/share");
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric recipe ID", async () => {
    const res = await request(app).get("/api/recipes/community/abc/share");
    expect(res.status).toBe(400);
  });
});
````

- [ ] **Step 3: Run tests**

Run: `npx vitest run server/routes/__tests__/favourite-recipes.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/favourite-recipes.ts server/routes/__tests__/favourite-recipes.test.ts
git commit -m "feat: add recipe share endpoint"
```

---

## Task 7: RecipeActionBar Component

**Files:**

- Create: `client/components/RecipeActionBar.tsx`
- Modify: `client/components/RecipeDetailContent.tsx`

- [ ] **Step 1: Create RecipeActionBar component**

Create `client/components/RecipeActionBar.tsx`:

```typescript
import React, { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useIsRecipeFavourited,
  useToggleFavouriteRecipe,
  useShareRecipe,
} from "@/hooks/useFavouriteRecipes";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface RecipeActionBarProps {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  onSaveToCookbook: () => void;
}

export const RecipeActionBar = React.memo(function RecipeActionBar({
  recipeId,
  recipeType,
  onSaveToCookbook,
}: RecipeActionBarProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const isFavourited = useIsRecipeFavourited(recipeId, recipeType);
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();
  const { share } = useShareRecipe();

  const handleFavourite = useCallback(() => {
    haptics.impact();
    toggleFavourite({ recipeId, recipeType });
  }, [haptics, toggleFavourite, recipeId, recipeType]);

  const handleShare = useCallback(() => {
    haptics.impact();
    share(recipeId, recipeType);
  }, [haptics, share, recipeId, recipeType]);

  const handleSave = useCallback(() => {
    haptics.impact();
    onSaveToCookbook();
  }, [haptics, onSaveToCookbook]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="toolbar"
      accessibilityLabel="Recipe actions"
    >
      <Pressable
        onPress={handleFavourite}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={
          isFavourited
            ? "Remove from favourites"
            : "Add to favourites"
        }
        accessibilityState={{ selected: isFavourited }}
      >
        <Ionicons
          name={isFavourited ? "heart" : "heart-outline"}
          size={20}
          color={isFavourited ? theme.error : theme.textSecondary}
        />
        <ThemedText
          style={[
            styles.actionLabel,
            { color: isFavourited ? theme.error : theme.textSecondary },
          ]}
        >
          Favourite
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={handleShare}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Share recipe"
      >
        <Feather name="share" size={18} color={theme.textSecondary} />
        <ThemedText
          style={[styles.actionLabel, { color: theme.textSecondary }]}
        >
          Share
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={handleSave}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Save to cookbook"
      >
        <Feather name="bookmark" size={18} color={theme.textSecondary} />
        <ThemedText
          style={[styles.actionLabel, { color: theme.textSecondary }]}
        >
          Save
        </ThemedText>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    marginTop: Spacing.md,
  },
  action: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
```

- [ ] **Step 2: Replace save/remix buttons in RecipeDetailContent**

In `client/components/RecipeDetailContent.tsx`:

Add import at top:

```typescript
import { RecipeActionBar } from "@/components/RecipeActionBar";
```

Replace the "Save to Cookbook" Pressable and "Remix Button" Pressable (lines ~213-255) with:

```typescript
          {/* 4. Action Bar (Favourite, Share, Save to Cookbook) */}
          {props.recipeId > 0 && (
            <RecipeActionBar
              recipeId={props.recipeId}
              recipeType={props.recipeType}
              onSaveToCookbook={() => setPickerVisible(true)}
            />
          )}

          {/* 4b. Remix Button (community recipes only) */}
          {isCommunityRecipe && props.recipeId > 0 && (
            <Pressable
              onPress={handleRemixPress}
              style={[
                styles.saveButton,
                { backgroundColor: withOpacity(theme.link, 0.1) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Remix this recipe"
              accessibilityHint="Opens a guided flow to modify this recipe"
            >
              <Ionicons name="shuffle-outline" size={14} color={theme.link} />
              <ThemedText
                style={[styles.saveButtonText, { color: theme.link }]}
              >
                Remix Recipe
              </ThemedText>
            </Pressable>
          )}
```

This keeps the Remix button separate (since it's a premium feature with different logic) but replaces the standalone "Save to Cookbook" Pressable with the full action bar.

- [ ] **Step 3: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/components/RecipeActionBar.tsx client/components/RecipeDetailContent.tsx
git commit -m "feat: add RecipeActionBar with favourite, share, save actions"
```

---

## Task 8: Heart Icon on Recipe Cards

**Files:**

- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx` (UnifiedRecipeCard)
- Modify: `client/components/home/CarouselRecipeCard.tsx`

- [ ] **Step 1: Add heart to UnifiedRecipeCard**

In `client/screens/meal-plan/RecipeBrowserScreen.tsx`, modify the `UnifiedRecipeCard` component:

Add imports at top of file:

```typescript
import { Ionicons } from "@expo/vector-icons";
import {
  useIsRecipeFavourited,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { useHaptics } from "@/hooks/useHaptics";
```

Inside the `UnifiedRecipeCard` component, add hooks and handler:

```typescript
const haptics = useHaptics();
const recipeType = isCommunity ? "community" : "mealPlan";
const isFavourited = useIsRecipeFavourited(
  item.id,
  recipeType as "mealPlan" | "community",
);
const { mutate: toggleFavourite } = useToggleFavouriteRecipe();

const handleFavourite = useCallback(
  (e: GestureResponderEvent) => {
    e.stopPropagation();
    haptics.impact();
    toggleFavourite({
      recipeId: item.id,
      recipeType: recipeType as "mealPlan" | "community",
    });
  },
  [haptics, toggleFavourite, item.id, recipeType],
);
```

Add a heart icon Pressable before the existing add/chevron button (before the `<View style={[styles.addButton, ...]}>` block):

```typescript
<Pressable
  onPress={handleFavourite}
  hitSlop={8}
  accessibilityRole="button"
  accessibilityLabel={
    isFavourited ? "Remove from favourites" : "Add to favourites"
  }
  style={{ marginRight: Spacing.sm }}
>
  <Ionicons
    name={isFavourited ? "heart" : "heart-outline"}
    size={20}
    color={isFavourited ? theme.error : theme.textSecondary}
  />
</Pressable>
```

Add the `GestureResponderEvent` import from `react-native` if not already imported.

- [ ] **Step 2: Replace thumbs-down with heart in CarouselRecipeCard**

In `client/components/home/CarouselRecipeCard.tsx`, find the dismiss button (around line 179):

```typescript
// Replace:
<Feather
  name="thumbs-down"
  size={18}
  color={theme.error}
  accessible={false}
/>

// With a heart favourite toggle. Update the onPress too.
```

Add imports:

```typescript
import {
  useIsRecipeFavourited,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
```

Add hooks inside the component:

```typescript
const isFavourited = useIsRecipeFavourited(card.recipeId, "community");
const { mutate: toggleFavourite } = useToggleFavouriteRecipe();

const handleFavourite = useCallback(() => {
  haptics.impact();
  toggleFavourite({ recipeId: card.recipeId, recipeType: "community" });
}, [haptics, toggleFavourite, card.recipeId]);
```

Replace the dismiss button with a heart button (keep the dismiss button as well, just add the heart before it):

```typescript
<View style={styles.actions}>
  <Pressable
    onPress={handleFavourite}
    style={[
      styles.actionButton,
      {
        backgroundColor: withOpacity(
          isFavourited ? theme.error : theme.textSecondary,
          0.1,
        ),
      },
    ]}
    hitSlop={4}
    accessibilityRole="button"
    accessibilityLabel={
      isFavourited ? "Remove from favourites" : "Add to favourites"
    }
  >
    <Ionicons
      name={isFavourited ? "heart" : "heart-outline"}
      size={18}
      color={isFavourited ? theme.error : theme.textSecondary}
      accessible={false}
    />
  </Pressable>
  <Pressable
    onPress={handleDismiss}
    style={[
      styles.actionButton,
      { backgroundColor: withOpacity(theme.error, 0.1) },
    ]}
    hitSlop={4}
    accessibilityRole="button"
    accessibilityLabel="Dismiss recipe"
  >
    <Feather
      name="x"
      size={18}
      color={theme.error}
      accessible={false}
    />
  </Pressable>
</View>
```

Note: Changed dismiss icon from `thumbs-down` to `x` since `thumbs-down` is being removed as a concept.

- [ ] **Step 3: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/screens/meal-plan/RecipeBrowserScreen.tsx client/components/home/CarouselRecipeCard.tsx
git commit -m "feat: add heart favourite toggle to recipe cards"
```

---

## Task 9: FavouriteRecipesScreen

**Files:**

- Create: `client/screens/FavouriteRecipesScreen.tsx`

- [ ] **Step 1: Create the screen**

Create `client/screens/FavouriteRecipesScreen.tsx`:

```typescript
import React, { useCallback } from "react";
import { StyleSheet, View, Pressable, FlatList } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import { useNavigation } from "@react-navigation/native";
import { Feather, Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useFavouriteRecipes,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { resolveImageUrl } from "@/lib/image-url";
import type { ResolvedFavouriteRecipe } from "@shared/schema";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function FavouriteRecipesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { data: recipes, isLoading, refetch } = useFavouriteRecipes();
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();

  const handleRecipePress = useCallback(
    (item: ResolvedFavouriteRecipe) => {
      haptics.selection();
      navigation.navigate("FeaturedRecipeDetail", {
        recipeId: item.recipeId,
        recipeType: item.recipeType,
      });
    },
    [haptics, navigation],
  );

  const handleUnfavourite = useCallback(
    (item: ResolvedFavouriteRecipe) => {
      haptics.impact();
      toggleFavourite({
        recipeId: item.recipeId,
        recipeType: item.recipeType,
      });
    },
    [haptics, toggleFavourite],
  );

  const renderItem = useCallback(
    ({ item }: { item: ResolvedFavouriteRecipe }) => (
      <Pressable
        onPress={() => handleRecipePress(item)}
        style={[
          styles.recipeCard,
          { backgroundColor: withOpacity(theme.text, 0.04) },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${item.recipeType === "community" ? ", community recipe" : ""}`}
      >
        <FallbackImage
          source={{ uri: resolveImageUrl(item.imageUrl) ?? undefined }}
          style={styles.recipeImage}
          fallbackStyle={{
            ...styles.recipePlaceholder,
            backgroundColor: withOpacity(theme.text, 0.08),
          }}
          fallbackIcon="image"
          fallbackIconSize={20}
          accessibilityIgnoresInvertColors
        />
        <View style={styles.recipeContent}>
          <ThemedText style={styles.recipeTitle} numberOfLines={2}>
            {item.title}
          </ThemedText>
          <View style={styles.recipeMeta}>
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: withOpacity(
                    item.recipeType === "community"
                      ? theme.link
                      : theme.success,
                    0.12,
                  ),
                },
              ]}
            >
              <ThemedText
                style={[
                  styles.typeBadgeText,
                  {
                    color:
                      item.recipeType === "community"
                        ? theme.link
                        : theme.success,
                  },
                ]}
              >
                {item.recipeType === "community" ? "Community" : "Personal"}
              </ThemedText>
            </View>
            {item.difficulty && (
              <ThemedText
                style={[styles.recipeMetaText, { color: theme.textSecondary }]}
              >
                {item.difficulty}
              </ThemedText>
            )}
          </View>
        </View>
        <Pressable
          onPress={() => handleUnfavourite(item)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.title} from favourites`}
        >
          <Ionicons name="heart" size={20} color={theme.error} />
        </Pressable>
      </Pressable>
    ),
    [theme, handleRecipePress, handleUnfavourite],
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight + Spacing.lg,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <View style={styles.skeletons}>
          {[1, 2, 3].map((i) => (
            <SkeletonBox
              key={i}
              width="100%"
              height={64}
              borderRadius={12}
              style={{ marginBottom: Spacing.md }}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={recipes || []}
        keyExtractor={(item) => `${item.recipeId}-${item.recipeType}`}
        renderItem={renderItem}
        onRefresh={refetch}
        refreshing={false}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons
              name="heart-outline"
              size={48}
              color={withOpacity(theme.text, 0.2)}
            />
            <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
              No Favourites
            </ThemedText>
            <ThemedText
              style={[styles.emptySubtitle, { color: theme.textSecondary }]}
            >
              Heart recipes to save them here for quick access.
            </ThemedText>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletons: {
    padding: Spacing.lg,
  },
  recipeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.md,
  },
  recipeImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
  },
  recipePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
  },
  recipeContent: {
    flex: 1,
    marginLeft: Spacing.md,
    marginRight: Spacing.sm,
  },
  recipeTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: 2,
  },
  recipeMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: 2,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  recipeMetaText: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
```

- [ ] **Step 2: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/screens/FavouriteRecipesScreen.tsx
git commit -m "feat: add FavouriteRecipesScreen"
```

---

## Task 10: Navigation Integration

**Files:**

- Modify: `client/navigation/MealPlanStackNavigator.tsx`
- Modify: `client/navigation/ProfileStackNavigator.tsx`
- Modify: `client/types/navigation.ts`

- [ ] **Step 1: Add FavouriteRecipes to MealPlanStack**

In `client/navigation/MealPlanStackNavigator.tsx`:

Add import:

```typescript
import FavouriteRecipesScreen from "@/screens/FavouriteRecipesScreen";
```

Add to `MealPlanStackParamList`:

```typescript
FavouriteRecipes: undefined;
```

Add Screen entry (after CookbookCreate screen):

```typescript
<Stack.Screen
  name="FavouriteRecipes"
  component={FavouriteRecipesScreen}
  options={{
    headerTitle: () => (
      <HeaderTitle title="Favourites" showIcon={false} />
    ),
  }}
/>
```

- [ ] **Step 2: Add FavouriteRecipes to ProfileStack**

In `client/navigation/ProfileStackNavigator.tsx`:

Add import:

```typescript
import FavouriteRecipesScreen from "@/screens/FavouriteRecipesScreen";
```

Add to `ProfileStackParamList`:

```typescript
FavouriteRecipes: undefined;
```

Add Screen entry (after GLP1Companion screen):

```typescript
<Stack.Screen
  name="FavouriteRecipes"
  component={FavouriteRecipesScreen}
  options={{
    headerTitle: () => (
      <HeaderTitle title="Favourites" showIcon={false} />
    ),
  }}
/>
```

- [ ] **Step 3: Add navigation type**

In `client/types/navigation.ts`, add after `CookbookListScreenNavigationProp`:

```typescript
/**
 * Navigation prop for FavouriteRecipesScreen
 * Uses CompositeNavigationProp to navigate to RootStack screens (FeaturedRecipeDetail modal)
 */
export type FavouriteRecipesScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<MealPlanStackParamList, "FavouriteRecipes">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;
```

- [ ] **Step 4: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/navigation/MealPlanStackNavigator.tsx client/navigation/ProfileStackNavigator.tsx client/types/navigation.ts
git commit -m "feat: register FavouriteRecipes screen in navigation"
```

---

## Task 11: Pinned Favourites Row in CookbookList + Profile Library

**Files:**

- Modify: `client/screens/meal-plan/CookbookListScreen.tsx`
- Modify: `client/components/profile/library-config.ts`
- Modify: `shared/schemas/profile-hub.ts`
- Modify: `server/storage/profile-hub.ts`

- [ ] **Step 1: Add pinned Favourites row to CookbookListScreen**

In `client/screens/meal-plan/CookbookListScreen.tsx`:

Add imports:

```typescript
import { Ionicons } from "@expo/vector-icons";
import { useFavouriteRecipeIds } from "@/hooks/useFavouriteRecipes";
```

Inside the component, add the hook:

```typescript
const { data: favouriteIds } = useFavouriteRecipeIds();
const favouriteCount = favouriteIds?.ids.length ?? 0;
```

Add a `ListHeaderComponent` to the FlatList that renders the pinned Favourites row:

```typescript
ListHeaderComponent={
  <Pressable
    onPress={() => {
      haptics.selection();
      navigation.navigate("FavouriteRecipes");
    }}
    style={[
      styles.listItem,
      { backgroundColor: withOpacity(theme.error, 0.06) },
    ]}
    accessibilityRole="button"
    accessibilityLabel={`Favourites, ${favouriteCount} recipes`}
  >
    <View style={styles.listItemContent}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
        <Ionicons name="heart" size={16} color={theme.error} />
        <ThemedText style={styles.listItemTitle}>Favourites</ThemedText>
      </View>
      <ThemedText
        style={[styles.listItemMeta, { color: theme.textSecondary }]}
      >
        {favouriteCount} {favouriteCount === 1 ? "recipe" : "recipes"}
      </ThemedText>
    </View>
    <View style={styles.listItemActions}>
      <Feather name="chevron-right" size={18} color={theme.textSecondary} />
    </View>
  </Pressable>
}
```

Note: Add the `Ionicons` import if not already present.

- [ ] **Step 2: Add favourites to profile library grid**

In `shared/schemas/profile-hub.ts`, add `favouriteRecipes` to the schema:

```typescript
export const libraryCountsSchema = z.object({
  cookbooks: z.number(),
  savedItems: z.number(),
  scanHistory: z.number(),
  groceryLists: z.number(),
  pantryItems: z.number(),
  featuredRecipes: z.number(),
  favouriteRecipes: z.number(),
});
```

In `server/storage/profile-hub.ts`, add the favourites count subselect to **both** SQL queries (cached and uncached):

```typescript
favouriteRecipes: sql<number>`(SELECT count(*) FROM favourite_recipes WHERE user_id = ${userId})`,
```

And add it to both return objects:

```typescript
favouriteRecipes: Number(row?.favouriteRecipes ?? 0),
```

In `client/components/profile/library-config.ts`, add the favourites item (as the first item in the array):

```typescript
{
  id: "favourites",
  icon: "heart",
  label: "Favourites",
  countKey: "favouriteRecipes",
},
```

And add the navigation case in `navigateLibraryItem`:

```typescript
case "favourites":
  navigation.navigate("FavouriteRecipes");
  break;
```

- [ ] **Step 3: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npm run test:run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/screens/meal-plan/CookbookListScreen.tsx client/components/profile/library-config.ts shared/schemas/profile-hub.ts server/storage/profile-hub.ts
git commit -m "feat: add favourites to cookbook list header and profile library grid"
```

---

## Task 12: Deep Link Update

**Files:**

- Modify: `client/navigation/linking.ts`

- [ ] **Step 1: Update deep link to parse recipe type**

In `client/navigation/linking.ts`, update the `FeaturedRecipeDetail` config to parse the `type` query parameter:

```typescript
FeaturedRecipeDetail: {
  path: "recipe/:recipeId",
  parse: {
    recipeId: parseIntOrZero,
    type: (value: string) =>
      value === "mealPlan" ? "mealPlan" : "community",
  },
  stringify: {
    recipeId: (id: number) => String(id),
  },
},
```

Note: React Navigation automatically maps query params. The `type` query param in the URL `ocrecipes://recipe/123?type=mealPlan` will be parsed and passed as a route param. However, the `FeaturedRecipeDetail` screen's param list uses `recipeType`, not `type`. So the parse needs to map `type` → `recipeType`. Check if React Navigation supports this mapping via the parse function key names, or if we need to handle it in the screen component. If the parse key must match the param name, we may need to rename or add a custom parse.

Alternative simpler approach — handle in the screen itself: just pass `type` through and let the screen check `route.params.type` as a fallback for `route.params.recipeType`:

```typescript
// In FeaturedRecipeDetailScreen, when reading params:
const recipeType = route.params.recipeType ?? route.params.type ?? "community";
```

Choose whichever approach works with the existing screen code.

- [ ] **Step 2: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `npm run test:run`
Expected: All tests PASS (including linking tests)

- [ ] **Step 4: Commit**

```bash
git add client/navigation/linking.ts
git commit -m "feat: parse recipe type from deep link query param"
```

---

## Task 13: Push Schema & Final Verification

- [ ] **Step 1: Push database schema**

Run: `npm run db:push`
Expected: New `favourite_recipes` table created

- [ ] **Step 2: Run full test suite**

Run: `npm run test:run`
Expected: All tests PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Run type check**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 5: Final commit (if any lint fixes)**

```bash
git add -A
git commit -m "chore: lint fixes for favourite recipes feature"
```
