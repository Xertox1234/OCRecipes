# Coach Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address five targeted gaps identified in the Coach implementation review: structured tool errors, content-addressed cache versioning, warm-up expiry logging, recipe image unavailable signal, and notebook archival on conversation open.

**Architecture:** All changes are confined to `server/services/` and `server/routes/chat.ts`. No schema migrations, no client changes, no new tables. Each task is independently committable.

**Tech Stack:** TypeScript, Express, Vitest, Drizzle ORM, OpenAI SDK

---

## File Map

| File                                               | Changes                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `server/services/coach-tools.ts`                   | Add `ToolErrorResult` type + helper fns; update all error returns                                             |
| `server/services/nutrition-coach.ts`               | Accept optional `now: Date` in `buildSystemPrompt`; export `getSystemPromptTemplateVersion()`                 |
| `server/services/coach-pro-chat.ts`                | Replace `COACH_CACHE_VERSION` constant with `getSystemPromptTemplateVersion()`; export `tryArchiveNotebook()` |
| `server/services/coach-warm-up.ts`                 | Add structured logging to `consumeWarmUp`                                                                     |
| `server/services/recipe-chat.ts`                   | Add `imageUnavailable` to SSE event union; yield it on timeout                                                |
| `server/routes/chat.ts`                            | Handle `imageUnavailable` SSE event; call `tryArchiveNotebook` on GET messages                                |
| `server/services/__tests__/coach-tools.test.ts`    | Update error-shape assertions to new structured form                                                          |
| `server/services/__tests__/coach-pro-chat.test.ts` | Add idempotency test for `hashCoachCacheKey`; add `tryArchiveNotebook` test                                   |
| `server/services/__tests__/coach-warm-up.test.ts`  | **Create new** — test logging for expired/missing warm-ups                                                    |
| `server/services/__tests__/recipe-chat.test.ts`    | Add test for `imageUnavailable` event                                                                         |

---

## Task 1: Structured Tool Error Envelope

**Goal:** Replace opaque `{ error: string }` returns with a discriminated union that lets the model distinguish invalid arguments, missing data, and service failures.

**Files:**

- Modify: `server/services/coach-tools.ts` (lines 381–578)
- Modify: `server/services/nutrition-coach.ts` (lines 370–388)
- Modify: `server/services/__tests__/coach-tools.test.ts`

- [ ] **Step 1: Write failing tests for the new error shape**

Add to `server/services/__tests__/coach-tools.test.ts` (after the existing `MAX_TOOL_CALLS_PER_RESPONSE` test):

```typescript
describe("structured error returns", () => {
  it("returns INVALID_ARGS error for empty lookup_nutrition query", async () => {
    const result = await executeToolCall(
      "lookup_nutrition",
      { query: "" },
      "user1",
    );
    expect(result).toMatchObject({
      error: true,
      code: "INVALID_ARGS",
      message: expect.stringContaining("lookup_nutrition"),
    });
  });

  it("returns NOT_FOUND error when nutrition lookup returns null", async () => {
    const { lookupNutrition } = await import("../nutrition-lookup");
    vi.mocked(lookupNutrition).mockResolvedValueOnce(null);
    const result = await executeToolCall(
      "lookup_nutrition",
      { query: "imaginary food" },
      "user1",
    );
    expect(result).toMatchObject({
      error: true,
      code: "NOT_FOUND",
      message: expect.stringContaining("imaginary food"),
    });
  });

  it("returns INVALID_ARGS error for empty search_recipes query", async () => {
    const result = await executeToolCall(
      "search_recipes",
      { query: "" },
      "user1",
    );
    expect(result).toMatchObject({
      error: true,
      code: "INVALID_ARGS",
      message: expect.stringContaining("search_recipes"),
    });
  });

  it("returns INVALID_ARGS error for log_food_item with missing name", async () => {
    const result = await executeToolCall(
      "log_food_item",
      { calories: 100 },
      "user1",
    );
    expect(result).toMatchObject({
      error: true,
      code: "INVALID_ARGS",
    });
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd /Users/williamtower/projects/OCRecipes
npx vitest run server/services/__tests__/coach-tools.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 4 FAIL — `toMatchObject` fails because `result` is `{ error: "..." }` (string, not `{ error: true, code: "...", message: "..." }`).

- [ ] **Step 3: Add `ToolErrorResult` type and helper functions to `coach-tools.ts`**

After the imports block (after line 24, before line 31), insert:

```typescript
// ---------------------------------------------------------------------------
// Structured error type returned by all tool call paths.
// The `code` field lets the model distinguish arg errors from service failures.
// ---------------------------------------------------------------------------

