# Recipe "I tried it" + Community Stats Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark a public community recipe "I tried it" from a sticky bottom bar, and show a small "Community" stats section (Tried it · Favourited · Community variants) near the bottom of the recipe, with a list screen of public remixes.

**Architecture:** A new `recipe_tries` table (one row per user per recipe) is the source of truth. All counts are computed from rows on read (no stored totals). Four auth'd endpoints in a new route file serve only `isPublic = true` recipes (404 otherwise, including to the author). The client shares one React Query cache entry per recipe between the bar and the stats section, with optimistic updates for the tried toggle.

**Tech Stack:** Drizzle ORM + PostgreSQL, Express, Vitest (+ supertest, + real-Postgres transaction harness), React Native/Expo, TanStack Query, React Navigation native-stack.

**Spec:** `docs/superpowers/specs/2026-10-10-recipe-tried-it-and-stats-design.md` (local-only; `docs/superpowers/` is gitignored). Read it alongside this plan.

## Global Constraints

- Only `community_recipes` rows with `isPublic = true` get the bar, the section or any endpoint response. `isPublic` is nullable; `NULL` counts as private.
- Non-public recipe → HTTP **404 `NOT_FOUND`** for everyone, **including the author** (never 403).
- No endpoint returns _who_ tried a recipe. Counts only.
- Visible favourite count = rows in `favourite_recipes` with `recipeType = 'community'`, **never** `popularityFavorites`.
- `incrementRecipePopularity` / `popularityScore` are **not touched**. "I tried it" does not feed them.
- No "More stats" drawer (owner ruling 2026-10-10).
- Copy (exact strings): bar caption `"Be the first to try it"` / `"1 person tried this"` / `"N people tried this"`; button `"I tried it"` / `"Tried"`; rows `"Tried it"`, `"Favourited"`, `"Community variants"`; zero values `"Be the first"`, `"Not yet"`, `"Remix it"`; section heading `"Community"`; variants header `"Community variants"`; error toast `"Couldn't save — try again"`.
- Accessibility: tried button uses `accessibilityRole="button"` + `accessibilityState={{ selected }}` (same as the catalog save bar heart).
- Header titles are **strings**, never functions (`docs/solutions/logic-errors/function-headertitle-leaks-route-name-into-ios-back-button-2026-10-02.md`).
- Reanimated shared values: `.set()`/`.get()` only, never `sv.value = x` (React Compiler bailout).
- No feature flag. No native changes (OTA-deliverable).
- Prod migration is applied **before merge**, and only with the owner's explicit yes.
- Git: work on branch `feat/recipe-tried-it-stats` in a worktree; never commit to `main`. Commit messages go through a file (`git commit -F`). Ending line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not run the full `test:run` / `check:types` / `lint` ad hoc; run the single test files named in each step. The push hook runs `preflight:fast`.

## Review Focus

1. **Rapid double tap (tap, untap) with responses arriving late** → the final UI state matches the _last_ tap, and the count never goes negative. Pinned in Task 4 (`applyTriedOptimistic` idempotence) and Task 5 (two sequential mutations).
2. **Recipe made private (or deleted) while the screen is open** → the next refetch 404s and the bar/section **disappear**, rather than freezing on stale data. React Query keeps old `data` on a failed refetch, so the render condition must be `isSuccess`, not `data !== undefined`. Pinned in Task 5 (hook test: after a 404 refetch, `isSuccess` is false) and used in Tasks 6–7.
3. **A favourite of a _meal-plan_ recipe whose numeric ID equals the community recipe's ID** → must not count towards the community recipe's "Favourited". Pinned in Task 1 (storage test).
4. **Remix rows with `isPublic = NULL` or `false`** → excluded from `variantCount` and the variants list. Pinned in Task 1.
5. **Account deletion / recipe deletion** → that user's or recipe's `recipe_tries` rows vanish (cascade), so counts drop accordingly. Pinned in Task 1.

---

## File Structure

| File                                                               | Status | Responsibility                                                                              |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| `shared/schema.ts`                                                 | Modify | `recipeTries` table; two new indexes on existing tables                                     |
| `shared/types/recipe-community.ts`                                 | Create | `RecipeCommunityStats`, `RecipeVariantDto` (shared by server + client)                      |
| `migrations/0019_recipe_tries.sql`                                 | Create | Hand-written prod migration                                                                 |
| `server/storage/recipe-tries.ts`                                   | Create | `isPublicCommunityRecipe`, `setRecipeTried`, `getRecipeCommunityStats`, `getRecipeVariants` |
| `server/storage/index.ts`                                          | Modify | Register the four functions on `storage`                                                    |
| `scripts/check-idor-storage.js`                                    | Modify | Allowlist the two recipe-scoped public readers                                              |
| `server/storage/__tests__/recipe-tries.test.ts`                    | Create | Real-Postgres storage tests                                                                 |
| `server/routes/recipe-community.ts`                                | Create | The four endpoints                                                                          |
| `server/routes.ts`                                                 | Modify | Register the new route group                                                                |
| `server/routes/__tests__/recipe-community.test.ts`                 | Create | Handler tests (mocked storage)                                                              |
| `server/routes/__tests__/auth-route-wiring.test.ts`                | Modify | Prove the new routes sit behind real `requireAuth`                                          |
| `server/storage/export.ts`                                         | Modify | Include the user's tries in the data export                                                 |
| `client/components/recipe-community-stats-utils.ts`                | Create | Pure copy/a11y/optimistic helpers                                                           |
| `client/components/__tests__/recipe-community-stats-utils.test.ts` | Create | Tests for the above                                                                         |
| `client/hooks/useRecipeCommunity.ts`                               | Create | Stats query, tried mutation, variants query                                                 |
| `client/hooks/__tests__/useRecipeCommunity.test.ts`                | Create | Hook tests                                                                                  |
| `client/hooks/useFavouriteRecipes.ts`                              | Modify | Favourite toggle also invalidates community stats                                           |
| `client/hooks/__tests__/useFavouriteRecipes.test.ts`               | Modify | Test for that invalidation                                                                  |
| `client/components/RecipeCommunityStats.tsx`                       | Create | "Community" list-row section                                                                |
| `client/components/RecipeDetailContent.tsx`                        | Modify | Render the section before Ask Coach                                                         |
| `client/components/RecipeTriedBar.tsx`                             | Create | Sticky bottom "I tried it" bar                                                              |
| `client/screens/FeaturedRecipeDetailScreen.tsx`                    | Modify | Render the bar; pad content                                                                 |
| `client/screens/RecipeVariantsScreen.tsx`                          | Create | List of public remixes                                                                      |
| `client/navigation/RootStackNavigator.tsx`                         | Modify | Register `RecipeVariants`                                                                   |

**Deviation from spec §5.2:** the routes live in a new `server/routes/recipe-community.ts` instead of `server/routes/recipes.ts`. `recipes.ts` is 432 lines and imports the AI generation services, so a separate group keeps it focused and lets the auth-wiring test mount these routes without mocking those services. The spec helper `getPublicCommunityRecipeId` is named `isPublicCommunityRecipe` (it returns a boolean).

---

### Task 0: Worktree, branch, and the filed todo

**Files:**

- Move in: `todos/P2-2026-10-10-quick-add-community-recipe-sends-wrong-id.md` (currently untracked in the main checkout)

- [ ] **Step 1: Create the worktree from fresh `main`**

```bash
cd /Users/williamtower/projects/OCRecipes
git fetch origin main
git worktree add -b feat/recipe-tried-it-stats ../OCRecipes-wt-tried-it origin/main
bash scripts/declare-worktree.sh /Users/williamtower/projects/OCRecipes-wt-tried-it
```

Expected: `declared worktree: /Users/williamtower/projects/OCRecipes-wt-tried-it`. All later paths are relative to this worktree. Inside it, use `/usr/bin/git` if `rtk git` is blocked by the worktree guard.

- [ ] **Step 2: Move the filed todo into the worktree and commit it**

```bash
mv /Users/williamtower/projects/OCRecipes/todos/P2-2026-10-10-quick-add-community-recipe-sends-wrong-id.md \
   /Users/williamtower/projects/OCRecipes-wt-tried-it/todos/
cd /Users/williamtower/projects/OCRecipes-wt-tried-it
git add todos/P2-2026-10-10-quick-add-community-recipe-sends-wrong-id.md
```

Write the message to `$SCRATCH/commit-msg.txt` (scratchpad), then `git commit -F`:

