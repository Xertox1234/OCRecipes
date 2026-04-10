# Advanced Coach Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the NutriCoach into a premium "Coach Pro" experience with persistent memory (notebook), rich interactive message blocks, voice input, API tool calling, and latency optimizations.

**Architecture:** The coach screen becomes a collapsible dashboard + rich chat. The server gains a notebook storage module, a tools dispatcher for OpenAI function calling, and a context pre-fetch endpoint. Rich message blocks are structured JSON in the SSE stream, rendered by dedicated client components. A new `coachPro` premium tier gates all new features.

**Tech Stack:** Expo/React Native (client), Express.js + Drizzle ORM + PostgreSQL (server), OpenAI function calling + streaming SSE, TanStack Query, Reanimated 4, expo-speech-recognition (STT).

**Spec:** `docs/superpowers/specs/2026-04-09-advanced-coach-pro-design.md`

---

## File Structure

### New Files

**Shared:**

- `shared/schemas/coach-blocks.ts` — Zod schemas + inferred types for all 7 block types and the block union
- `shared/schemas/coach-notebook.ts` — Zod schemas for notebook entry types and extraction output
- `shared/schemas/coach-tools.ts` — Zod schemas for tool parameter/return types

**Server:**

- `server/storage/coach-notebook.ts` — CRUD for `coach_notebook` table
- `server/services/coach-tools.ts` — Tool definitions array, execution dispatcher, result formatting
- `server/services/coach-blocks.ts` — Block validation, OpenAI structured output config
- `server/services/notebook-extraction.ts` — Post-conversation extraction via OpenAI
- `server/routes/coach-context.ts` — `GET /api/coach/context`, `POST /api/coach/warm-up`

**Client:**

- `client/screens/CoachProScreen.tsx` — Redesigned coach tab screen (dashboard + chat)
- `client/components/coach/CoachDashboard.tsx` — Collapsible dashboard header
- `client/components/coach/CoachChat.tsx` — Rich chat area with block rendering
- `client/components/coach/CoachMicButton.tsx` — Premium voice input button
- `client/components/coach/blocks/ActionCard.tsx` — Action card renderer
- `client/components/coach/blocks/SuggestionList.tsx` — Suggestion list renderer
- `client/components/coach/blocks/InlineChart.tsx` — Chart renderer
- `client/components/coach/blocks/CommitmentCard.tsx` — Commitment card renderer
- `client/components/coach/blocks/QuickReplies.tsx` — Quick reply chips renderer
- `client/components/coach/blocks/RecipeCard.tsx` — Recipe card renderer
- `client/components/coach/blocks/MealPlanCard.tsx` — Meal plan card renderer
- `client/components/coach/blocks/index.tsx` — Block renderer dispatcher
- `client/hooks/useCoachContext.ts` — Hook for preloaded context endpoint
- `client/hooks/useCoachWarmUp.ts` — Hook for interim transcript warm-up

**Tests:**

- `server/storage/__tests__/coach-notebook.test.ts`
- `server/services/__tests__/coach-tools.test.ts`
- `server/services/__tests__/coach-blocks.test.ts`
- `server/services/__tests__/notebook-extraction.test.ts`
- `server/routes/__tests__/coach-context.test.ts`
- `shared/schemas/__tests__/coach-blocks.test.ts`

### Modified Files

- `shared/schema.ts` — Add `coachNotebook` table definition
- `shared/types/premium.ts` — Add `coachPro` feature flag + `coachProDailyMessages` limit
- `server/storage/index.ts` — Compose coach-notebook storage
- `server/routes.ts` — Register coach-context routes
- `server/routes/chat.ts` — Add coachPro gating, blocks in SSE, tool calling, notebook trigger
- `server/services/nutrition-coach.ts` — Update system prompt for notebook + tools
- `client/navigation/ChatStackNavigator.tsx` — Swap screen based on tier
- `client/hooks/useChat.ts` — Handle blocks in SSE parsing, optimistic messages
- `client/components/ChatBubble.tsx` — Render blocks within messages

---

## Task 1: Database Schema — `coach_notebook` Table

**Files:**

- Modify: `shared/schema.ts` (after `coachResponseCache` table, ~line 1403)
- Test: `shared/schemas/__tests__/coach-blocks.test.ts` (created in Task 2)

- [ ] **Step 1: Add `coachNotebook` table to schema**

Add after the `coachResponseCache` table definition (after line 1403):

```typescript
// ============================================================================
// COACH NOTEBOOK
// ============================================================================

export const coachNotebook = pgTable(
  "coach_notebook",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(), // "insight" | "commitment" | "preference" | "goal" | "motivation" | "emotional_context" | "conversation_summary" | "coaching_strategy"
    content: text("content").notNull(),
    status: text("status").default("active").notNull(), // "active" | "completed" | "expired" | "archived"
    followUpDate: timestamp("follow_up_date"),
    sourceConversationId: integer("source_conversation_id").references(
      () => chatConversations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userTypeStatusIdx: index("coach_notebook_user_type_status_idx").on(
      table.userId,
      table.type,
      table.status,
    ),
    userFollowUpIdx: index("coach_notebook_user_follow_up_idx").on(
      table.userId,
      table.followUpDate,
    ),
    sourceConversationIdx: index("coach_notebook_source_conv_idx").on(
      table.sourceConversationId,
    ),
  }),
);

export const coachNotebookRelations = relations(coachNotebook, ({ one }) => ({
  user: one(users, {
    fields: [coachNotebook.userId],
    references: [users.id],
  }),
  sourceConversation: one(chatConversations, {
    fields: [coachNotebook.sourceConversationId],
    references: [chatConversations.id],
  }),
}));
```

- [ ] **Step 2: Add type exports**

Add to the type exports section at the end of `shared/schema.ts`:

```typescript
export type CoachNotebookEntry = typeof coachNotebook.$inferSelect;
export type InsertCoachNotebookEntry = typeof coachNotebook.$inferInsert;
```

- [ ] **Step 3: Push schema to database**

Run: `npm run db:push`
Expected: Schema changes applied successfully, `coach_notebook` table created with 3 indexes.

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `npm run test:run`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(schema): add coach_notebook table for Coach Pro memory system"
```

---

## Task 2: Shared Schemas — Coach Block Types

**Files:**

- Create: `shared/schemas/coach-blocks.ts`
- Test: `shared/schemas/__tests__/coach-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/schemas/__tests__/coach-blocks.test.ts
import { describe, it, expect } from "vitest";
import {
  actionCardSchema,
  suggestionListSchema,
  inlineChartSchema,
  commitmentCardSchema,
  quickRepliesSchema,
  recipeCardSchema,
  mealPlanCardSchema,
  coachBlockSchema,
  type CoachBlock,
} from "../coach-blocks";

