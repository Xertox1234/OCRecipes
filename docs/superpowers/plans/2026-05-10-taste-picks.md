# Taste Picks — Preference Elicitation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recipe-picker flow (onboarding step 7 + Settings) that captures explicit taste signals in a `taste_picks` table for recommendation personalization and future collaborative filtering.

**Architecture:** New `taste_picks` table without mutating manual `profile.cuisinePreferences`. Three new API endpoints. Shared `TastePicksGrid` client component reused by `TastePicksScreen` (onboarding) and `TasteProfileScreen` (settings). Onboarding Continue handler sequences profile POST → taste-picks PUT → `onboardingCompleted`.

**Tech Stack:** Drizzle ORM + PostgreSQL, Express, React Native, React Query (`apiRequest`), Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-05-10-taste-picks-design.md`

---

## File Map

### New

| File                                             | Responsibility                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `shared/types/taste-picks.ts`                    | API response types (RecipeCandidate, TastePickEntry, response shapes) |
| `server/storage/taste-picks.ts`                  | `getTastePicks`, `setTastePicks`, `getTastePickCandidates`            |
| `server/storage/__tests__/taste-picks.test.ts`   | Storage integration tests against real DB tx                          |
| `server/routes/taste-picks.ts`                   | Three endpoints: candidates GET, picks GET, picks PUT                 |
| `server/routes/__tests__/taste-picks.test.ts`    | Route unit tests (storage mocked)                                     |
| `client/components/TastePicksGrid.tsx`           | Controlled 2-col grid; both screens use this                          |
| `client/screens/onboarding/TastePicksScreen.tsx` | Step 7 of 7 — shows grid, sequences save on Continue                  |
| `client/screens/TasteProfileScreen.tsx`          | Settings edit — pre-populated, explicit Save Changes                  |

### Modified

| File                                              | Change                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `shared/schema.ts`                                | Add `tastePicks` table definition                                 |
| `server/storage/index.ts`                         | Expose taste-picks storage functions on `storage` object          |
| `server/routes.ts`                                | Register taste-picks route module                                 |
| `client/context/OnboardingContext.tsx`            | `totalSteps` 6 → 7                                                |
| `client/navigation/OnboardingNavigator.tsx`       | Add `TastePicks` to `SCREENS` and `OnboardingStackParamList`      |
| `client/screens/onboarding/PreferencesScreen.tsx` | Change `completeOnboarding` → `nextStep`, button label "Next"     |
| `client/screens/SettingsScreen.tsx`               | Add "Taste Profile" row between "Edit Profile" and "Apple Health" |
| `client/navigation/ProfileStackNavigator.tsx`     | Add `TasteProfile` screen + type                                  |
| `client/types/navigation.ts`                      | Add `TasteProfileScreenNavigationProp`                            |

---

## Task 1: DB Schema — Add `taste_picks` Table

**Files:**

- Modify: `shared/schema.ts`

- [x] **Step 1: Add the table definition to `shared/schema.ts`**

  Find the end of the `communityRecipes` block (around line 600) and add after the `communityRecipesRelations` export:

  ```typescript
  // Preference elicitation picks — recipe-level taste signal
  export const tastePicks = pgTable(
    "taste_picks",
    {
      id: serial("id").primaryKey(),
      userId: varchar("user_id", { length: 255 })
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      recipeId: integer("recipe_id")
        .notNull()
        .references(() => communityRecipes.id, { onDelete: "cascade" }),
      pickedAt: timestamp("picked_at")
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    },
    (table) => ({
      userRecipeUniq: unique("taste_picks_user_recipe_uniq").on(
        table.userId,
        table.recipeId,
      ),
      userIdx: index("taste_picks_user_idx").on(table.userId),
    }),
  );

  export type TastePick = typeof tastePicks.$inferSelect;
  export type InsertTastePick = typeof tastePicks.$inferInsert;
  ```

  Note: `recipeId` intentionally follows the current recipe-deletion contract and cascades with `communityRecipes`. Before using `taste_picks` as long-lived collaborative-filtering history, add recipe soft-delete or snapshot fields so historical taste signals survive recipe removal without breaking existing hard-delete flows.

  The imports `serial`, `integer`, `varchar`, `timestamp`, `unique`, `index`, `sql` are already used elsewhere in this file — no new imports needed.

- [x] **Step 2: Push schema to DB**

  ```bash
  npm run db:push
  ```

  Expected: Drizzle detects the new `taste_picks` table and adds it. Accept the prompt if interactive. Confirm the `taste_picks` table appears in your DB client.

- [x] **Step 3: Commit**

  ```bash
  git add shared/schema.ts
  git commit -m "feat(taste-picks): add taste_picks schema table"
  ```

---

## Task 2: Shared Types

**Files:**

- Create: `shared/types/taste-picks.ts`

- [x] **Step 1: Create the types file**

  ```typescript
  // shared/types/taste-picks.ts

  export interface RecipeCandidate {
    id: number;
    title: string;
    imageUrl: string;
    cuisineOrigin: string | null;
  }

  export interface TastePickEntry {
    recipeId: number;
    title: string;
    imageUrl: string;
    cuisineOrigin: string | null;
  }

  export interface TastePickCandidatesResponse {
    candidates: RecipeCandidate[];
    total: number;
    page: number;
  }

  export interface TastePicksResponse {
    picks: TastePickEntry[];
  }

  export interface SetTastePicksResponse {
    picks: TastePickEntry[];
    cuisinePreferences: string[];
  }
  ```

- [x] **Step 2: Commit**

  ```bash
  git add shared/types/taste-picks.ts
  git commit -m "feat(taste-picks): add shared API types"
  ```

---

## Task 3: Storage Tests (Write Failing Tests First)

**Files:**

- Create: `server/storage/__tests__/taste-picks.test.ts`

- [x] **Step 1: Write the test file**

  ```typescript
  // server/storage/__tests__/taste-picks.test.ts
  import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    afterAll,
    vi,
  } from "vitest";
  import {
    setupTestTransaction,
    rollbackTestTransaction,
    closeTestPool,
    createTestUser,
    getTestTx,
  } from "../../../test/db-test-utils";
  import { eq } from "drizzle-orm";
  import { communityRecipes, userProfiles } from "@shared/schema";
  import type { NodePgDatabase } from "drizzle-orm/node-postgres";
  import type * as schema from "@shared/schema";

  vi.mock("../../db", () => ({
    get db() {
      return getTestTx();
    },
  }));

  vi.mock("../../lib/fire-and-forget", () => ({
    fireAndForget: vi.fn(),
  }));

  const { getTastePicks, setTastePicks, getTastePickCandidates } = await import(
    "../taste-picks"
  );

  let tx: NodePgDatabase<typeof schema>;
  let testUserId: string;

  async function createCommunityRecipe(
    overrides: Record<string, unknown> = {},
  ) {
    const [recipe] = await tx
      .insert(communityRecipes)
      .values({
        authorId: testUserId,
        title: "Test Recipe",
        normalizedProductName: "test-product",
        instructions: ["Step 1"],
        isPublic: true,
        imageUrl: "https://example.com/image.jpg",
        cuisineOrigin: "Italian",
        ...overrides,
      })
      .returning();
    return recipe;
  }

  async function createProfile(cuisinePreferences: string[] = []) {
    await tx.insert(userProfiles).values({
      userId: testUserId,
      cuisinePreferences,
      allergies: [],
      healthConditions: [],
      foodDislikes: [],
      householdSize: 1,
    });
  }

  beforeEach(async () => {
    tx = await setupTestTransaction();
    const user = await createTestUser(tx);
    testUserId = user.id;
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("getTastePicks", () => {
    it("returns empty array when user has no picks", async () => {
      const picks = await getTastePicks(testUserId);
      expect(picks).toEqual([]);
    });

    it("returns picks with recipe info", async () => {
      const recipe = await createCommunityRecipe({
        title: "Pasta",
        cuisineOrigin: "Italian",
      });
      await setTastePicks(testUserId, [recipe.id]);

      const picks = await getTastePicks(testUserId);
      expect(picks).toHaveLength(1);
      expect(picks[0].recipeId).toBe(recipe.id);
      expect(picks[0].title).toBe("Pasta");
      expect(picks[0].cuisineOrigin).toBe("Italian");
    });
  });

  describe("setTastePicks", () => {
    it("inserts new picks", async () => {
      await createProfile();
      const recipe = await createCommunityRecipe();
      await setTastePicks(testUserId, [recipe.id]);

      const picks = await getTastePicks(testUserId);
      expect(picks).toHaveLength(1);
    });

    it("is idempotent — re-setting same IDs yields same rows", async () => {
      await createProfile();
      const recipe = await createCommunityRecipe();
      await setTastePicks(testUserId, [recipe.id]);
      await setTastePicks(testUserId, [recipe.id]);

      const picks = await getTastePicks(testUserId);
      expect(picks).toHaveLength(1);
    });

    it("removes IDs not in the new set", async () => {
      await createProfile();
      const r1 = await createCommunityRecipe({
        title: "A",
        normalizedProductName: "test-a",
      });
      const r2 = await createCommunityRecipe({
        title: "B",
        normalizedProductName: "test-b",
      });
      await setTastePicks(testUserId, [r1.id, r2.id]);
      await setTastePicks(testUserId, [r1.id]);

      const picks = await getTastePicks(testUserId);
      expect(picks).toHaveLength(1);
      expect(picks[0].recipeId).toBe(r1.id);
    });

    it("handles empty array — removes all picks", async () => {
      await createProfile();
      const recipe = await createCommunityRecipe();
      await setTastePicks(testUserId, [recipe.id]);
      await setTastePicks(testUserId, []);

      const picks = await getTastePicks(testUserId);
      expect(picks).toHaveLength(0);
    });

    it("returns derived cuisines without mutating manual profile cuisines", async () => {
      await createProfile(["Mexican"]);
      const recipe = await createCommunityRecipe({ cuisineOrigin: "Italian" });
      const result = await setTastePicks(testUserId, [recipe.id]);

      expect(result.cuisinePreferences).toContain("Italian");

      const [profile] = await getTestTx()
        .select({ cuisinePreferences: userProfiles.cuisinePreferences })
        .from(userProfiles)
        .where(eq(userProfiles.userId, testUserId));
      expect(profile.cuisinePreferences).toEqual(["Mexican"]);
    });

    it("null cuisineOrigin recipes do not add empty string", async () => {
      await createProfile([]);
      const recipe = await createCommunityRecipe({ cuisineOrigin: null });
      const result = await setTastePicks(testUserId, [recipe.id]);

      expect(result.cuisinePreferences).not.toContain(null);
      expect(result.cuisinePreferences).not.toContain("");
    });
  });

  describe("getTastePickCandidates", () => {
    it("returns only public recipes with images", async () => {
      await createCommunityRecipe({
        title: "Public",
        isPublic: true,
        imageUrl: "https://example.com/1.jpg",
      });
      await createCommunityRecipe({
        title: "Private",
        isPublic: false,
        imageUrl: "https://example.com/2.jpg",
      });
      await createCommunityRecipe({
        title: "No Image",
        isPublic: true,
        imageUrl: null,
      });

      const result = await getTastePickCandidates({ page: 1, limit: 10 });
      const titles = result.candidates.map((c) => c.title);
      expect(titles).toContain("Public");
      expect(titles).not.toContain("Private");
      expect(titles).not.toContain("No Image");
    });

    it("paginates results", async () => {
      for (let i = 0; i < 5; i++) {
        await createCommunityRecipe({
          title: `Recipe ${i}`,
          normalizedProductName: `test-recipe-${i}`,
          imageUrl: `https://example.com/${i}.jpg`,
        });
      }
      const page1 = await getTastePickCandidates({ page: 1, limit: 3 });
      const page2 = await getTastePickCandidates({ page: 2, limit: 3 });

      expect(page1.candidates).toHaveLength(3);
      expect(page2.candidates.length).toBeGreaterThanOrEqual(1);
      expect(page1.total).toBe(
        page1.candidates.length + page2.candidates.length,
      );
    });
  });
  ```

- [x] **Step 2: Run tests — verify they fail with "module not found"**

  ```bash
  npm run test:run -- taste-picks
  ```

  Expected: FAIL — `../taste-picks` module not found.

---

## Task 4: Storage Implementation

**Files:**

- Create: `server/storage/taste-picks.ts`

- [x] **Step 1: Create the storage module**

  ```typescript
  // server/storage/taste-picks.ts
  import { desc, eq, and, inArray, sql, count } from "drizzle-orm";
  import { db } from "../db";
  import { tastePicks, communityRecipes } from "@shared/schema";
  import type {
    RecipeCandidate,
    TastePickEntry,
  } from "@shared/types/taste-picks";

  const PICK_COLUMNS = {
    recipeId: tastePicks.recipeId,
    title: communityRecipes.title,
    imageUrl: communityRecipes.imageUrl,
    canonicalImages: communityRecipes.canonicalImages,
    cuisineOrigin: communityRecipes.cuisineOrigin,
  } as const;

  function resolveImage(
    imageUrl: string | null,
    canonicalImages: string[] | null,
  ): string | null {
    return imageUrl ?? canonicalImages?.[0] ?? null;
  }

  export class TastePicksValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TastePicksValidationError";
    }
  }

  export async function getTastePicks(
    userId: string,
  ): Promise<TastePickEntry[]> {
    const rows = await db
      .select(PICK_COLUMNS)
      .from(tastePicks)
      .innerJoin(communityRecipes, eq(tastePicks.recipeId, communityRecipes.id))
      .where(eq(tastePicks.userId, userId));

    return rows.flatMap((r) => {
      const imageUrl =
        resolveImage(r.imageUrl, r.canonicalImages) ??
        "https://placehold.co/600x400?text=Recipe";
      return [
        {
          recipeId: r.recipeId,
          title: r.title,
          imageUrl,
          cuisineOrigin: r.cuisineOrigin,
        },
      ];
    });
  }

  export interface SetTastePicksResult {
    picks: TastePickEntry[];
    cuisinePreferences: string[];
  }

  export async function setTastePicks(
    userId: string,
    recipeIds: number[],
  ): Promise<SetTastePicksResult> {
    const uniqueRecipeIds = [...new Set(recipeIds)];

    return db.transaction(async (tx) => {
      const visibleRecipes =
        uniqueRecipeIds.length > 0
          ? await tx
              .select({
                id: communityRecipes.id,
                cuisineOrigin: communityRecipes.cuisineOrigin,
              })
              .from(communityRecipes)
              .where(
                and(
                  inArray(communityRecipes.id, uniqueRecipeIds),
                  eq(communityRecipes.isPublic, true),
                ),
              )
          : [];

      if (visibleRecipes.length !== uniqueRecipeIds.length) {
        throw new TastePicksValidationError(
          "Taste picks must reference public recipes",
        );
      }

      // 1. Replace picks
      await tx.delete(tastePicks).where(eq(tastePicks.userId, userId));
      if (uniqueRecipeIds.length > 0) {
        await tx
          .insert(tastePicks)
          .values(uniqueRecipeIds.map((recipeId) => ({ userId, recipeId })))
          .onConflictDoNothing();
      }

      // 2. Derive cuisines from picked recipes
      const derivedCuisines: string[] = [];
      const seen = new Set<string>();
      for (const r of visibleRecipes) {
        if (r.cuisineOrigin && !seen.has(r.cuisineOrigin)) {
          seen.add(r.cuisineOrigin);
          derivedCuisines.push(r.cuisineOrigin);
        }
      }

      // 3. Return derived cuisines to the caller without mutating manual profile preferences.
      const cuisinePreferences = derivedCuisines;

      // 4. Fetch final picks for response
      const pickRows =
        uniqueRecipeIds.length > 0
          ? await tx
              .select(PICK_COLUMNS)
              .from(tastePicks)
              .innerJoin(
                communityRecipes,
                eq(tastePicks.recipeId, communityRecipes.id),
              )
              .where(eq(tastePicks.userId, userId))
          : [];

      const picks: TastePickEntry[] = pickRows.flatMap((r) => {
        const imageUrl =
          resolveImage(r.imageUrl, r.canonicalImages) ??
          "https://placehold.co/600x400?text=Recipe";
        return [
          {
            recipeId: r.recipeId,
            title: r.title,
            imageUrl,
            cuisineOrigin: r.cuisineOrigin,
          },
        ];
      });

      return { picks, cuisinePreferences };
    });
  }

  export interface CandidateParams {
    page: number;
    limit: number;
    dietType?: string | null;
  }

  export async function getTastePickCandidates(
    params: CandidateParams,
  ): Promise<{ candidates: RecipeCandidate[]; total: number; page: number }> {
    const { page, limit, dietType } = params;
    const offset = (page - 1) * limit;

    const baseConditions = [
      eq(communityRecipes.isPublic, true),
      sql`(${communityRecipes.imageUrl} IS NOT NULL OR jsonb_array_length(coalesce(${communityRecipes.canonicalImages}, '[]'::jsonb)) > 0)`,
    ];
    // `communityRecipes` has no soft-delete column; visibility is governed by `isPublic`.

    if (dietType && dietType !== "omnivore") {
      baseConditions.push(
        sql`${communityRecipes.dietTags} @> ${JSON.stringify([dietType])}::jsonb`,
      );
    }

    const [totalRow] = await db
      .select({ total: count() })
      .from(communityRecipes)
      .where(and(...baseConditions));
    const total = Number(totalRow.total);

    const rows = await db
      .select({
        id: communityRecipes.id,
        title: communityRecipes.title,
        imageUrl: communityRecipes.imageUrl,
        canonicalImages: communityRecipes.canonicalImages,
        cuisineOrigin: communityRecipes.cuisineOrigin,
      })
      .from(communityRecipes)
      .where(and(...baseConditions))
      // Use the existing `(isPublic, createdAt)` index; Postgres can scan it backward.
      .orderBy(desc(communityRecipes.createdAt))
      .limit(limit)
      .offset(offset);

    const candidates: RecipeCandidate[] = rows.flatMap((r) => {
      const imageUrl = resolveImage(r.imageUrl, r.canonicalImages);
      if (!imageUrl) return [];
      return [
        { id: r.id, title: r.title, imageUrl, cuisineOrigin: r.cuisineOrigin },
      ];
    });

    return { candidates, total, page };
  }
  ```

- [x] **Step 2: Run tests — verify they pass**

  ```bash
  npm run test:run -- taste-picks
  ```

  Expected: all storage tests PASS.

- [x] **Step 3: Commit**

  ```bash
  git add server/storage/taste-picks.ts server/storage/__tests__/taste-picks.test.ts
  git commit -m "feat(taste-picks): storage layer for explicit taste signals"
  ```

---

## Task 5: Route Tests (Write Failing Tests First)

**Files:**

- Create: `server/routes/__tests__/taste-picks.test.ts`

- [x] **Step 1: Write the route test file**

  ```typescript
  // server/routes/__tests__/taste-picks.test.ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import express from "express";
  import request from "supertest";

  import { storage } from "../../storage";
  import { register } from "../taste-picks";
  import { TastePicksValidationError } from "../../storage/taste-picks";

  vi.mock("../../middleware/auth");
  vi.mock("express-rate-limit");

  vi.mock("../../storage", () => ({
    storage: {
      getTastePicks: vi.fn(),
      setTastePicks: vi.fn(),
      getTastePickCandidates: vi.fn(),
      getUserProfile: vi.fn(),
      invalidateSuggestionCacheForUser: vi.fn().mockResolvedValue(undefined),
    },
  }));

  function createApp() {
    const app = express();
    app.use(express.json());
    register(app);
    return app;
  }

  const mockCandidate = {
    id: 1,
    title: "Greek Salad",
    imageUrl: "https://example.com/greek.jpg",
    cuisineOrigin: "Mediterranean",
  };

  const mockPick = {
    recipeId: 1,
    title: "Greek Salad",
    imageUrl: "https://example.com/greek.jpg",
    cuisineOrigin: "Mediterranean",
  };

  describe("Taste Picks Routes", () => {
    let app: express.Express;

    beforeEach(() => {
      vi.clearAllMocks();
      app = createApp();
    });

    describe("GET /api/taste-picks/candidates", () => {
      it("returns paginated candidates", async () => {
        vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
        vi.mocked(storage.getTastePickCandidates).mockResolvedValue({
          candidates: [mockCandidate],
          total: 1,
          page: 1,
        });

        const res = await request(app).get("/api/taste-picks/candidates");

        expect(res.status).toBe(200);
        expect(res.body.candidates).toHaveLength(1);
        expect(res.body.candidates[0].title).toBe("Greek Salad");
        expect(res.body.total).toBe(1);
      });

      it("passes dietType from query param when present", async () => {
        vi.mocked(storage.getTastePickCandidates).mockResolvedValue({
          candidates: [],
          total: 0,
          page: 1,
        });

        await request(app).get("/api/taste-picks/candidates?dietType=vegan");

        expect(vi.mocked(storage.getTastePickCandidates)).toHaveBeenCalledWith(
          expect.objectContaining({ dietType: "vegan" }),
        );
      });

      it("falls back to stored profile dietType when no query param", async () => {
        vi.mocked(storage.getUserProfile).mockResolvedValue({
          dietType: "vegetarian",
          cuisinePreferences: [],
          allergies: [],
        } as any);
        vi.mocked(storage.getTastePickCandidates).mockResolvedValue({
          candidates: [],
          total: 0,
          page: 1,
        });

        await request(app).get("/api/taste-picks/candidates");

        expect(vi.mocked(storage.getTastePickCandidates)).toHaveBeenCalledWith(
          expect.objectContaining({ dietType: "vegetarian" }),
        );
      });
    });

    describe("GET /api/taste-picks", () => {
      it("returns current picks", async () => {
        vi.mocked(storage.getTastePicks).mockResolvedValue([mockPick]);

        const res = await request(app).get("/api/taste-picks");

        expect(res.status).toBe(200);
        expect(res.body.picks).toHaveLength(1);
        expect(res.body.picks[0].recipeId).toBe(1);
      });
    });

    describe("PUT /api/taste-picks", () => {
      it("saves picks and returns updated preferences", async () => {
        vi.mocked(storage.setTastePicks).mockResolvedValue({
          picks: [mockPick],
          cuisinePreferences: ["Mediterranean"],
        });

        const res = await request(app)
          .put("/api/taste-picks")
          .send({ recipeIds: [1] });

        expect(res.status).toBe(200);
        expect(res.body.picks).toHaveLength(1);
        expect(res.body.cuisinePreferences).toContain("Mediterranean");
      });

      it("fires cache invalidation after save", async () => {
        vi.mocked(storage.setTastePicks).mockResolvedValue({
          picks: [],
          cuisinePreferences: ["Italian"],
        });

        await request(app).put("/api/taste-picks").send({ recipeIds: [] });

        expect(
          vi.mocked(storage.invalidateSuggestionCacheForUser),
        ).toHaveBeenCalledWith("1");
      });

      it("returns 400 when recipeIds is missing", async () => {
        const res = await request(app).put("/api/taste-picks").send({});
        expect(res.status).toBe(400);
      });

      it("returns 400 when recipeIds is not an array", async () => {
        const res = await request(app)
          .put("/api/taste-picks")
          .send({ recipeIds: "bad" });
        expect(res.status).toBe(400);
      });

      it("returns 400 when too many recipeIds are submitted", async () => {
        const res = await request(app)
          .put("/api/taste-picks")
          .send({ recipeIds: Array.from({ length: 51 }, (_, i) => i + 1) });

        expect(res.status).toBe(400);
      });

      it("returns 400 when selected recipes are not public candidates", async () => {
        vi.mocked(storage.setTastePicks).mockRejectedValue(
          new TastePicksValidationError(
            "Taste picks must reference public recipes",
          ),
        );

        const res = await request(app)
          .put("/api/taste-picks")
          .send({ recipeIds: [999] });
        expect(res.status).toBe(400);
      });

      it("accepts empty recipeIds array", async () => {
        vi.mocked(storage.setTastePicks).mockResolvedValue({
          picks: [],
          cuisinePreferences: [],
        });

        const res = await request(app)
          .put("/api/taste-picks")
          .send({ recipeIds: [] });
        expect(res.status).toBe(200);
      });
    });
  });
  ```

- [x] **Step 2: Run tests — verify they fail with "module not found"**

  ```bash
  npm run test:run -- routes/__tests__/taste-picks
  ```

  Expected: FAIL — `../taste-picks` route module not found.

---

## Task 6: Route Implementation

**Files:**

- Create: `server/routes/taste-picks.ts`

- [x] **Step 1: Create the route module**

  ```typescript
  // server/routes/taste-picks.ts
  import type { Express, Response } from "express";
  import { z } from "zod";
  import { storage } from "../storage";
  import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
  import { sendError } from "../lib/api-errors";
  import { ErrorCode } from "@shared/constants/error-codes";
  import { fireAndForget } from "../lib/fire-and-forget";
  import { handleRouteError } from "./_helpers";
  import { crudRateLimit } from "./_rate-limiters";
  import { TastePicksValidationError } from "../storage/taste-picks";

  const setPicksSchema = z.object({
    recipeIds: z.array(z.number().int().positive()).max(50),
  });

  const candidatesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    dietType: z
      .enum([
        "omnivore",
        "vegetarian",
        "vegan",
        "keto",
        "paleo",
        "mediterranean",
        "low-carb",
        "gluten-free",
      ])
      .optional(),
  });

  export function register(app: Express): void {
    // GET /api/taste-picks/candidates
    app.get(
      "/api/taste-picks/candidates",
      requireAuth,
      crudRateLimit,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const query = candidatesQuerySchema.safeParse(req.query);
          if (!query.success) {
            return sendError(
              res,
              400,
              "Invalid query params",
              ErrorCode.VALIDATION_ERROR,
            );
          }

          // dietType from query param takes precedence over stored profile
          let dietType: string | null | undefined = query.data.dietType;
          if (!dietType) {
            const profile = await storage.getUserProfile(req.userId);
            dietType = profile?.dietType ?? null;
          }

          const result = await storage.getTastePickCandidates({
            page: query.data.page,
            limit: query.data.limit,
            dietType,
          });

          res.json(result);
        } catch (error) {
          handleRouteError(res, error, "fetch taste pick candidates");
        }
      },
    );

    // GET /api/taste-picks
    app.get(
      "/api/taste-picks",
      requireAuth,
      crudRateLimit,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const picks = await storage.getTastePicks(req.userId);
          res.json({ picks });
        } catch (error) {
          handleRouteError(res, error, "fetch taste picks");
        }
      },
    );

    // PUT /api/taste-picks
    app.put(
      "/api/taste-picks",
      requireAuth,
      crudRateLimit,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const parsed = setPicksSchema.safeParse(req.body);
          if (!parsed.success) {
            return sendError(
              res,
              400,
              "recipeIds must be an array of integers",
              ErrorCode.VALIDATION_ERROR,
            );
          }

          const result = await storage.setTastePicks(
            req.userId,
            parsed.data.recipeIds,
          );

          // Taste signals changed, so personalized suggestions should be regenerated
          fireAndForget(
            "taste-picks-cache-invalidation",
            storage.invalidateSuggestionCacheForUser(req.userId),
          );

          res.json(result);
        } catch (error) {
          if (error instanceof TastePicksValidationError) {
            return sendError(
              res,
              400,
              error.message,
              ErrorCode.VALIDATION_ERROR,
            );
          }
          handleRouteError(res, error, "save taste picks");
        }
      },
    );
  }
  ```

- [x] **Step 2: Run route tests — verify they pass**

  ```bash
  npm run test:run -- routes/__tests__/taste-picks
  ```

  Expected: all PASS.

- [x] **Step 3: Commit**

  ```bash
  git add server/routes/taste-picks.ts server/routes/__tests__/taste-picks.test.ts
  git commit -m "feat(taste-picks): route handlers — candidates, get, put"
  ```

---

## Task 7: Wire Server-Side

**Files:**

- Modify: `server/storage/index.ts`
- Modify: `server/routes.ts`

- [x] **Step 1: Expose taste-picks functions in `server/storage/index.ts`**

  Add import near the top of the file (after `canonicalRecipesStorage` import):

  ```typescript
  import * as tastePicksStorage from "./taste-picks";
  ```

  Add to the `storage` object (after `canonicalRecipes` entries):

  ```typescript
  // Taste Picks
  getTastePicks: tastePicksStorage.getTastePicks,
  setTastePicks: tastePicksStorage.setTastePicks,
  getTastePickCandidates: tastePicksStorage.getTastePickCandidates,
  ```

- [x] **Step 2: Register route in `server/routes.ts`**

  Add import near the top (after `registerCuratedRecipes` import):

  ```typescript
  import { register as registerTastePicks } from "./routes/taste-picks";
  ```

  Add registration inside `registerRoutes` (after `registerCuratedRecipes(app)`):

  ```typescript
  registerTastePicks(app);
  ```

- [x] **Step 3: Run full test suite to check for regressions**

  ```bash
  npm run test:run
  ```

  Expected: all existing tests pass, new tests pass.

- [x] **Step 4: Commit**

  ```bash
  git add server/storage/index.ts server/routes.ts
  git commit -m "feat(taste-picks): wire storage and routes into server"
  ```

---

## Task 8: Client Shared Component — `TastePicksGrid`

**Files:**

- Create: `client/components/TastePicksGrid.tsx`

- [x] **Step 1: Create the component**

  ```typescript
  // client/components/TastePicksGrid.tsx
  import React from "react";
  import {
    View,
    FlatList,
    Pressable,
    Image,
    StyleSheet,
  } from "react-native";
  import { Feather } from "@expo/vector-icons";
  import { ThemedText } from "@/components/ThemedText";
  import { useTheme } from "@/hooks/useTheme";
  import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
  import type { RecipeCandidate } from "@shared/types/taste-picks";

  interface TastePicksGridProps {
    candidates: RecipeCandidate[];
    selectedIds: Set<number>;
    onToggle: (recipeId: number) => void;
    onEndReached?: () => void;
    isLoading?: boolean;
  }

  function RecipeCard({
    item,
    selected,
    onToggle,
  }: {
    item: RecipeCandidate;
    selected: boolean;
    onToggle: (id: number) => void;
  }) {
    const { theme } = useTheme();
    return (
      <Pressable
        onPress={() => onToggle(item.id)}
        accessibilityLabel={item.title}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        style={[
          styles.card,
          {
            borderColor: selected ? theme.error : theme.border,
            borderWidth: selected ? 2 : 1,
            backgroundColor: theme.backgroundDefault,
          },
        ]}
      >
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
          {selected && (
            <View
              style={[styles.checkmark, { backgroundColor: theme.error }]}
            >
              <Feather name="check" size={10} color={theme.buttonText} />
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <ThemedText
            type="small"
            numberOfLines={1}
            style={styles.cardTitle}
          >
            {item.title}
          </ThemedText>
          {item.cuisineOrigin && (
            <ThemedText
              type="caption"
              numberOfLines={1}
              style={{ color: theme.textSecondary }}
            >
              {item.cuisineOrigin}
            </ThemedText>
          )}
        </View>
      </Pressable>
    );
  }

  export function TastePicksGrid({
    candidates,
    selectedIds,
    onToggle,
    onEndReached,
    isLoading,
  }: TastePicksGridProps) {
    return (
      <FlatList
        data={candidates}
        numColumns={2}
        keyExtractor={(item) => String(item.id)}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <RecipeCard
            item={item}
            selected={selectedIds.has(item.id)}
            onToggle={onToggle}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  const CARD_IMAGE_HEIGHT = 90;

  const styles = StyleSheet.create({
    list: {
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing["2xl"],
    },
    row: {
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    card: {
      flex: 1,
      borderRadius: BorderRadius.sm,
      overflow: "hidden",
    },
    imageContainer: {
      position: "relative",
    },
    image: {
      height: CARD_IMAGE_HEIGHT,
      width: "100%",
    },
    checkmark: {
      position: "absolute",
      top: Spacing.xs,
      right: Spacing.xs,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    cardBody: {
      padding: Spacing.sm,
      gap: 2,
    },
    cardTitle: {
      fontWeight: "600",
    },
  });
  ```

- [x] **Step 2: Verify TypeScript compiles**

  ```bash
  npm run type-check 2>&1 | grep -i "taste"
  ```

  Expected: no type errors related to taste-picks.

- [x] **Step 3: Commit**

  ```bash
  git add client/components/TastePicksGrid.tsx
  git commit -m "feat(taste-picks): TastePicksGrid shared component"
  ```

---

## Task 9: Onboarding Integration

**Files:**

- Create: `client/screens/onboarding/TastePicksScreen.tsx`
- Modify: `client/context/OnboardingContext.tsx`
- Modify: `client/navigation/OnboardingNavigator.tsx`
- Modify: `client/screens/onboarding/PreferencesScreen.tsx`

- [x] **Step 1: Change PreferencesScreen to call `nextStep` instead of `completeOnboarding`**

  In `client/screens/onboarding/PreferencesScreen.tsx`:

  Change line 24 — replace `completeOnboarding` with `nextStep`:

  ```typescript
  // Before:
  const { data, updateData, prevStep, completeOnboarding, isSubmitting } =
    useOnboarding();

  // After:
  const { data, updateData, prevStep, nextStep } = useOnboarding();
  ```

  Change the step indicator chip text (line 90) from "Step 5 of 6" to "Step 6 of 7":

  ```typescript
  Step 6 of 7
  ```

  Change the Button at the bottom from `completeOnboarding` to `nextStep`:

  ```typescript
  // Before:
  <Button
    onPress={completeOnboarding}
    disabled={isSubmitting}
    accessibilityLabel={
      isSubmitting ? "Saving your preferences" : "Complete setup"
    }
    style={styles.continueButton}
  >
    {isSubmitting ? "Saving..." : "Complete Setup"}
  </Button>

  // After:
  <Button
    onPress={nextStep}
    accessibilityLabel="Next step"
    style={styles.continueButton}
  >
    Next
  </Button>
  ```

- [x] **Step 2: Bump `totalSteps` in `OnboardingContext.tsx`**

  In `client/context/OnboardingContext.tsx`, line 55:

  ```typescript
  // Before:
  const totalSteps = 6;

  // After:
  const totalSteps = 7;
  ```

- [x] **Step 3: Create `TastePicksScreen.tsx`**

  ```typescript
  // client/screens/onboarding/TastePicksScreen.tsx
  import React, { useState, useCallback, useEffect } from "react";
  import { Alert, View, StyleSheet, Pressable } from "react-native";
  import { useSafeAreaInsets } from "react-native-safe-area-context";

  import { ThemedText } from "@/components/ThemedText";
  import { Button } from "@/components/Button";
  import { TastePicksGrid } from "@/components/TastePicksGrid";
  import { useTheme } from "@/hooks/useTheme";
  import { useOnboarding } from "@/context/OnboardingContext";
  import { useAuthContext } from "@/context/AuthContext";
  import { apiRequest } from "@/lib/query-client";
  import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
  import { Feather } from "@expo/vector-icons";
  import type { RecipeCandidate } from "@shared/types/taste-picks";

  const MIN_PICKS = 5;
  const PAGE_LIMIT = 30;

  export default function TastePicksScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { data, prevStep } = useOnboarding();
    const { updateUser } = useAuthContext();

    const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadCandidates = useCallback(
      async (pageNum: number) => {
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: String(PAGE_LIMIT),
        });
        // Pass draft dietType so server can filter before profile is persisted
        if (data.dietType) params.set("dietType", data.dietType);

        try {
          setLoadError(null);
          const res = await apiRequest("GET", `/api/taste-picks/candidates?${params}`);
          if (!res.ok) throw new Error("Failed to load recipes");
          const body = await res.json();
          setCandidates((prev) =>
            pageNum === 1 ? body.candidates : [...prev, ...body.candidates],
          );
          setHasMore(body.candidates.length === PAGE_LIMIT);
        } catch {
          setLoadError("Could not load recipes. Pull to retry.");
          Alert.alert("Could not load recipes", "Please try again.");
        }
      },
      [data.dietType],
    );

    useEffect(() => {
      loadCandidates(1);
    }, [loadCandidates]);

    const handleToggle = useCallback((recipeId: number) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(recipeId)) {
          next.delete(recipeId);
        } else {
          next.add(recipeId);
        }
        return next;
      });
    }, []);

    const handleEndReached = useCallback(() => {
      if (!hasMore) return;
      const nextPage = page + 1;
      setPage(nextPage);
      loadCandidates(nextPage);
    }, [hasMore, page, loadCandidates]);

    const handleContinue = useCallback(async () => {
      setIsSubmitting(true);
      try {
        // 1. Persist profile
        await apiRequest("POST", "/api/user/dietary-profile", data);
        // 2. Save picks — updates explicit taste signals
        if (selectedIds.size > 0) {
          await apiRequest("PUT", "/api/taste-picks", {
            recipeIds: [...selectedIds],
          });
        }
        // 3. Mark onboarding complete — navigates to home
        await updateUser({ onboardingCompleted: true });
      } catch {
        Alert.alert("Could not save preferences", "Please try again before continuing.");
      } finally {
        setIsSubmitting(false);
      }
    }, [data, selectedIds, updateUser]);

    const handleSkip = useCallback(async () => {
      setIsSubmitting(true);
      try {
        await apiRequest("POST", "/api/user/dietary-profile", data);
        await updateUser({ onboardingCompleted: true });
      } catch {
        Alert.alert("Could not finish onboarding", "Please try again before continuing.");
      } finally {
        setIsSubmitting(false);
      }
    }, [data, updateUser]);

    const canContinue = selectedIds.size >= MIN_PICKS;
    const chipActive = selectedIds.size >= MIN_PICKS;

    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <View style={styles.header}>
          <ThemedText type="h3" style={styles.title}>
            Pick recipes you love
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            We&apos;ll personalise your recommendations. Tap at least {MIN_PICKS}.
          </ThemedText>
          <View
            style={[
              styles.chip,
              {
                backgroundColor: chipActive
                  ? theme.error
                  : withOpacity(theme.error, 0.12),
              },
            ]}
          >
            <ThemedText
              type="small"
              style={{
                color: chipActive ? theme.buttonText : theme.error,
                fontWeight: "600",
              }}
            >
              {chipActive
                ? `${selectedIds.size} selected ✓`
                : `${selectedIds.size} of ${MIN_PICKS} selected`}
            </ThemedText>
          </View>
        </View>

        {loadError ? (
          <View style={[styles.errorBanner, { backgroundColor: withOpacity(theme.error, 0.12) }]}>
            <ThemedText type="small" style={{ color: theme.error }}>{loadError}</ThemedText>
            <Pressable
              onPress={() => loadCandidates(1)}
              accessibilityRole="button"
              accessibilityLabel="Retry loading taste pick recipes"
            >
              <ThemedText type="small" style={{ color: theme.error, fontWeight: "700" }}>
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.grid}>
          <TastePicksGrid
            candidates={candidates}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            onEndReached={handleEndReached}
          />
        </View>

        <View
          style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}
        >
          <View style={styles.footerButtons}>
            <Pressable
              onPress={prevStep}
              style={({ pressed }) => [
                styles.backButton,
                {
                  backgroundColor: pressed
                    ? theme.backgroundTertiary
                    : theme.backgroundSecondary,
                },
              ]}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Feather name="arrow-left" size={24} color={theme.text} />
            </Pressable>
            <Button
              onPress={handleContinue}
              disabled={!canContinue || isSubmitting}
              accessibilityLabel={
                canContinue
                  ? isSubmitting
                    ? "Saving..."
                    : "Continue"
                  : `Select ${MIN_PICKS - selectedIds.size} more to continue`
              }
              style={styles.continueButton}
            >
              {isSubmitting ? "Saving..." : "Continue"}
            </Button>
          </View>
          <Pressable
            onPress={handleSkip}
            disabled={isSubmitting}
            accessibilityLabel="Skip for now"
            accessibilityRole="button"
            style={styles.skipButton}
          >
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Skip for now
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing["2xl"],
      paddingBottom: Spacing.md,
      gap: Spacing.sm,
    },
    title: {},
    subtitle: { lineHeight: 22 },
    chip: {
      alignSelf: "flex-start",
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.full,
    },
    grid: { flex: 1 },
    errorBanner: {
      marginHorizontal: Spacing.xl,
      marginBottom: Spacing.sm,
      padding: Spacing.md,
      borderRadius: BorderRadius.md,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: Spacing.md,
    },
    footer: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      gap: Spacing.sm,
    },
    footerButtons: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
    },
    backButton: {
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: BorderRadius.full,
    },
    continueButton: { flex: 1 },
    skipButton: {
      alignItems: "center",
      paddingVertical: Spacing.xs,
    },
  });
  ```

- [x] **Step 4: Add `TastePicks` to `OnboardingNavigator.tsx`**

  In `client/navigation/OnboardingNavigator.tsx`:

  Add import after the `PreferencesScreen` import:

  ```typescript
  import TastePicksScreen from "@/screens/onboarding/TastePicksScreen";
  ```

  Add to `OnboardingStackParamList`:

  ```typescript
  export type OnboardingStackParamList = {
    Welcome: undefined;
    Allergies: undefined;
    HealthConditions: undefined;
    DietType: undefined;
    Goals: undefined;
    Preferences: undefined;
    TastePicks: undefined; // add this line
  };
  ```

  Add to `SCREENS` array (after `PreferencesScreen`):

  ```typescript
  { name: "TastePicks" as const, component: TastePicksScreen },
  ```

- [x] **Step 5: Type-check the onboarding changes**

  ```bash
  npm run type-check 2>&1 | grep -iE "onboarding|tastepicks|preference"
  ```

  Expected: no errors.

- [x] **Step 6: Commit**

  ```bash
  git add client/context/OnboardingContext.tsx \
          client/navigation/OnboardingNavigator.tsx \
          client/screens/onboarding/PreferencesScreen.tsx \
          client/screens/onboarding/TastePicksScreen.tsx
  git commit -m "feat(taste-picks): onboarding step 7 — TastePicksScreen"
  ```

---

## Task 10: Settings Integration

**Files:**

- Create: `client/screens/TasteProfileScreen.tsx`
- Modify: `client/navigation/ProfileStackNavigator.tsx`
- Modify: `client/screens/SettingsScreen.tsx`
- Modify: `client/types/navigation.ts`

- [x] **Step 1: Create `TasteProfileScreen.tsx`**

  ```typescript
  // client/screens/TasteProfileScreen.tsx
  import React, { useState, useCallback, useEffect } from "react";
  import { Alert, View, StyleSheet } from "react-native";

  import { ThemedText } from "@/components/ThemedText";
  import { Button } from "@/components/Button";
  import { TastePicksGrid } from "@/components/TastePicksGrid";
  import { useTheme } from "@/hooks/useTheme";
  import { useNavigation } from "@react-navigation/native";
  import { useSafeAreaInsets } from "react-native-safe-area-context";
  import { apiRequest } from "@/lib/query-client";
  import { Spacing, withOpacity } from "@/constants/theme";
  import type { RecipeCandidate } from "@shared/types/taste-picks";
  import type { TasteProfileScreenNavigationProp } from "@/types/navigation";

  const PAGE_LIMIT = 30;

  export default function TasteProfileScreen() {
    const { theme } = useTheme();
    const navigation = useNavigation<TasteProfileScreenNavigationProp>();
    const insets = useSafeAreaInsets();

    const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    // Load existing picks on mount
    useEffect(() => {
      async function loadPicks() {
        try {
          const res = await apiRequest("GET", "/api/taste-picks");
          if (!res.ok) throw new Error("Failed to load taste picks");
          const body = await res.json();
          setSelectedIds(new Set(body.picks.map((p: { recipeId: number }) => p.recipeId)));
        } catch {
          Alert.alert("Could not load taste profile", "Please try again.");
        }
      }
      loadPicks();
    }, []);

    const loadCandidates = useCallback(async (pageNum: number) => {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(PAGE_LIMIT),
      });
      try {
        const res = await apiRequest("GET", `/api/taste-picks/candidates?${params}`);
        if (!res.ok) throw new Error("Failed to load candidates");
        const body = await res.json();
        setCandidates((prev) =>
          pageNum === 1 ? body.candidates : [...prev, ...body.candidates],
        );
        setHasMore(body.candidates.length === PAGE_LIMIT);
      } catch {
        Alert.alert("Could not load recipes", "Please try again.");
      }
    }, []);

    useEffect(() => {
      loadCandidates(1);
    }, [loadCandidates]);

    const handleToggle = useCallback((recipeId: number) => {
      setIsDirty(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(recipeId)) {
          next.delete(recipeId);
        } else {
          next.add(recipeId);
        }
        return next;
      });
    }, []);

    const handleEndReached = useCallback(() => {
      if (!hasMore) return;
      const nextPage = page + 1;
      setPage(nextPage);
      loadCandidates(nextPage);
    }, [hasMore, page, loadCandidates]);

    const handleSave = useCallback(async () => {
      setIsSubmitting(true);
      try {
        await apiRequest("PUT", "/api/taste-picks", {
          recipeIds: [...selectedIds],
        });
        setIsDirty(false);
        navigation.goBack();
      } catch {
        Alert.alert("Could not save taste profile", "Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    }, [selectedIds, navigation]);

    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <View style={styles.header}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Recipes you love — used to personalise your feed.
          </ThemedText>
          <View
            style={[
              styles.chip,
              {
                backgroundColor:
                  selectedIds.size > 0
                    ? theme.error
                    : withOpacity(theme.error, 0.12),
              },
            ]}
          >
            <ThemedText
              type="small"
              style={{
                color: selectedIds.size > 0 ? theme.buttonText : theme.error,
                fontWeight: "600",
              }}
            >
              {selectedIds.size} selected
            </ThemedText>
          </View>
        </View>

        <View style={styles.grid}>
          <TastePicksGrid
            candidates={candidates}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            onEndReached={handleEndReached}
          />
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <Button
            onPress={handleSave}
            disabled={isSubmitting || !isDirty}
            accessibilityLabel={isSubmitting ? "Saving..." : "Save Changes"}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </View>
      </View>
    );
  }

  const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.md,
      gap: Spacing.sm,
    },
    chip: {
      alignSelf: "flex-start",
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: 999,
    },
    grid: { flex: 1 },
    footer: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
    },
  });
  ```

- [x] **Step 2: Add `TasteProfileScreenNavigationProp` to `client/types/navigation.ts`**

  Add after the `NotebookEntryNavigationProp` export at the end of the file:

  ```typescript
  /**
   * Navigation prop for TasteProfileScreen.
   * Simple goBack — lives in ProfileStack pushed from SettingsScreen.
   */
  export type TasteProfileScreenNavigationProp = NativeStackNavigationProp<
    ProfileStackParamList,
    "TasteProfile"
  >;
  ```

  Note: this type will show an error until Step 3 adds `TasteProfile` to `ProfileStackParamList`.

- [x] **Step 3: Add `TasteProfile` to `ProfileStackNavigator.tsx`**

  Add import after `CoachRemindersScreen` import:

  ```typescript
  import TasteProfileScreen from "@/screens/TasteProfileScreen";
  ```

  Add to `ProfileStackParamList`:

  ```typescript
  TasteProfile: undefined;
  ```

  Add a new `Stack.Screen` after the `CoachReminders` screen:

  ```typescript
  <Stack.Screen
    name="TasteProfile"
    component={TasteProfileScreen}
    options={{
      headerTitle: () => (
        <HeaderTitle title="Taste Profile" showIcon={false} />
      ),
    }}
  />
  ```

- [x] **Step 4: Add "Taste Profile" row to `SettingsScreen.tsx`**

  Add to `SETTINGS_ITEMS` array, between `editProfile` and `healthkit`:

  ```typescript
  { id: "tasteProfile", icon: "heart" as FeatherIconName, label: "Taste Profile" },
  ```

  Add to the `switch` in `handlePress`:

  ```typescript
  case "tasteProfile":
    navigation.navigate("TasteProfile");
    break;
  ```

- [x] **Step 5: Type-check settings changes**

  ```bash
  npm run type-check 2>&1 | grep -iE "taste|profile"
  ```

  Expected: no errors.

- [x] **Step 6: Run full test suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass.

- [x] **Step 7: Commit**

  ```bash
  git add client/screens/TasteProfileScreen.tsx \
          client/navigation/ProfileStackNavigator.tsx \
          client/screens/SettingsScreen.tsx \
          client/types/navigation.ts
  git commit -m "feat(taste-picks): settings TasteProfileScreen + navigation wiring"
  ```

---

## Task 11: Final Verification

- [x] **Step 1: Run full type-check**

  ```bash
  npm run type-check
  ```

  Expected: zero errors.

- [x] **Step 2: Run full test suite**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass, including new taste-picks tests.

- [ ] **Step 3: Manual smoke test — onboarding flow**

  In the iOS simulator using the demo/demo123 account:
  - Create a new account (or clear onboarding state)
  - Complete steps 1–6 (Welcome → Preferences)
  - Verify step 7 (Taste Picks) appears with recipe grid
  - Select 4 recipes — verify Continue button stays disabled
  - Select 5th recipe — verify Continue button activates
  - Tap Continue — verify profile saves and app navigates to Home

- [ ] **Step 4: Manual smoke test — settings flow**
  - Navigate to Profile → Settings
  - Verify "Taste Profile" row appears between "Edit Profile" and "Apple Health"
  - Tap it — verify grid appears pre-populated with onboarding picks
  - Toggle a recipe off — verify "Save Changes" becomes active
  - Tap "Save Changes" — verify navigates back to Settings

- [ ] **Step 5: Verify carousel recommendation labels**

  After completing onboarding with Italian recipe picks, return to Home and check that some carousel cards show "Matches your cuisine preferences" instead of "Recently added recipe".

- [x] **Step 6: Final commit + push**

  ```bash
  git push origin HEAD
  ```