```
chore(todos): file Quick Add community-recipe wrong-ID bug

Found while specifying the recipe "I tried it" feature.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

### Task 1: Schema, migration and storage

**Files:**

- Modify: `shared/schema.ts` (new table after the `communityRecipes` table, before `// Recipe generation log` ~line 947; index arrays of `favouriteRecipes` ~812 and `communityRecipes` ~928)
- Create: `shared/types/recipe-community.ts`
- Create: `migrations/0019_recipe_tries.sql`
- Create: `server/storage/recipe-tries.ts`
- Modify: `server/storage/index.ts` (import block ~line 41; registry beside "Taste Picks" ~line 395)
- Modify: `scripts/check-idor-storage.js` (`ALLOWLIST`, ~line 97 near `incrementRecipePopularity`)
- Test: `server/storage/__tests__/recipe-tries.test.ts`

**Interfaces:**

- Produces (shared types, `@shared/types/recipe-community`):
  ```ts
  export interface RecipeCommunityStats {
    triedCount: number;
    triedByMe: boolean;
    favouritedCount: number;
    variantCount: number;
  }
  export interface RecipeVariantDto {
    id: number;
    title: string;
    imageUrl: string | null;
    createdAt: string; // ISO string on the wire
  }
  ```
- Produces (storage, also on `storage.*`):
  - `isPublicCommunityRecipe(recipeId: number): Promise<boolean>`
  - `setRecipeTried(userId: string, recipeId: number, tried: boolean): Promise<void>`
  - `getRecipeCommunityStats(recipeId: number, userId: string): Promise<RecipeCommunityStats>`
  - `getRecipeVariants(recipeId: number, limit?: number): Promise<{ id: number; title: string; imageUrl: string | null; createdAt: Date }[]>`
- Produces (schema): `recipeTries`, types `RecipeTry`, `InsertRecipeTry`.

- [ ] **Step 1: Add the shared types file**

Create `shared/types/recipe-community.ts` with exactly the two interfaces in **Interfaces** above, each with a one-line doc comment.

- [ ] **Step 2: Add the table and indexes to `shared/schema.ts`**

Insert directly after the `communityRecipes` table definition (before `// Recipe generation log - tracks daily generation limits`), so both referenced tables are already declared:

```ts
// "I tried it" — one row per user per public community recipe. Counts are
// computed from these rows on read; createdAt supports time-windowed
// rankings later (a createdAt-led index is added with that feature).
export const recipeTries = pgTable(
  "recipe_tries",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id")
      .references(() => communityRecipes.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    unique("recipe_tries_user_recipe_uniq").on(table.userId, table.recipeId),
    index("recipe_tries_recipe_created_idx").on(
      table.recipeId,
      table.createdAt,
    ),
  ],
);

export type RecipeTry = typeof recipeTries.$inferSelect;
export type InsertRecipeTry = typeof recipeTries.$inferInsert;
```

In the `favouriteRecipes` index array, after `index("favourite_recipes_user_id_idx")...`:

```ts
    index("favourite_recipes_recipe_idx").on(table.recipeId, table.recipeType),
```

In the `communityRecipes` index array, after `index("community_recipes_author_idx")...`:

```ts
    index("community_recipes_remixed_from_idx").on(table.remixedFromId),
```

- [ ] **Step 3: Push the schema to the local dev/test DB**

Run: `npm run db:push`
Expected: drizzle-kit reports creating `recipe_tries` and the 3 indexes, with no destructive prompts. If it proposes dropping or altering anything else, **stop** and report it: the local DB has drifted.

- [ ] **Step 4: Write the prod migration**

Create `migrations/0019_recipe_tries.sql`:

```sql
-- "I tried it" on public community recipes + indexes for its counts.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads recipe_tries on every recipe stats request, so the table must
-- exist before that bundle deploys. Applying early is safe for the old bundle:
-- a new table it never reads and two indexes. Additive and idempotent; no
-- backfill. Constraint and index names match Drizzle's.

CREATE TABLE IF NOT EXISTS recipe_tries (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT recipe_tries_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  recipe_id integer NOT NULL
    CONSTRAINT recipe_tries_recipe_id_community_recipes_id_fk REFERENCES community_recipes(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT recipe_tries_user_recipe_uniq UNIQUE (user_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS recipe_tries_recipe_created_idx
  ON recipe_tries (recipe_id, created_at);

CREATE INDEX IF NOT EXISTS favourite_recipes_recipe_idx
  ON favourite_recipes (recipe_id, recipe_type);
CREATE INDEX IF NOT EXISTS community_recipes_remixed_from_idx
  ON community_recipes (remixed_from_id);
```

Verify the names match what Drizzle generated: `psql "$DATABASE_URL" -c '\d recipe_tries'`. If the FK names differ, change the SQL to match psql's output.

- [ ] **Step 5: Write the failing storage tests**

Create `server/storage/__tests__/recipe-tries.test.ts`:

```ts
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import {
  communityRecipes,
  favouriteRecipes,
  recipeTries,
  users,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  isPublicCommunityRecipe,
  setRecipeTried,
  getRecipeCommunityStats,
  getRecipeVariants,
} = await import("../recipe-tries");

let tx: NodePgDatabase<typeof schema>;
let author: schema.User;
let viewer: schema.User;

async function createCommunityRecipe(
  overrides: Record<string, unknown> = {},
): Promise<schema.CommunityRecipe> {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId: author.id,
      title: "Test Community Recipe",
      // `test-` prefix: caught by global-teardown if a row leaks.
      normalizedProductName: "test-product",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return recipe;
}

describe("recipe-tries storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    author = await createTestUser(tx);
    viewer = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("isPublicCommunityRecipe", () => {
    it("is true only when isPublic = true", async () => {
      const pub = await createCommunityRecipe({ isPublic: true });
      const priv = await createCommunityRecipe({ isPublic: false });
      const nul = await createCommunityRecipe({ isPublic: null });
      expect(await isPublicCommunityRecipe(pub.id)).toBe(true);
      expect(await isPublicCommunityRecipe(priv.id)).toBe(false);
      expect(await isPublicCommunityRecipe(nul.id)).toBe(false);
    });

    it("is false for a missing id", async () => {
      expect(await isPublicCommunityRecipe(2_000_000_000)).toBe(false);
    });
  });

  describe("setRecipeTried + getRecipeCommunityStats", () => {
    it("starts at all zeros", async () => {
      const r = await createCommunityRecipe();
      expect(await getRecipeCommunityStats(r.id, viewer.id)).toEqual({
        triedCount: 0,
        triedByMe: false,
        favouritedCount: 0,
        variantCount: 0,
      });
    });

    it("marking twice counts once", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await setRecipeTried(viewer.id, r.id, true);
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.triedCount).toBe(1);
      expect(stats.triedByMe).toBe(true);
    });

    it("triedByMe is per-user", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(author.id, r.id, true);
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.triedCount).toBe(1);
      expect(stats.triedByMe).toBe(false);
    });

    it("unmarking removes the row; unmarking again is a no-op", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await setRecipeTried(viewer.id, r.id, false);
      await setRecipeTried(viewer.id, r.id, false);
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.triedCount).toBe(0);
      expect(stats.triedByMe).toBe(false);
    });

    it("favouritedCount counts current community favourites only", async () => {
      const r = await createCommunityRecipe();
      await tx.insert(favouriteRecipes).values([
        { userId: viewer.id, recipeId: r.id, recipeType: "community" },
        { userId: author.id, recipeId: r.id, recipeType: "community" },
      ]);
      // Same numeric id, but a meal-plan favourite — must NOT count.
      // (favourite_recipes.recipe_id has no FK, so no meal-plan row is needed.)
      await tx.insert(favouriteRecipes).values({
        userId: viewer.id,
        recipeId: r.id,
        recipeType: "mealPlan",
      });
      // Unfavourite one community favourite.
      await tx
        .delete(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.userId, author.id),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        );
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.favouritedCount).toBe(1);
    });

    it("variantCount counts public remixes only (false and NULL excluded)", async () => {
      const r = await createCommunityRecipe();
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: true });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: false });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: null });
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.variantCount).toBe(1);
    });
  });

  describe("cascades", () => {
    it("deleting the user removes their tries", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await tx.delete(users).where(eq(users.id, viewer.id));
      const stats = await getRecipeCommunityStats(r.id, author.id);
      expect(stats.triedCount).toBe(0);
    });

    it("deleting the recipe removes its tries", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await tx.delete(communityRecipes).where(eq(communityRecipes.id, r.id));
      const rows = await tx
        .select()
        .from(recipeTries)
        .where(eq(recipeTries.recipeId, r.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe("getRecipeVariants", () => {
    it("returns public remixes newest first, without author", async () => {
      const r = await createCommunityRecipe();
      const older = await createCommunityRecipe({
        remixedFromId: r.id,
        title: "Older",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const newer = await createCommunityRecipe({
        remixedFromId: r.id,
        title: "Newer",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: false });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: null });

      const variants = await getRecipeVariants(r.id);
      expect(variants.map((v) => v.id)).toEqual([newer.id, older.id]);
      expect(Object.keys(variants[0]).sort()).toEqual(
        ["createdAt", "id", "imageUrl", "title"].sort(),
      );
    });

    it("respects the limit", async () => {
      const r = await createCommunityRecipe();
      await createCommunityRecipe({ remixedFromId: r.id });
      await createCommunityRecipe({ remixedFromId: r.id });
      expect(await getRecipeVariants(r.id, 1)).toHaveLength(1);
    });
  });
});
```