describe("Coach Block Schemas", () => {
  it("validates an action card", () => {
    const card = {
      type: "action_card",
      title: "Grilled chicken salad",
      subtitle: "~450 cal - 38g protein",
      action: {
        type: "log_food",
        description: "Grilled chicken salad",
        calories: 450,
        protein: 38,
        fat: 12,
        carbs: 25,
      },
      actionLabel: "Log it",
    };
    expect(actionCardSchema.parse(card)).toEqual(card);
  });

  it("validates a suggestion list", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "Greek Chicken Bowl",
          subtitle: "480 cal - 42g P",
          action: {
            type: "navigate",
            screen: "RecipeDetail",
            params: { recipeId: 123 },
          },
        },
        { title: "Tuna Wrap", subtitle: "420 cal", action: null },
      ],
    };
    expect(suggestionListSchema.parse(list)).toEqual(list);
  });

  it("validates an inline chart", () => {
    const chart = {
      type: "inline_chart",
      chartType: "bar",
      title: "Protein This Week",
      data: [
        { label: "Mon", value: 142, target: 140, hit: true },
        { label: "Tue", value: 155, target: 140, hit: true },
      ],
      summary: "5/7 days on target",
    };
    expect(inlineChartSchema.parse(chart)).toEqual(chart);
  });

  it("validates a commitment card", () => {
    const card = {
      type: "commitment_card",
      title: "Meal prep on Sunday",
      followUpText: "I'll check in on Monday",
      followUpDate: "2026-04-13",
    };
    expect(commitmentCardSchema.parse(card)).toEqual(card);
  });

  it("validates quick replies", () => {
    const replies = {
      type: "quick_replies",
      options: [
        { label: "Yes", message: "Yes, show me options" },
        { label: "No", message: "No thanks" },
      ],
    };
    expect(quickRepliesSchema.parse(replies)).toEqual(replies);
  });

  it("validates a recipe card", () => {
    const card = {
      type: "recipe_card",
      recipe: {
        title: "Mediterranean Quinoa Bowl",
        calories: 420,
        protein: 28,
        prepTime: "15 min",
        imageUrl: null,
        recipeId: 456,
        source: "community",
      },
    };
    expect(recipeCardSchema.parse(card)).toEqual(card);
  });

  it("validates a meal plan card", () => {
    const card = {
      type: "meal_plan_card",
      title: "High-Protein Day Plan",
      days: [
        {
          label: "Today",
          meals: [
            {
              type: "breakfast",
              title: "Greek Yogurt",
              calories: 320,
              protein: 28,
            },
          ],
          totals: { calories: 320, protein: 28 },
        },
      ],
    };
    expect(mealPlanCardSchema.parse(card)).toEqual(card);
  });

  it("parses discriminated union via coachBlockSchema", () => {
    const block = {
      type: "quick_replies",
      options: [{ label: "Yes", message: "Yes" }],
    };
    const parsed = coachBlockSchema.parse(block);
    expect(parsed.type).toBe("quick_replies");
  });

  it("rejects unknown block type", () => {
    expect(() =>
      coachBlockSchema.parse({ type: "unknown", data: 123 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/schemas/__tests__/coach-blocks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the schemas**

```typescript
// shared/schemas/coach-blocks.ts
import { z } from "zod";

// ── Action types for cards ──────────────────────────────────────────

const logFoodActionSchema = z.object({
  type: z.literal("log_food"),
  description: z.string(),
  calories: z.number(),
  protein: z.number(),
  fat: z.number(),
  carbs: z.number(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  servings: z.number().optional(),
});

const navigateActionSchema = z.object({
  type: z.literal("navigate"),
  screen: z.string(),
  params: z.record(z.unknown()).optional(),
});

const setGoalActionSchema = z.object({
  type: z.literal("set_goal"),
  goalType: z.string(),
  value: z.number().optional(),
});

const blockActionSchema = z.discriminatedUnion("type", [
  logFoodActionSchema,
  navigateActionSchema,
  setGoalActionSchema,
]);

// ── Block schemas ───────────────────────────────────────────────────

export const actionCardSchema = z.object({
  type: z.literal("action_card"),
  title: z.string(),
  subtitle: z.string(),
  action: blockActionSchema,
  actionLabel: z.string(),
});

export const suggestionListSchema = z.object({
  type: z.literal("suggestion_list"),
  items: z.array(
    z.object({
      title: z.string(),
      subtitle: z.string(),
      action: z.union([navigateActionSchema, z.null()]).nullable(),
    }),
  ),
});

export const inlineChartSchema = z.object({
  type: z.literal("inline_chart"),
  chartType: z.enum(["bar", "progress", "stat_row"]),
  title: z.string(),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      target: z.number().optional(),
      hit: z.boolean().optional(),
    }),
  ),
  summary: z.string().optional(),
});

export const commitmentCardSchema = z.object({
  type: z.literal("commitment_card"),
  title: z.string(),
  followUpText: z.string(),
  followUpDate: z.string(),
});

export const quickRepliesSchema = z.object({
  type: z.literal("quick_replies"),
  options: z.array(
    z.object({
      label: z.string(),
      message: z.string(),
    }),
  ),
});

export const recipeCardSchema = z.object({
  type: z.literal("recipe_card"),
  recipe: z.object({
    title: z.string(),
    calories: z.number(),
    protein: z.number(),
    prepTime: z.string(),
    imageUrl: z.string().nullable(),
    recipeId: z.number(),
    source: z.enum(["community", "spoonacular", "generated"]),
  }),
});

export const mealPlanCardSchema = z.object({
  type: z.literal("meal_plan_card"),
  title: z.string(),
  days: z.array(
    z.object({
      label: z.string(),
      meals: z.array(
        z.object({
          type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
          title: z.string(),
          calories: z.number(),
          protein: z.number(),
        }),
      ),
      totals: z.object({
        calories: z.number(),
        protein: z.number(),
      }),
    }),
  ),
});

// ── Discriminated union of all blocks ───────────────────────────────

export const coachBlockSchema = z.discriminatedUnion("type", [
  actionCardSchema,
  suggestionListSchema,
  inlineChartSchema,
  commitmentCardSchema,
  quickRepliesSchema,
  recipeCardSchema,
  mealPlanCardSchema,
]);

export type CoachBlock = z.infer<typeof coachBlockSchema>;
export type ActionCard = z.infer<typeof actionCardSchema>;
export type SuggestionList = z.infer<typeof suggestionListSchema>;
export type InlineChart = z.infer<typeof inlineChartSchema>;
export type CommitmentCard = z.infer<typeof commitmentCardSchema>;
export type QuickReplies = z.infer<typeof quickRepliesSchema>;
export type RecipeCard = z.infer<typeof recipeCardSchema>;
export type MealPlanCard = z.infer<typeof mealPlanCardSchema>;
export type BlockAction = z.infer<typeof blockActionSchema>;
export type LogFoodAction = z.infer<typeof logFoodActionSchema>;
export type NavigateAction = z.infer<typeof navigateActionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/schemas/__tests__/coach-blocks.test.ts`
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/schemas/coach-blocks.ts shared/schemas/__tests__/coach-blocks.test.ts
git commit -m "feat(shared): add Zod schemas for coach block types"
```

---

## Task 3: Shared Schemas — Notebook & Tool Types

**Files:**

- Create: `shared/schemas/coach-notebook.ts`
- Create: `shared/schemas/coach-tools.ts`

- [ ] **Step 1: Create notebook schemas**

```typescript
// shared/schemas/coach-notebook.ts
import { z } from "zod";

export const notebookEntryTypes = [
  "insight",
  "commitment",
  "preference",
  "goal",
  "motivation",
  "emotional_context",
  "conversation_summary",
  "coaching_strategy",
] as const;

export type NotebookEntryType = (typeof notebookEntryTypes)[number];

export const notebookEntryStatusValues = [
  "active",
  "completed",
  "expired",
  "archived",
] as const;

export type NotebookEntryStatus = (typeof notebookEntryStatusValues)[number];

export const notebookEntrySchema = z.object({
  type: z.enum(notebookEntryTypes),
  content: z.string().min(1).max(500),
  followUpDate: z.string().nullable().optional(),
});

export const extractionResultSchema = z.object({
  entries: z.array(notebookEntrySchema).max(10),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
```

- [ ] **Step 2: Create tool schemas**

```typescript
// shared/schemas/coach-tools.ts
import { z } from "zod";

export const lookupNutritionParamsSchema = z.object({
  query: z.string().min(1).max(200),
});

export const searchRecipesParamsSchema = z.object({
  query: z.string().min(1).max(200),
  cuisine: z.string().optional(),
  diet: z.string().optional(),
  maxReadyTime: z.number().optional(),
  intolerances: z.string().optional(),
});

export const getDailyLogParamsSchema = z.object({
  date: z.string().optional(),
});

export const logFoodItemParamsSchema = z.object({
  description: z.string().min(1).max(500),
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  servings: z.number().min(0.1).optional(),
});

export const getPantryItemsParamsSchema = z.object({
  includeExpiring: z.boolean().optional(),
});

export const getMealPlanParamsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

export const addToMealPlanParamsSchema = z.object({
  recipeId: z.number(),
  date: z.string(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  servings: z.number().optional(),
});

export const addToGroceryListParamsSchema = z.object({
  listId: z.number().optional(),
  listName: z.string().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.string().optional(),
      unit: z.string().optional(),
    }),
  ),
});

export const getSubstitutionsParamsSchema = z.object({
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.string().optional(),
      unit: z.string().optional(),
    }),
  ),
});

export const coachToolNames = [
  "lookup_nutrition",
  "search_recipes",
  "get_daily_log_details",
  "log_food_item",
  "get_pantry_items",
  "get_meal_plan",
  "add_to_meal_plan",
  "add_to_grocery_list",
  "get_substitutions",
] as const;

export type CoachToolName = (typeof coachToolNames)[number];
```

- [ ] **Step 3: Run tests**

Run: `npm run test:run`
Expected: All tests pass (no new test for schemas alone — they're validated via service tests in later tasks).

- [ ] **Step 4: Commit**

```bash
git add shared/schemas/coach-notebook.ts shared/schemas/coach-tools.ts
git commit -m "feat(shared): add notebook and tool schemas for Coach Pro"
```

---

## Task 4: Premium Feature Flag — `coachPro`

**Files:**

- Modify: `shared/types/premium.ts`

- [ ] **Step 1: Add `coachPro` to `PremiumFeatures` interface**

Add after `dailyCoachMessages: number;` (line 37):

```typescript
coachPro: boolean;
coachProDailyMessages: number;
```

- [ ] **Step 2: Add to `TIER_FEATURES.free`**

Add after `dailyCoachMessages: 3,` (line 75):

```typescript
    coachPro: false,
    coachProDailyMessages: 0,
```

- [ ] **Step 3: Add to `TIER_FEATURES.premium`**

Add after `dailyCoachMessages: 999999,` (line 108):

```typescript
    coachPro: true,
    coachProDailyMessages: 999999,
```

- [ ] **Step 4: Run tests to verify no regressions**

Run: `npm run test:run`
Expected: All tests pass. The `PremiumFeatures` type is now extended with `coachPro` and `coachProDailyMessages`.

- [ ] **Step 5: Commit**

```bash
git add shared/types/premium.ts
git commit -m "feat(premium): add coachPro feature flag and daily message limit"
```

---

## Task 5: Coach Notebook Storage Module

**Files:**

- Create: `server/storage/coach-notebook.ts`
- Modify: `server/storage/index.ts`
- Test: `server/storage/__tests__/coach-notebook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/storage/__tests__/coach-notebook.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db module before importing storage
vi.mock("../../db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return { db: mockDb };
});

import {
  getActiveNotebookEntries,
  createNotebookEntry,
  updateNotebookEntryStatus,
  getCommitmentsWithDueFollowUp,
  archiveOldEntries,
} from "../coach-notebook";

describe("Coach Notebook Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports getActiveNotebookEntries", () => {
    expect(typeof getActiveNotebookEntries).toBe("function");
  });

  it("exports createNotebookEntry", () => {
    expect(typeof createNotebookEntry).toBe("function");
  });

  it("exports updateNotebookEntryStatus", () => {
    expect(typeof updateNotebookEntryStatus).toBe("function");
  });

  it("exports getCommitmentsWithDueFollowUp", () => {
    expect(typeof getCommitmentsWithDueFollowUp).toBe("function");
  });

  it("exports archiveOldEntries", () => {
    expect(typeof archiveOldEntries).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/storage/__tests__/coach-notebook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the storage module**

```typescript
// server/storage/coach-notebook.ts
import {
  coachNotebook,
  type CoachNotebookEntry,
  type InsertCoachNotebookEntry,
} from "@shared/schema";
import type {
  NotebookEntryStatus,
  NotebookEntryType,
} from "@shared/schemas/coach-notebook";
import { db } from "../db";
import { eq, and, desc, lte, sql, inArray } from "drizzle-orm";

export async function getActiveNotebookEntries(
  userId: string,
  types?: NotebookEntryType[],
): Promise<CoachNotebookEntry[]> {
  const conditions = [
    eq(coachNotebook.userId, userId),
    eq(coachNotebook.status, "active"),
  ];
  if (types && types.length > 0) {
    conditions.push(inArray(coachNotebook.type, types));
  }
  return db
    .select()
    .from(coachNotebook)
    .where(and(...conditions))
    .orderBy(desc(coachNotebook.updatedAt));
}

export async function createNotebookEntry(
  entry: InsertCoachNotebookEntry,
): Promise<CoachNotebookEntry> {
  const [created] = await db.insert(coachNotebook).values(entry).returning();
  return created;
}

export async function createNotebookEntries(
  entries: InsertCoachNotebookEntry[],
): Promise<CoachNotebookEntry[]> {
  if (entries.length === 0) return [];
  return db.insert(coachNotebook).values(entries).returning();
}

export async function updateNotebookEntryStatus(
  id: number,
  userId: string,
  status: NotebookEntryStatus,
): Promise<CoachNotebookEntry | undefined> {
  const [updated] = await db
    .update(coachNotebook)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(coachNotebook.id, id), eq(coachNotebook.userId, userId)))
    .returning();
  return updated;
}

export async function getCommitmentsWithDueFollowUp(
  userId: string,
): Promise<CoachNotebookEntry[]> {
  return db
    .select()
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.type, "commitment"),
        eq(coachNotebook.status, "active"),
        lte(coachNotebook.followUpDate, new Date()),
      ),
    )
    .orderBy(desc(coachNotebook.followUpDate));
}

export async function archiveOldEntries(
  userId: string,
  olderThanDays: number,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await db
    .update(coachNotebook)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.status, "active"),
        lte(coachNotebook.updatedAt, cutoff),
      ),
    )
    .returning();
  return result.length;
}

export async function getNotebookEntryCount(
  userId: string,
  type: NotebookEntryType,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coachNotebook)
    .where(
      and(
        eq(coachNotebook.userId, userId),
        eq(coachNotebook.type, type),
        eq(coachNotebook.status, "active"),
      ),
    );
  return result?.count ?? 0;
}
```

- [ ] **Step 4: Add to storage composition**

In `server/storage/index.ts`, add the import and compose the functions:

```typescript
import * as coachNotebook from "./coach-notebook";
```

Add to the `storage` object:

```typescript
  // Coach Notebook
  getActiveNotebookEntries: coachNotebook.getActiveNotebookEntries,
  createNotebookEntry: coachNotebook.createNotebookEntry,
  createNotebookEntries: coachNotebook.createNotebookEntries,
  updateNotebookEntryStatus: coachNotebook.updateNotebookEntryStatus,
  getCommitmentsWithDueFollowUp: coachNotebook.getCommitmentsWithDueFollowUp,
  archiveOldEntries: coachNotebook.archiveOldEntries,
  getNotebookEntryCount: coachNotebook.getNotebookEntryCount,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/storage/__tests__/coach-notebook.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/storage/coach-notebook.ts server/storage/__tests__/coach-notebook.test.ts server/storage/index.ts
git commit -m "feat(storage): add coach-notebook storage module"
```

---

## Task 6: Coach Tools Service

**Files:**

- Create: `server/services/coach-tools.ts`
- Test: `server/services/__tests__/coach-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/__tests__/coach-tools.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getToolDefinitions,
  executeToolCall,
  MAX_TOOL_CALLS_PER_RESPONSE,
} from "../coach-tools";

// Mock storage and services
vi.mock("../../storage", () => ({
  storage: {
    getDailyLogs: vi.fn().mockResolvedValue([]),
    getDailySummary: vi
      .fn()
      .mockResolvedValue({ totalCalories: 800, totalProtein: 60 }),
    getPantryItems: vi.fn().mockResolvedValue([]),
    getExpiringPantryItems: vi.fn().mockResolvedValue([]),
    getMealPlanItems: vi.fn().mockResolvedValue([]),
    addMealPlanItem: vi.fn().mockResolvedValue({ id: 1 }),
    addGroceryListItems: vi.fn().mockResolvedValue([{ id: 1 }]),
    createGroceryListWithLimitCheck: vi
      .fn()
      .mockResolvedValue({ list: { id: 1 }, items: [{ id: 1 }] }),
    getGroceryLists: vi.fn().mockResolvedValue({ lists: [], total: 0 }),
  },
}));

vi.mock("../nutrition-lookup", () => ({
  lookupNutrition: vi
    .fn()
    .mockResolvedValue({ name: "chicken", calories: 165, protein: 31 }),
}));

vi.mock("../recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn().mockResolvedValue({ results: [] }),
}));

describe("Coach Tools Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 9 tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(9);
  });

  it("each tool has name, description, and parameters", () => {
    const tools = getToolDefinitions();
    for (const tool of tools) {
      expect(tool).toHaveProperty("type", "function");
      expect(tool.function).toHaveProperty("name");
      expect(tool.function).toHaveProperty("description");
      expect(tool.function).toHaveProperty("parameters");
    }
  });

  it("tool names match expected set", () => {
    const tools = getToolDefinitions();
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("lookup_nutrition");
    expect(names).toContain("search_recipes");
    expect(names).toContain("get_daily_log_details");
    expect(names).toContain("log_food_item");
    expect(names).toContain("get_pantry_items");
    expect(names).toContain("get_meal_plan");
    expect(names).toContain("add_to_meal_plan");
    expect(names).toContain("add_to_grocery_list");
    expect(names).toContain("get_substitutions");
  });

  it("executes lookup_nutrition tool", async () => {
    const result = await executeToolCall(
      "lookup_nutrition",
      { query: "chicken breast" },
      "user-1",
    );
    expect(result).toHaveProperty("name", "chicken");
  });

  it("rejects unknown tool name", async () => {
    await expect(executeToolCall("unknown_tool", {}, "user-1")).rejects.toThrow(
      "Unknown tool",
    );
  });

  it("exports MAX_TOOL_CALLS_PER_RESPONSE as 5", () => {
    expect(MAX_TOOL_CALLS_PER_RESPONSE).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/coach-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the coach tools service**

```typescript
// server/services/coach-tools.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { storage } from "../storage";
import { lookupNutrition } from "./nutrition-lookup";
import { searchCatalogRecipes } from "./recipe-catalog";
import { logger } from "../lib/logger";

export const MAX_TOOL_CALLS_PER_RESPONSE = 5;

export function getToolDefinitions(): ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "lookup_nutrition",
        description:
          "Look up nutrition data for a specific food item. Returns calories, protein, carbs, fat, and serving size from verified databases.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: 'Food name to look up (e.g., "chicken breast")',
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_recipes",
        description:
          "Search the recipe catalog for recipes matching a query. Returns real recipes the user can view and save.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: 'Search terms (e.g., "high protein lunch")',
            },
            cuisine: { type: "string", description: "Cuisine filter" },
            diet: { type: "string", description: "Diet filter" },
            maxReadyTime: {
              type: "number",
              description: "Max prep+cook time in minutes",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_daily_log_details",
        description:
          "Get the detailed breakdown of what the user has eaten on a specific day, including each meal and daily totals.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "ISO date string (defaults to today)",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "log_food_item",
        description:
          "Log a food item to the user's daily intake. Only call this after the user has confirmed via an action card.",
        parameters: {
          type: "object",
          properties: {
            description: { type: "string", description: "Food description" },
            calories: { type: "number" },
            protein: { type: "number" },
            carbs: { type: "number" },
            fat: { type: "number" },
            mealType: {
              type: "string",
              enum: ["breakfast", "lunch", "dinner", "snack"],
            },
            servings: { type: "number" },
          },
          required: ["description", "calories", "protein", "carbs", "fat"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_pantry_items",
        description:
          "Check what's currently in the user's pantry, optionally including items expiring soon.",
        parameters: {
          type: "object",
          properties: {
            includeExpiring: {
              type: "boolean",
              description: "Include items expiring within 7 days",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_meal_plan",
        description: "Get the user's scheduled meal plan for a date range.",
        parameters: {
          type: "object",
          properties: {
            startDate: { type: "string", description: "ISO date" },
            endDate: { type: "string", description: "ISO date" },
          },
          required: ["startDate", "endDate"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_to_meal_plan",
        description:
          "Add a recipe to the user's meal plan. Only call after the user confirms via a meal plan card.",
        parameters: {
          type: "object",
          properties: {
            recipeId: { type: "number" },
            date: { type: "string" },
            mealType: {
              type: "string",
              enum: ["breakfast", "lunch", "dinner", "snack"],
            },
            servings: { type: "number" },
          },
          required: ["recipeId", "date", "mealType"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_to_grocery_list",
        description:
          "Add items to the user's grocery list. Only call after user confirmation.",
        parameters: {
          type: "object",
          properties: {
            listId: { type: "number", description: "Existing list ID" },
            listName: { type: "string", description: "Name for new list" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  quantity: { type: "string" },
                  unit: { type: "string" },
                },
                required: ["name"],
              },
            },
          },
          required: ["items"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_substitutions",
        description:
          "Get ingredient substitutions that respect the user's dietary restrictions.",
        parameters: {
          type: "object",
          properties: {
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  quantity: { type: "string" },
                  unit: { type: "string" },
                },
                required: ["name"],
              },
            },
          },
          required: ["ingredients"],
        },
      },
    },
  ];
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  logger.debug({ toolName, args }, "Executing coach tool call");

  switch (toolName) {
    case "lookup_nutrition": {
      const result = await lookupNutrition(args.query as string);
      if (!result) return { error: "No nutrition data found" };
      return {
        name: result.name,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        fiber: result.fiber,
        sugar: result.sugar,
        sodium: result.sodium,
        servingSize: result.servingSize,
        source: result.source,
      };
    }

    case "search_recipes": {
      const response = await searchCatalogRecipes({
        query: args.query as string,
        cuisine: args.cuisine as string | undefined,
        diet: args.diet as string | undefined,
        maxReadyTime: args.maxReadyTime as number | undefined,
        intolerances: args.intolerances as string | undefined,
        number: 5,
      });
      return {
        results: response.results.map((r: Record<string, unknown>) => ({
          id: r.id,
          title: r.title,
          image: r.image,
          readyInMinutes: r.readyInMinutes,
        })),
      };
    }

    case "get_daily_log_details": {
      const date = args.date ? new Date(args.date as string) : new Date();
      const [logs, summary] = await Promise.all([
        storage.getDailyLogs(userId, date),
        storage.getDailySummary(userId, date),
      ]);
      return { logs, totals: summary };
    }

    case "log_food_item": {
      // This creates a scanned item + daily log in one atomic operation
      const item = await storage.createScannedItemWithLog({
        userId,
        name: args.description as string,
        calories: String(args.calories),
        protein: String(args.protein),
        carbs: String(args.carbs),
        fat: String(args.fat),
        servingSize: "1 serving",
        source: "coach",
      });
      return { success: true, logId: item.id };
    }

    case "get_pantry_items": {
      const items = await storage.getPantryItems(userId);
      const result: Record<string, unknown> = {
        items: items.map((i: Record<string, unknown>) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
          category: i.category,
          expiresAt: i.expiresAt,
        })),
      };
      if (args.includeExpiring) {
        const expiring = await storage.getExpiringPantryItems(userId, 7);
        result.expiringItems = expiring;
      }
      return result;
    }

    case "get_meal_plan": {
      const items = await storage.getMealPlanItems(
        userId,
        new Date(args.startDate as string),
        new Date(args.endDate as string),
      );
      return { items };
    }

    case "add_to_meal_plan": {
      const item = await storage.addMealPlanItem({
        userId,
        recipeId: args.recipeId as number,
        date: new Date(args.date as string),
        mealType: args.mealType as string,
        servings: (args.servings as number) ?? 1,
      });
      return { success: true, itemId: item.id };
    }

    case "add_to_grocery_list": {
      const items = args.items as Array<{
        name: string;
        quantity?: string;
        unit?: string;
      }>;
      if (args.listId) {
        const created = await storage.addGroceryListItems(
          items.map((item) => ({
            groceryListId: args.listId as number,
            name: item.name,
            quantity: item.quantity ?? null,
            unit: item.unit ?? null,
          })),
        );
        return {
          success: true,
          listId: args.listId,
          itemCount: created.length,
        };
      }
      const result = await storage.createGroceryListWithLimitCheck(
        { userId, name: (args.listName as string) || "Coach Suggestions" },
        items.map((item) => ({
          name: item.name,
          quantity: item.quantity ?? null,
          unit: item.unit ?? null,
        })),
        20,
      );
      return {
        success: true,
        listId: result.list.id,
        itemCount: result.items.length,
      };
    }

    case "get_substitutions": {
      // Lazy import to avoid circular dependency
      const { getSubstitutions } = await import("./ingredient-substitution");
      const ingredients = args.ingredients as Array<{
        name: string;
        quantity?: string;
        unit?: string;
      }>;
      const result = await getSubstitutions(
        ingredients.map((i, idx) => ({
          id: idx,
          name: i.name,
          quantity: i.quantity || "",
          unit: i.unit || "",
        })),
        undefined, // userProfile — auto-fetched inside service
      );
      return result;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/coach-tools.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach-tools.ts server/services/__tests__/coach-tools.test.ts
git commit -m "feat(services): add coach tools service with 9 tool definitions"
```

---

## Task 7: Coach Blocks Service

**Files:**

- Create: `server/services/coach-blocks.ts`
- Test: `server/services/__tests__/coach-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

````typescript
// server/services/__tests__/coach-blocks.test.ts
import { describe, it, expect } from "vitest";
import { validateBlocks, parseBlocksFromContent } from "../coach-blocks";

describe("Coach Blocks Service", () => {
  it("validates valid blocks array", () => {
    const blocks = [
      {
        type: "quick_replies",
        options: [{ label: "Yes", message: "Yes please" }],
      },
    ];
    const result = validateBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("quick_replies");
  });

  it("filters out invalid blocks silently", () => {
    const blocks = [
      { type: "unknown_type", data: "bad" },
      {
        type: "quick_replies",
        options: [{ label: "Yes", message: "Yes please" }],
      },
    ];
    const result = validateBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("quick_replies");
  });

  it("returns empty array for no valid blocks", () => {
    const result = validateBlocks([{ type: "bad" }]);
    expect(result).toEqual([]);
  });

  it("parses blocks from JSON-annotated content", () => {
    const content =
      'Here are some options:\n```coach_blocks\n[{"type":"quick_replies","options":[{"label":"Yes","message":"Yes"}]}]\n```';
    const { text, blocks } = parseBlocksFromContent(content);
    expect(text).toBe("Here are some options:");
    expect(blocks).toHaveLength(1);
  });

  it("returns original content when no blocks marker found", () => {
    const content = "Just plain text response";
    const { text, blocks } = parseBlocksFromContent(content);
    expect(text).toBe("Just plain text response");
    expect(blocks).toEqual([]);
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/coach-blocks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the blocks service**

````typescript
// server/services/coach-blocks.ts
import {
  coachBlockSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
import { logger } from "../lib/logger";

/**
 * Validates an array of raw block objects against the Zod schemas.
 * Invalid blocks are silently dropped — text content still streams.
 */
export function validateBlocks(rawBlocks: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const block of rawBlocks) {
    const result = coachBlockSchema.safeParse(block);
    if (result.success) {
      valid.push(result.data);
    } else {
      logger.debug(
        { block, error: result.error.message },
        "Dropped invalid coach block",
      );
    }
  }
  return valid;
}

/**
 * Parses coach blocks from content that uses a ```coach_blocks``` marker.
 * The model is instructed to output blocks in a fenced code block with
 * the `coach_blocks` language tag.
 *
 * Returns the text content (without the blocks marker) and parsed blocks.
 */
export function parseBlocksFromContent(content: string): {
  text: string;
  blocks: CoachBlock[];
} {
  const blockPattern = /```coach_blocks\n([\s\S]*?)```/;
  const match = content.match(blockPattern);

  if (!match) {
    return { text: content.trim(), blocks: [] };
  }

  const text = content.replace(blockPattern, "").trim();

  try {
    const rawBlocks = JSON.parse(match[1]);
    if (!Array.isArray(rawBlocks)) {
      return { text, blocks: [] };
    }
    return { text, blocks: validateBlocks(rawBlocks) };
  } catch {
    logger.debug("Failed to parse coach blocks JSON");
    return { text, blocks: [] };
  }
}

/**
 * System prompt instructions for the model to output structured blocks.
 */
export const BLOCKS_SYSTEM_PROMPT = `
When appropriate, you can include structured interactive content blocks in your response.
To do this, add a fenced code block with the language tag \`coach_blocks\` containing a JSON array of block objects.

Available block types:
- action_card: { type: "action_card", title, subtitle, action: { type: "log_food"|"navigate"|"set_goal", ... }, actionLabel }
- suggestion_list: { type: "suggestion_list", items: [{ title, subtitle, action: { type: "navigate", screen, params } | null }] }
- inline_chart: { type: "inline_chart", chartType: "bar"|"progress"|"stat_row", title, data: [{ label, value, target?, hit? }], summary? }
- commitment_card: { type: "commitment_card", title, followUpText, followUpDate: "YYYY-MM-DD" }
- quick_replies: { type: "quick_replies", options: [{ label, message }] }
- recipe_card: { type: "recipe_card", recipe: { title, calories, protein, prepTime, imageUrl, recipeId, source: "community"|"spoonacular"|"generated" } }
- meal_plan_card: { type: "meal_plan_card", title, days: [{ label, meals: [{ type, title, calories, protein }], totals: { calories, protein } }] }

Rules:
- Only include blocks when they add value (don't force them into every response)
- Place the coach_blocks fence after your text response
- Always include quick_replies with 2-3 contextual follow-up options
- For recipe suggestions, use search_recipes tool first to get real recipe data
- For nutrition data, use lookup_nutrition tool first for accuracy
`.trim();
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/coach-blocks.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach-blocks.ts server/services/__tests__/coach-blocks.test.ts
git commit -m "feat(services): add coach blocks validation and parsing service"
```

---

## Task 8: Notebook Extraction Service

**Files:**

- Create: `server/services/notebook-extraction.ts`
- Test: `server/services/__tests__/notebook-extraction.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/__tests__/notebook-extraction.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractNotebookEntries,
  shouldUpdateStrategy,
} from "../notebook-extraction";
import { openai } from "../../lib/openai";

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  MODEL_FAST: "gpt-4o-mini",
}));

vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntryCount: vi.fn().mockResolvedValue(3),
  },
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

describe("Notebook Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts entries from a conversation", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              entries: [
                {
                  type: "preference",
                  content: "Prefers quick meals under 15 min",
                  followUpDate: null,
                },
                {
                  type: "commitment",
                  content: "Try meal prepping on Sunday",
                  followUpDate: "2026-04-13",
                },
              ],
            }),
          },
        },
      ],
    } as never);

    const messages = [
      { role: "user" as const, content: "I need quick meal ideas" },
      {
        role: "assistant" as const,
        content: "Try meal prepping on Sunday!",
      },
    ];

    const entries = await extractNotebookEntries(messages, "user-1", 1);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("preference");
    expect(entries[1].type).toBe("commitment");
    expect(entries[1].followUpDate).toBe("2026-04-13");
  });

  it("returns empty array on parse failure", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    } as never);

    const entries = await extractNotebookEntries(
      [{ role: "user", content: "hello" }],
      "user-1",
      1,
    );
    expect(entries).toEqual([]);
  });

  it("shouldUpdateStrategy returns true every 5 conversations", () => {
    expect(shouldUpdateStrategy(0)).toBe(true);
    expect(shouldUpdateStrategy(1)).toBe(false);
    expect(shouldUpdateStrategy(4)).toBe(false);
    expect(shouldUpdateStrategy(5)).toBe(true);
    expect(shouldUpdateStrategy(10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/notebook-extraction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the extraction service**

```typescript
// server/services/notebook-extraction.ts
import { openai, MODEL_FAST } from "../lib/openai";
import {
  extractionResultSchema,
  type NotebookEntryType,
} from "@shared/schemas/coach-notebook";
import { storage } from "../storage";
import { logger } from "../lib/logger";

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const EXTRACTION_PROMPT = `You are a coaching analyst. Given a conversation between a nutrition coach and a user, extract structured insights.

Return a JSON object with an "entries" array. Each entry has:
- type: one of "insight", "commitment", "preference", "goal", "motivation", "emotional_context", "conversation_summary", "coaching_strategy"
- content: a concise description (max 500 chars)
- followUpDate: ISO date string if this is a commitment with a check-in date, otherwise null

Rules:
- Only extract genuinely new information — skip greetings and small talk
- Commitments must be things the user explicitly agreed to try
- Preferences are stated likes/dislikes about food, cooking, or lifestyle
- Goals are explicit targets the user wants to achieve
- Motivations are the deeper "why" behind their goals
- Emotional context captures stress, frustration, or excitement related to nutrition
- Conversation summary should be 1-2 sentences covering what was discussed and decided
- coaching_strategy describes how the user responds best (only include if clear signal)
- Maximum 10 entries per extraction
- Return empty entries array if nothing meaningful to extract`;

export async function extractNotebookEntries(
  messages: ConversationMessage[],
  userId: string,
  conversationId: number,
): Promise<
  Array<{
    type: NotebookEntryType;
    content: string;
    followUpDate: string | null;
  }>
> {
  try {
    const strategyCount = await storage.getNotebookEntryCount(
      userId,
      "coaching_strategy",
    );
    const includeStrategy = shouldUpdateStrategy(strategyCount);

    const prompt = includeStrategy
      ? EXTRACTION_PROMPT
      : EXTRACTION_PROMPT +
        '\n- Do NOT include "coaching_strategy" entries this time.';

    const response = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: "system", content: prompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const result = extractionResultSchema.safeParse(parsed);

    if (!result.success) {
      logger.warn(
        { error: result.error.message, conversationId },
        "Failed to validate extraction result",
      );
      return [];
    }

    return result.data.entries.map((e) => ({
      type: e.type,
      content: e.content,
      followUpDate: e.followUpDate ?? null,
    }));
  } catch (error) {
    logger.error({ error, conversationId }, "Notebook extraction failed");
    return [];
  }
}

/**
 * Coaching strategy should only be updated every ~5 conversations
 * to avoid thrashing. Returns true when count is a multiple of 5.
 */
export function shouldUpdateStrategy(currentCount: number): boolean {
  return currentCount % 5 === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/notebook-extraction.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/notebook-extraction.ts server/services/__tests__/notebook-extraction.test.ts
git commit -m "feat(services): add notebook extraction service for Coach Pro"
```

---

## Task 9: Coach Context Route

**Files:**

- Create: `server/routes/coach-context.ts`
- Modify: `server/routes.ts`
- Test: `server/routes/__tests__/coach-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/routes/__tests__/coach-context.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { register } from "../coach-context";

// Mock auth middleware
vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req.userId = "test-user";
    next();
  },
}));

// Mock storage
vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn().mockResolvedValue({
      dietType: "balanced",
      allergies: [],
      dislikes: [],
    }),
    getDailySummary: vi.fn().mockResolvedValue({
      totalCalories: 800,
      totalProtein: 60,
      totalCarbs: 100,
      totalFat: 30,
    }),
    getActiveNotebookEntries: vi
      .fn()
      .mockResolvedValue([
        {
          id: 1,
          type: "insight",
          content: "High protein consistency",
          status: "active",
        },
      ]),
    getCommitmentsWithDueFollowUp: vi.fn().mockResolvedValue([]),
    getSubscriptionStatus: vi.fn().mockResolvedValue({
      tier: "premium",
      features: { coachPro: true },
    }),
  },
}));

// Mock helpers
vi.mock("../_helpers", () => ({
  checkPremiumFeature: vi.fn().mockResolvedValue({ coachPro: true }),
  handleRouteError: vi.fn(),
  formatZodError: vi.fn(),
}));

// Mock goal calculator
vi.mock("../../services/goal-calculator", () => ({
  calculateGoals: vi.fn().mockReturnValue({
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65,
  }),
}));

describe("Coach Context Route", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    register(app);
  });

  it("GET /api/coach/context returns 200 with context payload", async () => {
    const res = await request(app).get("/api/coach/context");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("goals");
    expect(res.body).toHaveProperty("todayIntake");
    expect(res.body).toHaveProperty("notebook");
    expect(res.body).toHaveProperty("suggestions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/__tests__/coach-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the coach context route**

```typescript
// server/routes/coach-context.ts
import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { checkPremiumFeature, handleRouteError } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { calculateGoals } from "../services/goal-calculator";
import { logger } from "../lib/logger";

// In-memory warm-up cache: userId → { warmUpId, messages, preparedAt }
const warmUpCache = new Map<
  string,
  {
    warmUpId: string;
    messages: Array<{ role: string; content: string }>;
    preparedAt: number;
  }
>();

const WARM_UP_TTL_MS = 30_000; // 30 seconds

export function register(app: Express): void {
  // ── GET /api/coach/context ──────────────────────────────────────
  app.get(
    "/api/coach/context",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "coachPro",
          "Coach Pro",
        );
        if (!features) return;

        const [profile, todayIntake, notebookEntries, dueCommitments] =
          await Promise.all([
            storage.getUserProfile(req.userId),
            storage.getDailySummary(req.userId, new Date()),
            storage.getActiveNotebookEntries(req.userId),
            storage.getCommitmentsWithDueFollowUp(req.userId),
          ]);

        const goals = profile ? calculateGoals(profile) : null;

        // Generate contextual suggestion chips
        const suggestions: string[] = [];
        if (dueCommitments.length > 0) {
          suggestions.push(`How did "${dueCommitments[0].content}" go?`);
        }
        if (todayIntake && goals) {
          const proteinLeft =
            (goals.protein ?? 0) - (todayIntake.totalProtein ?? 0);
          if (proteinLeft > 30) {
            suggestions.push(
              `I need ${Math.round(proteinLeft)}g more protein today`,
            );
          }
        }
        const hour = new Date().getHours();
        if (hour < 11) {
          suggestions.push("Quick breakfast ideas");
        } else if (hour >= 17) {
          suggestions.push("How was my day?");
        }
        if (suggestions.length < 3) {
          suggestions.push("What should I eat next?");
        }

        res.json({
          goals,
          todayIntake,
          dietaryProfile: profile
            ? {
                dietType: profile.dietType,
                allergies: profile.allergies,
                dislikes: profile.dislikes,
              }
            : null,
          notebook: notebookEntries,
          dueCommitments,
          suggestions: suggestions.slice(0, 5),
        });
      } catch (error) {
        handleRouteError(res, error, "get coach context");
      }
    },
  );

  // ── POST /api/coach/warm-up ─────────────────────────────────────
  app.post(
    "/api/coach/warm-up",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "coachPro",
          "Coach Pro",
        );
        if (!features) return;

        const schema = z.object({
          conversationId: z.number(),
          interimTranscript: z.string().min(1).max(2000),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid warm-up request",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const { conversationId, interimTranscript } = parsed.data;

        // Pre-fetch conversation history
        const messages = await storage.getChatMessages(conversationId, 20);
        const prepared = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        // Add the interim transcript as tentative user message
        prepared.push({ role: "user", content: interimTranscript });

        const warmUpId = `${req.userId}-${Date.now()}`;

        // Evict any existing warm-up for this user
        warmUpCache.delete(req.userId);
        warmUpCache.set(req.userId, {
          warmUpId,
          messages: prepared,
          preparedAt: Date.now(),
        });

        res.json({ warmUpId });
      } catch (error) {
        handleRouteError(res, error, "coach warm-up");
      }
    },
  );
}