export type ToolErrorResult = {
  error: true;
  code: "INVALID_ARGS" | "NOT_FOUND" | "SERVICE_UNAVAILABLE";
  message: string;
};

function invalidArgs(toolName: string, message: string): ToolErrorResult {
  return {
    error: true,
    code: "INVALID_ARGS",
    message: `${toolName}: ${message}`,
  };
}

function notFound(message: string): ToolErrorResult {
  return { error: true, code: "NOT_FOUND", message };
}

function serviceUnavailable(toolName: string): ToolErrorResult {
  return {
    error: true,
    code: "SERVICE_UNAVAILABLE",
    message: `${toolName} is temporarily unavailable`,
  };
}
```

- [ ] **Step 4: Update every error return in `executeToolCall` in `coach-tools.ts`**

Replace each `{ error: \`...\` }` with the appropriate helper. Full updated switch cases (replace lines 388–578):

```typescript
switch (toolName) {
  case "lookup_nutrition": {
    const parsed = lookupNutritionSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("lookup_nutrition", parsed.error.message);
    }
    const result = await lookupNutrition(parsed.data.query);
    if (!result) {
      return notFound(`No nutrition data found for "${parsed.data.query}"`);
    }
    return result;
  }

  case "search_recipes": {
    const parsed = searchRecipesSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("search_recipes", parsed.error.message);
    }
    const profile = await storage.getUserProfile(userId);
    const allergyNames = (
      (profile?.allergies as { name: string }[] | null) ?? []
    )
      .map((a) => a?.name)
      .filter(Boolean);
    const result = await searchCatalogRecipes({
      query: parsed.data.query,
      diet: parsed.data.diet,
      cuisine: parsed.data.cuisine,
      maxReadyTime: parsed.data.maxReadyTime,
      intolerances:
        allergyNames.length > 0 ? allergyNames.join(",") : undefined,
      number: 5,
    });
    return { results: result.results };
  }

  case "get_daily_log_details": {
    const parsed = getDailyLogDetailsSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("get_daily_log_details", parsed.error.message);
    }
    const date = parsed.data.date ? new Date(parsed.data.date) : new Date();
    const [logs, totals] = await Promise.all([
      storage.getDailyLogs(userId, date),
      storage.getDailySummary(userId, date),
    ]);
    return {
      date: date.toISOString().split("T")[0],
      items: logs,
      totals,
    };
  }

  case "log_food_item": {
    const parsed = logFoodItemSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("log_food_item", parsed.error.message);
    }
    return {
      proposal: true,
      action: "log_food",
      description: parsed.data.name,
      calories: parsed.data.calories,
      protein: parsed.data.protein ?? 0,
      carbs: parsed.data.carbs ?? 0,
      fat: parsed.data.fat ?? 0,
      servingSize: parsed.data.servingSize,
      message:
        "I've prepared this to log. Please confirm by tapping 'Log it' below.",
    };
  }

  case "get_pantry_items": {
    const parsed = getPantryItemsSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("get_pantry_items", parsed.error.message);
    }
    const { expiringWithinDays } = parsed.data;
    if (expiringWithinDays !== undefined) {
      const items = await storage.getExpiringPantryItems(
        userId,
        expiringWithinDays,
      );
      return { items, expiringWithinDays };
    }
    const items = await storage.getPantryItems(userId);
    return { items };
  }

  case "get_meal_plan": {
    const parsed = getMealPlanSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("get_meal_plan", parsed.error.message);
    }
    const today = new Date().toISOString().split("T")[0];
    const startDate = parsed.data.startDate ?? today;
    const defaultEnd = new Date(
      new Date(startDate).getTime() + 6 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split("T")[0];
    const endDate = parsed.data.endDate ?? defaultEnd;
    const items = await storage.getMealPlanItems(userId, startDate, endDate);
    return { startDate, endDate, items };
  }

  case "add_to_meal_plan": {
    const parsed = addToMealPlanSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("add_to_meal_plan", parsed.error.message);
    }
    return {
      proposal: true,
      action: "add_meal_plan",
      plannedDate:
        parsed.data.plannedDate ?? new Date().toISOString().split("T")[0],
      mealType: parsed.data.mealType ?? "lunch",
      notes: parsed.data.notes,
      message: "I've prepared this meal plan addition. Please confirm below.",
    };
  }

  case "add_to_grocery_list": {
    const parsed = addToGroceryListSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("add_to_grocery_list", parsed.error.message);
    }
    return {
      proposal: true,
      action: "add_grocery_list",
      listName: parsed.data.listName ?? "Coach Grocery List",
      items: (parsed.data.items ?? []).map((i) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
      })),
      message:
        "Here are the items I'd add to your grocery list. Please confirm below.",
    };
  }

  case "get_substitutions": {
    const parsed = getSubstitutionsSchema.safeParse(args);
    if (!parsed.success) {
      return invalidArgs("get_substitutions", parsed.error.message);
    }
    const { getSubstitutions } = await import("./ingredient-substitution");
    const rawIngredients = parsed.data.ingredients ?? [];
    const ingredients = rawIngredients.map((item, index) => ({
      id: String(index + 1),
      name: item.name,
      quantity: 1,
      unit: item.unit ?? "",
      confidence: 1,
      category: "other" as const,
      photoId: "",
      userEdited: false,
    }));
    const result = await getSubstitutions(ingredients, null);
    return result;
  }

  default:
    throw new Error(`Unknown tool: ${toolName}`);
}
```

- [ ] **Step 5: Update the catch block in `nutrition-coach.ts` (lines 370–388)**

In `generateCoachProResponse`, replace the catch block inside `Promise.all(toolCallsArray.map(...))`:

```typescript
const toolResults = await Promise.all(
  toolCallsArray.map(async (tc) => {
    try {
      const args = JSON.parse(tc.function.arguments);
      const result = await executeToolCall(tc.function.name, args, userId);
      return { tc, result };
    } catch (error) {
      log.warn(
        { err: toError(error), tool: tc.function.name },
        "Tool call failed",
      );
      return {
        tc,
        result: {
          error: true,
          code: "SERVICE_UNAVAILABLE",
          message: `${tc.function.name} is temporarily unavailable`,
        },
      };
    }
  }),
);
```

Also add `ToolErrorResult` to the import from `./coach-tools` in `nutrition-coach.ts`:

```typescript
import {
  getToolDefinitions,
  executeToolCall,
  MAX_TOOL_CALLS_PER_RESPONSE,
  type ToolErrorResult,
} from "./coach-tools";
```

(The `ToolErrorResult` import is for type clarity — remove it if TypeScript inference is sufficient without the explicit type annotation.)

- [ ] **Step 6: Run tests**

```bash
npx vitest run server/services/__tests__/coach-tools.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All PASS. Any existing tests that asserted `{ error: "..." }` string shape will need to be updated to `{ error: true, code: expect.any(String), message: expect.any(String) }`. Check the test output and update any failing assertions.

- [ ] **Step 7: Run full test suite to confirm no regressions**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/services/coach-tools.ts server/services/nutrition-coach.ts server/services/__tests__/coach-tools.test.ts
git commit -m "$(cat <<'EOF'
feat: structured tool error envelope for coach tool calls

Replace opaque { error: string } returns with { error: true, code, message }
so the model can distinguish INVALID_ARGS / NOT_FOUND / SERVICE_UNAVAILABLE
rather than pattern-matching error strings.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Content-Addressed Cache Version

**Goal:** Replace the manual `COACH_CACHE_VERSION` string (currently `"v2-2026-04-18"`) with a hash derived from the static system prompt template, so cache invalidation is automatic when prompt prose changes.

**Files:**

- Modify: `server/services/nutrition-coach.ts` (add `now` param to `buildSystemPrompt` at line 40; export `getSystemPromptTemplateVersion`)
- Modify: `server/services/coach-pro-chat.ts` (replace `COACH_CACHE_VERSION` at line 74, update `hashCoachCacheKey` at line 99)
- Modify: `server/services/__tests__/coach-pro-chat.test.ts`

- [ ] **Step 1: Write a failing test for idempotent `hashCoachCacheKey`**

Add to `server/services/__tests__/coach-pro-chat.test.ts` (in the `hashCoachCacheKey` describe block if one exists, or as a new describe block):

```typescript
describe("hashCoachCacheKey (content-addressed version)", () => {
  it("returns the same hash for identical inputs across calls", () => {
    const hash1 = hashCoachCacheKey(
      "user1",
      "what should I eat?",
      false,
      "2026-04-19",
    );
    const hash2 = hashCoachCacheKey(
      "user1",
      "what should I eat?",
      false,
      "2026-04-19",
    );
    expect(hash1).toBe(hash2);
  });

  it("differs for different users", () => {
    const hash1 = hashCoachCacheKey(
      "user1",
      "what should I eat?",
      false,
      "2026-04-19",
    );
    const hash2 = hashCoachCacheKey(
      "user2",
      "what should I eat?",
      false,
      "2026-04-19",
    );
    expect(hash1).not.toBe(hash2);
  });

  it("differs for pro vs non-pro", () => {
    const hash1 = hashCoachCacheKey(
      "user1",
      "what should I eat?",
      false,
      "2026-04-19",
    );
    const hash2 = hashCoachCacheKey(
      "user1",
      "what should I eat?",
      true,
      "2026-04-19",
    );
    expect(hash1).not.toBe(hash2);
  });

  it("returns a 32-char hex string", () => {
    const hash = hashCoachCacheKey("user1", "test", false, "2026-04-19");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
```

These tests should PASS even before the implementation change, since they only test the interface contract. Run them now to confirm:

```bash
npx vitest run server/services/__tests__/coach-pro-chat.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All PASS (these tests don't depend on the version string specifically). If they fail, investigate before continuing.

- [ ] **Step 2: Make `buildSystemPrompt` accept an optional `now` parameter in `nutrition-coach.ts`**

Change line 40 from:

```typescript
function buildSystemPrompt(context: CoachContext): string {
```

to:

```typescript
function buildSystemPrompt(context: CoachContext, now: Date = new Date()): string {
```

Then update the two lines inside `buildSystemPrompt` that use `new Date()` (currently lines 123–124):

```typescript
// Before:
const now = new Date();
const hours = now.getHours();

// After (remove the now = new Date() line, just use the parameter):
const hours = now.getHours();
```

- [ ] **Step 3: Export `getSystemPromptTemplateVersion()` from `nutrition-coach.ts`**

Add after the `buildSystemPrompt` function definition (after line 153), and add `import { createHash } from "crypto";` at the top of `nutrition-coach.ts` (line 1, before existing imports):

```typescript
import { createHash } from "crypto";
```

Then after the `buildSystemPrompt` function:

```typescript
/** Fixed reference time — used to make the template hash deterministic. */
const TEMPLATE_REFERENCE_TIME = new Date(0);

let _systemPromptTemplateVersion: string | undefined;

/**
 * Returns a stable hex hash of the static system prompt template.
 * Memoized for the process lifetime — automatically changes when the
 * prompt prose is edited, eliminating the manual COACH_CACHE_VERSION bump.
 */
export function getSystemPromptTemplateVersion(): string {
  if (_systemPromptTemplateVersion) return _systemPromptTemplateVersion;
  const emptyContext: CoachContext = {
    goals: null,
    todayIntake: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    weightTrend: { currentWeight: null, weeklyRate: null },
    dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
  };
  _systemPromptTemplateVersion = createHash("sha256")
    .update(buildSystemPrompt(emptyContext, TEMPLATE_REFERENCE_TIME))
    .digest("hex")
    .slice(0, 16);
  return _systemPromptTemplateVersion;
}
```

- [ ] **Step 4: Replace `COACH_CACHE_VERSION` in `coach-pro-chat.ts`**

First, add `getSystemPromptTemplateVersion` to the import from `./nutrition-coach` at line 23:

```typescript
import {
  generateCoachResponse,
  generateCoachProResponse,
  getSystemPromptTemplateVersion,
  type CoachContext,
} from "./nutrition-coach";
```

Then delete the `COACH_CACHE_VERSION` constant (lines 69–74):

```typescript
// DELETE THIS:
const COACH_CACHE_VERSION = "v2-2026-04-18";
```

Then update `hashCoachCacheKey` (lines 97–109) to replace `COACH_CACHE_VERSION` with `getSystemPromptTemplateVersion()`:

```typescript
export function hashCoachCacheKey(
  userId: string,
  content: string,
  isCoachPro: boolean,
  dayBucket: string = getUtcDayBucket(),
): string {
  return createHash("sha256")
    .update(
      [
        getSystemPromptTemplateVersion(),
        userId,
        isCoachPro ? "pro" : "free",
        dayBucket,
        content.trim().toLowerCase(),
      ].join("\u001f"),
    )
    .digest("hex")
    .slice(0, 32);
}
```

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: All tests pass. TypeScript compile (`npm run check:types`) should also be clean.

```bash
npm run check:types 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add server/services/nutrition-coach.ts server/services/coach-pro-chat.ts server/services/__tests__/coach-pro-chat.test.ts
git commit -m "$(cat <<'EOF'
feat: content-address coach cache version from system prompt template

Replace manual COACH_CACHE_VERSION string with a hash of the static prompt
template so cache invalidation is automatic when prompt prose changes.
Adds optional `now` param to buildSystemPrompt for deterministic hashing.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Warm-Up Expiry Logging

**Goal:** Distinguish "warm-up expired" from "warm-up never set" in server logs so the 5-minute TTL can be tuned from real data.

**Files:**

- Modify: `server/services/coach-warm-up.ts`
- Create: `server/services/__tests__/coach-warm-up.test.ts`

- [ ] **Step 1: Write the test file**

Create `server/services/__tests__/coach-warm-up.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setWarmUp, consumeWarmUp, WARM_UP_TTL_MS } from "../coach-warm-up";

vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// The warm-up store is module-level state — reset between tests by
// consuming any leftover entries.

describe("consumeWarmUp", () => {
  const MESSAGES = [{ role: "user" as const, content: "hello" }];

  beforeEach(() => {
    // Consume any stale entry
    consumeWarmUp("user1", 1, "stale");
  });

  it("returns messages when warm-up exists and id matches", () => {
    setWarmUp("user1", 1, "wuid-1", MESSAGES);
    const result = consumeWarmUp("user1", 1, "wuid-1");
    expect(result).toEqual(MESSAGES);
  });

  it("returns null when no warm-up exists for the key", () => {
    const result = consumeWarmUp("user1", 999, "wuid-x");
    expect(result).toBeNull();
  });

  it("returns null when warm-up id does not match", () => {
    setWarmUp("user1", 1, "wuid-correct", MESSAGES);
    const result = consumeWarmUp("user1", 1, "wuid-wrong");
    expect(result).toBeNull();
  });

  it("returns null when warm-up has expired", () => {
    vi.useFakeTimers();
    setWarmUp("user1", 1, "wuid-2", MESSAGES);
    // Advance past TTL
    vi.advanceTimersByTime(WARM_UP_TTL_MS + 1);
    const result = consumeWarmUp("user1", 1, "wuid-2");
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("is destructive — second consume returns null", () => {
    setWarmUp("user1", 1, "wuid-3", MESSAGES);
    const first = consumeWarmUp("user1", 1, "wuid-3");
    const second = consumeWarmUp("user1", 1, "wuid-3");
    expect(first).toEqual(MESSAGES);
    expect(second).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass with current code**

```bash
npx vitest run server/services/__tests__/coach-warm-up.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All PASS. (This step verifies the tests describe existing correct behavior before we add logging.)

- [ ] **Step 3: Add structured logging to `consumeWarmUp` in `coach-warm-up.ts`**

Add `createServiceLogger` import at the top of the file (after `import crypto from "crypto";`):

```typescript
import { createServiceLogger } from "../lib/logger";

const log = createServiceLogger("coach-warm-up");
```

Then update `consumeWarmUp` with three distinct log lines:

```typescript
export function consumeWarmUp(
  userId: string,
  conversationId: number,
  warmUpId: string,
): WarmUpMessage[] | null {
  const key = cacheKey(userId, conversationId);
  const cached = warmUpStore.get(key);
  if (!cached) {
    log.debug({ userId, conversationId }, "warm_up_not_found");
    return null;
  }
  if (cached.warmUpId !== warmUpId) {
    log.debug({ userId, conversationId }, "warm_up_id_mismatch");
    return null;
  }
  if (Date.now() - cached.createdAt > WARM_UP_TTL_MS) {
    log.debug({ userId, conversationId }, "warm_up_expired");
    warmUpStore.clear(key);
    return null;
  }
  warmUpStore.clear(key);
  return cached.messages;
}
```

- [ ] **Step 4: Run tests again**

```bash
npx vitest run server/services/__tests__/coach-warm-up.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All PASS. The logger mock absorbs the `log.debug` calls.

- [ ] **Step 5: Run full test suite**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/coach-warm-up.ts server/services/__tests__/coach-warm-up.test.ts
git commit -m "$(cat <<'EOF'
feat: structured warm-up expiry logging in consumeWarmUp

Distinguish warm_up_not_found / warm_up_id_mismatch / warm_up_expired
so the 5-minute TTL can be tuned from real log data. Adds test file.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Recipe Image Unavailable Signal

**Goal:** Emit `{ imageUnavailable: true }` when image generation times out, so the client can show a placeholder instead of silent empty space.

**Files:**

- Modify: `server/services/recipe-chat.ts` (lines 29–37, 430–443)
- Modify: `server/routes/chat.ts` (lines 385–395)
- Modify: `server/services/__tests__/recipe-chat.test.ts`

- [ ] **Step 1: Write a failing test for the `imageUnavailable` event**

Add to `server/services/__tests__/recipe-chat.test.ts`:

````typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../recipe-generation", () => ({
  generateRecipeImage: vi.fn(),
}));

vi.mock("../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 30000,
  OPENAI_TIMEOUT_IMAGE_MS: 30000,
  MODEL_HEAVY: "gpt-4o",
}));

vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Note: put this AFTER existing describe blocks in the file, not inside them

describe("generateRecipeChatResponse — image events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields imageUnavailable when image generation times out", async () => {
    const { generateRecipeChatResponse } = await import("../recipe-chat");
    const { generateRecipeImage } = await import("../recipe-generation");
    const { openai } = await import("../lib/openai");

    // Simulate a recipe in the streamed response
    const recipeJson = JSON.stringify({
      title: "Test Recipe",
      description: "A test.",
      difficulty: "Easy",
      timeEstimate: "10 min",
      servings: 2,
      ingredients: [{ name: "egg", quantity: "2", unit: "pcs" }],
      instructions: ["Boil the egg"],
      dietTags: [],
    });

    const fakeChunks = [
      {
        choices: [
          {
            delta: { content: "Here you go!\n\n```json\n" },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ delta: { content: recipeJson }, finish_reason: null }] },
      { choices: [{ delta: { content: "\n```" }, finish_reason: "stop" }] },
    ];

    vi.mocked(openai.chat.completions.create).mockResolvedValueOnce(
      (async function* () {
        for (const c of fakeChunks) yield c;
      })() as any,
    );

    // Image generation never resolves within 15s — simulate with a never-resolving promise
    vi.mocked(generateRecipeImage).mockImplementation(
      () => new Promise(() => {}),
    );

    // Use fake timers to fast-forward past the 15s image timeout
    vi.useFakeTimers();
    const gen = generateRecipeChatResponse(
      [{ role: "user", content: "make me a recipe" }],
      null,
    );

    const events: unknown[] = [];
    const collectionPromise = (async () => {
      for await (const event of gen) {
        events.push(event);
      }
    })();

    // Fast-forward 16 seconds to trigger image timeout
    await vi.runAllTimersAsync();
    await collectionPromise;
    vi.useRealTimers();

    const imageUnavailableEvent = events.find(
      (e) => typeof e === "object" && e !== null && "imageUnavailable" in e,
    );
    expect(imageUnavailableEvent).toEqual({
      content: "",
      imageUnavailable: true,
    });
  });
});
````

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run server/services/__tests__/recipe-chat.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — `imageUnavailable` event is never emitted (currently `generateRecipeChatResponse` yields nothing on timeout).

- [ ] **Step 3: Add `imageUnavailable` to the `RecipeChatSSEEvent` union in `recipe-chat.ts`**

Update lines 29–38 in `recipe-chat.ts`:

```typescript
export type RecipeChatSSEEvent =
  | { content: string }
  | {
      content: "";
      recipe: RecipeChatRecipe;
      allergenWarning: string | null;
      messageId?: number;
    }
  | { content: ""; imageUrl: string; messageId?: number }
  | { content: ""; imageUnavailable: true }
  | { done: true };
```

- [ ] **Step 4: Yield `imageUnavailable` on timeout in `generateRecipeChatResponse`**

Replace lines 429–443 in `recipe-chat.ts`:

```typescript
    // Await image generation with timeout — yield appropriate event before done
    try {
      const imageUrl = await Promise.race([
        generateRecipeImage(
          recipe.title,
          recipe.ingredients.map((i) => i.name).join(", "),
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (imageUrl) {
        yield { content: "", imageUrl };
      } else {
        yield { content: "", imageUnavailable: true as const };
      }
    } catch (error) {
      log.warn({ err: toError(error) }, "recipe image generation failed");
      yield { content: "", imageUnavailable: true as const };
    }
```

- [ ] **Step 5: Handle `imageUnavailable` in the route handler in `chat.ts`**

In `server/routes/chat.ts`, update the recipe event loop (around lines 385–395). After the existing `imageUrl` handler, add:

```typescript
              } else if ("imageUnavailable" in event && event.imageUnavailable) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
```

The full block in context (replacing the current if/else chain):

```typescript
if ("done" in event && event.done) {
  // Terminal event — handled after loop
} else if ("recipe" in event && event.recipe) {
  recipeData = event.recipe;
  allergenWarning = event.allergenWarning;
  res.write(`data: ${eventJson}\n\n`);
} else if ("imageUrl" in event && event.imageUrl) {
  recipeImageUrl = event.imageUrl;
  res.write(`data: ${eventJson}\n\n`);
} else if ("imageUnavailable" in event && event.imageUnavailable) {
  res.write(`data: ${eventJson}\n\n`);
} else if ("content" in event && event.content) {
  fullTextResponse += event.content;
  res.write(`data: ${eventJson}\n\n`);
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run server/services/__tests__/recipe-chat.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All PASS.

- [ ] **Step 7: Type-check**

```bash
npm run check:types 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 8: Run full test suite**

```bash
npm run test:run 2>&1 | tail -20
```

- [ ] **Step 9: Commit**

```bash
git add server/services/recipe-chat.ts server/routes/chat.ts server/services/__tests__/recipe-chat.test.ts
git commit -m "$(cat <<'EOF'
feat: emit imageUnavailable SSE event when recipe image generation times out

Previously the 15s image timeout silently emitted nothing, leaving the
client unable to distinguish pending vs unavailable. Now yields
{ imageUnavailable: true } so the client can render a placeholder.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Notebook Archival on Conversation Open

**Goal:** Ensure stale notebook entries (>30 days) are archived before a user's first message after a long absence, not after it.

**Context:** Currently `archiveOldEntries` only fires inside the `POST /messages` handler (after a response is generated). A user absent for >30 days will get stale notebook entries injected into their first Coach Pro response before archival runs. Triggering archival when the user opens a conversation (GET messages) fixes this.

**Files:**

- Modify: `server/services/coach-pro-chat.ts` (export `tryArchiveNotebook`)
- Modify: `server/routes/chat.ts` (call `tryArchiveNotebook` in GET messages handler)
- Modify: `server/services/__tests__/coach-pro-chat.test.ts`

- [ ] **Step 1: Write a failing test for `tryArchiveNotebook`**

Add to `server/services/__tests__/coach-pro-chat.test.ts` (after existing imports and mocks are set up):

```typescript
describe("tryArchiveNotebook", () => {
  it("calls archiveOldEntries when throttle allows", async () => {
    const { tryArchiveNotebook } = await import("../coach-pro-chat");
    // Clear the in-memory throttle state for this user
    coachProInternals.lastArchivedAt.delete("user-archive-test");

    await tryArchiveNotebook("user-archive-test");

    expect(storage.archiveOldEntries).toHaveBeenCalledWith(
      "user-archive-test",
      30,
    );
  });

  it("does not call archiveOldEntries when throttle blocks", async () => {
    const { tryArchiveNotebook } = await import("../coach-pro-chat");
    // Set last archived to now so throttle blocks
    coachProInternals.lastArchivedAt.set("user-throttled", Date.now());

    vi.mocked(storage.archiveOldEntries).mockClear();
    await tryArchiveNotebook("user-throttled");

    expect(storage.archiveOldEntries).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run server/services/__tests__/coach-pro-chat.test.ts --reporter=verbose -t "tryArchiveNotebook" 2>&1 | tail -30
```

Expected: FAIL — `tryArchiveNotebook` is not exported from `coach-pro-chat`.

- [ ] **Step 3: Export `tryArchiveNotebook` from `coach-pro-chat.ts`**

Add after the `_testInternals` export (after line 191) in `coach-pro-chat.ts`:

```typescript
/**
 * Run notebook archival for a user if the per-user throttle allows it.
 * Safe to call from any frequent handler — the in-memory throttle gates
 * it to once per 24h per user.
 */
export async function tryArchiveNotebook(userId: string): Promise<void> {
  if (!shouldRunArchive(userId, Date.now())) return;
  await storage.archiveOldEntries(userId, 30);
}
```

- [ ] **Step 4: Run test again to confirm it passes**

```bash
npx vitest run server/services/__tests__/coach-pro-chat.test.ts --reporter=verbose -t "tryArchiveNotebook" 2>&1 | tail -30
```

Expected: Both PASS.

- [ ] **Step 5: Wire `tryArchiveNotebook` into the GET messages route in `chat.ts`**

Add `tryArchiveNotebook` to the existing import from `../services/coach-pro-chat` at line 25 of `chat.ts`:

```typescript
import {
  handleCoachChat,
  tryArchiveNotebook,
} from "../services/coach-pro-chat";
```

Then in the GET messages handler (after `const messages = await storage.getChatMessages(id, 100);` at line 188), add the archival call:

```typescript
const messages = await storage.getChatMessages(id, 100);
fireAndForget("coach-notebook-archival", tryArchiveNotebook(req.userId));
res.json(messages);
```

The `fireAndForget` import is already present in `chat.ts` (line 14).

- [ ] **Step 6: Run full test suite**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 7: Type-check**

```bash
npm run check:types 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add server/services/coach-pro-chat.ts server/routes/chat.ts server/services/__tests__/coach-pro-chat.test.ts
git commit -m "$(cat <<'EOF'
feat: trigger notebook archival when user opens a conversation

Previously archival only ran after a message was sent, meaning a user
returning after 30+ days could get stale notebook entries in their first
Pro response. Now fires (throttled to 1x/day) on GET messages so entries
are archived before the next request.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Deferred: Conversation History Window

The fixed 20-message history window for Coach Pro could become a problem as tool-call payloads grow (full daily logs, recipe ingredient lists). This is **not implemented in this plan** — monitor context window errors in production logs and address when `finish_reason: "length"` appears. The fix at that point would be token-budget-aware truncation in `handleCoachChat`, pruning older tool result messages first.

---

## Self-Review Checklist

**Spec coverage:**

- [x] Task 1 — Structured tool error envelope (Medium priority)
- [x] Task 2 — Content-addressed cache invalidation (Low priority)
- [x] Task 3 — Warm-up expiry logging (Low priority)
- [x] Task 4 — Recipe image timeout signal (Low priority)
- [x] Task 5 — Notebook archival drift fix (Cosmetic)
- [x] Deferred history window noted

**Placeholder scan:** No TBD, TODO, or "similar to above" phrases. Every step has complete code.

**Type consistency:** `ToolErrorResult` defined in Task 1 and referenced in Task 1 only. `getSystemPromptTemplateVersion` exported in Task 2 and imported in Task 2. `tryArchiveNotebook` exported in Task 5 and imported in Task 5. No cross-task type conflicts.