Before running, check `createTestUser`'s signature in `test/db-test-utils.ts`, and adjust the two calls if it takes different arguments.

- [ ] **Step 6: Run the tests and confirm they fail**

Run: `npx vitest run server/storage/__tests__/recipe-tries.test.ts`
Expected: FAIL. The module `../recipe-tries` is not found.

- [ ] **Step 7: Implement `server/storage/recipe-tries.ts`**

```ts
import { db } from "../db";
import { and, count, desc, eq } from "drizzle-orm";
import {
  communityRecipes,
  favouriteRecipes,
  recipeTries,
} from "@shared/schema";
import type { RecipeCommunityStats } from "@shared/types/recipe-community";

/** True only for an existing community recipe with isPublic = true (NULL = private). */
export async function isPublicCommunityRecipe(
  recipeId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: communityRecipes.id })
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.id, recipeId),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Idempotent: true inserts (duplicate is a no-op), false deletes. */
export async function setRecipeTried(
  userId: string,
  recipeId: number,
  tried: boolean,
): Promise<void> {
  if (tried) {
    await db
      .insert(recipeTries)
      .values({ userId, recipeId })
      .onConflictDoNothing();
    return;
  }
  await db
    .delete(recipeTries)
    .where(
      and(eq(recipeTries.userId, userId), eq(recipeTries.recipeId, recipeId)),
    );
}

/** Counts computed from rows on read. Caller must gate on isPublicCommunityRecipe. */
export async function getRecipeCommunityStats(
  recipeId: number,
  userId: string,
): Promise<RecipeCommunityStats> {
  const [[tried], mine, [favourited], [variants]] = await Promise.all([
    db
      .select({ n: count() })
      .from(recipeTries)
      .where(eq(recipeTries.recipeId, recipeId)),
    db
      .select({ id: recipeTries.id })
      .from(recipeTries)
      .where(
        and(eq(recipeTries.recipeId, recipeId), eq(recipeTries.userId, userId)),
      )
      .limit(1),
    db
      .select({ n: count() })
      .from(favouriteRecipes)
      .where(
        and(
          eq(favouriteRecipes.recipeId, recipeId),
          eq(favouriteRecipes.recipeType, "community"),
        ),
      ),
    db
      .select({ n: count() })
      .from(communityRecipes)
      .where(
        and(
          eq(communityRecipes.remixedFromId, recipeId),
          eq(communityRecipes.isPublic, true),
        ),
      ),
  ]);
  return {
    triedCount: tried?.n ?? 0,
    triedByMe: mine.length > 0,
    favouritedCount: favourited?.n ?? 0,
    variantCount: variants?.n ?? 0,
  };
}

/** Public remixes of a recipe, newest first. Never includes the author. */
export async function getRecipeVariants(
  recipeId: number,
  limit = 50,
): Promise<
  { id: number; title: string; imageUrl: string | null; createdAt: Date }[]
> {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      imageUrl: communityRecipes.imageUrl,
      createdAt: communityRecipes.createdAt,
    })
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.remixedFromId, recipeId),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .orderBy(desc(communityRecipes.createdAt), desc(communityRecipes.id))
    .limit(limit);
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run server/storage/__tests__/recipe-tries.test.ts`
Expected: PASS (all tests).

- [ ] **Step 9: Register on `storage` and allowlist the IDOR check**

In `server/storage/index.ts`, add with the other namespace imports:

```ts
import * as recipeTriesStorage from "./recipe-tries";
```

and inside `export const storage = { ... }`, after the "Taste Picks" block:

```ts
  // Recipe "I tried it" + community stats
  isPublicCommunityRecipe: recipeTriesStorage.isPublicCommunityRecipe,
  setRecipeTried: recipeTriesStorage.setRecipeTried,
  getRecipeCommunityStats: recipeTriesStorage.getRecipeCommunityStats,
  getRecipeVariants: recipeTriesStorage.getRecipeVariants,
```

In `scripts/check-idor-storage.js` `ALLOWLIST`, next to `"incrementRecipePopularity"`:

```js
  // Public-recipe probes/readers — recipeId is a PUBLIC community recipe
  // (routes gate on isPublicCommunityRecipe first); returns no per-user data.
  "isPublicCommunityRecipe",
  "getRecipeVariants",
```

Run: `node scripts/check-idor-storage.js server/storage/recipe-tries.ts`
Expected: no violations reported.

- [ ] **Step 10: Commit**

```bash
git add shared/schema.ts shared/types/recipe-community.ts migrations/0019_recipe_tries.sql \
  server/storage/recipe-tries.ts server/storage/index.ts scripts/check-idor-storage.js \
  server/storage/__tests__/recipe-tries.test.ts
```

Message (via `-F`): `feat(recipes): recipe_tries table and community stats storage`, plus the Co-Authored-By line.

---

### Task 2: Endpoints

**Files:**

- Create: `server/routes/recipe-community.ts`
- Modify: `server/routes.ts` (import ~line 35, call ~line 99 beside `registerFavouriteRecipes(app)`)
- Test: `server/routes/__tests__/recipe-community.test.ts`
- Modify: `server/routes/__tests__/auth-route-wiring.test.ts` (import block + route table)

**Interfaces:**

- Consumes: `storage.isPublicCommunityRecipe`, `storage.setRecipeTried`, `storage.getRecipeCommunityStats`, `storage.getRecipeVariants` (Task 1).
- Produces (HTTP, all `requireAuth` + `crudRateLimit`):
  - `PUT /api/recipes/:id/tried` → `200 { tried: true, triedCount: number }`
  - `DELETE /api/recipes/:id/tried` → `200 { tried: false, triedCount: number }`
  - `GET /api/recipes/:id/stats` → `200 RecipeCommunityStats`
  - `GET /api/recipes/:id/variants` → `200 { variants: RecipeVariantDto[] }`
  - Invalid `:id` → `400 VALIDATION_ERROR`; non-public or missing → `404 NOT_FOUND`.
- Produces: `export function register(app: Express): void` from `server/routes/recipe-community.ts`.

- [ ] **Step 1: Write the failing route tests**