/**
 * Retrieve and consume a cached warm-up, or return null if expired/missing.
 */
export function consumeWarmUp(
  userId: string,
  warmUpId: string,
): Array<{ role: string; content: string }> | null {
  const cached = warmUpCache.get(userId);
  if (!cached || cached.warmUpId !== warmUpId) return null;
  if (Date.now() - cached.preparedAt > WARM_UP_TTL_MS) {
    warmUpCache.delete(userId);
    return null;
  }
  warmUpCache.delete(userId);
  return cached.messages;
}
```

- [ ] **Step 4: Register the route**

In `server/routes.ts`, add:

```typescript
import { register as registerCoachContext } from "./routes/coach-context";
```

Add after `registerChat(app);`:

```typescript
registerCoachContext(app);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/routes/__tests__/coach-context.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm run test:run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/routes/coach-context.ts server/routes/__tests__/coach-context.test.ts server/routes.ts
git commit -m "feat(routes): add coach context and warm-up endpoints"
```

---

## Task 10: Update Chat Route for Blocks + Tools

**Files:**

- Modify: `server/routes/chat.ts`
- Modify: `server/services/nutrition-coach.ts`

This task modifies the existing coach message endpoint to support:

- Tool calling via OpenAI function calling
- Block parsing from responses
- Notebook context injection
- Post-conversation extraction trigger

- [ ] **Step 1: Update nutrition-coach service to accept notebook context and tools**

In `server/services/nutrition-coach.ts`, update the `CoachContext` type and `generateCoachResponse` to accept notebook entries and optionally use tools. The key changes:

1. Add `notebookSummary?: string` to `CoachContext`
2. Add `useTools?: boolean` parameter
3. When `useTools` is true, include tool definitions and handle tool calls in the stream
4. Append `BLOCKS_SYSTEM_PROMPT` to system prompt when Coach Pro
5. Append notebook summary to system prompt

The system prompt section should add after the existing context:

```typescript
// Add to system prompt building:
if (context.notebookSummary) {
  systemParts.push(
    `\n## What You Know About This User\n${context.notebookSummary}`,
  );
}
```

- [ ] **Step 2: Update chat route to inject notebook + blocks for coachPro users**

In `server/routes/chat.ts`, in the `POST /api/chat/conversations/:id/messages` handler, after checking premium features:

1. Check if user has `coachPro` feature
2. If yes: fetch notebook entries, build summary, pass to `generateCoachResponse` with `useTools: true`
3. Parse blocks from completed response using `parseBlocksFromContent()`
4. Include blocks in SSE events: `data: { content, blocks, done }`
5. After stream completes, if `coachPro`, fire-and-forget notebook extraction

The SSE event format changes from:

```
data: {"content":"text","done":false}
```

to:

```
data: {"content":"text","blocks":[],"done":false}
```

Blocks are only included in the final chunk (when `done: true`) since they depend on complete tool call results.

- [ ] **Step 3: Run existing chat tests**

Run: `npx vitest run server/routes/__tests__/chat.test.ts`
Expected: All existing tests pass (the changes are additive — basic coach without `coachPro` is unchanged).

- [ ] **Step 4: Run full test suite**

Run: `npm run test:run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/chat.ts server/services/nutrition-coach.ts
git commit -m "feat(chat): add coach pro tool calling, blocks, and notebook integration"
```

---

## Task 11: Client — Coach Context Hook

**Files:**

- Create: `client/hooks/useCoachContext.ts`

- [ ] **Step 1: Create the hook**

```typescript
// client/hooks/useCoachContext.ts
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { CoachNotebookEntry } from "@shared/schema";

export interface CoachContextData {
  goals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null;
  todayIntake: {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
  } | null;
  dietaryProfile: {
    dietType: string | null;
    allergies: string[] | null;
    dislikes: string[] | null;
  } | null;
  notebook: CoachNotebookEntry[];
  dueCommitments: CoachNotebookEntry[];
  suggestions: string[];
}

export function useCoachContext(enabled: boolean) {
  return useQuery<CoachContextData>({
    queryKey: ["/api/coach/context"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/coach/context");
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint -- --no-error-on-unmatched-pattern client/hooks/useCoachContext.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/hooks/useCoachContext.ts
git commit -m "feat(hooks): add useCoachContext hook for preloaded coach data"
```

---

## Task 12: Client — Coach Warm-Up Hook

**Files:**

- Create: `client/hooks/useCoachWarmUp.ts`

- [ ] **Step 1: Create the hook**

```typescript
// client/hooks/useCoachWarmUp.ts
import { useRef, useCallback } from "react";
import { apiRequest } from "@/lib/query-client";

export function useCoachWarmUp(conversationId: number | null) {
  const warmUpIdRef = useRef<string | null>(null);
  const lastTranscriptRef = useRef<string>("");
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendWarmUp = useCallback(
    async (interimTranscript: string) => {
      if (!conversationId || pendingRef.current) return;
      if (interimTranscript.length < 20) return;
      if (interimTranscript === lastTranscriptRef.current) return;

      lastTranscriptRef.current = interimTranscript;

      // Debounce: wait 500ms of stability
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        pendingRef.current = true;
        try {
          const res = await apiRequest("POST", "/api/coach/warm-up", {
            conversationId,
            interimTranscript,
          });
          const data = await res.json();
          warmUpIdRef.current = data.warmUpId;
        } catch {
          // Silent failure — falls back to normal latency
          warmUpIdRef.current = null;
        } finally {
          pendingRef.current = false;
        }
      }, 500);
    },
    [conversationId],
  );

  const getWarmUpId = useCallback(() => {
    const id = warmUpIdRef.current;
    warmUpIdRef.current = null;
    return id;
  }, []);

  const reset = useCallback(() => {
    warmUpIdRef.current = null;
    lastTranscriptRef.current = "";
    pendingRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { sendWarmUp, getWarmUpId, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/hooks/useCoachWarmUp.ts
git commit -m "feat(hooks): add useCoachWarmUp hook for interim transcript preloading"
```

---

## Task 13: Client — Block Renderer Components

**Files:**

- Create: `client/components/coach/blocks/index.tsx`
- Create: `client/components/coach/blocks/ActionCard.tsx`
- Create: `client/components/coach/blocks/SuggestionList.tsx`
- Create: `client/components/coach/blocks/InlineChart.tsx`
- Create: `client/components/coach/blocks/CommitmentCard.tsx`
- Create: `client/components/coach/blocks/QuickReplies.tsx`
- Create: `client/components/coach/blocks/RecipeCard.tsx`
- Create: `client/components/coach/blocks/MealPlanCard.tsx`

- [ ] **Step 1: Create the block renderer dispatcher**

```typescript
// client/components/coach/blocks/index.tsx
import React from "react";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import ActionCard from "./ActionCard";
import SuggestionList from "./SuggestionList";
import InlineChart from "./InlineChart";
import CommitmentCard from "./CommitmentCard";
import QuickReplies from "./QuickReplies";
import RecipeCard from "./RecipeCard";
import MealPlanCard from "./MealPlanCard";

interface BlockRendererProps {
  block: CoachBlock;
  onAction?: (action: Record<string, unknown>) => void;
  onQuickReply?: (message: string) => void;
  onCommitmentAccept?: (title: string, followUpDate: string) => void;
}

export default function BlockRenderer({
  block,
  onAction,
  onQuickReply,
  onCommitmentAccept,
}: BlockRendererProps) {
  switch (block.type) {
    case "action_card":
      return <ActionCard block={block} onAction={onAction} />;
    case "suggestion_list":
      return <SuggestionList block={block} onAction={onAction} />;
    case "inline_chart":
      return <InlineChart block={block} />;
    case "commitment_card":
      return (
        <CommitmentCard block={block} onAccept={onCommitmentAccept} />
      );
    case "quick_replies":
      return <QuickReplies block={block} onSelect={onQuickReply} />;
    case "recipe_card":
      return <RecipeCard block={block} onAction={onAction} />;
    case "meal_plan_card":
      return <MealPlanCard block={block} onAction={onAction} />;
    default:
      return null;
  }
}
```

- [ ] **Step 2: Create ActionCard component**

```typescript
// client/components/coach/blocks/ActionCard.tsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: ActionCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function ActionCard({ block, onAction }: Props) {
  const { theme } = useTheme();

  return (
    <View
      style={[styles.container, { backgroundColor: theme.cardBackground }]}
      accessibilityRole="button"
      accessibilityLabel={`${block.title}. ${block.subtitle}. ${block.actionLabel}`}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>
          {block.title}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {block.subtitle}
        </Text>
      </View>
      <Pressable
        style={[styles.button, { backgroundColor: theme.link }]}
        onPress={() => onAction?.(block.action as Record<string, unknown>)}
        accessibilityRole="button"
        accessibilityLabel={block.actionLabel}
      >
        <Text style={styles.buttonText}>{block.actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: { flex: 1, marginRight: 12 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  button: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
});
```

- [ ] **Step 3: Create SuggestionList component**

```typescript
// client/components/coach/blocks/SuggestionList.tsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { SuggestionList as SuggestionListType } from "@shared/schemas/coach-blocks";

interface Props {
  block: SuggestionListType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function SuggestionList({ block, onAction }: Props) {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.cardBackground }]}>
      {block.items.map((item, i) => (
        <Pressable
          key={i}
          style={[
            styles.item,
            i < block.items.length - 1 && {
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            },
          ]}
          onPress={() =>
            item.action && onAction?.(item.action as Record<string, unknown>)
          }
          disabled={!item.action}
          accessibilityRole={item.action ? "button" : "text"}
          accessibilityLabel={`${item.title}. ${item.subtitle}`}
        >
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: theme.text }]}>
              {item.title}
            </Text>
            <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>
              {item.subtitle}
            </Text>
          </View>
          {item.action && (
            <Text style={[styles.arrow, { color: theme.link }]}>
              {"View \u2192"}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, marginTop: 8, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", padding: 10 },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: 13, fontWeight: "600" },
  itemSubtitle: { fontSize: 11, marginTop: 2 },
  arrow: { fontSize: 12 },
});
```

- [ ] **Step 4: Create InlineChart component**

```typescript
// client/components/coach/blocks/InlineChart.tsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { InlineChart as InlineChartType } from "@shared/schemas/coach-blocks";

interface Props {
  block: InlineChartType;
}

export default function InlineChart({ block }: Props) {
  const { theme } = useTheme();

  if (block.chartType === "bar") {
    const maxValue = Math.max(...block.data.map((d) => d.value), 1);
    return (
      <View
        style={[styles.container, { backgroundColor: theme.cardBackground }]}
        accessibilityLabel={`${block.title}. ${block.summary ?? ""}`}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {block.title}
        </Text>
        <View style={styles.barRow}>
          {block.data.map((d, i) => (
            <View key={i} style={styles.barCol}>
              <View style={styles.barWrapper}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${(d.value / maxValue) * 100}%`,
                      backgroundColor: d.hit
                        ? theme.success
                        : theme.error,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: theme.textSecondary }]}>
                {d.label}
              </Text>
            </View>
          ))}
        </View>
        {block.summary && (
          <Text style={[styles.summary, { color: theme.textSecondary }]}>
            {block.summary}
          </Text>
        )}
      </View>
    );
  }

  if (block.chartType === "stat_row") {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.cardBackground }]}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {block.title}
        </Text>
        <View style={styles.statRow}>
          {block.data.map((d, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.link }]}>
                {d.value}
              </Text>
              <Text
                style={[styles.statLabel, { color: theme.textSecondary }]}
              >
                {d.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  // progress type — simple progress bar
  const datum = block.data[0];
  const pct = datum?.target
    ? Math.min((datum.value / datum.target) * 100, 100)
    : 0;
  return (
    <View
      style={[styles.container, { backgroundColor: theme.cardBackground }]}
    >
      <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
      <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${pct}%`, backgroundColor: theme.success },
          ]}
        />
      </View>
      {block.summary && (
        <Text style={[styles.summary, { color: theme.textSecondary }]}>
          {block.summary}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  title: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  barRow: { flexDirection: "row", gap: 4, height: 80, alignItems: "flex-end" },
  barCol: { flex: 1, alignItems: "center" },
  barWrapper: { width: "100%", height: 60, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 4, minHeight: 4 },
  barLabel: { fontSize: 9, marginTop: 4 },
  summary: { fontSize: 11, marginTop: 8, textAlign: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "700" },
  statLabel: { fontSize: 10, marginTop: 2 },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
});
```

- [ ] **Step 5: Create CommitmentCard component**

```typescript
// client/components/coach/blocks/CommitmentCard.tsx
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { CommitmentCard as CommitmentCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: CommitmentCardType;
  onAccept?: (title: string, followUpDate: string) => void;
}

export default function CommitmentCard({ block, onAccept }: Props) {
  const { theme } = useTheme();
  const [accepted, setAccepted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <View style={[styles.container, { backgroundColor: theme.cardBackground, opacity: 0.5 }]}>
        <Text style={[styles.title, { color: theme.textSecondary }]}>
          {block.title}
        </Text>
        <Text style={[styles.dismissed, { color: theme.textSecondary }]}>
          Dismissed
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.cardBackground }]}
      accessibilityRole="group"
      accessibilityLabel={`Commitment: ${block.title}. ${block.followUpText}`}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.checkbox,
            accepted
              ? { backgroundColor: theme.success }
              : { borderColor: theme.link, borderWidth: 2 },
          ]}
        >
          {accepted && (
            <Text style={styles.checkmark}>{"\u2713"}</Text>
          )}
        </View>
        <Text style={[styles.title, { color: theme.text }]}>
          {block.title}
        </Text>
      </View>
      <Text style={[styles.followUp, { color: theme.textSecondary }]}>
        {block.followUpText}
      </Text>
      {!accepted && (
        <View style={styles.actions}>
          <Pressable
            style={[styles.acceptBtn, { backgroundColor: theme.link + "33" }]}
            onPress={() => {
              setAccepted(true);
              onAccept?.(block.title, block.followUpDate);
            }}
            accessibilityRole="button"
            accessibilityLabel="Accept commitment"
          >
            <Text style={[styles.acceptText, { color: theme.link }]}>
              Accept
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDismissed(true)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss commitment"
          >
            <Text style={[styles.dismissText, { color: theme.textSecondary }]}>
              Dismiss
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  checkmark: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  title: { fontSize: 14, fontWeight: "600", flex: 1 },
  followUp: { fontSize: 12, marginTop: 4, marginLeft: 28 },
  actions: { flexDirection: "row", gap: 12, marginTop: 10, marginLeft: 28 },
  acceptBtn: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 14 },
  acceptText: { fontSize: 13, fontWeight: "600" },
  dismissText: { fontSize: 13, paddingVertical: 5 },
  dismissed: { fontSize: 12, marginTop: 4, fontStyle: "italic" },
});
```

- [ ] **Step 6: Create QuickReplies component**

```typescript
// client/components/coach/blocks/QuickReplies.tsx
import React from "react";
import { ScrollView, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { QuickReplies as QuickRepliesType } from "@shared/schemas/coach-blocks";

interface Props {
  block: QuickRepliesType;
  onSelect?: (message: string) => void;
}

export default function QuickReplies({ block, onSelect }: Props) {
  const { theme } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {block.options.map((option, i) => (
        <Pressable
          key={i}
          style={[
            styles.chip,
            {
              backgroundColor: theme.link + "26",
              borderColor: theme.link + "4D",
            },
          ]}
          onPress={() => onSelect?.(option.message)}
          accessibilityRole="button"
          accessibilityLabel={option.label}
        >
          <Text style={[styles.chipText, { color: theme.link }]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  content: { gap: 8, paddingHorizontal: 2 },
  chip: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14, borderWidth: 1 },
  chipText: { fontSize: 13 },
});
```

- [ ] **Step 7: Create RecipeCard component**

```typescript
// client/components/coach/blocks/RecipeCard.tsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { RecipeCard as RecipeCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: RecipeCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function RecipeCard({ block, onAction }: Props) {
  const { theme } = useTheme();
  const { recipe } = block;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.cardBackground }]}
      accessibilityLabel={`Recipe: ${recipe.title}. ${recipe.calories} calories, ${recipe.protein}g protein, ${recipe.prepTime}`}
    >
      <View style={styles.info}>
        <Text style={[styles.title, { color: theme.text }]}>
          {recipe.title}
        </Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>
          {recipe.calories} cal {"\u00B7"} {recipe.protein}g protein{" "}
          {"\u00B7"} {recipe.prepTime}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.link }]}
          onPress={() =>
            onAction?.({
              type: "navigate",
              screen: "RecipeDetail",
              params: {
                recipeId: recipe.recipeId,
                source: recipe.source,
              },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="View recipe"
        >
          <Text style={styles.primaryBtnText}>View</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            onAction?.({
              type: "navigate",
              screen: "MealPlanPicker",
              params: { recipeId: recipe.recipeId },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Add to meal plan"
        >
          <Text style={[styles.secondaryText, { color: theme.link }]}>
            Add to Plan
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  info: { marginBottom: 8 },
  title: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  primaryBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  secondaryText: { fontSize: 13 },
});
```

- [ ] **Step 8: Create MealPlanCard component**

```typescript
// client/components/coach/blocks/MealPlanCard.tsx
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { MealPlanCard as MealPlanCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: MealPlanCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function MealPlanCard({ block, onAction }: Props) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.cardBackground }]}
      accessibilityRole="group"
      accessibilityLabel={`Meal plan: ${block.title}`}
    >
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse meal plan" : "Expand meal plan"}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {block.title}
        </Text>
        <Text style={{ color: theme.textSecondary }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </Text>
      </Pressable>

      {expanded &&
        block.days.map((day, di) => (
          <View key={di} style={styles.day}>
            <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>
              {day.label}
            </Text>
            {day.meals.map((meal, mi) => (
              <View key={mi} style={styles.meal}>
                <Text style={[styles.mealType, { color: theme.textSecondary }]}>
                  {meal.type}
                </Text>
                <Text style={[styles.mealTitle, { color: theme.text }]}>
                  {meal.title}
                </Text>
                <Text style={[styles.mealMeta, { color: theme.textSecondary }]}>
                  {meal.calories} cal {"\u00B7"} {meal.protein}g P
                </Text>
              </View>
            ))}
            <View
              style={[styles.totals, { borderTopColor: theme.border }]}
            >
              <Text style={[styles.totalsText, { color: theme.text }]}>
                Total: {day.totals.calories} cal {"\u00B7"}{" "}
                {day.totals.protein}g protein
              </Text>
            </View>
          </View>
        ))}

      {expanded && (
        <Pressable
          style={[styles.addBtn, { backgroundColor: theme.link }]}
          onPress={() =>
            onAction?.({ type: "add_meal_plan", plan: block.days })
          }
          accessibilityRole="button"
          accessibilityLabel="Add to meal plan"
        >
          <Text style={styles.addBtnText}>Add to Meal Plan</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, marginTop: 8, overflow: "hidden" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
  },
  title: { fontSize: 14, fontWeight: "600" },
  day: { paddingHorizontal: 12, paddingBottom: 8 },
  dayLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  meal: { paddingVertical: 4 },
  mealType: { fontSize: 10, textTransform: "capitalize" },
  mealTitle: { fontSize: 13, fontWeight: "500" },
  mealMeta: { fontSize: 11 },
  totals: { borderTopWidth: 1, paddingTop: 6, marginTop: 4 },
  totalsText: { fontSize: 12, fontWeight: "600" },
  addBtn: { margin: 12, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  addBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
});
```

- [ ] **Step 9: Run lint on all block components**

Run: `npm run lint -- --no-error-on-unmatched-pattern "client/components/coach/blocks/**"`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add client/components/coach/blocks/
git commit -m "feat(components): add 7 coach block renderer components"
```

---

## Task 14: Client — Coach Dashboard Component

**Files:**

- Create: `client/components/coach/CoachDashboard.tsx`

- [ ] **Step 1: Create the collapsible dashboard**

```typescript
// client/components/coach/CoachDashboard.tsx
import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import type { CoachContextData } from "@/hooks/useCoachContext";

interface Props {
  context: CoachContextData;
  onSuggestionPress: (text: string) => void;
}

export default function CoachDashboard({ context, onSuggestionPress }: Props) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const expandedHeight = useSharedValue(1);

  const toggleExpanded = () => {
    expandedHeight.value = withTiming(expanded ? 0 : 1, { duration: 250 });
    setExpanded(!expanded);
  };

  const expandedStyle = useAnimatedStyle(() => ({
    maxHeight: expandedHeight.value * 300,
    opacity: expandedHeight.value,
  }));

  const { goals, todayIntake, notebook, dueCommitments, suggestions } = context;

  const proteinStreak = notebook
    .filter((e) => e.type === "insight" && e.content.toLowerCase().includes("protein"))
    .length;

  return (
    <View style={[styles.container, { backgroundColor: theme.cardBackground }]}>
      {/* Compact header — always visible */}
      <Pressable onPress={toggleExpanded} style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: theme.text }]}>
            {getGreeting()}
          </Text>
          {!expanded && (
            <Text style={[styles.miniSummary, { color: theme.textSecondary }]}>
              {todayIntake
                ? `${todayIntake.totalCalories} cal today`
                : "No meals logged yet"}
            </Text>
          )}
        </View>
        <Text style={{ color: theme.link, fontSize: 12 }}>
          {expanded ? "Less \u25B4" : "See all \u25BE"}
        </Text>
      </Pressable>

      {/* Stat cards — always visible */}
      <View style={styles.statRow}>
        <View style={[styles.stat, { backgroundColor: theme.background }]}>
          <Text style={[styles.statValue, { color: theme.link }]}>
            {todayIntake?.totalCalories ?? 0}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
            Calories
          </Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.background }]}>
          <Text style={[styles.statValue, { color: theme.success }]}>
            {todayIntake?.totalProtein ?? 0}g
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
            Protein
          </Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.background }]}>
          <Text style={[styles.statValue, { color: theme.warning }]}>
            {goals ? goals.calories - (todayIntake?.totalCalories ?? 0) : "—"}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
            Remaining
          </Text>
        </View>
      </View>

      {/* Expanded section — commitments + insights */}
      <Animated.View style={[styles.expandedSection, expandedStyle]}>
        {dueCommitments.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Commitments
            </Text>
            {dueCommitments.map((c) => (
              <View key={c.id} style={styles.commitmentRow}>
                <View style={[styles.commitDot, { borderColor: theme.link }]} />
                <Text style={[styles.commitText, { color: theme.text }]}>
                  {c.content}
                </Text>
              </View>
            ))}
          </View>
        )}
        {notebook
          .filter((e) => e.type === "insight")
          .slice(0, 2)
          .map((insight) => (
            <Pressable
              key={insight.id}
              style={styles.insightRow}
              onPress={() => onSuggestionPress(insight.content)}
              accessibilityRole="button"
              accessibilityLabel={`Discuss: ${insight.content}`}
            >
              <Text style={[styles.insightText, { color: theme.text }]}>
                {insight.content}
              </Text>
              <Text style={{ color: theme.link, fontSize: 11 }}>
                {"Discuss \u2192"}
              </Text>
            </Pressable>
          ))}
      </Animated.View>

      {/* Suggestion chips */}
      {suggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          {suggestions.map((s, i) => (
            <Pressable
              key={i}
              style={[styles.chip, { backgroundColor: theme.background }]}
              onPress={() => onSuggestionPress(s)}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, { color: theme.link }]}>
                {s}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning \uD83D\uDC4B";
  if (hour < 17) return "Good afternoon \uD83D\uDC4B";
  return "Good evening \uD83D\uDC4B";
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, margin: 16, marginBottom: 8, overflow: "hidden" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    paddingBottom: 8,
  },
  greeting: { fontSize: 16, fontWeight: "600" },
  miniSummary: { fontSize: 12, marginTop: 2 },
  statRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  stat: { flex: 1, borderRadius: 10, padding: 8, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700" },
  statLabel: { fontSize: 10, marginTop: 2 },
  expandedSection: { overflow: "hidden", paddingHorizontal: 14 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  commitmentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  commitDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 2 },
  commitText: { fontSize: 13, flex: 1 },
  insightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  insightText: { fontSize: 13, flex: 1, marginRight: 8 },
  chips: { paddingBottom: 12 },
  chipsContent: { paddingHorizontal: 14, gap: 8 },
  chip: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipText: { fontSize: 13 },
});
```

- [ ] **Step 2: Commit**

```bash
git add client/components/coach/CoachDashboard.tsx
git commit -m "feat(components): add collapsible CoachDashboard component"
```

---

## Task 15: Client — CoachMicButton Component

**Files:**

- Create: `client/components/coach/CoachMicButton.tsx`

- [ ] **Step 1: Create the mic button**

```typescript
// client/components/coach/CoachMicButton.tsx
import React from "react";
import { Pressable, StyleSheet, AccessibilityInfo, Platform } from "react-native";
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useSharedValue,
  cancelAnimation,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { volumeToScale } from "@/lib/volume-scale";
import { Ionicons } from "@expo/vector-icons";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface Props {
  isListening: boolean;
  volume: number;
  onPress: () => void;
}

export default function CoachMicButton({
  isListening,
  volume,
  onPress,
}: Props) {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();

  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (isListening && !reducedMotion) {
      scale.value = 1 + volumeToScale(volume, 0.3);
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
    }
  }, [isListening, volume, reducedMotion, scale]);

  React.useEffect(() => {
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        isListening ? "Listening" : "Stopped listening",
      );
    }
  }, [isListening]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        style={[
          styles.button,
          {
            backgroundColor: isListening ? theme.error : theme.link,
          },
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={isListening ? "Stop listening" : "Voice input"}
        accessibilityState={{ selected: isListening }}
      >
        <Ionicons
          name={isListening ? "stop" : "mic"}
          size={18}
          color="#FFFFFF"
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add client/components/coach/CoachMicButton.tsx
git commit -m "feat(components): add CoachMicButton with volume-reactive animation"
```

---

## Task 16: Client — CoachChat Component

**Files:**

- Create: `client/components/coach/CoachChat.tsx`

This component manages the chat area with rich block rendering, optimistic messages, and streaming.

- [ ] **Step 1: Create the rich chat component**

This component should:

- Display messages with `ChatBubble` for text content
- Render blocks below assistant messages using `BlockRenderer`
- Show optimistic user messages immediately
- Handle quick reply chip taps (send as new message)
- Handle commitment card accepts (save to notebook via API)
- Handle action card taps (navigate, log food, etc.)
- Include the input bar with text field + mic button
- Support the STT flow via `useSpeechToText` and `useCoachWarmUp`

The component is large — implement it following the patterns in `CoachOverlayContent.tsx` but with:

1. Block rendering via `BlockRenderer` after each assistant message
2. Optimistic messages in local state before SSE confirmation
3. Mic button integration with warm-up hook
4. Quick reply handler that sends the message text

Key interfaces:

```typescript
interface CoachChatProps {
  conversationId: number | null;
  onCreateConversation: () => Promise<number>;
  isCoachPro: boolean;
  warmUpHook: ReturnType<typeof useCoachWarmUp>;
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint -- --no-error-on-unmatched-pattern client/components/coach/CoachChat.tsx`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/components/coach/CoachChat.tsx
git commit -m "feat(components): add CoachChat with rich block rendering and voice input"
```

---

## Task 17: Client — CoachProScreen + Navigation

**Files:**

- Create: `client/screens/CoachProScreen.tsx`
- Modify: `client/navigation/ChatStackNavigator.tsx`

- [ ] **Step 1: Create the CoachProScreen**

```typescript
// client/screens/CoachProScreen.tsx
import React, { useCallback, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useCoachContext } from "@/hooks/useCoachContext";
import { useCreateConversation } from "@/hooks/useChat";
import { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import CoachDashboard from "@/components/coach/CoachDashboard";
import CoachChat from "@/components/coach/CoachChat";

export default function CoachProScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isCoachPro = usePremiumFeature("coachPro");
  const { data: context, isLoading } = useCoachContext(isCoachPro);
  const createConversation = useCreateConversation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const warmUpHook = useCoachWarmUp(conversationId);

  const handleCreateConversation = useCallback(async () => {
    const result = await createConversation.mutateAsync({
      type: "coach",
    });
    setConversationId(result.id);
    return result.id;
  }, [createConversation]);

  const handleSuggestionPress = useCallback(
    async (text: string) => {
      let id = conversationId;
      if (!id) {
        id = await handleCreateConversation();
      }
      // The CoachChat component handles sending the message
      // via its own internal ref
    },
    [conversationId, handleCreateConversation],
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top,
        },
      ]}
    >
      {context && (
        <CoachDashboard
          context={context}
          onSuggestionPress={handleSuggestionPress}
        />
      )}
      <CoachChat
        conversationId={conversationId}
        onCreateConversation={handleCreateConversation}
        isCoachPro={isCoachPro}
        warmUpHook={warmUpHook}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
```

- [ ] **Step 2: Update ChatStackNavigator**

In `client/navigation/ChatStackNavigator.tsx`, add the CoachProScreen and conditionally route to it based on tier:

```typescript
import CoachProScreen from "@/screens/CoachProScreen";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
```

Add the screen to the navigator:

```typescript
<Stack.Screen
  name="CoachPro"
  component={CoachProScreen}
  options={{ headerShown: false }}
/>
```

Update the initial route logic to check `coachPro` and route to `CoachPro` screen if the user has the entitlement, otherwise the existing Chat flow.

- [ ] **Step 3: Run lint**

Run: `npm run lint -- --no-error-on-unmatched-pattern client/screens/CoachProScreen.tsx`
Expected: No errors.

- [ ] **Step 4: Run full test suite**

Run: `npm run test:run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/screens/CoachProScreen.tsx client/navigation/ChatStackNavigator.tsx
git commit -m "feat(screens): add CoachProScreen and update navigation for Coach Pro tier"
```

---

## Task 18: Update useChat Hook for Blocks + Optimistic UI

**Files:**

- Modify: `client/hooks/useChat.ts`

- [ ] **Step 1: Update SSE parsing to handle blocks**

In the SSE streaming code within `useChat.ts`, update the chunk parsing to extract `blocks` from the data payload:

Current parsing:

```typescript
const data = JSON.parse(jsonStr);
// Uses data.content, data.done, data.error
```

Updated parsing:

```typescript
const data = JSON.parse(jsonStr);
// data.content — text chunk
// data.blocks — array of coach block objects (only in final chunk when done=true)
// data.done — stream complete flag
```

Add a `blocks` field to the message state that accumulates blocks from the stream.

- [ ] **Step 2: Add optimistic message support**

Add a local state array for optimistic messages that are shown immediately before the server confirms. When the SSE stream starts, the optimistic message is replaced by the real server-confirmed message.

```typescript
// Add to the hook's return type:
interface ChatState {
  // ... existing fields
  optimisticMessage: string | null;
  blocks: CoachBlock[];
}
```

- [ ] **Step 3: Run existing useChat tests**

Run: `npx vitest run client/hooks/__tests__/useChat.test.ts`
Expected: All existing tests pass (changes are additive).

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useChat.ts
git commit -m "feat(hooks): update useChat for block parsing and optimistic messages"
```

---

## Task 19: Integration Testing & Polish

**Files:**

- Run all tests
- Fix any remaining lint/type issues

- [ ] **Step 1: Run full test suite**

Run: `npm run test:run`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `npm run check:types`
Expected: No type errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors.

- [ ] **Step 4: Fix any issues found**

Address any type errors, lint warnings, or test failures. Common issues:

- Missing imports in modified files
- Type mismatches between shared schemas and component props
- Unused imports from refactored code

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: resolve lint and type issues from Coach Pro integration"
```

---

## Dependency Graph

```
Task 1 (Schema) ──┐
Task 2 (Block schemas) ──┤
Task 3 (Notebook + tool schemas) ──┤
Task 4 (Premium flag) ──┤
                        ├── Task 5 (Notebook storage) ──┐
                        │                                ├── Task 8 (Notebook extraction)
                        │                                ├── Task 9 (Context route)
                        ├── Task 6 (Coach tools) ────────┤
                        ├── Task 7 (Coach blocks) ───────┤
                        │                                └── Task 10 (Chat route update)
                        │
                        ├── Task 11 (useCoachContext hook)
                        ├── Task 12 (useCoachWarmUp hook)
                        ├── Task 13 (Block renderers) ───┐
                        ├── Task 14 (Dashboard) ─────────┤
                        ├── Task 15 (MicButton) ─────────┤
                        │                                ├── Task 16 (CoachChat) ──┐
                        │                                │                         ├── Task 17 (Screen + Nav)
                        ├── Task 18 (useChat update) ────┘                         │
                        │                                                          │
                        └──────────────────────────────────────────────────────────── Task 19 (Integration)
```

Tasks 1-4 can run in parallel (foundation). Tasks 5-10 depend on 1-4 but can be partially parallelized. Tasks 11-18 are client-side and can largely run in parallel after the shared schemas exist. Task 19 is the final integration pass.