Create `server/routes/__tests__/recipe-community.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../recipe-community";

vi.mock("../../storage", () => ({
  storage: {
    isPublicCommunityRecipe: vi.fn(),
    setRecipeTried: vi.fn(),
    getRecipeCommunityStats: vi.fn(),
    getRecipeVariants: vi.fn(),
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

const stats = {
  triedCount: 3,
  triedByMe: true,
  favouritedCount: 2,
  variantCount: 1,
};

describe("recipe community routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    vi.mocked(storage.isPublicCommunityRecipe).mockResolvedValue(true);
    vi.mocked(storage.getRecipeCommunityStats).mockResolvedValue(stats);
  });

  describe.each([
    ["put", "/api/recipes/abc/tried"],
    ["delete", "/api/recipes/0/tried"],
    ["get", "/api/recipes/-1/stats"],
    ["get", "/api/recipes/abc/variants"],
  ] as const)("%s %s", (method, path) => {
    it("returns 400 for an invalid id", async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(storage.isPublicCommunityRecipe).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ["put", "/api/recipes/7/tried"],
    ["delete", "/api/recipes/7/tried"],
    ["get", "/api/recipes/7/stats"],
    ["get", "/api/recipes/7/variants"],
  ] as const)("%s %s on a non-public recipe", (method, path) => {
    it("returns 404 and touches nothing else", async () => {
      vi.mocked(storage.isPublicCommunityRecipe).mockResolvedValue(false);
      const res = await request(app)[method](path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(storage.isPublicCommunityRecipe).toHaveBeenCalledWith(7);
      expect(storage.setRecipeTried).not.toHaveBeenCalled();
      expect(storage.getRecipeCommunityStats).not.toHaveBeenCalled();
      expect(storage.getRecipeVariants).not.toHaveBeenCalled();
    });
  });

  it("PUT /tried marks as tried for the caller and returns the count", async () => {
    const res = await request(app).put("/api/recipes/7/tried");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tried: true, triedCount: 3 });
    expect(storage.setRecipeTried).toHaveBeenCalledWith("1", 7, true);
  });

  it("DELETE /tried unmarks for the caller and returns the count", async () => {
    vi.mocked(storage.getRecipeCommunityStats).mockResolvedValue({
      ...stats,
      triedCount: 2,
      triedByMe: false,
    });
    const res = await request(app).delete("/api/recipes/7/tried");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tried: false, triedCount: 2 });
    expect(storage.setRecipeTried).toHaveBeenCalledWith("1", 7, false);
  });

  it("GET /stats returns the stats object for the caller", async () => {
    const res = await request(app).get("/api/recipes/7/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
    expect(storage.getRecipeCommunityStats).toHaveBeenCalledWith(7, "1");
  });

  it("GET /variants wraps the list", async () => {
    vi.mocked(storage.getRecipeVariants).mockResolvedValue([
      {
        id: 9,
        title: "Spicier",
        imageUrl: null,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const res = await request(app).get("/api/recipes/7/variants");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      variants: [
        {
          id: 9,
          title: "Spicier",
          imageUrl: null,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    expect(storage.getRecipeVariants).toHaveBeenCalledWith(7);
  });

  it("returns 500 when storage throws", async () => {
    vi.mocked(storage.getRecipeCommunityStats).mockRejectedValue(
      new Error("db down"),
    );
    const res = await request(app).get("/api/recipes/7/stats");
    expect(res.status).toBe(500);
  });
});
```

Check how `sendError` shapes the body (`server/lib/api-errors.ts`). If the error code field isn't `code`, change the `res.body.code` assertions to match.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run server/routes/__tests__/recipe-community.test.ts`
Expected: FAIL. `../recipe-community` is not found.

- [ ] **Step 3: Implement `server/routes/recipe-community.ts`**

```ts
import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { crudRateLimit } from "./_rate-limiters";
import { handleRouteError, parsePositiveIntParam } from "./_helpers";

/**
 * Parse :id and gate on public visibility. Sends 400/404 and returns null on
 * failure. 404 (not 403) for a private recipe — even to its author — so the
 * response never confirms the id exists and a private recipe has no community.
 */
async function resolvePublicRecipeId(
  req: AuthenticatedRequest,
  res: Response,
): Promise<number | null> {
  const recipeId = parsePositiveIntParam(req.params.id);
  if (!recipeId) {
    sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
    return null;
  }
  if (!(await storage.isPublicCommunityRecipe(recipeId))) {
    sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
    return null;
  }
  return recipeId;
}

export function register(app: Express): void {
  for (const tried of [true, false] as const) {
    app[tried ? "put" : "delete"](
      "/api/recipes/:id/tried",
      requireAuth,
      crudRateLimit,
      async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
          const recipeId = await resolvePublicRecipeId(req, res);
          if (recipeId === null) return;
          await storage.setRecipeTried(req.userId, recipeId, tried);
          const stats = await storage.getRecipeCommunityStats(
            recipeId,
            req.userId,
          );
          res.json({ tried, triedCount: stats.triedCount });
        } catch (error) {
          handleRouteError(res, error, "set recipe tried");
        }
      },
    );
  }

  app.get(
    "/api/recipes/:id/stats",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = await resolvePublicRecipeId(req, res);
        if (recipeId === null) return;
        res.json(await storage.getRecipeCommunityStats(recipeId, req.userId));
      } catch (error) {
        handleRouteError(res, error, "fetch recipe stats");
      }
    },
  );

  app.get(
    "/api/recipes/:id/variants",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipeId = await resolvePublicRecipeId(req, res);
        if (recipeId === null) return;
        res.json({ variants: await storage.getRecipeVariants(recipeId) });
      } catch (error) {
        handleRouteError(res, error, "fetch recipe variants");
      }
    },
  );
}
```

If the lint or React-free style checks dislike the `for` loop that registers two methods, write the two handlers out separately; the behaviour is identical.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run server/routes/__tests__/recipe-community.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the group**

In `server/routes.ts`, beside the favourite-recipes import and call:

```ts
import { register as registerRecipeCommunity } from "./routes/recipe-community";
```

```ts
registerRecipeCommunity(app);
```

- [ ] **Step 6: Add the routes to the auth-wiring test (fails first)**

In `server/routes/__tests__/auth-route-wiring.test.ts`, add the import:

```ts
import { register as registerRecipeCommunity } from "../recipe-community";
```

In the route table, after the `favourite-recipes` GET entry:

```ts
  {
    group: "recipe-community",
    register: registerRecipeCommunity,
    method: "get",
    path: "/api/recipes/1/stats",
  },
```

and in the mutation section:

```ts
  {
    group: "recipe-community",
    register: registerRecipeCommunity,
    method: "put",
    path: "/api/recipes/1/tried",
  },
  {
    group: "recipe-community",
    register: registerRecipeCommunity,
    method: "delete",
    path: "/api/recipes/1/tried",
  },
```

Read how this file's table entries are consumed (method typing, and whether the authed case needs extra `storage` mocks). If the authed-pass case reaches a handler, add `isPublicCommunityRecipe: vi.fn().mockResolvedValue(false)` to its `storage` mock so the handler returns 404 rather than crashing. A 404 still proves auth passed.

Run: `npx vitest run server/routes/__tests__/auth-route-wiring.test.ts`
Expected: PASS. To confirm the test has teeth, temporarily remove `requireAuth` from the stats route, re-run, and expect FAIL. Then restore it.

- [ ] **Step 7: Commit**

```bash
git add server/routes/recipe-community.ts server/routes.ts \
  server/routes/__tests__/recipe-community.test.ts \
  server/routes/__tests__/auth-route-wiring.test.ts
```

Message: `feat(recipes): tried/stats/variants endpoints for public community recipes`, plus the Co-Authored-By line.

---

### Task 3: Data export includes tries

**Files:**

- Modify: `server/storage/export.ts` (import list ~line 32; `UserDataExport` ~line 102; `Promise.all` destructure ~152 and query ~243; return ~348)
- Test: `server/storage/__tests__/recipe-tries.test.ts` (append)

**Interfaces:**

- Consumes: `recipeTries` (Task 1).
- Produces: `UserDataExport.recipeTries: Record<string, unknown>[]`, each `{ recipeId, createdAt }`.

- [ ] **Step 1: Append the failing test**

At the end of `server/storage/__tests__/recipe-tries.test.ts`, inside the top-level `describe`:

```ts
describe("data export", () => {
  it("includes the user's tries (recipeId + createdAt only)", async () => {
    const { getUserDataExport } = await import("../export");
    const r = await createCommunityRecipe();
    await setRecipeTried(viewer.id, r.id, true);
    await setRecipeTried(author.id, r.id, true);

    const data = await getUserDataExport(viewer.id);
    expect(data.recipeTries).toHaveLength(1);
    expect(data.recipeTries[0]).toEqual({
      recipeId: r.id,
      createdAt: expect.any(Date),
    });
  });
});
```

Run: `npx vitest run server/storage/__tests__/recipe-tries.test.ts -t "data export"`
Expected: FAIL. `data.recipeTries` is undefined (and a type error).

- [ ] **Step 2: Implement**

In `server/storage/export.ts`:

- Add `recipeTries,` to the `@shared/schema` import list (next to `tastePicks,`).
- In `interface UserDataExport`, after `tastePicks: Record<string, unknown>[];`, add `recipeTries: Record<string, unknown>[];`.
- In the `Promise.all` destructure, after `tastePickRows,`, add `recipeTryRows,`.
- In the `Promise.all` array, directly after the `tastePicks` query (the order must match the destructure), add:

```ts
    db
      .select({
        recipeId: recipeTries.recipeId,
        createdAt: recipeTries.createdAt,
      })
      .from(recipeTries)
      .where(eq(recipeTries.userId, userId)),
```

- In the returned object, after `tastePicks: tastePickRows,`, add `recipeTries: recipeTryRows,`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run server/storage/__tests__/recipe-tries.test.ts server/storage/__tests__/export.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/storage/export.ts server/storage/__tests__/recipe-tries.test.ts
```

Message: `feat(export): include recipe tries in the user data export`, plus the Co-Authored-By line.

---

### Task 4: Client copy and optimistic helpers (pure)

**Files:**

- Create: `client/components/recipe-community-stats-utils.ts`
- Test: `client/components/__tests__/recipe-community-stats-utils.test.ts`

**Interfaces:**

- Consumes: `RecipeCommunityStats` from `@shared/types/recipe-community`.
- Produces:

  ```ts
  formatPeopleCount(n: number): string            // "1 person" | "N people"
  triedBarCaption(n: number): string              // "Be the first to try it" | "1 person tried this" | "N people tried this"
  triedButtonLabel(triedByMe: boolean): string    // "Tried" | "I tried it"
  triedButtonA11yLabel(n: number): string         // "I tried it, no one has tried this yet" | "I tried it, N people tried this"
  triedRowValue(n: number): string                // "Be the first" | formatPeopleCount(n)
  favouritedRowValue(n: number): string           // "Not yet" | formatPeopleCount(n)
  variantsRowValue(n: number): string             // "Remix it" | String(n)
  applyTriedOptimistic(stats: RecipeCommunityStats, tried: boolean): RecipeCommunityStats
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  formatPeopleCount,
  triedBarCaption,
  triedButtonLabel,
  triedButtonA11yLabel,
  triedRowValue,
  favouritedRowValue,
  variantsRowValue,
  applyTriedOptimistic,
} from "../recipe-community-stats-utils";

const base = {
  triedCount: 2,
  triedByMe: false,
  favouritedCount: 0,
  variantCount: 0,
};

describe("recipe-community-stats-utils", () => {
  it("formatPeopleCount pluralises", () => {
    expect(formatPeopleCount(1)).toBe("1 person");
    expect(formatPeopleCount(12)).toBe("12 people");
  });

  it("triedBarCaption", () => {
    expect(triedBarCaption(0)).toBe("Be the first to try it");
    expect(triedBarCaption(1)).toBe("1 person tried this");
    expect(triedBarCaption(12)).toBe("12 people tried this");
  });

  it("triedButtonLabel", () => {
    expect(triedButtonLabel(false)).toBe("I tried it");
    expect(triedButtonLabel(true)).toBe("Tried");
  });

  it("triedButtonA11yLabel", () => {
    expect(triedButtonA11yLabel(0)).toBe(
      "I tried it, no one has tried this yet",
    );
    expect(triedButtonA11yLabel(1)).toBe("I tried it, 1 person tried this");
    expect(triedButtonA11yLabel(12)).toBe("I tried it, 12 people tried this");
  });

  it("row values turn zero into invitations", () => {
    expect(triedRowValue(0)).toBe("Be the first");
    expect(triedRowValue(3)).toBe("3 people");
    expect(favouritedRowValue(0)).toBe("Not yet");
    expect(favouritedRowValue(1)).toBe("1 person");
    expect(variantsRowValue(0)).toBe("Remix it");
    expect(variantsRowValue(3)).toBe("3");
  });

  describe("applyTriedOptimistic", () => {
    it("marks: +1 and triedByMe", () => {
      expect(applyTriedOptimistic(base, true)).toEqual({
        ...base,
        triedCount: 3,
        triedByMe: true,
      });
    });

    it("unmarks: -1", () => {
      expect(applyTriedOptimistic({ ...base, triedByMe: true }, false)).toEqual(
        { ...base, triedCount: 1, triedByMe: false },
      );
    });

    it("is idempotent when already in the target state", () => {
      expect(applyTriedOptimistic(base, false)).toBe(base);
      const tried = { ...base, triedByMe: true };
      expect(applyTriedOptimistic(tried, true)).toBe(tried);
    });

    it("never goes below zero", () => {
      expect(
        applyTriedOptimistic({ ...base, triedCount: 0, triedByMe: true }, false)
          .triedCount,
      ).toBe(0);
    });
  });
});
```

Run: `npx vitest run client/components/__tests__/recipe-community-stats-utils.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
import type { RecipeCommunityStats } from "@shared/types/recipe-community";

export function formatPeopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

export function triedBarCaption(n: number): string {
  return n === 0
    ? "Be the first to try it"
    : `${formatPeopleCount(n)} tried this`;
}

export function triedButtonLabel(triedByMe: boolean): string {
  return triedByMe ? "Tried" : "I tried it";
}

export function triedButtonA11yLabel(n: number): string {
  return n === 0
    ? "I tried it, no one has tried this yet"
    : `I tried it, ${formatPeopleCount(n)} tried this`;
}

export function triedRowValue(n: number): string {
  return n === 0 ? "Be the first" : formatPeopleCount(n);
}

export function favouritedRowValue(n: number): string {
  return n === 0 ? "Not yet" : formatPeopleCount(n);
}

export function variantsRowValue(n: number): string {
  return n === 0 ? "Remix it" : String(n);
}

/** Optimistic cache update for the tried toggle; a no-op when already there. */
export function applyTriedOptimistic(
  stats: RecipeCommunityStats,
  tried: boolean,
): RecipeCommunityStats {
  if (stats.triedByMe === tried) return stats;
  return {
    ...stats,
    triedByMe: tried,
    triedCount: Math.max(0, stats.triedCount + (tried ? 1 : -1)),
  };
}
```

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `npx vitest run client/components/__tests__/recipe-community-stats-utils.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/components/recipe-community-stats-utils.ts \
  client/components/__tests__/recipe-community-stats-utils.test.ts
```

Message: `feat(recipes): copy and optimistic helpers for recipe community stats`, plus the Co-Authored-By line.

---

### Task 5: Client data hooks

**Files:**

- Create: `client/hooks/useRecipeCommunity.ts`
- Test: `client/hooks/__tests__/useRecipeCommunity.test.ts`
- Modify: `client/hooks/useFavouriteRecipes.ts` (`useToggleFavouriteRecipe` `onSettled`)
- Modify: `client/hooks/__tests__/useFavouriteRecipes.test.ts`

**Interfaces:**

- Consumes: `applyTriedOptimistic` (Task 4); endpoints (Task 2); shared types (Task 1).
- Produces:
  ```ts
  recipeStatsKey(recipeId: number): readonly [string]       // [`/api/recipes/${id}/stats`]
  useRecipeCommunityStats(recipeId: number, enabled: boolean): UseQueryResult<RecipeCommunityStats>
  useSetRecipeTried(recipeId: number): UseMutationResult<{ tried: boolean; triedCount: number }, Error, boolean>
  useRecipeVariants(recipeId: number): UseQueryResult<{ variants: RecipeVariantDto[] }>
  ```
- **Render rule for consumers:** show community UI only when `query.isSuccess` is true. After a failed refetch React Query keeps the old `data`, but `isSuccess` becomes false.

- [ ] **Step 1: Write the failing hook tests**

```ts
// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";

import {
  recipeStatsKey,
  useRecipeCommunityStats,
  useSetRecipeTried,
  useRecipeVariants,
} from "../useRecipeCommunity";
import { ApiError } from "@/lib/api-error";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const stats = {
  triedCount: 2,
  triedByMe: false,
  favouritedCount: 1,
  variantCount: 0,
};

describe("useRecipeCommunity", () => {
  afterEach(() => {
    mockApiRequest.mockReset();
  });

  it("useRecipeCommunityStats fetches /stats", async () => {
    mockApiRequest.mockResolvedValue(ok(stats));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeCommunityStats(7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);
    expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/recipes/7/stats");
  });

  it("does not fetch when disabled", () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useRecipeCommunityStats(7, false), { wrapper });
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("isSuccess turns false when a refetch 404s (recipe went private)", async () => {
    mockApiRequest.mockResolvedValueOnce(ok(stats));
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeCommunityStats(7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    mockApiRequest.mockRejectedValueOnce(
      new ApiError("Recipe not found", 404, "NOT_FOUND"),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: recipeStatsKey(7) });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(false));
  });

  it("useSetRecipeTried updates the cache optimistically and PUTs", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(recipeStatsKey(7), stats);
    let resolvePut: (v: unknown) => void = () => {};
    mockApiRequest.mockImplementation((method: string) =>
      method === "PUT"
        ? new Promise((r) => {
            resolvePut = r;
          })
        : Promise.resolve(ok({ ...stats, triedCount: 3, triedByMe: true })),
    );

    const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });
    act(() => {
      result.current.mutate(true);
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(recipeStatsKey(7))).toEqual({
        ...stats,
        triedCount: 3,
        triedByMe: true,
      }),
    );
    expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/recipes/7/tried");
    resolvePut(ok({ tried: true, triedCount: 3 }));
  });

  it("rolls back on error", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(recipeStatsKey(7), stats);
    mockApiRequest.mockImplementation((method: string) =>
      method === "PUT"
        ? Promise.reject(new Error("network"))
        : Promise.resolve(ok(stats)),
    );
    const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(true).catch(() => {});
    });
    expect(queryClient.getQueryData(recipeStatsKey(7))).toEqual(stats);
  });

  it("tap then untap ends untried (last tap wins)", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(recipeStatsKey(7), stats);
    mockApiRequest.mockImplementation((method: string) =>
      method === "GET"
        ? Promise.resolve(ok(stats))
        : Promise.resolve(ok({ tried: method === "PUT", triedCount: 2 })),
    );
    const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(true);
      await result.current.mutateAsync(false);
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<typeof stats>(recipeStatsKey(7))?.triedByMe,
      ).toBe(false),
    );
    expect(mockApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/recipes/7/tried",
    );
  });

  it("useRecipeVariants fetches /variants", async () => {
    mockApiRequest.mockResolvedValue(ok({ variants: [] }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeVariants(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/recipes/7/variants",
    );
  });
});
```

Check `ApiError`'s constructor in `client/lib/api-error.ts`, and fix the `new ApiError(...)` arguments if the order differs.

Run: `npx vitest run client/hooks/__tests__/useRecipeCommunity.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement `client/hooks/useRecipeCommunity.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/query-client";
import { applyTriedOptimistic } from "@/components/recipe-community-stats-utils";
import type {
  RecipeCommunityStats,
  RecipeVariantDto,
} from "@shared/types/recipe-community";

export function recipeStatsKey(recipeId: number) {
  return [`/api/recipes/${recipeId}/stats`] as const;
}

/**
 * Community stats for a public community recipe. Consumers render ONLY when
 * `isSuccess` — a failed refetch (e.g. the recipe went private → 404) keeps
 * stale `data` but flips `isSuccess` to false, which hides the UI.
 */
export function useRecipeCommunityStats(recipeId: number, enabled: boolean) {
  return useQuery<RecipeCommunityStats>({
    queryKey: recipeStatsKey(recipeId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/recipes/${recipeId}/stats`);
      return res.json();
    },
    enabled: enabled && recipeId > 0,
    retry: false,
    // Secondary UI: hides itself on error; never a global error toast.
    meta: { silentError: true },
  });
}

export function useSetRecipeTried(recipeId: number) {
  const queryClient = useQueryClient();
  const key = recipeStatsKey(recipeId);
  return useMutation<
    { tried: boolean; triedCount: number },
    Error,
    boolean,
    { previous: RecipeCommunityStats | undefined }
  >({
    mutationFn: async (tried) => {
      const res = await apiRequest(
        tried ? "PUT" : "DELETE",
        `/api/recipes/${recipeId}/tried`,
      );
      return res.json();
    },
    onMutate: async (tried) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RecipeCommunityStats>(key);
      if (previous) {
        queryClient.setQueryData(key, applyTriedOptimistic(previous, tried));
      }
      return { previous };
    },
    onError: (_error, _tried, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
    // The bar shows its own "Couldn't save" toast.
    meta: { silentError: true },
  });
}

export function useRecipeVariants(recipeId: number) {
  return useQuery<{ variants: RecipeVariantDto[] }>({
    queryKey: [`/api/recipes/${recipeId}/variants`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/recipes/${recipeId}/variants`);
      return res.json();
    },
    enabled: recipeId > 0,
    meta: { silentError: true },
  });
}
```

If `meta: { silentError: true }` is rejected by the mutation's `meta` type, look at `useCreateCookSession` (`client/hooks/useCookSession.ts:38`), which already uses it on a mutation, and match its typing.

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `npx vitest run client/hooks/__tests__/useRecipeCommunity.test.ts`
Expected: PASS.

- [ ] **Step 4: Failing test — a favourite toggle refreshes the community stats**

Append inside the `useToggleFavouriteRecipe` describe in `client/hooks/__tests__/useFavouriteRecipes.test.ts` (follow the file's existing toggle test for setup):

```ts
it("invalidates the recipe's community stats for a community recipe", async () => {
  const { wrapper, queryClient } = createQueryWrapper();
  mockApiRequest.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ favourited: true }),
  });
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(() => useToggleFavouriteRecipe(), {
    wrapper,
  });
  await act(async () => {
    await result.current.mutateAsync({ recipeId: 7, recipeType: "community" });
  });
  expect(spy).toHaveBeenCalledWith({
    queryKey: ["/api/recipes/7/stats"],
  });
});

it("does not touch community stats for a meal-plan recipe", async () => {
  const { wrapper, queryClient } = createQueryWrapper();
  mockApiRequest.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ favourited: true }),
  });
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(() => useToggleFavouriteRecipe(), {
    wrapper,
  });
  await act(async () => {
    await result.current.mutateAsync({ recipeId: 7, recipeType: "mealPlan" });
  });
  expect(spy).not.toHaveBeenCalledWith({
    queryKey: ["/api/recipes/7/stats"],
  });
});
```

Run: `npx vitest run client/hooks/__tests__/useFavouriteRecipes.test.ts -t "community stats"`
Expected: the first test FAILS.

- [ ] **Step 5: Implement the invalidation**

In `client/hooks/useFavouriteRecipes.ts`, import the key:

```ts
import { recipeStatsKey } from "@/hooks/useRecipeCommunity";
```

and change `useToggleFavouriteRecipe`'s `onSettled` to:

```ts
    onSettled: (_data, _error, { recipeId, recipeType }) => {
      void queryClient.invalidateQueries({ queryKey: FAVOURITES_IDS_KEY });
      void queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY });
      if (recipeType === "community") {
        void queryClient.invalidateQueries({
          queryKey: recipeStatsKey(recipeId),
        });
      }
    },
```

Run: `npx vitest run client/hooks/__tests__/useFavouriteRecipes.test.ts client/hooks/__tests__/useRecipeCommunity.test.ts`
Expected: PASS. Watch for an import cycle: `useRecipeCommunity` must not import `useFavouriteRecipes`.

- [ ] **Step 6: Commit**

```bash
git add client/hooks/useRecipeCommunity.ts client/hooks/__tests__/useRecipeCommunity.test.ts \
  client/hooks/useFavouriteRecipes.ts client/hooks/__tests__/useFavouriteRecipes.test.ts
```

Message: `feat(recipes): community stats hooks with optimistic tried toggle`, plus the Co-Authored-By line.

---

### Task 6: "Community" stats section

**Files:**

- Create: `client/components/RecipeCommunityStats.tsx`
- Modify: `client/components/RecipeDetailContent.tsx` (render before `{/* 10. Ask Coach */}` ~line 515)

**Interfaces:**

- Consumes: `useRecipeCommunityStats` (Task 5); row-value helpers (Task 4); `handleRemixPress` (existing in `RecipeDetailContent`).
- Produces: route type `RecipeVariants: { recipeId: number; title: string }` in `RootStackParamList` (the screen itself is registered in Task 8).
- Produces: `export function RecipeCommunityStats(props: { recipeId: number; recipeTitle: string; onRemix: () => void }): JSX.Element | null`.

- [ ] **Step 0: Add the route type**

In `client/navigation/RootStackNavigator.tsx` `RootStackParamList`, after the `FeaturedRecipeDetail` entry:

```ts
/** Public community remixes of a recipe (from the recipe's Community section). */
RecipeVariants: {
  recipeId: number;
  title: string;
}
```

- [ ] **Step 1: Implement the component**

Before writing, invoke the `interaction-feel` skill (project rule for new interactive client UI) and apply its press-feedback guidance to the variants row.

```tsx
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useRecipeCommunityStats } from "@/hooks/useRecipeCommunity";
import {
  favouritedRowValue,
  triedRowValue,
  variantsRowValue,
} from "@/components/recipe-community-stats-utils";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

interface Props {
  recipeId: number;
  recipeTitle: string;
  onRemix: () => void;
}

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function RecipeCommunityStats({
  recipeId,
  recipeTitle,
  onRemix,
}: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<NavProp>();
  const stats = useRecipeCommunityStats(recipeId, true);

  if (stats.isPending) {
    return (
      <View style={styles.section} accessibilityLabel="Loading community stats">
        <SkeletonBox width={120} height={18} />
        {[0, 1, 2].map((i) => (
          <SkeletonBox key={i} height={20} style={styles.skeletonRow} />
        ))}
      </View>
    );
  }
  if (!stats.isSuccess) return null;

  const { triedCount, favouritedCount, variantCount } = stats.data;
  const zero = theme.link;

  const onVariants = () => {
    haptics.selection();
    if (variantCount === 0) {
      onRemix();
      return;
    }
    navigation.navigate("RecipeVariants", { recipeId, title: recipeTitle });
  };

  return (
    <View style={styles.section}>
      <ThemedText type="h4" style={styles.heading}>
        Community
      </ThemedText>

      <View
        style={[styles.row, { borderBottomColor: theme.border }]}
        accessible
        accessibilityLabel={`Tried it, ${triedRowValue(triedCount)}`}
      >
        <View style={styles.label}>
          <Feather name="check-circle" size={16} color={theme.textSecondary} />
          <ThemedText>Tried it</ThemedText>
        </View>
        <ThemedText style={triedCount === 0 ? { color: zero } : styles.value}>
          {triedRowValue(triedCount)}
        </ThemedText>
      </View>

      <View
        style={[styles.row, { borderBottomColor: theme.border }]}
        accessible
        accessibilityLabel={`Favourited, ${favouritedRowValue(favouritedCount)}`}
      >
        <View style={styles.label}>
          <Ionicons
            name="heart-outline"
            size={16}
            color={theme.textSecondary}
          />
          <ThemedText>Favourited</ThemedText>
        </View>
        <ThemedText
          style={favouritedCount === 0 ? { color: zero } : styles.value}
        >
          {favouritedRowValue(favouritedCount)}
        </ThemedText>
      </View>

      <Pressable
        onPress={onVariants}
        style={({ pressed }) => [
          styles.row,
          styles.lastRow,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          variantCount === 0
            ? "Community variants, none yet. Remix this recipe"
            : `Community variants, ${variantCount}`
        }
        accessibilityHint={
          variantCount === 0 ? undefined : "Shows the list of community remixes"
        }
      >
        <View style={styles.label}>
          <Ionicons
            name="shuffle-outline"
            size={16}
            color={theme.textSecondary}
          />
          <ThemedText>Community variants</ThemedText>
        </View>
        <View style={styles.label}>
          <ThemedText
            style={variantCount === 0 ? { color: zero } : styles.value}
          >
            {variantsRowValue(variantCount)}
          </ThemedText>
          <Feather name="chevron-right" size={16} color={theme.textSecondary} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xl,
  },
  heading: {
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  value: {
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.6,
  },
  skeletonRow: {
    marginTop: Spacing.sm,
  },
});
```

If `SkeletonBox` doesn't take a `style` prop, wrap each box in a `View` with `styles.skeletonRow` instead. The colour lint check (`scripts/check-hardcoded-colors.js`) forbids hex literals; this file uses theme tokens only.

- [ ] **Step 2: Render it in `RecipeDetailContent`**

In `client/components/RecipeDetailContent.tsx`, import:

```ts
import { RecipeCommunityStats } from "@/components/RecipeCommunityStats";
```

Directly above `{/* 10. Ask Coach */}`:

```tsx
{
  /* 9c. Community stats (public community recipes only — the
            component renders nothing unless the stats request succeeds,
            and the server 404s non-public recipes) */
}
{
  isCommunityRecipe && props.recipeId > 0 && (
    <RecipeCommunityStats
      recipeId={props.recipeId}
      recipeTitle={props.title}
      onRemix={handleRemixPress}
    />
  );
}
```

- [ ] **Step 3: Type-check the touched files**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "RecipeCommunityStats|RecipeDetailContent" || echo "no errors in touched files"`
Expected: `no errors in touched files`.

- [ ] **Step 4: Commit**

```bash
git add client/components/RecipeCommunityStats.tsx client/components/RecipeDetailContent.tsx \
  client/navigation/RootStackNavigator.tsx
```

Message: `feat(recipes): Community stats section on public recipes`, plus the Co-Authored-By line.

---

### Task 7: Sticky "I tried it" bar

**Files:**

- Create: `client/components/RecipeTriedBar.tsx`
- Modify: `client/screens/FeaturedRecipeDetailScreen.tsx` (stats hook near the community fetch ~line 115; `contentPaddingBottom` ~line 540; render beside the catalog save bar ~line 555)

**Interfaces:**

- Consumes: `useRecipeCommunityStats`, `useSetRecipeTried` (Task 5); `triedBarCaption`, `triedButtonLabel`, `triedButtonA11yLabel` (Task 4); `useSuccessPop`, `useHaptics`, `useToast` (existing).
- Produces: `export function RecipeTriedBar(props: { recipeId: number; bottomInset: number }): JSX.Element | null`, and `export const TRIED_BAR_HEIGHT = 72`.

- [ ] **Step 1: Implement the bar**

Apply the `interaction-feel` guidance loaded in Task 6 (press scale/opacity, haptics) to the button.

```tsx
import React, { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useSuccessPop } from "@/hooks/useSuccessAnimation";
import { useToast } from "@/context/ToastContext";
import {
  useRecipeCommunityStats,
  useSetRecipeTried,
} from "@/hooks/useRecipeCommunity";
import {
  triedBarCaption,
  triedButtonA11yLabel,
  triedButtonLabel,
} from "@/components/recipe-community-stats-utils";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";

/** Matches the catalog save bar so content padding stays consistent. */
export const TRIED_BAR_HEIGHT = 72;

interface Props {
  recipeId: number;
  bottomInset: number;
}

export function RecipeTriedBar({ recipeId, bottomInset }: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const stats = useRecipeCommunityStats(recipeId, true);
  const { mutate: setTried } = useSetRecipeTried(recipeId);
  const { trigger: triggerPop, animatedStyle: popStyle } = useSuccessPop(1.2);

  const triedByMe = stats.data?.triedByMe ?? false;

  const onPress = useCallback(() => {
    const next = !triedByMe;
    // The pop fires its own Success haptic — one buzz per mark.
    if (next) triggerPop();
    else haptics.impact();
    setTried(next, {
      onError: () => toast.error("Couldn't save — try again"),
    });
  }, [triedByMe, triggerPop, haptics, setTried, toast]);

  if (!stats.isSuccess) return null;
  const { triedCount } = stats.data;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: bottomInset + Spacing.sm,
          backgroundColor: theme.backgroundRoot,
          borderTopColor: theme.border,
        },
      ]}
    >
      <ThemedText
        style={[styles.caption, { color: theme.textSecondary }]}
        numberOfLines={1}
        accessible={false}
      >
        {triedBarCaption(triedCount)}
      </ThemedText>
      <Animated.View style={popStyle}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={triedButtonA11yLabel(triedCount)}
          accessibilityState={{ selected: triedByMe }}
          style={({ pressed }) => [
            styles.button,
            triedByMe
              ? { backgroundColor: theme.link, borderColor: theme.link }
              : {
                  backgroundColor: withOpacity(theme.link, 0.08),
                  borderColor: theme.link,
                },
            pressed && styles.pressed,
          ]}
        >
          <Feather
            name="check"
            size={16}
            color={triedByMe ? theme.buttonText : theme.link}
          />
          <ThemedText
            style={[
              styles.buttonText,
              { color: triedByMe ? theme.buttonText : theme.link },
            ]}
          >
            {triedButtonLabel(triedByMe)}
          </ThemedText>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: TRIED_BAR_HEIGHT,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  caption: {
    flex: 1,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  buttonText: {
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.8,
  },
});
```

Check the `useSuccessPop` signature in `client/hooks/useSuccessAnimation.ts` (the action bar uses `useSuccessPop(1.4)` returning `{ trigger, animatedStyle }`). Also check that `Spacing.lg` exists; if not, use the nearest key.

- [ ] **Step 2: Wire it into `FeaturedRecipeDetailScreen`**

Imports:

```ts
import { RecipeTriedBar, TRIED_BAR_HEIGHT } from "@/components/RecipeTriedBar";
import { useRecipeCommunityStats } from "@/hooks/useRecipeCommunity";
```

After the community recipe `useQuery` (~line 123):

```ts
// "I tried it" bar: public community recipes only. Shares the stats cache
// entry with RecipeCommunityStats. isSuccess (not data) so a 404 refetch —
// recipe made private — hides the bar instead of freezing stale counts.
const communityStats = useRecipeCommunityStats(
  recipeId,
  resolvedRecipeType === "community",
);
const showTriedBar =
  resolvedRecipeType === "community" && communityStats.isSuccess;
```

Change `contentPaddingBottom`:

```tsx
          contentPaddingBottom={
            insets.bottom +
            Spacing.xl +
            (resolvedRecipeType === "catalog" ? SAVE_BAR_HEIGHT : 0) +
            (showTriedBar ? TRIED_BAR_HEIGHT : 0)
          }
```

Directly after the catalog save bar block (`{resolvedRecipeType === "catalog" && normalized ? (...) : null}`), add:

```tsx
{
  showTriedBar && normalized ? (
    <RecipeTriedBar recipeId={recipeId} bottomInset={insets.bottom} />
  ) : null;
}
```

If the save bar block ends with `)}` rather than `: null}`, match its exact style.

- [ ] **Step 3: Type-check the touched files**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "RecipeTriedBar|FeaturedRecipeDetailScreen" || echo "no errors in touched files"`
Expected: `no errors in touched files`.

- [ ] **Step 4: Check the React Compiler bailout ratchet**

Run: `node scripts/check-react-compiler-bailouts.js client/components/RecipeTriedBar.tsx client/components/RecipeCommunityStats.tsx client/screens/FeaturedRecipeDetailScreen.tsx`
Expected: no new bailouts. If one appears, follow `docs/solutions/code-quality/react-compiler-bails-on-a-conditional-inside-a-try-2026-10-10.md` and the `.set()/.get()` rule.

- [ ] **Step 5: Commit**

```bash
git add client/components/RecipeTriedBar.tsx client/screens/FeaturedRecipeDetailScreen.tsx
```

Message: `feat(recipes): sticky "I tried it" bar on public community recipes`, plus the Co-Authored-By line.

---

### Task 8: Community variants screen

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx` (`<Stack.Screen>` after `FeaturedRecipeDetail` ~line 390; the param type was added in Task 6)
- Create: `client/screens/RecipeVariantsScreen.tsx`

**Interfaces:**

- Consumes: `useRecipeVariants` (Task 5); `FallbackImage`, `InlineError`, `EmptyState` (existing).
- Produces: route `RecipeVariants: { recipeId: number; title: string }`.

- [ ] **Step 1: Confirm the route type from Task 6 is present**

Run: `grep -n "RecipeVariants:" client/navigation/RootStackNavigator.tsx`
Expected: one match.

- [ ] **Step 2: Implement the screen**

```tsx
import React, { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { InlineError } from "@/components/InlineError";
import { EmptyState } from "@/components/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useRecipeVariants } from "@/hooks/useRecipeCommunity";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { RecipeVariantDto } from "@shared/types/recipe-community";

type Route = RouteProp<RootStackParamList, "RecipeVariants">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const THUMB = 56;

export default function RecipeVariantsScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { data, isPending, isError, refetch } = useRecipeVariants(
    params.recipeId,
  );

  const openVariant = useCallback(
    (id: number) => {
      haptics.selection();
      // push, not navigate: FeaturedRecipeDetail is already in the stack (the
      // original recipe); navigate could return to it instead of opening the remix.
      navigation.push("FeaturedRecipeDetail", {
        recipeId: id,
        recipeType: "community",
      });
    },
    [haptics, navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: RecipeVariantDto }) => (
      <Pressable
        onPress={() => openVariant(item.id)}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: theme.border },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, remixed ${new Date(item.createdAt).toLocaleDateString()}`}
      >
        <FallbackImage
          source={{ uri: item.imageUrl }}
          style={styles.thumb}
          fallbackStyle={{ backgroundColor: theme.backgroundSecondary }}
          fallbackIcon="image"
          fallbackIconSize={20}
          resizeMode="cover"
          accessible={false}
        />
        <View style={styles.text}>
          <ThemedText numberOfLines={2} style={styles.title}>
            {item.title}
          </ThemedText>
          <ThemedText style={{ color: theme.textSecondary }}>
            {new Date(item.createdAt).toLocaleDateString()}
          </ThemedText>
        </View>
      </Pressable>
    ),
    [openVariant, theme],
  );

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
        <InlineError message="Couldn't load community variants." />
        <Pressable onPress={() => void refetch()} accessibilityRole="button">
          <ThemedText style={{ color: theme.link }}>Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
      data={data?.variants ?? []}
      keyExtractor={(v) => String(v.id)}
      renderItem={renderItem}
      ListEmptyComponent={
        isPending ? null : (
          <EmptyState
            variant="temporary"
            icon="shuffle"
            title="No community variants yet."
            description={`Be the first to remix ${params.title}.`}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: BorderRadius.xs,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.6,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
  },
});
```

Check the `EmptyState` props (`variant`, `icon`, `title`, `description`) against `FeaturedRecipeDetailScreen`'s use (~line 515), and that `"shuffle"` is a valid icon for it (it may be Feather-typed; `"shuffle"` exists in Feather). Check `InlineError`'s props, and whether `FallbackImage` accepts `accessible={false}` or needs its decorative prop (see its use in `RecipeDetailContent` ~line 240).

- [ ] **Step 3: Register the screen**

In `RootStackNavigator.tsx`, import:

```ts
import RecipeVariantsScreen from "@/screens/RecipeVariantsScreen";
```

After the `FeaturedRecipeDetail` `<Stack.Screen>`:

```tsx
<Stack.Screen
  name="RecipeVariants"
  component={RecipeVariantsScreen}
  options={{
    headerTitle: "Community variants",
    presentation: "modal",
  }}
/>
```

`presentation: "modal"` matches the screen it is opened from (`FeaturedRecipeDetail` is a modal). The title is a string, not a function.

- [ ] **Step 4: Type-check the touched files**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "RecipeVariants|RootStackNavigator|RecipeCommunityStats" || echo "no errors in touched files"`
Expected: `no errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add client/navigation/RootStackNavigator.tsx client/screens/RecipeVariantsScreen.tsx
```

Message: `feat(recipes): Community variants screen`, plus the Co-Authored-By line.

---

### Task 9: Simulator verification, review, PR

**Files:** none new (fixes go back into the owning task's files).

- [ ] **Step 1: Prepare data**

Start the API (`npm run server:dev`) from the worktree. **First** run `curl "$EXPO_PUBLIC_DOMAIN/api/health"` (project rule: check the API IP first). With the local dev DB, pick or seed one **public** community recipe and one **private** one (`npm run seed:recipes` if empty). Record their ids.

- [ ] **Step 2: `verify-ui` on the public recipe**

Invoke the `verify-ui` skill with a deep link to `FeaturedRecipeDetail` for the public id. Assert:

- The bar is visible at the top of the scroll and still visible after scrolling to the end.
- The caption reads "Be the first to try it" and the button reads "I tried it".
- Tapping it makes the button read "Tried" and the caption "1 person tried this".
- The "Community" section sits above Ask Coach and shows "Be the first" / "Not yet" / "Remix it".
- The last instruction step and Ask Coach aren't hidden behind the bar.

Then tap "I tried it" again to confirm it reverts.

- [ ] **Step 3: `verify-ui` on the private recipe and a meal-plan recipe**

Assert there's no bar and no "Community" section on either.

- [ ] **Step 4: Variants screen**

Create a public remix of the public recipe (via the app's Remix flow, or a local-DB insert setting `remixed_from_id`), reload, and assert the Community variants row now reads "1" with a chevron. Tap it to reach "Community variants", tap the row, and confirm the remix opens.

- [ ] **Step 5: Review**

Dispatch the review roster per `docs/AI_WORKFLOW.md` → Review Policy: `code-reviewer` plus `server-reviewer` (schema/migration/routes) and `mobile-reviewer` (bar/section/screen). Use the AI_WORKFLOW dispatch prompt verbatim, with `REVIEWED-SHA` on the same line, and commit before dispatching. One review pass. Fix the findings in the owning files.

- [ ] **Step 6: Push and open the PR**

Push (the hook runs `preflight:fast`), then open the PR with `mcp__github__create_pull_request`. The PR body must include:

- A summary of the feature and the spec path.
- **Out of contract:** the route-file deviation (§5.2 → `recipe-community.ts`).
- **Owner steps (blocking merge):** (1) apply `migrations/0019_recipe_tries.sql` to prod **before merge**, with owner yes; (2) after merge and deploy, run `npm run update:production -- --message "recipe I tried it + community stats"`, with owner yes; (3) add "recipes you marked as tried" to ocrecipes.com/privacy; (4) confirm the iOS privacy manifest / App Store privacy labels cover it.
- The verify-ui evidence.
- Ending: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 7: Codify**

After review, run `/codify` for any emergent pattern (e.g. "render on `isSuccess`, not `data`, when a refetch can 404").
