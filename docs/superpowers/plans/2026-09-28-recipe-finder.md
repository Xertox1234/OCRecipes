# Recipe Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recipe request in Coach Pro or RecipeChef first offers close community recipes, then Spoonacular, then generation, with one short clarifying round, entirely inside the chat — and Spoonacular results (in Recipe Browser, Coach's recipe card and the finder) open a real preview with Save.

**Architecture:** A server-owned flow (`server/services/recipe-finder/`) of small step functions plus a pure transition function decides every step from the latest stored finder block; the chat send route and `handleCoachChat` branch into it before any generation-quota accounting. Finder messages persist a structured block (`recipe_results` / `recipe_questions`) plus a self-sufficient plain-text `content`, and both chats render the block with one shared client component. Everything new on the server is behind `RECIPE_FINDER_ENABLED` (default off); the Spoonacular preview fix (PR A) ships first and unflagged.

**Tech Stack:** Express + Drizzle/PostgreSQL (jsonb metadata, advisory-locked transactions), OpenAI JSON mode (`MODEL_FAST`), MiniSearch, Spoonacular, Expo/React Native, TanStack Query, Zod, Vitest (+ jsdom, supertest, real-DB storage harness), Maestro.

**Spec:** `docs/superpowers/specs/2026-09-28-recipe-finder-design.md` (decisions D1–D11 and §9 resolutions R1–R6 are binding).

---

## Global Constraints

- Feature flag: `RECIPE_FINDER_ENABLED`, read at request time as `process.env.RECIPE_FINDER_ENABLED === "true"`; **default off** — with it unset, every server path behaves exactly as today.
- Spoonacular list searches are capped at **10 per user per day**, as a changeable server setting (`RECIPE_FINDER_SPOONACULAR_DAILY_CAP`, default `10`); the count is **stored in the database**, never in memory.
- **At most 1 clarifying round** per flow; a second _None of these_ generates.
- Local search is **community-only** (public community recipes via the search index; never meal-plan or private chat-saved recipes).
- Tiers: **Coach Pro and RecipeChef only.** Free Coach is unchanged (prose answer).
- **Only Generate counts against the 20/day recipe generation limit** (`dailyRecipeGenerations`), in both chats; finder list/button/question steps never do.
- **Hermes has no global `crypto`.** Client code never calls `crypto.randomUUID()`; any client-minted UUID uses `randomUuidV4` from `client/lib/uuid.ts`. flowIds are minted **server-side** (`randomUUID` from `node:crypto` is fine there); the client only echoes them back.
- **TDD is mandatory:** every task writes the failing test first, runs it red, implements, runs it green.
- Build/consider **both iOS and Android** for every client change (touch targets ≥ 44pt, TalkBack + VoiceOver labels, no iOS-only announcement as the sole feedback).
- **Never commit to `main`.** One branch + one PR per PR group: `fix/spoonacular-preview-save` (A), `feat/recipe-finder-server` (B), `feat/recipe-finder-client` (C), `chore/recipe-finder-enable` (D).
- **Commit messages are written to a file and committed with `-F`**: write the message with the Write tool to `/private/tmp/claude-501/-Users-williamtower-projects-OCRecipes/<session>/scratchpad/commit-msg-finder-task-<N>.txt` (unique per task — the scratchpad is shared across parallel executors), then `git commit -F <that file>`. End every message with the attribution lines from the session's system reminder.
- Local verification is per-test (`npx vitest run <file> -t "<name>"`); do not run the whole suite, `check:types` or `lint` ad hoc — the push gate (`preflight:fast`) and CI own that.

## Review Focus

The five untested-input/failure modes most likely to bite a user, each pinned by a named test:

1. **Typed "generate" on an old client** (no finder component, text list only) — must run the Generate action, not refine the search. Pinned in **Task 15** (`matchTypedFinderCommand` table) and **Task 18** (`it("treats typed \"generate\" in the results stage as the Generate action")`).
2. **A flow action for a stale flowId** (an older list's button, or a double tap) — must be a silent no-op: SSE `{done:true}`, no user row, no AI call, no quota. Pinned in **Task 14** (`planFinderStep` stale rows), **Task 16** (`createFinderUserMessage` duplicate), **Task 18** (`it("ignores an action whose flowId is not the latest finder message")`).
3. **Spoonacular 402 / error / timeout mid-flow** — must render "Spoonacular isn't available right now…", never "no results", and keep Generate/None of these usable. Pinned in **Task 11** (`it("returns unavailable on a 402 quota error")`) and **Task 14** (`finderOutcome` unavailable row).
4. **`classifyTurn` misclassifying a refinement** (e.g. "make it spicier" → `new_request`, or an AI failure) — failure must fall back to `new_request` (a recoverable list), never silently rewrite the recipe; the gold set records accuracy. Pinned in **Task 13** (`it("falls back to new_request when the AI call throws")` + gold-set measurement) and **Task 18** (`it("routes a refine_current follow-up to the legacy recipe path")`).
5. **A catalog detail fetch that 404s or is premium-denied** — the preview must show "Recipe not found" (404) or a Premium upsell (403 `PREMIUM_REQUIRED`), never a blank screen or the generic retry. Pinned in **Task 2** (`it("shows the Premium state for a 403 PREMIUM_REQUIRED")`, `it("shows 'Recipe not found' for a catalog 404")`).

## File Structure

**PR A — Spoonacular preview + Save (unflagged)**

| File                                               | Change          | Responsibility                                                        |
| -------------------------------------------------- | --------------- | --------------------------------------------------------------------- |
| `client/navigation/RootStackNavigator.tsx`         | modify 142-148  | `FeaturedRecipeDetail.recipeType` gains `"catalog"`                   |
| `client/navigation/linking.ts`                     | modify 227-234  | parse `recipeType` like `type` so a link can never select `"catalog"` |
| `shared/schemas/coach-blocks.ts`                   | modify 75-79    | Coach navigate params accept `recipeType: "catalog"`                  |
| `client/screens/featured-recipe-detail-utils.ts`   | create          | pure `resolveFeaturedRecipeType`, `normalizeCatalogDetail`            |
| `client/screens/FeaturedRecipeDetailScreen.tsx`    | modify 78-359   | `catalog` branch: fetch, 404/403/402 states, Save, saved state        |
| `client/screens/meal-plan/recipe-browser-utils.ts` | modify (append) | pure `detailParamsForSearchResult`                                    |
| `client/screens/meal-plan/RecipeBrowserScreen.tsx` | modify 550-566  | spoonacular rows open `recipeType: "catalog"`                         |
| `client/components/coach/blocks/RecipeCard.tsx`    | modify 40-50    | View sends `recipeType` (spoonacular → catalog)                       |

**PR B — Server (behind the flag)**

| File                                                                           | Change                  | Responsibility                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `shared/schemas/recipe-finder.ts`                                              | create                  | Zod + types: query, item, flow, blocks, action, metadata                                              |
| `shared/schemas/coach-blocks.ts`                                               | modify 286-296          | register `recipe_results`/`recipe_questions` in `coachBlockSchema`                                    |
| `server/services/coach-blocks.ts`                                              | modify 8-22             | drop server-only finder blocks from model output                                                      |
| `server/services/recipe-finder/config.ts`                                      | create                  | flag + cap + catalog-configured readers                                                               |
| `server/services/recipe-search.ts`                                             | modify 152-410          | opt-in `includeScores`                                                                                |
| `server/services/recipe-finder/extract-query.ts`                               | create                  | `extractQuery` (JSON-mode AI, raw-text fallback)                                                      |
| `server/services/recipe-finder/find-community.ts`                              | create                  | `findCommunity`, `selectCloseMatches`, threshold constants                                            |
| `server/services/recipe-finder/__tests__/fixtures/community-catalog.json`      | create (generated)      | fixture copy of public community catalog                                                              |
| `server/services/recipe-finder/__tests__/fixtures/finder-gold-set.json`        | create                  | labelled requests for the threshold                                                                   |
| `scripts/export-community-catalog-fixture.ts`                                  | create                  | writes the fixture from a DB (no author ids)                                                          |
| `server/services/recipe-catalog.ts`                                            | modify (append)         | exported `buildIntolerancesParam` (moved from the route)                                              |
| `server/routes/recipe-catalog.ts`                                              | modify 26-52            | import `buildIntolerancesParam` instead of defining it                                                |
| `server/services/recipe-finder/find-online.ts`                                 | create                  | `findOnline` (no nutrition; `unavailable` on any failure)                                             |
| `server/services/recipe-finder/ask-clarifying.ts`                              | create                  | `askClarifying` + `FALLBACK_QUESTIONS`                                                                |
| `server/services/recipe-finder/classify-turn.ts`                               | create                  | `classifyTurn` (`new_request` fallback)                                                               |
| `server/services/recipe-finder/__tests__/fixtures/classify-turn-gold-set.json` | create                  | labelled follow-ups                                                                                   |
| `scripts/measure-classify-turn.ts`                                             | create                  | runs the real `classifyTurn` over the gold set, prints accuracy                                       |
| `server/services/recipe-finder/transition.ts`                                  | create                  | pure `planFinderStep`, `finderOutcome`, `blockedGenerateBlock`, `finderStatusLabel`                   |
| `server/services/recipe-finder/fallback-text.ts`                               | create                  | pure plain-text `content` for every finder block                                                      |
| `server/services/recipe-finder/entry.ts`                                       | create                  | pure entry rules + typed-command guard + latest-block readers                                         |
| `server/storage/chat.ts`                                                       | modify 297-512          | shared generation count; `createFinderUserMessage`, `claimRecipeGeneration`, `claimSpoonacularSearch` |
| `server/storage/index.ts`                                                      | modify 165-168          | expose the three new storage functions                                                                |
| `server/services/recipe-finder/generate.ts`                                    | create                  | `gateRecipeGeneration`, `buildFinderGenerationMessages`                                               |
| `server/services/recipe-finder/run-turn.ts`                                    | create                  | `prepareFinderTurn`, `executeFinderStep` (orchestration)                                              |
| `server/services/recipe-finder/index.ts`                                       | create                  | public exports                                                                                        |
| `server/routes/chat.ts`                                                        | modify 266-460          | `finderAction` body field, action pre-check/dedupe, RecipeChef finder branch                          |
| `server/services/coach-intent-classifier.ts`                                   | modify 1-163            | `recipe_request` intent (after safety, before vague)                                                  |
| `server/services/nutrition-coach.ts`                                           | modify 490-500, 638     | template-version intent list; flag-gated tool list                                                    |
| `server/services/coach-pro-chat.ts`                                            | modify 188-217, 500-560 | `finder` params, early-return finder branch, legacy-intent remap                                      |
| `server/services/recipe-finder/coach-turn.ts`                                  | create                  | `runCoachFinderTurn` generator (Coach delivery)                                                       |
| `server/services/coach-blocks.ts`                                              | modify 65-90            | `getBlocksSystemPrompt(finderEnabled)` without `search_recipes` lines                                 |
| `evals/datasets/coach-cases.json`                                              | no change               | (expectations live in the classifier test map)                                                        |

**PR C — Client (flag still off server-side)**

| File                                                            | Change                         | Responsibility                                                   |
| --------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `client/components/recipe-finder/recipe-finder-utils.ts`        | create                         | pure labels, meta line, announcements, nav params                |
| `client/components/recipe-finder/RecipeResultsList.tsx`         | create                         | list header, rows, notice, 3 buttons, disabled/locked states     |
| `client/components/recipe-finder/RecipeQuestions.tsx`           | create                         | questions + single-select chips + "Search with these"            |
| `client/components/recipe-finder/RecipeFinderMessage.tsx`       | create                         | dispatches a `FinderBlock`, builds `FinderAction` with flowId    |
| `client/hooks/useChat.ts`                                       | modify 135-414                 | `finder` + `status` SSE cases, `finderAction` option             |
| `client/screens/RecipeChatScreen.tsx`                           | modify 105-560                 | status text, pending bridge `isPresent`, finder render + actions |
| `client/hooks/useCoachStream.ts`                                | modify 84-88, 275-280, 387-394 | `extras.finderAction` in the body                                |
| `client/components/coach/blocks/index.tsx`                      | modify 11-64                   | finder block cases                                               |
| `client/components/coach/CoachChat.tsx`                         | modify 250-800                 | finder actions, active flag, generated-card render + Save        |
| `client/components/recipe-finder/__tests__/both-chats.test.tsx` | create                         | both chats render `RecipeFinderMessage`                          |

**PR D — Enable**

| File                            | Change     | Responsibility                                                                    |
| ------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `e2e/manual/recipe-finder.yaml` | create     | Maestro run of the whole flow in both chats (manual; not in CI's `flows/**` glob) |
| Railway `RECIPE_FINDER_ENABLED` | human step | flag flip, only after the user confirms                                           |

---

# PR A — Spoonacular preview + Save (pre-existing HIGH bug, ships first, NOT behind the flag)

Branch: `fix/spoonacular-preview-save` from `main`. R1 is a live defect today: Recipe Browser and Coach's recipe card send a Spoonacular id to `FeaturedRecipeDetail` as a _community_ id, which fetches `/api/recipes/:id` (a 404 or an unrelated recipe). Nothing in the client calls `GET /api/meal-plan/catalog/:id`.

### Task 1: `recipeType: "catalog"` in the param types — and never from a link

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx:142-148`
- Modify: `client/navigation/linking.ts:227-234`
- Modify: `shared/schemas/coach-blocks.ts:75-79`
- Test: `client/navigation/__tests__/linking.test.ts` (append), `shared/schemas/__tests__/coach-blocks.test.ts` (append inside `describe("validateNavigateParams stripping")`, after line 419)

**Interfaces:**

- Produces: `RootStackParamList["FeaturedRecipeDetail"] = { recipeId: number; recipeType?: "community" | "mealPlan" | "catalog"; type?: "community" | "mealPlan" }`
- Produces: linking parse `recipeType: (value: string) => "mealPlan" | "community"` (a link can never produce `"catalog"`: a catalog open costs a Spoonacular quota point and must only come from an in-app tap).

- [ ] **Step 1: Write the failing tests**

Append to `client/navigation/__tests__/linking.test.ts`:

```ts
// A catalog (Spoonacular) preview spends a shared Spoonacular quota point on
// open, so only an in-app tap may select it. `type` was already parsed; the
// `recipeType` alias passed through unparsed, so `?recipeType=catalog` reached
// the screen as a string.
describe("FeaturedRecipeDetail links never select the catalog branch", () => {
  const rootRoute = (path: string) => {
    const state = linking.getStateFromPath!(path, linking.config);
    return state?.routes[state.routes.length - 1] as
      | { name: string; params?: Record<string, unknown> }
      | undefined;
  };

  it("maps type=catalog to community", () => {
    const route = rootRoute("recipe/42?type=catalog");
    expect(route?.name).toBe("FeaturedRecipeDetail");
    expect(route?.params).toEqual({ recipeId: 42, type: "community" });
  });

  it("maps recipeType=catalog to community", () => {
    const route = rootRoute("recipe/42?recipeType=catalog");
    expect(route?.params).toEqual({ recipeId: 42, recipeType: "community" });
  });

  it("positive control: recipeType=mealPlan still selects the meal-plan branch", () => {
    const route = rootRoute("recipe/42?recipeType=mealPlan");
    expect(route?.params).toEqual({ recipeId: 42, recipeType: "mealPlan" });
  });
});
```

Append inside `describe("validateNavigateParams stripping", …)` in `shared/schemas/__tests__/coach-blocks.test.ts`:

```ts
it("keeps recipeType catalog on a FeaturedRecipeDetail navigate action", () => {
  const card = {
    type: "action_card",
    title: "Spoonacular Chili",
    subtitle: "Preview",
    action: {
      type: "navigate",
      screen: "FeaturedRecipeDetail",
      params: { recipeId: 715538, recipeType: "catalog" },
    },
    actionLabel: "View recipe",
  };
  const parsed = actionCardSchema.parse(card);
  if (parsed.action.type !== "navigate") {
    throw new Error("expected a navigate action");
  }
  expect(parsed.action.params).toEqual({
    recipeId: 715538,
    recipeType: "catalog",
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run client/navigation/__tests__/linking.test.ts -t "never select the catalog branch"`
Expected: FAIL — `maps recipeType=catalog to community` receives `recipeType: "catalog"`.

Run: `npx vitest run shared/schemas/__tests__/coach-blocks.test.ts -t "keeps recipeType catalog"`
Expected: FAIL — params equal `{ recipeId: 715538 }` (catalog degraded to undefined).

- [ ] **Step 3: Implement**

`client/navigation/RootStackNavigator.tsx` lines 142-148 become:

```ts
  FeaturedRecipeDetail: {
    recipeId: number;
    /**
     * "community" (default) fetches /api/recipes/:id; "mealPlan" fetches
     * /api/meal-plan/recipes/:id; "catalog" previews a Spoonacular recipe via
     * /api/meal-plan/catalog/:id (in-app only — linking.ts never produces it).
     */
    recipeType?: "community" | "mealPlan" | "catalog";
    /** Deep link query param — alias for recipeType */
    type?: "community" | "mealPlan";
  };
```

`client/navigation/linking.ts` — the `FeaturedRecipeDetail` entry becomes:

```ts
      FeaturedRecipeDetail: {
        path: "recipe/:recipeId",
        parse: {
          recipeId: parseIntOrZero,
          type: (value: string) =>
            value === "mealPlan" ? "mealPlan" : "community",
          // Same mapping for the recipeType alias: a link must never select
          // "catalog" (a Spoonacular preview spends shared quota on open).
          recipeType: (value: string) =>
            value === "mealPlan" ? "mealPlan" : "community",
        },
      },
```

`shared/schemas/coach-blocks.ts` lines 75-79 become:

```ts
  FeaturedRecipeDetail: z.object({
    recipeId: z.number(),
    recipeType: z
      .enum(["community", "mealPlan", "catalog"])
      .optional()
      .catch(undefined),
    type: z.enum(["community", "mealPlan"]).optional().catch(undefined),
  }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/navigation/__tests__/linking.test.ts -t "never select the catalog branch"` → PASS (3 tests).
Run: `npx vitest run shared/schemas/__tests__/coach-blocks.test.ts -t "recipeType"` → PASS (the new test and the existing `drops an out-of-vocabulary recipeType` test).

- [ ] **Step 5: Commit**

Write `commit-msg-finder-task-1.txt`: `fix(nav): FeaturedRecipeDetail accepts recipeType "catalog"; links can never select it` + attribution lines. Then:

```bash
git add client/navigation/RootStackNavigator.tsx client/navigation/linking.ts shared/schemas/coach-blocks.ts client/navigation/__tests__/linking.test.ts shared/schemas/__tests__/coach-blocks.test.ts
git commit -F /private/tmp/claude-501/-Users-williamtower-projects-OCRecipes/<session>/scratchpad/commit-msg-finder-task-1.txt
```

### Task 2: `FeaturedRecipeDetailScreen` catalog branch — preview, 404/403/402 states, Save

**Files:**

- Create: `client/screens/featured-recipe-detail-utils.ts`
- Create: `client/screens/__tests__/featured-recipe-detail-utils.test.ts`
- Modify: `client/screens/FeaturedRecipeDetailScreen.tsx:1-359`
- Test: `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx` (modify mocks at 33-75, append a describe)

**Interfaces:**

- Consumes: `GET /api/meal-plan/catalog/:id` → `{ recipe: InsertMealPlanRecipe; ingredients: InsertRecipeIngredient[] }` (403 `PREMIUM_REQUIRED`, 404 `NOT_FOUND`, 402 `CATALOG_QUOTA_EXCEEDED`); `useSaveCatalogRecipe(): UseMutationResult<MealPlanRecipe, Error, number>` (`client/hooks/useMealPlanRecipes.ts:147`).
- Produces:
  - `export type FeaturedRecipeType = "community" | "mealPlan" | "catalog"`
  - `export function resolveFeaturedRecipeType(recipeType: unknown, type: unknown): FeaturedRecipeType`
  - `export interface CatalogDetailResponse`
  - `export function normalizeCatalogDetail(detail: CatalogDetailResponse): { title: string; description: string | null; difficulty: string | null; timeDisplay: string | null; servings: number | null; dietTags: string[]; instructions: string[]; ingredients: IngredientItem[]; imageUrl: string | null; nutrition: NutritionData | null }`

- [ ] **Step 1: Write the failing pure-helper tests**

Create `client/screens/__tests__/featured-recipe-detail-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resolveFeaturedRecipeType,
  normalizeCatalogDetail,
} from "../featured-recipe-detail-utils";

describe("resolveFeaturedRecipeType", () => {
  it.each([
    ["catalog", undefined, "catalog"],
    ["mealPlan", undefined, "mealPlan"],
    ["community", undefined, "community"],
    [undefined, "mealPlan", "mealPlan"],
    [undefined, undefined, "community"],
    // A repeated link key arrives as an array — never a branch selector.
    [["catalog", "catalog"], undefined, "community"],
    [undefined, "catalog", "community"],
  ])("recipeType=%j type=%j → %s", (recipeType, type, expected) => {
    expect(resolveFeaturedRecipeType(recipeType, type)).toBe(expected);
  });
});

describe("normalizeCatalogDetail", () => {
  it("maps the catalog detail payload onto the detail-screen shape", () => {
    const n = normalizeCatalogDetail({
      recipe: {
        title: "Spoonacular Chili",
        description: "Warm",
        difficulty: null,
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 30,
        imageUrl: "https://img.spoonacular.com/1.jpg",
        instructions: ["Brown", "Simmer"],
        dietTags: ["gluten free"],
        caloriesPerServing: "420",
        proteinPerServing: "30",
        carbsPerServing: "40",
        fatPerServing: "12",
      },
      ingredients: [{ name: "beans", quantity: "1", unit: "can" }],
    });
    expect(n.title).toBe("Spoonacular Chili");
    expect(n.timeDisplay).toBe("10 min prep · 30 min cook");
    expect(n.nutrition).toEqual({
      calories: 420,
      protein: 30,
      carbs: 40,
      fat: 12,
    });
    expect(n.ingredients).toEqual([
      { name: "beans", quantity: "1", unit: "can" },
    ]);
  });

  it("yields null nutrition when the catalog has no calories", () => {
    const n = normalizeCatalogDetail({
      recipe: { title: "Plain", caloriesPerServing: null },
      ingredients: [],
    });
    expect(n.nutrition).toBeNull();
    expect(n.instructions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/screens/__tests__/featured-recipe-detail-utils.test.ts`
Expected: FAIL — `Cannot find module '../featured-recipe-detail-utils'`.

- [ ] **Step 3: Implement the helper**

Create `client/screens/featured-recipe-detail-utils.ts`:

```ts
import {
  formatTimeDisplay,
  parseNutritionData,
} from "@/components/recipe-detail/recipe-detail-utils";
import type { IngredientItem } from "@/components/recipe-detail";

export type FeaturedRecipeType = "community" | "mealPlan" | "catalog";

/**
 * Route params are typed, but a link's repeated query key arrives as an
 * array (linking.ts's `parse` skips non-strings) — only an exact string may
 * select a branch. `type` (the link alias) can never select "catalog".
 */
export function resolveFeaturedRecipeType(
  recipeType: unknown,
  type: unknown,
): FeaturedRecipeType {
  if (
    recipeType === "catalog" ||
    recipeType === "mealPlan" ||
    recipeType === "community"
  ) {
    return recipeType;
  }
  if (type === "mealPlan") return "mealPlan";
  return "community";
}

/** GET /api/meal-plan/catalog/:id (server/routes/recipe-catalog.ts). */
export interface CatalogDetailResponse {
  recipe: {
    title: string;
    description?: string | null;
    difficulty?: string | null;
    servings?: number | null;
    prepTimeMinutes?: number | null;
    cookTimeMinutes?: number | null;
    imageUrl?: string | null;
    instructions?: string[] | null;
    dietTags?: string[] | null;
    caloriesPerServing?: string | null;
    proteinPerServing?: string | null;
    carbsPerServing?: string | null;
    fatPerServing?: string | null;
  };
  ingredients: {
    name: string;
    quantity?: string | null;
    unit?: string | null;
  }[];
}

export function normalizeCatalogDetail(detail: CatalogDetailResponse) {
  const r = detail.recipe;
  return {
    title: r.title,
    description: r.description ?? null,
    difficulty: r.difficulty ?? null,
    timeDisplay: formatTimeDisplay(r.prepTimeMinutes, r.cookTimeMinutes),
    servings: r.servings ?? null,
    dietTags: r.dietTags ?? [],
    instructions: r.instructions ?? [],
    ingredients: detail.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity ?? null,
      unit: i.unit ?? null,
    })) as IngredientItem[],
    imageUrl: r.imageUrl ?? null,
    nutrition: parseNutritionData(r),
  };
}
```

Run: `npx vitest run client/screens/__tests__/featured-recipe-detail-utils.test.ts` → PASS.

- [ ] **Step 4: Write the failing screen tests**

In `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`:

1. Extend the hoisted block (lines 33-46) with `mockReplace: vi.fn()` and `mockDetailProps: { current: null as Record<string, unknown> | null }`, and widen `mockRouteParams.current` to `{ recipeId: number; recipeType: "mealPlan" | "community" | "catalog" }`.
2. Navigation mock (line 48-51) becomes `useNavigation: () => ({ navigate: mockNavigate, reset: mockReset, replace: mockReplace })`.
3. `RecipeDetailContent` mock (line 67-71) captures props:

```tsx
vi.mock("@/components/RecipeDetailContent", () => ({
  RecipeDetailContent: (props: { title: string } & Record<string, unknown>) => {
    mockDetailProps.current = props;
    return <div data-testid="recipe-detail-content">{props.title}</div>;
  },
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="upgrade-modal" /> : null,
}));
```

4. Append:

```tsx
describe("FeaturedRecipeDetailScreen — catalog (Spoonacular) preview", () => {
  const catalogDetail = {
    recipe: {
      title: "Spoonacular Chili",
      description: "Warm",
      servings: 4,
      prepTimeMinutes: 10,
      cookTimeMinutes: 30,
      imageUrl: null,
      instructions: ["Cook"],
      dietTags: [],
      caloriesPerServing: "420",
      proteinPerServing: "30",
      carbsPerServing: "40",
      fatPerServing: "12",
    },
    ingredients: [{ name: "beans", quantity: "1", unit: "can" }],
  };

  beforeEach(() => {
    mockRouteParams.current = { recipeId: 715538, recipeType: "catalog" };
    mockDetailProps.current = null;
  });

  function mockCatalogApi(saveResult: unknown = { id: 901 }) {
    mockApiRequest.mockImplementation(async (method: string) =>
      method === "GET"
        ? { json: async () => catalogDetail }
        : saveResult instanceof Error
          ? Promise.reject(saveResult)
          : { json: async () => saveResult },
    );
  }

  it("fetches the preview from the catalog endpoint, not /api/recipes", async () => {
    mockCatalogApi();
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(await screen.findByText("Spoonacular Chili")).toBeDefined();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/meal-plan/catalog/715538",
    );
  });

  it("hands RecipeDetailContent recipeId 0 so favourite/cookbook/remix never touch a DB row", async () => {
    mockCatalogApi();
    renderComponent(<FeaturedRecipeDetailScreen />);
    await screen.findByText("Spoonacular Chili");
    expect(mockDetailProps.current?.recipeId).toBe(0);
    expect(mockDetailProps.current?.recipeType).toBe("mealPlan");
  });

  it("saves via the catalog save endpoint, shows the saved state, and opens the saved copy", async () => {
    mockCatalogApi({ id: 901 });
    renderComponent(<FeaturedRecipeDetailScreen />);
    fireEvent.click(
      await screen.findByLabelText("Save Spoonacular Chili to your recipes"),
    );
    expect(await screen.findByText("Saved · View recipe")).toBeDefined();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/catalog/715538/save",
    );
    fireEvent.click(
      screen.getByLabelText("Saved. Open Spoonacular Chili in your recipes"),
    );
    expect(mockReplace).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 901,
      recipeType: "mealPlan",
    });
  });

  it("shows an inline error when Save fails", async () => {
    mockCatalogApi(new TypeError("Network request failed"));
    renderComponent(<FeaturedRecipeDetailScreen />);
    fireEvent.click(
      await screen.findByLabelText("Save Spoonacular Chili to your recipes"),
    );
    expect(
      await screen.findByText("Couldn't save this recipe. Try again."),
    ).toBeDefined();
  });

  it("shows the Premium state for a 403 PREMIUM_REQUIRED", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError(
        "403: Recipe catalog requires a premium subscription",
        ErrorCode.PREMIUM_REQUIRED,
        403,
      ),
    );
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(
      await screen.findByText("Online recipes are a Premium feature"),
    ).toBeDefined();
    expect(screen.queryByText("Try Again")).toBeNull();
    fireEvent.click(screen.getByText("See Premium"));
    expect(screen.getByTestId("upgrade-modal")).toBeDefined();
  });

  it("shows 'Recipe not found' for a catalog 404", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError(
        "404: Recipe not found in catalog",
        ErrorCode.NOT_FOUND,
        404,
      ),
    );
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(await screen.findByText("Recipe not found")).toBeDefined();
    expect(screen.queryByText("Try Again")).toBeNull();
  });

  it("shows the unavailable state for a 402 quota error", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError(
        "402: Spoonacular API quota exceeded",
        ErrorCode.CATALOG_QUOTA_EXCEEDED,
        402,
      ),
    );
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(
      await screen.findByText("Spoonacular isn't available right now"),
    ).toBeDefined();
  });
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `npx vitest run client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx -t "catalog"`
Expected: FAIL — the screen resolves `"catalog"` to neither query, so `findByText("Spoonacular Chili")` times out; `mockApiRequest` is never called with the catalog URL.

- [ ] **Step 6: Implement the screen branch**

In `client/screens/FeaturedRecipeDetailScreen.tsx`:

Imports — change line 1 to `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";` and add:

```ts
import { ThemedText } from "@/components/ThemedText";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useSaveCatalogRecipe } from "@/hooks/useMealPlanRecipes";
import {
  normalizeCatalogDetail,
  resolveFeaturedRecipeType,
  type CatalogDetailResponse,
} from "@/screens/featured-recipe-detail-utils";
```

Replace line 81 (`const resolvedRecipeType = recipeType ?? type ?? "community";`) with:

```ts
const resolvedRecipeType = resolveFeaturedRecipeType(recipeType, type);
```

After the meal-plan query (after line 116) add:

```ts
// --- Catalog (Spoonacular) preview — nothing is saved until Save ---
const {
  data: catalogDetail,
  isLoading: catalogLoading,
  error: catalogError,
  refetch: refetchCatalogDetail,
} = useQuery<CatalogDetailResponse>({
  queryKey: ["/api/meal-plan/catalog", recipeId],
  queryFn: async () => {
    const res = await apiRequest("GET", `/api/meal-plan/catalog/${recipeId}`);
    return res.json();
  },
  enabled: resolvedRecipeType === "catalog" && recipeId > 0,
  // This screen renders its own 403/404/402/generic states for this query.
  meta: { silentError: true },
});
const { mutateAsync: saveCatalogRecipe, isPending: isSavingCatalog } =
  useSaveCatalogRecipe();
const [savedRecipeId, setSavedRecipeId] = useState<number | null>(null);
const [saveError, setSaveError] = useState<string | null>(null);
const [showUpgrade, setShowUpgrade] = useState(false);
```

In the `normalized` memo, before `if (communityRecipe)`, add:

```ts
if (resolvedRecipeType === "catalog") {
  if (!catalogDetail) return null;
  return {
    ...normalizeCatalogDetail(catalogDetail),
    allergens: null,
    isCanonical: false,
    canonicalImages: [],
    instructionDetails: [],
    toolsRequired: [],
    chefTips: [],
    cuisineOrigin: null,
  };
}
```

and add `catalogDetail` to its deps array.

Replace the `isLoading`/`error`/`refetch` block (lines 177-184) with:

```ts
const isLoading =
  resolvedRecipeType === "catalog"
    ? catalogLoading
    : resolvedRecipeType === "community"
      ? communityLoading
      : mealPlanLoading;
const error =
  resolvedRecipeType === "catalog"
    ? catalogError
    : resolvedRecipeType === "community"
      ? communityError
      : mealPlanError;
const refetch =
  resolvedRecipeType === "catalog"
    ? refetchCatalogDetail
    : resolvedRecipeType === "community"
      ? refetchCommunityRecipe
      : refetchMealPlanRecipe;
```

Replace line 195-196 (`isNotFoundError`/`showsGenericError`) with:

```ts
const isNotFoundError =
  error instanceof ApiError && error.code === ErrorCode.NOT_FOUND;
const isPremiumDenied =
  error instanceof ApiError && error.code === ErrorCode.PREMIUM_REQUIRED;
const isCatalogUnavailable =
  error instanceof ApiError && error.code === ErrorCode.CATALOG_QUOTA_EXCEEDED;
const showsGenericError =
  Boolean(error) &&
  !isNotFoundError &&
  !isPremiumDenied &&
  !isCatalogUnavailable &&
  !normalized;
```

Replace the `announcement` expression with:

```ts
const announcement = isLoading
  ? null
  : isPremiumDenied
    ? "Online recipes are a Premium feature."
    : isCatalogUnavailable
      ? "Spoonacular isn't available right now."
      : showsGenericError
        ? toastAnnouncesError
          ? null
          : "Couldn't load this recipe. Try again."
        : !normalized
          ? "Recipe not found."
          : null;
```

Add the handlers after `imageUri`:

```ts
const handleSaveCatalog = useCallback(async () => {
  setSaveError(null);
  try {
    const saved = await saveCatalogRecipe(recipeId);
    setSavedRecipeId(saved.id);
    AccessibilityInfo.announceForAccessibility("Recipe saved");
  } catch (err) {
    if (err instanceof ApiError && err.code === ErrorCode.PREMIUM_REQUIRED) {
      setShowUpgrade(true);
      return;
    }
    setSaveError(
      err instanceof ApiError && err.code === ErrorCode.CATALOG_QUOTA_EXCEEDED
        ? "Spoonacular isn't available right now. Try again later."
        : "Couldn't save this recipe. Try again.",
    );
  }
}, [saveCatalogRecipe, recipeId]);

const handleOpenSaved = useCallback(() => {
  if (savedRecipeId === null) return;
  navigation.replace("FeaturedRecipeDetail", {
    recipeId: savedRecipeId,
    recipeType: "mealPlan",
  });
}, [navigation, savedRecipeId]);
```

In the JSX, insert two branches right after the `isLoading ? (…)` branch:

```tsx
      ) : isPremiumDenied ? (
        <View style={styles.center}>
          <EmptyState
            variant="temporary"
            icon="lock"
            title="Online recipes are a Premium feature"
            description="Upgrade to preview and save Spoonacular recipes."
            actionLabel="See Premium"
            onAction={() => setShowUpgrade(true)}
          />
        </View>
      ) : isCatalogUnavailable ? (
        <View style={styles.center}>
          <EmptyState
            variant="temporary"
            icon="cloud-off"
            title="Spoonacular isn't available right now"
            description="Try again later, or pick a community recipe."
          />
        </View>
```

Change the `RecipeDetailContent` props `recipeId={recipeId}` / `recipeType={resolvedRecipeType}` to:

```tsx
          // A catalog preview is not a row in our DB yet: recipeId 0 hides
          // the favourite/cookbook/remix affordances that key on it.
          recipeId={resolvedRecipeType === "catalog" ? 0 : recipeId}
          recipeType={
            resolvedRecipeType === "catalog" ? "mealPlan" : resolvedRecipeType
          }
```

and `contentPaddingBottom={insets.bottom + Spacing.xl + (resolvedRecipeType === "catalog" ? SAVE_BAR_HEIGHT : 0)}`.

After the big ternary (before the closing root `</View>`), add:

```tsx
{
  resolvedRecipeType === "catalog" && normalized ? (
    <View
      style={[
        styles.saveBar,
        {
          paddingBottom: insets.bottom + Spacing.sm,
          backgroundColor: theme.backgroundRoot,
        },
      ]}
    >
      {saveError ? (
        <ThemedText
          style={{ color: theme.error }}
          accessibilityLiveRegion="polite"
        >
          {saveError}
        </ThemedText>
      ) : null}
      <Pressable
        onPress={savedRecipeId !== null ? handleOpenSaved : handleSaveCatalog}
        disabled={isSavingCatalog}
        accessibilityRole="button"
        accessibilityLabel={
          savedRecipeId !== null
            ? `Saved. Open ${normalized.title} in your recipes`
            : `Save ${normalized.title} to your recipes`
        }
        accessibilityState={{
          disabled: isSavingCatalog,
          busy: isSavingCatalog,
        }}
        style={[styles.saveButton, { backgroundColor: theme.accentSolid }]}
      >
        <ThemedText style={{ color: theme.buttonText, fontWeight: "600" }}>
          {isSavingCatalog
            ? "Saving…"
            : savedRecipeId !== null
              ? "Saved · View recipe"
              : "Save to My Recipes"}
        </ThemedText>
      </Pressable>
    </View>
  ) : null;
}
<UpgradeModal visible={showUpgrade} onClose={() => setShowUpgrade(false)} />;
```

Add `const SAVE_BAR_HEIGHT = 72;` next to `HANDLE_HEIGHT`, and to `styles`:

```ts
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
```

(`EmptyState`'s `icon` is a Feather name — `lock` and `cloud-off` both exist in Feather.)

(The test file's partial `@/lib/query-client` mock is enough for the real `useSaveCatalogRecipe`: `client/hooks/useMealPlanRecipes.ts` imports only `apiRequest` from it — verified 2026-09-28.)

- [ ] **Step 7: Run to verify they pass**

Run: `npx vitest run client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`
Expected: PASS — the 7 new catalog tests and every pre-existing test (the meal-plan/community branches are unchanged).

- [ ] **Step 8: Commit**

`commit-msg-finder-task-2.txt`: `fix(recipes): preview Spoonacular recipes via the catalog endpoint with Save (R1)`; `git add client/screens/featured-recipe-detail-utils.ts client/screens/__tests__/featured-recipe-detail-utils.test.ts client/screens/FeaturedRecipeDetailScreen.tsx client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`; `git commit -F …/commit-msg-finder-task-2.txt`.

### Task 3: Recipe Browser opens Spoonacular rows as `catalog`

**Files:**

- Modify: `client/screens/meal-plan/recipe-browser-utils.ts` (append)
- Modify: `client/screens/meal-plan/RecipeBrowserScreen.tsx:550-570`
- Test: `client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts` (append)

**Interfaces:**

- Produces: `export function detailParamsForSearchResult(item: Pick<SearchableRecipe, "id" | "source">): { recipeId: number; recipeType: "community" | "mealPlan" | "catalog" }`

- [ ] **Step 1: Write the failing test**

Append to `client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts` (add `detailParamsForSearchResult` to the import):

```ts
describe("detailParamsForSearchResult", () => {
  it("opens a Spoonacular result as a catalog preview, not a community id", () => {
    expect(
      detailParamsForSearchResult({
        id: "spoonacular:715538",
        source: "spoonacular",
      }),
    ).toEqual({ recipeId: 715538, recipeType: "catalog" });
  });

  it("opens a community result as community", () => {
    expect(
      detailParamsForSearchResult({ id: "community:17", source: "community" }),
    ).toEqual({ recipeId: 17, recipeType: "community" });
  });

  it("opens a personal result as mealPlan", () => {
    expect(
      detailParamsForSearchResult({ id: "personal:42", source: "personal" }),
    ).toEqual({ recipeId: 42, recipeType: "mealPlan" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts -t "detailParamsForSearchResult"`
Expected: FAIL — `detailParamsForSearchResult is not a function`.

- [ ] **Step 3: Implement**

Append to `client/screens/meal-plan/recipe-browser-utils.ts` (add `import type { SearchableRecipe } from "@shared/types/recipe-search";` at the top):

```ts
/**
 * Detail-screen params for a search row. A Spoonacular id is NOT a community
 * id — it previews through /api/meal-plan/catalog/:id (R1, 2026-09-28).
 */
export function detailParamsForSearchResult(
  item: Pick<SearchableRecipe, "id" | "source">,
): { recipeId: number; recipeType: "community" | "mealPlan" | "catalog" } {
  const recipeId = parseInt(item.id.split(":")[1], 10);
  if (item.source === "spoonacular") return { recipeId, recipeType: "catalog" };
  if (item.source === "personal") return { recipeId, recipeType: "mealPlan" };
  return { recipeId, recipeType: "community" };
}
```

In `RecipeBrowserScreen.tsx`'s `handleRecipePress` (lines 550-570), replace the `numericId` line and both navigate calls:

```ts
haptics.selection();
const detailParams = detailParamsForSearchResult(item);
const numericId = detailParams.recipeId;

if (item.source === "community" || item.source === "spoonacular") {
  navigation.navigate("FeaturedRecipeDetail", detailParams);
  return;
}

// Personal recipe
if (isBrowseOnly) {
  navigation.navigate("FeaturedRecipeDetail", detailParams);
  return;
}
```

and add `detailParamsForSearchResult` to the screen's existing `recipe-browser-utils` import.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/screens/meal-plan/__tests__/recipe-browser-utils.test.ts` → PASS.
Run: `npx vitest run client/screens/meal-plan/__tests__/RecipeBrowserScreen.params.test.tsx` → PASS (the personal-recipe navigate assertion still receives `{ recipeId: 42, recipeType: "mealPlan" }`).

- [ ] **Step 5: Commit**

`commit-msg-finder-task-3.txt`: `fix(recipe-browser): Spoonacular rows open the catalog preview (R1)`; add both files + test; `git commit -F`.

### Task 4: Coach `RecipeCard` "View" sends `recipeType`

**Files:**

- Modify: `client/components/coach/blocks/RecipeCard.tsx:40-50`
- Test: `client/components/coach/blocks/__tests__/RecipeCard.test.tsx:40-49` (update + add)

**Interfaces:**

- Produces: View emits `{ type: "navigate", screen: "FeaturedRecipeDetail", params: { recipeId, recipeType: "catalog" | "community" } }` (`spoonacular` → `catalog`; `community`/`generated` → `community`). `CoachChat.handleBlockAction` (`CoachChat.tsx:537-541`) forwards params unchanged.

- [ ] **Step 1: Update the test to the correct contract and add the spoonacular case**

Replace the `fires a FeaturedRecipeDetail navigate action from the View button` test body's expectation with:

```ts
expect(onAction).toHaveBeenCalledWith({
  type: "navigate",
  screen: "FeaturedRecipeDetail",
  params: { recipeId: 88, recipeType: "community" },
});
```

and add:

```ts
  it("opens a Spoonacular card as a catalog preview", () => {
    const onAction = vi.fn();
    renderComponent(<RecipeCard block={spoonacularBlock} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /view recipe/i }));
    expect(onAction).toHaveBeenCalledWith({
      type: "navigate",
      screen: "FeaturedRecipeDetail",
      params: { recipeId: 715538, recipeType: "catalog" },
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/components/coach/blocks/__tests__/RecipeCard.test.tsx`
Expected: FAIL — received `params: { recipeId: 88, source: "community" }`.

- [ ] **Step 3: Implement**

In `RecipeCard.tsx`, the View `onPress` becomes:

```tsx
          onPress={() =>
            onAction?.({
              type: "navigate",
              screen: "FeaturedRecipeDetail",
              // A Spoonacular id previews through the catalog endpoint; the
              // old `source` param was never read, so every card opened as a
              // community id (R1).
              params: {
                recipeId: recipe.recipeId,
                recipeType:
                  recipe.source === "spoonacular" ? "catalog" : "community",
              },
            })
          }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/components/coach/blocks/__tests__/RecipeCard.test.tsx` → PASS.

- [ ] **Step 5: Commit, push, open PR A**

`commit-msg-finder-task-4.txt`: `fix(coach): recipe card View opens Spoonacular recipes as a catalog preview (R1)`; commit with `-F`. Then `git push -u origin fix/spoonacular-preview-save` (the push gate runs `preflight:fast`), and open the PR with `mcp__github__create_pull_request` (load via `ToolSearch select:mcp__github__create_pull_request`). PR body: the R1 defect, the four fixes, "not behind the flag", test evidence, attribution footer. Review per `docs/AI_WORKFLOW.md` → Review Policy (`code-reviewer` + `mobile-reviewer`). Ship a preview OTA after merge (`npm run update:preview -- --message "Spoonacular preview + Save"`) only with the user's go-ahead (outward-facing).

---

# PR B — Server (behind `RECIPE_FINDER_ENABLED`, default off)

Branch: `feat/recipe-finder-server` from `main` (after PR A merges). With the flag unset, every changed path must behave exactly as before — each task that touches a live path includes a flag-off control test.

### Task 5: Shared finder schemas + Coach block registration + model-output guard

**Files:**

- Create: `shared/schemas/recipe-finder.ts`
- Create: `shared/schemas/__tests__/recipe-finder.test.ts`
- Modify: `shared/schemas/coach-blocks.ts:1-3` (import), `:286-296` (union), `:297-305` (types)
- Modify: `server/services/coach-blocks.ts:1-22`
- Test: `server/services/__tests__/coach-blocks.test.ts` (append)

**Interfaces (Produces — used by every later task, names are final):**

```ts
export const FINDER_MAX_ITEMS = 5;
export const recipeQuerySchema;
export type RecipeQuery = {
  q: string;
  cuisine?: string;
  diet?: string;
  maxPrepTime?: number;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
};
export const finderItemSchema;
export type FinderItem = {
  id: number;
  source: "community" | "spoonacular";
  title: string;
  imageUrl: string | null;
  readyInMinutes: number | null;
  calories: number | null;
};
export const finderButtonSchema;
export type FinderButton = "search_online" | "generate" | "none_of_these";
export const finderFlowSchema;
export type FinderFlow = {
  flowId: string;
  stage: "results" | "clarifying";
  request: string;
  query: RecipeQuery;
  round: 0 | 1;
  shownIds: string[];
};
export const clarifyingQuestionSchema;
export type ClarifyingQuestion = { question: string; options: string[] };
export const finderNoticeSchema;
export type FinderNotice =
  | "no_matches"
  | "unavailable"
  | "generate_limit"
  | "generate_premium";
export const recipeResultsBlockSchema;
export type RecipeResultsBlock = {
  type: "recipe_results";
  source: "community" | "spoonacular";
  items: FinderItem[];
  actions: FinderButton[];
  notice: FinderNotice | null;
  flow: FinderFlow;
};
export const recipeQuestionsBlockSchema;
export type RecipeQuestionsBlock = {
  type: "recipe_questions";
  questions: ClarifyingQuestion[];
  flow: FinderFlow;
};
export const finderBlockSchema;
export type FinderBlock = RecipeResultsBlock | RecipeQuestionsBlock;
export function isFinderBlockType(type: unknown): type is FinderBlock["type"];
export const finderAnswerSchema;
export type FinderAnswer = { question: string; answer: string };
export const finderActionSchema;
export type FinderAction = {
  type: "search_online" | "generate" | "none_of_these" | "answers";
  flowId: string;
  answers?: FinderAnswer[];
};
export const recipeFinderMetadataSchema;
export type RecipeFinderMetadata = { metadataVersion: 1; finder: FinderBlock };
```

- [ ] **Step 1: Write the failing schema tests**

Create `shared/schemas/__tests__/recipe-finder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  finderBlockSchema,
  finderActionSchema,
  recipeFinderMetadataSchema,
  isFinderBlockType,
  FINDER_MAX_ITEMS,
} from "../recipe-finder";
import { coachBlockSchema } from "../coach-blocks";

const FLOW_ID = "11111111-1111-4111-8111-111111111111";

const resultsBlock = {
  type: "recipe_results" as const,
  source: "community" as const,
  items: [
    {
      id: 12,
      source: "community" as const,
      title: "Mediterranean Quinoa Salad",
      imageUrl: null,
      readyInMinutes: null,
      calories: 350,
    },
  ],
  actions: ["search_online", "generate", "none_of_these"] as const,
  notice: null,
  flow: {
    flowId: FLOW_ID,
    stage: "results" as const,
    request: "Mediterranean",
    query: { q: "mediterranean" },
    round: 0 as const,
    shownIds: ["community:12"],
  },
};

describe("finderBlockSchema", () => {
  it("accepts a community results block", () => {
    expect(finderBlockSchema.safeParse(resultsBlock).success).toBe(true);
  });

  it(`rejects more than ${FINDER_MAX_ITEMS} items`, () => {
    const items = Array.from({ length: FINDER_MAX_ITEMS + 1 }, (_, i) => ({
      ...resultsBlock.items[0],
      id: i + 1,
    }));
    expect(
      finderBlockSchema.safeParse({ ...resultsBlock, items }).success,
    ).toBe(false);
  });

  it("rejects a third round (the flow allows one clarifying round)", () => {
    const bad = { ...resultsBlock, flow: { ...resultsBlock.flow, round: 2 } };
    expect(finderBlockSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a questions block", () => {
    const q = {
      type: "recipe_questions",
      questions: [
        { question: "How much time?", options: ["20 min", "1 hour"] },
      ],
      flow: { ...resultsBlock.flow, stage: "clarifying" },
    };
    expect(finderBlockSchema.safeParse(q).success).toBe(true);
  });
});

describe("finderActionSchema", () => {
  it("requires answers on an answers action", () => {
    expect(
      finderActionSchema.safeParse({ type: "answers", flowId: FLOW_ID })
        .success,
    ).toBe(false);
    expect(
      finderActionSchema.safeParse({
        type: "answers",
        flowId: FLOW_ID,
        answers: [{ question: "Time?", answer: "20 min" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid flowId", () => {
    expect(
      finderActionSchema.safeParse({ type: "generate", flowId: "abc" }).success,
    ).toBe(false);
  });
});

describe("registration", () => {
  it("coachBlockSchema accepts a finder block (else filterValidBlocks drops it — R6)", () => {
    expect(coachBlockSchema.safeParse(resultsBlock).success).toBe(true);
  });

  it("recipeFinderMetadataSchema wraps a block for RecipeChef", () => {
    expect(
      recipeFinderMetadataSchema.safeParse({
        metadataVersion: 1,
        finder: resultsBlock,
      }).success,
    ).toBe(true);
  });

  it("isFinderBlockType names exactly the two finder types", () => {
    expect(isFinderBlockType("recipe_results")).toBe(true);
    expect(isFinderBlockType("recipe_questions")).toBe(true);
    expect(isFinderBlockType("recipe_card")).toBe(false);
  });
});
```

Append to `server/services/__tests__/coach-blocks.test.ts`:

````ts
describe("server-only finder blocks", () => {
  const flow = {
    flowId: "11111111-1111-4111-8111-111111111111",
    stage: "results",
    request: "anything",
    query: { q: "anything" },
    round: 0,
    shownIds: [],
  };

  it("drops a recipe_results block the model wrote — only the server builds finder blocks", () => {
    const content =
      "Here you go.\n```coach_blocks\n" +
      JSON.stringify([
        {
          type: "recipe_results",
          source: "community",
          items: [],
          actions: [],
          notice: null,
          flow,
        },
        {
          type: "quick_replies",
          options: [{ label: "More", message: "More" }],
        },
      ]) +
      "\n```";
    const { blocks } = parseBlocksFromContent(content);
    expect(blocks.map((b) => b.type)).toEqual(["quick_replies"]);
  });
});
````

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/schemas/__tests__/recipe-finder.test.ts`
Expected: FAIL — `Cannot find module '../recipe-finder'`.
Run: `npx vitest run server/services/__tests__/coach-blocks.test.ts -t "server-only finder blocks"`
Expected: PASS for the wrong reason today (the union does not know `recipe_results` yet, so it is dropped as invalid). This is the vacuous-green trap: implement Step 3 in two halves — first the schema file + union registration, re-run and see it FAIL with `["recipe_results", "quick_replies"]`, then add the `validateBlocks` guard.

- [ ] **Step 3: Implement**

Create `shared/schemas/recipe-finder.ts`:

```ts
// shared/schemas/recipe-finder.ts
// Recipe finder (spec 2026-09-28): server-built list/question blocks shared by
// RecipeChef (message metadata `finder`) and Coach Pro (a `blocks[]` entry).
import { z } from "zod";

/** Max rows in one finder list (D3: 3–5 close matches). */
export const FINDER_MAX_ITEMS = 5;

export const recipeQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  cuisine: z.string().trim().min(1).max(50).optional(),
  diet: z.string().trim().min(1).max(50).optional(),
  maxPrepTime: z.number().int().positive().max(1440).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
});
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;

export const finderItemSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["community", "spoonacular"]),
  title: z.string().min(1).max(200),
  imageUrl: z.string().nullable(),
  readyInMinutes: z.number().int().positive().nullable(),
  calories: z.number().nonnegative().nullable(),
});
export type FinderItem = z.infer<typeof finderItemSchema>;

export const finderButtonSchema = z.enum([
  "search_online",
  "generate",
  "none_of_these",
]);
export type FinderButton = z.infer<typeof finderButtonSchema>;

export const finderFlowSchema = z.object({
  /** New per finder message: only the latest message's buttons are live. */
  flowId: z.string().uuid(),
  stage: z.enum(["results", "clarifying"]),
  /** The request text so far (original + refinements + answers). */
  request: z.string().min(1).max(2000),
  query: recipeQuerySchema,
  /** 0 before the clarifying round, 1 after it (spec §4: one round max). */
  round: z.union([z.literal(0), z.literal(1)]),
  /** "community:12" / "spoonacular:715538" already shown in this flow. */
  shownIds: z.array(z.string().max(40)).max(40),
});
export type FinderFlow = z.infer<typeof finderFlowSchema>;

export const clarifyingQuestionSchema = z.object({
  question: z.string().trim().min(1).max(160),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(5),
});
export type ClarifyingQuestion = z.infer<typeof clarifyingQuestionSchema>;

export const finderNoticeSchema = z.enum([
  "no_matches",
  "unavailable",
  "generate_limit",
  "generate_premium",
]);
export type FinderNotice = z.infer<typeof finderNoticeSchema>;

export const recipeResultsBlockSchema = z.object({
  type: z.literal("recipe_results"),
  source: z.enum(["community", "spoonacular"]),
  items: z.array(finderItemSchema).max(FINDER_MAX_ITEMS),
  actions: z.array(finderButtonSchema).max(3),
  notice: finderNoticeSchema.nullable(),
  flow: finderFlowSchema,
});
export type RecipeResultsBlock = z.infer<typeof recipeResultsBlockSchema>;

export const recipeQuestionsBlockSchema = z.object({
  type: z.literal("recipe_questions"),
  questions: z.array(clarifyingQuestionSchema).min(1).max(3),
  flow: finderFlowSchema,
});
export type RecipeQuestionsBlock = z.infer<typeof recipeQuestionsBlockSchema>;

export const finderBlockSchema = z.discriminatedUnion("type", [
  recipeResultsBlockSchema,
  recipeQuestionsBlockSchema,
]);
export type FinderBlock = z.infer<typeof finderBlockSchema>;

export function isFinderBlockType(type: unknown): type is FinderBlock["type"] {
  return type === "recipe_results" || type === "recipe_questions";
}

export const finderAnswerSchema = z.object({
  question: z.string().trim().min(1).max(160),
  answer: z.string().trim().min(1).max(200),
});
export type FinderAnswer = z.infer<typeof finderAnswerSchema>;

/** Button taps, sent as the send-message body's `finderAction` (R2). */
export const finderActionSchema = z
  .object({
    type: z.enum(["search_online", "generate", "none_of_these", "answers"]),
    flowId: z.string().uuid(),
    answers: z.array(finderAnswerSchema).min(1).max(3).optional(),
  })
  .refine((a) => a.type !== "answers" || a.answers !== undefined, {
    message: "answers is required for an answers action",
    path: ["answers"],
  });
export type FinderAction = z.infer<typeof finderActionSchema>;

/** RecipeChef assistant-message metadata for a finder step (R2). */
export const recipeFinderMetadataSchema = z.object({
  metadataVersion: z.literal(1),
  finder: finderBlockSchema,
});
export type RecipeFinderMetadata = z.infer<typeof recipeFinderMetadataSchema>;
```

`shared/schemas/coach-blocks.ts`: add under the existing imports

```ts
import {
  recipeResultsBlockSchema,
  recipeQuestionsBlockSchema,
} from "./recipe-finder";
```

and change the union + types:

```ts
// recipe_results / recipe_questions are SERVER-BUILT (recipe finder, R6):
// registered here so filterValidBlocks keeps them, but the model may never
// author one — server/services/coach-blocks.ts drops them from model output.
export const coachBlockSchema = z.discriminatedUnion("type", [
  actionCardSchema,
  suggestionListSchema,
  inlineChartSchema,
  commitmentCardSchema,
  quickRepliesSchema,
  recipeCardSchema,
  mealPlanCardSchema,
  recipeResultsBlockSchema,
  recipeQuestionsBlockSchema,
]);
```

and after `export type MealPlanCard …` add:

```ts
export type { RecipeResultsBlock, RecipeQuestionsBlock } from "./recipe-finder";
```

`server/services/coach-blocks.ts` — `validateBlocks` becomes:

```ts
import { isFinderBlockType } from "@shared/schemas/recipe-finder";

export function validateBlocks(rawBlocks: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const block of rawBlocks) {
    // Finder blocks carry flow state the server derives the next step from;
    // a model-authored one would let model output steer the flow.
    if (
      typeof block === "object" &&
      block !== null &&
      isFinderBlockType((block as { type?: unknown }).type)
    ) {
      logger.debug(
        { type: (block as { type?: unknown }).type },
        "Dropped server-only finder block from model output",
      );
      continue;
    }
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run shared/schemas/__tests__/recipe-finder.test.ts shared/schemas/__tests__/coach-blocks.test.ts server/services/__tests__/coach-blocks.test.ts` → PASS.

- [ ] **Step 5: Commit**

`commit-msg-finder-task-5.txt`: `feat(recipe-finder): shared finder block/action schemas; register server-only Coach blocks`; `git add shared/schemas/recipe-finder.ts shared/schemas/__tests__/recipe-finder.test.ts shared/schemas/coach-blocks.ts server/services/coach-blocks.ts server/services/__tests__/coach-blocks.test.ts`; `git commit -F …`.

### Task 6: Finder config — flag, per-user cap, catalog configured

**Files:**

- Create: `server/services/recipe-finder/config.ts`
- Create: `server/services/recipe-finder/__tests__/config.test.ts`

**Interfaces:**

- Produces: `isRecipeFinderEnabled(): boolean`, `DEFAULT_SPOONACULAR_DAILY_CAP = 10`, `getSpoonacularDailyCap(): number`, `isOnlineCatalogConfigured(): boolean` — all read `process.env` at call time (tests toggle them; a Railway variable change needs no code change).

- [ ] **Step 1: Write the failing test**

```ts
// server/services/recipe-finder/__tests__/config.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isRecipeFinderEnabled,
  getSpoonacularDailyCap,
  isOnlineCatalogConfigured,
  DEFAULT_SPOONACULAR_DAILY_CAP,
} from "../config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recipe finder config", () => {
  it("is off unless RECIPE_FINDER_ENABLED is exactly 'true'", () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "");
    expect(isRecipeFinderEnabled()).toBe(false);
    vi.stubEnv("RECIPE_FINDER_ENABLED", "1");
    expect(isRecipeFinderEnabled()).toBe(false);
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    expect(isRecipeFinderEnabled()).toBe(true);
  });

  it("defaults the Spoonacular cap to 10 and honours a valid override", () => {
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "");
    expect(getSpoonacularDailyCap()).toBe(DEFAULT_SPOONACULAR_DAILY_CAP);
    expect(DEFAULT_SPOONACULAR_DAILY_CAP).toBe(10);
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "25");
    expect(getSpoonacularDailyCap()).toBe(25);
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "0");
    expect(getSpoonacularDailyCap()).toBe(0);
  });

  it("ignores a garbage cap value", () => {
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "lots");
    expect(getSpoonacularDailyCap()).toBe(10);
    vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "-3");
    expect(getSpoonacularDailyCap()).toBe(10);
  });

  it("reports the online catalog configured only with a key (same check as /catalog/config)", () => {
    vi.stubEnv("SPOONACULAR_API_KEY", "");
    expect(isOnlineCatalogConfigured()).toBe(false);
    vi.stubEnv("SPOONACULAR_API_KEY", "k");
    expect(isOnlineCatalogConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/config.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/config.ts
// Read at call time, never at module load: Railway variable flips and tests
// both change process.env after import.

/** Spec §8: the whole finder sits behind this flag, off by default. */
export function isRecipeFinderEnabled(): boolean {
  return process.env.RECIPE_FINDER_ENABLED === "true";
}

/** D9: per-user Spoonacular list searches per day. */
export const DEFAULT_SPOONACULAR_DAILY_CAP = 10;

export function getSpoonacularDailyCap(): number {
  const raw = process.env.RECIPE_FINDER_SPOONACULAR_DAILY_CAP;
  if (raw === undefined || raw.trim() === "")
    return DEFAULT_SPOONACULAR_DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_SPOONACULAR_DAILY_CAP;
}

/** Same check as GET /api/meal-plan/catalog/config (§6: hide the button). */
export function isOnlineCatalogConfigured(): boolean {
  return Boolean(process.env.SPOONACULAR_API_KEY);
}
```

- [ ] **Step 4: Run** the test → PASS (4 tests).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-6.txt`: `feat(recipe-finder): flag + per-user Spoonacular cap config`.

### Task 7: `searchRecipes` opt-in `includeScores` (R3)

**Files:**

- Modify: `server/services/recipe-search.ts:152-155` (signature), `:396-409` (return)
- Test: `server/services/__tests__/recipe-search.test.ts` (append inside `describe("searchRecipes — text search")`, after line 344)

**Interfaces:**

- Produces: `searchRecipes(params: RecipeSearchParams, userId: string, opts?: { includeScores?: boolean }): Promise<RecipeSearchResponse & { scores?: Record<string, number> }>` — `scores` maps each returned result id to its MiniSearch relevance score (0 when there was no text query); absent unless opted in, so `GET /api/recipes/search`'s response is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it("returns per-result relevance scores only when includeScores is set", async () => {
  await initSearchIndex();
  const withScores = await searchRecipes({ q: "chicken" }, "user1", {
    includeScores: true,
  });
  expect(withScores.scores).toBeDefined();
  const ids = withScores.results.map((r) => r.id);
  expect(Object.keys(withScores.scores!).sort()).toEqual([...ids].sort());
  const ordered = ids.map((id) => withScores.scores![id]);
  expect(ordered).toEqual([...ordered].sort((a, b) => b - a));
  expect(ordered.every((s) => s > 0)).toBe(true);

  const plain = await searchRecipes({ q: "chicken" }, "user1");
  expect(plain.scores).toBeUndefined();
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/__tests__/recipe-search.test.ts -t "relevance scores only when includeScores"` — Expected: FAIL (`withScores.scores` is undefined).

- [ ] **Step 3: Implement**

Signature:

```ts
export async function searchRecipes(
  params: RecipeSearchParams,
  userId: string,
  opts: { includeScores?: boolean } = {},
): Promise<RecipeSearchResponse & { scores?: Record<string, number> }> {
```

Return statement:

```ts
return {
  results: page,
  total,
  offset: safeOffset,
  limit: safeLimit,
  query: {
    q: q ?? null,
    filters,
    sort,
  },
  // Opt-in (recipe finder close-match threshold, R3): MiniSearch scores are
  // otherwise discarded after sorting.
  ...(opts.includeScores
    ? {
        scores: Object.fromEntries(
          page.map((r) => [r.id, relevanceScores.get(r.id) ?? 0]),
        ),
      }
    : {}),
};
```

- [ ] **Step 4: Run** `npx vitest run server/services/__tests__/recipe-search.test.ts` → PASS (new test + all existing).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-7.txt`: `feat(recipe-search): opt-in includeScores for the recipe finder`.

### Task 8: `extractQuery` — JSON-mode AI, raw-text fallback

**Files:**

- Create: `server/services/recipe-finder/extract-query.ts`
- Create: `server/services/recipe-finder/__tests__/extract-query.test.ts`

**Interfaces:**

- Consumes: `openai`, `MODEL_FAST`, `OPENAI_TIMEOUT_FAST_MS` (`server/lib/openai.ts`); `sanitizeUserInput`, `sanitizeContextField`, `validateAiResponse`, `SYSTEM_PROMPT_BOUNDARY` (`server/lib/ai-safety.ts`) — the `food-nlp.ts:74-105` pattern.
- Produces: `extractQuery(text: string, context?: { dietType?: string | null }): Promise<RecipeQuery>` (never throws) and `rawQuery(text: string): RecipeQuery`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/recipe-finder/__tests__/extract-query.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractQuery, rawQuery } from "../extract-query";
import { openai } from "../../../lib/openai";

vi.mock("../../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  OPENAI_TIMEOUT_FAST_MS: 15_000,
  MODEL_FAST: "gpt-4o-mini",
}));

vi.mock("../../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  validateAiResponse: vi.fn(
    (
      data: unknown,
      schema: {
        safeParse: (d: unknown) => { success: boolean; data?: unknown };
      },
    ) => {
      const r = schema.safeParse(data);
      return r.success ? r.data : null;
    },
  ),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

function aiReturns(json: unknown) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(json) } }],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractQuery", () => {
  it("maps the AI JSON onto a RecipeQuery, dropping nulls", async () => {
    aiReturns({
      q: "quinoa salad",
      cuisine: "mediterranean",
      diet: null,
      maxPrepTime: 20,
      mealType: "lunch",
    });
    await expect(
      extractQuery("a quick mediterranean quinoa salad for lunch"),
    ).resolves.toEqual({
      q: "quinoa salad",
      cuisine: "mediterranean",
      maxPrepTime: 20,
      mealType: "lunch",
    });
    const call = mockCreate.mock.calls[0][0] as {
      response_format: unknown;
      model: string;
    };
    expect(call.response_format).toEqual({ type: "json_object" });
    expect(call.model).toBe("gpt-4o-mini");
  });

  it("drops an invalid optional field but keeps q", async () => {
    aiReturns({ q: "pancakes", mealType: "brunch", maxPrepTime: -5 });
    await expect(extractQuery("pancakes for brunch")).resolves.toEqual({
      q: "pancakes",
    });
  });

  it("searches the raw text when the AI call throws (timeout)", async () => {
    mockCreate.mockRejectedValue(new Error("Request timed out."));
    await expect(extractQuery("Mediterranean")).resolves.toEqual({
      q: "Mediterranean",
    });
  });

  it("searches the raw text on invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    } as never);
    await expect(extractQuery("salmon")).resolves.toEqual({ q: "salmon" });
  });

  it("searches the raw text when the AI returns an empty q", async () => {
    aiReturns({ q: "   " });
    await expect(extractQuery("tofu stir fry")).resolves.toEqual({
      q: "tofu stir fry",
    });
  });
});

describe("rawQuery", () => {
  it("caps q at 200 chars and never returns an empty q", () => {
    expect(rawQuery("x".repeat(300)).q).toHaveLength(200);
    expect(rawQuery("   ").q).toBe("recipe");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/extract-query.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/extract-query.ts
import { z } from "zod";
import { openai, OPENAI_TIMEOUT_FAST_MS, MODEL_FAST } from "../../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { createServiceLogger, toError } from "../../lib/logger";
import {
  recipeQuerySchema,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";

const log = createServiceLogger("recipe-finder-extract-query");

// Lenient on the wire: a bad optional field degrades to "absent" below; only
// a missing/blank q falls back to the raw text.
const aiQuerySchema = z.object({
  q: z.string().optional(),
  cuisine: z.string().nullable().optional(),
  diet: z.string().nullable().optional(),
  maxPrepTime: z.number().nullable().optional(),
  mealType: z.string().nullable().optional(),
});

/** §6: on any extractQuery failure, search the raw text with no filters. */
export function rawQuery(text: string): RecipeQuery {
  const q = sanitizeUserInput(text).trim().slice(0, 200);
  return { q: q || "recipe" };
}

export async function extractQuery(
  text: string,
  context: { dietType?: string | null } = {},
): Promise<RecipeQuery> {
  const sanitized = sanitizeUserInput(text);
  const dietLine = context.dietType
    ? `The user's saved diet type is "${sanitizeContextField(context.dietType, 50)}". Do not add it unless the request mentions a diet.`
    : "";

  let content: string | null | undefined;
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        temperature: 0,
        max_completion_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You turn a recipe request into search terms.
Return JSON: {"q": string, "cuisine": string|null, "diet": string|null, "maxPrepTime": number|null, "mealType": "breakfast"|"lunch"|"dinner"|"snack"|null}
- "q": 1-6 plain words naming the dish or main ingredients (e.g. "chicken curry", "quinoa salad"). No filler words like "recipe", "please", "something".
- "cuisine": only if the user named a cuisine (e.g. "mediterranean", "thai"), else null.
- "diet": one of "vegetarian", "vegan", "gluten free", "dairy free", "ketogenic", "paleo" — only if named, else null.
- "maxPrepTime": minutes, only if the user gave a time limit, else null.
- "mealType": only if named, else null.
${dietLine}

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          { role: "user", content: sanitized },
        ],
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
    content = response.choices[0]?.message?.content;
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "extractQuery failed; searching raw text",
    );
    return rawQuery(text);
  }
  if (!content) return rawQuery(text);

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return rawQuery(text);
  }
  const ai = validateAiResponse(json, aiQuerySchema);
  const aiQ = ai?.q?.trim();
  if (!ai || !aiQ) return rawQuery(text);

  const q = aiQ.slice(0, 200);
  const optional = {
    cuisine: ai.cuisine ?? undefined,
    diet: ai.diet ?? undefined,
    maxPrepTime: ai.maxPrepTime ?? undefined,
    mealType: ai.mealType ?? undefined,
  };
  // Keep each optional field only if it validates on its own.
  const result: RecipeQuery = { q };
  for (const key of Object.keys(optional) as (keyof typeof optional)[]) {
    const value = optional[key];
    if (value === undefined) continue;
    const parsed = recipeQuerySchema.shape[key].safeParse(value);
    if (parsed.success && parsed.data !== undefined) {
      (result as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run** the test file → PASS (6 tests).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-8.txt`: `feat(recipe-finder): extractQuery with raw-text fallback`.

### Task 9: `findCommunity` — cuisine into q, never maxPrepTime, q-only retry, relative threshold

**Files:**

- Create: `server/services/recipe-finder/find-community.ts`
- Create: `server/services/recipe-finder/__tests__/find-community.test.ts`

**Interfaces:**

- Consumes: `searchRecipes(params, userId, { includeScores: true })` (Task 7); `isIndexInitialized()` (`server/lib/search-index.ts`); `initSearchIndex()`.
- Produces:
  - `CLOSE_MATCH_RELATIVE: number`, `CLOSE_MATCH_FLOOR: number` (provisional values below; Task 10 replaces them with measured ones)
  - `interface ScoredHit { recipe: SearchableRecipe; score: number }`
  - `selectCloseMatches(hits: ScoredHit[], opts?: { relative: number; floor: number; max: number }): ScoredHit[]`
  - `communityQueryText(query: RecipeQuery): string`
  - `toFinderItem(recipe: SearchableRecipe): FinderItem | null`
  - `findCommunity(query: RecipeQuery, userId: string, excludeIds: string[], thresholds?: { relative: number; floor: number }): Promise<FinderItem[]>` (never throws; `[]` when the index is not ready)

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/recipe-finder/__tests__/find-community.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchableRecipe } from "@shared/types/recipe-search";
import {
  findCommunity,
  selectCloseMatches,
  communityQueryText,
  toFinderItem,
} from "../find-community";
import { searchRecipes, initSearchIndex } from "../../recipe-search";
import { isIndexInitialized } from "../../../lib/search-index";

vi.mock("../../recipe-search", () => ({
  searchRecipes: vi.fn(),
  initSearchIndex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../lib/search-index", () => ({
  isIndexInitialized: vi.fn().mockReturnValue(true),
}));
vi.mock("../../../lib/fire-and-forget", () => ({
  fireAndForget: vi.fn((_l: string, p: Promise<unknown>) => {
    p.catch(() => {});
  }),
}));

function recipe(
  id: number,
  title: string,
  overrides: Partial<SearchableRecipe> = {},
): SearchableRecipe {
  return {
    id: `community:${id}`,
    source: "community",
    userId: null,
    title,
    description: null,
    ingredients: ["x"],
    cuisine: null,
    dietTags: [],
    mealTypes: [],
    difficulty: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    caloriesPerServing: 350.4,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    servings: 2,
    imageUrl: null,
    sourceUrl: null,
    createdAt: null,
    isCanonical: false,
    allergens: [],
    ...overrides,
  };
}

function searchReturns(hits: [SearchableRecipe, number][]) {
  vi.mocked(searchRecipes).mockResolvedValueOnce({
    results: hits.map(([r]) => r),
    total: hits.length,
    offset: 0,
    limit: 25,
    query: { q: "x", filters: {}, sort: "relevance" },
    scores: Object.fromEntries(hits.map(([r, s]) => [r.id, s])),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isIndexInitialized).mockReturnValue(true);
});

describe("selectCloseMatches", () => {
  const hits = [
    { recipe: recipe(1, "A"), score: 20 },
    { recipe: recipe(2, "B"), score: 12 },
    { recipe: recipe(3, "C"), score: 9 },
    { recipe: recipe(4, "D"), score: 3 },
  ];

  it("keeps hits at or above relative × best, capped at max", () => {
    const out = selectCloseMatches(hits, { relative: 0.5, floor: 0, max: 5 });
    expect(out.map((h) => h.score)).toEqual([20, 12]);
  });

  it("applies the absolute floor so a lone weak hit is not shown", () => {
    expect(
      selectCloseMatches([{ recipe: recipe(9, "Z"), score: 2 }], {
        relative: 0.5,
        floor: 4,
        max: 5,
      }),
    ).toEqual([]);
  });

  it("returns [] for no hits", () => {
    expect(selectCloseMatches([], { relative: 0.5, floor: 0, max: 5 })).toEqual(
      [],
    );
  });
});

describe("communityQueryText", () => {
  it("puts cuisine into q (community rows have cuisine null — R3)", () => {
    expect(
      communityQueryText({ q: "quinoa salad", cuisine: "mediterranean" }),
    ).toBe("mediterranean quinoa salad");
  });
});

describe("toFinderItem", () => {
  it("maps id, rounds calories, and leaves time null for community rows", () => {
    expect(toFinderItem(recipe(12, "Salad"))).toEqual({
      id: 12,
      source: "community",
      title: "Salad",
      imageUrl: null,
      readyInMinutes: null,
      calories: 350,
    });
  });
});

describe("findCommunity", () => {
  it("never sends maxPrepTime or a cuisine filter, and asks for scores", async () => {
    searchReturns([[recipe(1, "Mediterranean Quinoa Salad"), 20]]);
    await findCommunity(
      { q: "quinoa salad", cuisine: "mediterranean", maxPrepTime: 20 },
      "u1",
      [],
    );
    const [params, userId, opts] = vi.mocked(searchRecipes).mock.calls[0];
    expect(params).toMatchObject({
      q: "mediterranean quinoa salad",
      source: "community",
      safeForMe: true,
    });
    expect(params).not.toHaveProperty("maxPrepTime");
    expect(params).not.toHaveProperty("cuisine");
    expect(userId).toBe("u1");
    expect(opts).toEqual({ includeScores: true });
  });

  it("retries once with q only when the filtered search returns nothing", async () => {
    searchReturns([]);
    searchReturns([[recipe(5, "Vegan Chili"), 15]]);
    const items = await findCommunity(
      { q: "chili", diet: "vegan", mealType: "dinner" },
      "u1",
      [],
    );
    expect(vi.mocked(searchRecipes)).toHaveBeenCalledTimes(2);
    const retry = vi.mocked(searchRecipes).mock.calls[1][0];
    expect(retry).not.toHaveProperty("diet");
    expect(retry).not.toHaveProperty("mealType");
    expect(retry).toMatchObject({
      q: "chili",
      safeForMe: true,
      source: "community",
    });
    expect(items.map((i) => i.id)).toEqual([5]);
  });

  it("excludes already-shown ids", async () => {
    searchReturns([
      [recipe(1, "A"), 20],
      [recipe(2, "B"), 19],
    ]);
    const items = await findCommunity({ q: "a" }, "u1", ["community:1"]);
    expect(items.map((i) => i.id)).toEqual([2]);
  });

  it("treats a not-ready index as 0 matches and starts the build (§6)", async () => {
    vi.mocked(isIndexInitialized).mockReturnValue(false);
    await expect(findCommunity({ q: "a" }, "u1", [])).resolves.toEqual([]);
    expect(searchRecipes).not.toHaveBeenCalled();
    expect(initSearchIndex).toHaveBeenCalled();
  });

  it("returns [] when the search throws", async () => {
    vi.mocked(searchRecipes).mockRejectedValueOnce(new Error("db down"));
    await expect(findCommunity({ q: "a" }, "u1", [])).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/find-community.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/find-community.ts
import type {
  RecipeSearchParams,
  SearchableRecipe,
} from "@shared/types/recipe-search";
import {
  FINDER_MAX_ITEMS,
  type FinderItem,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";
import { searchRecipes, initSearchIndex } from "../recipe-search";
import { isIndexInitialized } from "../../lib/search-index";
import { fireAndForget } from "../../lib/fire-and-forget";
import { createServiceLogger, toError } from "../../lib/logger";

const log = createServiceLogger("recipe-finder-community");

/**
 * Keep hits scoring at least this fraction of the best hit. Relative because
 * MiniSearch scores are unnormalized and an absolute cut drifts as the
 * catalog grows (spec §4). MEASURED in Task 10 — see the gold set.
 */
export const CLOSE_MATCH_RELATIVE = 0.5;
/** Absolute floor so a lone weak hit is not shown. MEASURED in Task 10. */
export const CLOSE_MATCH_FLOOR = 5;

export interface ScoredHit {
  recipe: SearchableRecipe;
  score: number;
}

export function selectCloseMatches(
  hits: ScoredHit[],
  opts: { relative: number; floor: number; max: number } = {
    relative: CLOSE_MATCH_RELATIVE,
    floor: CLOSE_MATCH_FLOOR,
    max: FINDER_MAX_ITEMS,
  },
): ScoredHit[] {
  if (hits.length === 0) return [];
  const best = Math.max(...hits.map((h) => h.score));
  const cutoff = Math.max(opts.floor, best * opts.relative);
  return hits
    .filter((h) => h.score >= cutoff)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.max);
}

/** R3: community rows always have cuisine null, so cuisine goes into q. */
export function communityQueryText(query: RecipeQuery): string {
  return [query.cuisine, query.q].filter(Boolean).join(" ");
}

export function toFinderItem(r: SearchableRecipe): FinderItem | null {
  const id = parseInt(r.id.split(":")[1] ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    source: "community",
    title: r.title.slice(0, 200),
    imageUrl: r.imageUrl,
    readyInMinutes:
      r.totalTimeMinutes !== null && r.totalTimeMinutes > 0
        ? Math.round(r.totalTimeMinutes)
        : null,
    calories:
      r.caloriesPerServing !== null && r.caloriesPerServing >= 0
        ? Math.round(r.caloriesPerServing)
        : null,
  };
}

export async function findCommunity(
  query: RecipeQuery,
  userId: string,
  excludeIds: string[],
  thresholds: { relative: number; floor: number } = {
    relative: CLOSE_MATCH_RELATIVE,
    floor: CLOSE_MATCH_FLOOR,
  },
): Promise<FinderItem[]> {
  // §6: an index still building at boot is 0 matches, not a wait.
  if (!isIndexInitialized()) {
    fireAndForget("recipe-finder-index-init", initSearchIndex());
    return [];
  }
  const q = communityQueryText(query);
  const exclude = new Set(excludeIds);

  const run = async (
    filters: Pick<RecipeSearchParams, "diet" | "mealType">,
  ): Promise<ScoredHit[]> => {
    // Never maxPrepTime (every community row has null prep time — R3) and
    // never the cuisine filter (it is already in q).
    const res = await searchRecipes(
      {
        ...filters,
        q,
        source: "community",
        safeForMe: true,
        sort: "relevance",
        limit: 25,
      },
      userId,
      { includeScores: true },
    );
    return res.results
      .filter((r) => !exclude.has(r.id))
      .map((r) => ({ recipe: r, score: res.scores?.[r.id] ?? 0 }));
  };

  try {
    const filters: Pick<RecipeSearchParams, "diet" | "mealType"> = {};
    if (query.diet) filters.diet = query.diet;
    if (query.mealType) filters.mealType = query.mealType;
    let hits = await run(filters);
    // A small catalog + a structured filter often zeroes out: retry q-only.
    if (hits.length === 0 && Object.keys(filters).length > 0) {
      hits = await run({});
    }
    return selectCloseMatches(hits, { ...thresholds, max: FINDER_MAX_ITEMS })
      .map((h) => toFinderItem(h.recipe))
      .filter((i): i is FinderItem => i !== null);
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "findCommunity failed; treating as 0 matches",
    );
    return [];
  }
}
```

- [ ] **Step 4: Run** the test file → PASS (10 tests).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-9.txt`: `feat(recipe-finder): findCommunity with q-only retry and relative close-match threshold`.

### Task 10: Measure the close-match threshold against a gold set (spec §7)

The two constants in Task 9 are provisional. This task replaces them with measured values, following `docs/solutions/logic-errors/food-name-matcher-whole-words-gold-set-2026-09-27.md` (label right answers, score right/wrong/none, report both versions, one tuning pass).

**Files:**

- Create: `scripts/export-community-catalog-fixture.ts`
- Create (generated): `server/services/recipe-finder/__tests__/fixtures/community-catalog.json`
- Create: `server/services/recipe-finder/__tests__/fixtures/finder-gold-set.json`
- Create: `server/services/recipe-finder/__tests__/close-match-gold-set.test.ts`
- Modify: `server/services/recipe-finder/find-community.ts` (the two constants)

**Interfaces:**

- Consumes: `storage.getAllPublicCommunityRecipes()` (public rows only), `findCommunity(query, userId, excludeIds, thresholds)`.
- Produces: the measured `CLOSE_MATCH_RELATIVE` / `CLOSE_MATCH_FLOOR`, and a pinned test asserting the exact right/wrong/none request sets at those values.

- [ ] **Step 1: Write the fixture exporter**

```ts
// scripts/export-community-catalog-fixture.ts
/**
 * Writes a fixture copy of the PUBLIC community catalog for the recipe-finder
 * close-match gold set (spec §7). Public recipe content only: no author ids,
 * no image URLs.
 *
 *   NODE_ENV=development DATABASE_URL=postgresql://localhost/nutricam npx tsx scripts/export-community-catalog-fixture.ts
 *
 * If the dev catalog is not representative of production, ask the user to run
 * the same command against production (prod reads are run by the user).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storage } from "../server/storage";

const OUT = path.resolve(
  process.cwd(),
  "server/services/recipe-finder/__tests__/fixtures/community-catalog.json",
);

async function main(): Promise<void> {
  const rows = await storage.getAllPublicCommunityRecipes();
  const fixture = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    ingredients: (r.ingredients ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity ?? "",
      unit: i.unit ?? "",
    })),
    dietTags: r.dietTags ?? [],
    mealTypes: r.mealTypes ?? [],
    allergens: r.allergens ?? null,
    difficulty: r.difficulty ?? null,
    servings: r.servings ?? null,
    caloriesPerServing: r.caloriesPerServing ?? null,
    proteinPerServing: r.proteinPerServing ?? null,
    carbsPerServing: r.carbsPerServing ?? null,
    fatPerServing: r.fatPerServing ?? null,
    imageUrl: null,
    isCanonical: r.isCanonical ?? false,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  }));
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${fixture.length} public community recipes to ${OUT}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
```

- [ ] **Step 2: Export the fixture**

Run: `NODE_ENV=development DATABASE_URL=postgresql://localhost/nutricam npx tsx scripts/export-community-catalog-fixture.ts` (the shell exports `NODE_ENV=production`; override it so the dev DB/SSL settings apply)
Expected: `wrote N public community recipes to …/community-catalog.json` with N > 0. **Record N.** If N < 30, stop and ask the user whether to export from production instead (the user runs prod reads via `!`); the spec's threshold is only meaningful on a realistic catalog.

- [ ] **Step 3: Write the gold set**

Create `server/services/recipe-finder/__tests__/fixtures/finder-gold-set.json`. Each `query` is what `extractQuery` would produce for the `request`; `right` lists every fixture id that is genuinely a close match (grep the fixture titles/ingredients before labelling — a query with no genuine match gets `"right": []`). The requests are fixed; only the ids come from the fixture:

```json
{
  "measured": {
    "relative": null,
    "floor": null,
    "right": [],
    "wrong": [],
    "none": []
  },
  "queries": [
    {
      "request": "Mediterranean",
      "query": { "q": "mediterranean" },
      "right": []
    },
    {
      "request": "mediterranean dinner",
      "query": {
        "q": "dinner",
        "cuisine": "mediterranean",
        "mealType": "dinner"
      },
      "right": []
    },
    {
      "request": "chicken curry",
      "query": { "q": "chicken curry" },
      "right": []
    },
    {
      "request": "quick chicken dinner",
      "query": { "q": "chicken", "mealType": "dinner", "maxPrepTime": 30 },
      "right": []
    },
    {
      "request": "vegan pasta",
      "query": { "q": "pasta", "diet": "vegan" },
      "right": []
    },
    {
      "request": "vegetarian chili",
      "query": { "q": "chili", "diet": "vegetarian" },
      "right": []
    },
    { "request": "salmon", "query": { "q": "salmon" }, "right": [] },
    {
      "request": "something with salmon and rice",
      "query": { "q": "salmon rice" },
      "right": []
    },
    {
      "request": "high protein breakfast",
      "query": { "q": "high protein breakfast", "mealType": "breakfast" },
      "right": []
    },
    {
      "request": "overnight oats",
      "query": { "q": "overnight oats" },
      "right": []
    },
    { "request": "pancakes", "query": { "q": "pancakes" }, "right": [] },
    {
      "request": "banana bread",
      "query": { "q": "banana bread" },
      "right": []
    },
    {
      "request": "beef stir fry",
      "query": { "q": "beef stir fry" },
      "right": []
    },
    {
      "request": "tofu stir fry",
      "query": { "q": "tofu stir fry" },
      "right": []
    },
    { "request": "lentil soup", "query": { "q": "lentil soup" }, "right": [] },
    {
      "request": "chicken soup",
      "query": { "q": "chicken soup" },
      "right": []
    },
    {
      "request": "greek salad",
      "query": { "q": "salad", "cuisine": "greek" },
      "right": []
    },
    {
      "request": "quinoa salad",
      "query": { "q": "quinoa salad" },
      "right": []
    },
    { "request": "tacos", "query": { "q": "tacos" }, "right": [] },
    { "request": "fish tacos", "query": { "q": "fish tacos" }, "right": [] },
    {
      "request": "shrimp pasta",
      "query": { "q": "shrimp pasta" },
      "right": []
    },
    {
      "request": "egg breakfast",
      "query": { "q": "eggs", "mealType": "breakfast" },
      "right": []
    },
    { "request": "a smoothie", "query": { "q": "smoothie" }, "right": [] },
    {
      "request": "chocolate dessert",
      "query": { "q": "chocolate dessert" },
      "right": []
    },
    { "request": "cookies", "query": { "q": "cookies" }, "right": [] },
    {
      "request": "keto dinner",
      "query": { "q": "dinner", "diet": "ketogenic", "mealType": "dinner" },
      "right": []
    },
    {
      "request": "gluten free dinner",
      "query": { "q": "dinner", "diet": "gluten free", "mealType": "dinner" },
      "right": []
    },
    {
      "request": "turkey meatballs",
      "query": { "q": "turkey meatballs" },
      "right": []
    },
    {
      "request": "beef wellington",
      "query": { "q": "beef wellington" },
      "right": []
    },
    {
      "request": "lobster thermidor",
      "query": { "q": "lobster thermidor" },
      "right": []
    }
  ]
}
```

(Replace each `"right": []` with the labelled ids; leave `[]` only where the fixture has no genuine match. Keep at least 5 genuine-none queries — the two named ones plus any the fixture lacks.)

- [ ] **Step 4: Write the measurement + pinned test (fails until measured)**

```ts
// server/services/recipe-finder/__tests__/close-match-gold-set.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RecipeQuery } from "@shared/schemas/recipe-finder";
import {
  findCommunity,
  CLOSE_MATCH_RELATIVE,
  CLOSE_MATCH_FLOOR,
} from "../find-community";
import { initSearchIndex, resetSearchIndex } from "../../recipe-search";

vi.mock("../../../storage", () => ({
  storage: {
    getAllMealPlanRecipes: vi.fn().mockResolvedValue([]),
    getAllRecipeIngredients: vi.fn().mockResolvedValue(new Map()),
    // Read lazily inside the mock: vi.mock is hoisted above every
    // module-scope const, so the factory must not close over one.
    getAllPublicCommunityRecipes: vi.fn(async () => {
      const { readFileSync } = await import("node:fs");
      const rows: { createdAt: string | null }[] = JSON.parse(
        readFileSync(
          `${process.cwd()}/server/services/recipe-finder/__tests__/fixtures/community-catalog.json`,
          "utf8",
        ),
      );
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt) : null,
      }));
    }),
    getPantryItems: vi.fn().mockResolvedValue([]),
    // safeForMe is a no-op for a user with no allergies.
    getUserProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Read with fs, like nutrition-lookup.test.ts's cnf-gold-set.json.
const FIXTURES = path.join(
  process.cwd(),
  "server/services/recipe-finder/__tests__/fixtures",
);
const catalog: { createdAt: string | null }[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "community-catalog.json"), "utf8"),
);
interface GoldQuery {
  request: string;
  query: RecipeQuery;
  right: number[];
}
const gold: {
  measured: {
    relative: number | null;
    floor: number | null;
    right: string[];
    wrong: string[];
    none: string[];
  };
  queries: GoldQuery[];
} = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "finder-gold-set.json"), "utf8"),
);

type Outcome = "right" | "wrong" | "none";

async function outcomes(relative: number, floor: number) {
  const byOutcome: Record<Outcome, string[]> = {
    right: [],
    wrong: [],
    none: [],
  };
  let correct = 0;
  for (const g of gold.queries) {
    const items = await findCommunity(g.query, "gold-user", [], {
      relative,
      floor,
    });
    const outcome: Outcome =
      items.length === 0
        ? "none"
        : items.every((i) => g.right.includes(i.id))
          ? "right"
          : "wrong";
    byOutcome[outcome].push(g.request);
    if (
      (g.right.length === 0 && outcome === "none") ||
      (g.right.length > 0 && outcome === "right")
    )
      correct++;
  }
  return { byOutcome, correct };
}

beforeAll(async () => {
  resetSearchIndex();
  await initSearchIndex();
});

describe.skipIf(process.env.MEASURE_FINDER_THRESHOLD !== "1")(
  "close-match threshold sweep (measurement)",
  () => {
    it("prints right/wrong/none per (relative, floor)", async () => {
      const rows: string[] = [];
      for (const relative of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        for (const floor of [0, 2, 4, 6, 8, 10, 12]) {
          const { byOutcome, correct } = await outcomes(relative, floor);
          rows.push(
            `${relative}\t${floor}\tcorrect=${correct}\tright=${byOutcome.right.length}\twrong=${byOutcome.wrong.length}\tnone=${byOutcome.none.length}`,
          );
        }
      }
      console.log(`relative\tfloor\t…\n${rows.join("\n")}`);
      expect(rows.length).toBeGreaterThan(0);
    });
  },
);

describe("close-match threshold — committed gold set", () => {
  it("uses the measured constants", () => {
    expect(CLOSE_MATCH_RELATIVE).toBe(gold.measured.relative);
    expect(CLOSE_MATCH_FLOOR).toBe(gold.measured.floor);
  });

  it("reproduces the measured right / wrong / none sets exactly", async () => {
    const { byOutcome } = await outcomes(
      CLOSE_MATCH_RELATIVE,
      CLOSE_MATCH_FLOOR,
    );
    expect(byOutcome.right.sort()).toEqual([...gold.measured.right].sort());
    expect(byOutcome.wrong.sort()).toEqual([...gold.measured.wrong].sort());
    expect(byOutcome.none.sort()).toEqual([...gold.measured.none].sort());
  });

  it("positive control: the fixture is loaded and at least one query finds a right match", async () => {
    expect(catalog.length).toBeGreaterThan(0);
    const { byOutcome } = await outcomes(
      CLOSE_MATCH_RELATIVE,
      CLOSE_MATCH_FLOOR,
    );
    expect(byOutcome.right.length).toBeGreaterThan(0);
  });
});
```

(Fixtures are read with `fs`, following `nutrition-lookup.test.ts`'s `cnf-gold-set.json`; the storage mock reads the catalog lazily because `vi.mock` factories are hoisted above module-scope consts.)

- [ ] **Step 5: Run to verify red**

Run: `npx vitest run server/services/recipe-finder/__tests__/close-match-gold-set.test.ts -t "committed gold set"`
Expected: FAIL — `uses the measured constants` (`0.5` vs `null`).

- [ ] **Step 6: Measure**

Run: `MEASURE_FINDER_THRESHOLD=1 npx vitest run server/services/recipe-finder/__tests__/close-match-gold-set.test.ts -t "sweep"`
Pick the `(relative, floor)` row with the highest `correct`; break ties by fewest `wrong`, then by the higher floor. Record the provisional `(0.5, 5)` row too — both go in the PR body. One tuning pass, then stop.

- [ ] **Step 7: Pin the measurement**

Set `CLOSE_MATCH_RELATIVE` / `CLOSE_MATCH_FLOOR` in `find-community.ts` to the chosen values (update the doc comments to say "measured 2026-09-xx on N public recipes, see finder-gold-set.json"). Fill `gold.measured` with `relative`, `floor`, and the exact `right`/`wrong`/`none` request lists printed at those values (re-run with a temporary `console.log(byOutcome)` if needed, then remove it).

Run: `npx vitest run server/services/recipe-finder/__tests__/close-match-gold-set.test.ts server/services/recipe-finder/__tests__/find-community.test.ts`
Expected: PASS (the sweep is skipped without the env var; `find-community.test.ts` passes explicit thresholds, so it is independent of the constants).

- [ ] **Step 8: Commit** — `commit-msg-finder-task-10.txt`: `feat(recipe-finder): measured close-match threshold (gold set, N recipes)` with the sweep table's chosen and provisional rows in the body; add the script, both fixtures, the test and `find-community.ts`.

### Task 11: `findOnline` — Spoonacular list, no nutrition, `unavailable` on any failure

**Files:**

- Modify: `server/services/recipe-catalog.ts` (append `buildIntolerancesParam` + its map, moved verbatim from the route)
- Modify: `server/routes/recipe-catalog.ts:7-10, 26-52` (delete the local map/function, import from the service)
- Create: `server/services/recipe-finder/find-online.ts`
- Create: `server/services/recipe-finder/__tests__/find-online.test.ts`

**Interfaces:**

- Produces: `export function buildIntolerancesParam(allergies: unknown): string | undefined` (in `server/services/recipe-catalog.ts`); `export type FindOnlineResult = { status: "ok"; items: FinderItem[] } | { status: "unavailable" }`; `findOnline(query: RecipeQuery, allergies: unknown): Promise<FindOnlineResult>` (never throws).
- Consumes: `searchCatalogRecipes` (`recipe-catalog.ts:209`, 10s timeout, throws `CatalogQuotaError` on 402), `isOnlineCatalogConfigured()` (Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/recipe-finder/__tests__/find-online.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findOnline } from "../find-online";
import { searchCatalogRecipes, CatalogQuotaError } from "../../recipe-catalog";

vi.mock("../../recipe-catalog", async () => {
  const actual = await vi.importActual<typeof import("../../recipe-catalog")>(
    "../../recipe-catalog",
  );
  return { ...actual, searchCatalogRecipes: vi.fn() };
});

const allergies = [
  { name: "peanuts", severity: "severe" },
  { name: "milk", severity: "mild" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SPOONACULAR_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("findOnline", () => {
  it("sends q, cuisine, diet, meal type, time and intolerances — and never asks for nutrition", async () => {
    vi.mocked(searchCatalogRecipes).mockResolvedValue({
      results: [
        {
          id: 715538,
          title: "Bowl",
          image: "https://img/1.jpg",
          readyInMinutes: 25,
        },
      ],
      offset: 0,
      number: 5,
      totalResults: 1,
    });
    const result = await findOnline(
      {
        q: "quinoa salad",
        cuisine: "mediterranean",
        diet: "vegan",
        mealType: "dinner",
        maxPrepTime: 20,
      },
      allergies,
    );
    expect(searchCatalogRecipes).toHaveBeenCalledWith({
      query: "quinoa salad",
      number: 5,
      cuisine: "mediterranean",
      diet: "vegan",
      type: "main course",
      maxReadyTime: 20,
      intolerances: "peanut,dairy",
    });
    expect(result).toEqual({
      status: "ok",
      items: [
        {
          id: 715538,
          source: "spoonacular",
          title: "Bowl",
          imageUrl: "https://img/1.jpg",
          readyInMinutes: 25,
          calories: null,
        },
      ],
    });
  });

  it("returns unavailable on a 402 quota error", async () => {
    vi.mocked(searchCatalogRecipes).mockRejectedValue(
      new CatalogQuotaError("Spoonacular API quota exceeded"),
    );
    await expect(findOnline({ q: "tacos" }, [])).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable on a timeout/network error", async () => {
    vi.mocked(searchCatalogRecipes).mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
    await expect(findOnline({ q: "tacos" }, [])).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable without a call when SPOONACULAR_API_KEY is unset", async () => {
    vi.stubEnv("SPOONACULAR_API_KEY", "");
    await expect(findOnline({ q: "tacos" }, [])).resolves.toEqual({
      status: "unavailable",
    });
    expect(searchCatalogRecipes).not.toHaveBeenCalled();
  });

  it("reports ok with zero items for a genuine empty result", async () => {
    vi.mocked(searchCatalogRecipes).mockResolvedValue({
      results: [],
      offset: 0,
      number: 5,
      totalResults: 0,
    });
    await expect(findOnline({ q: "zzz" }, [])).resolves.toEqual({
      status: "ok",
      items: [],
    });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/find-online.test.ts` — Expected: FAIL, module `../find-online` not found.

- [ ] **Step 3: Implement**

Append to `server/services/recipe-catalog.ts` (add `import { parseUserAllergies, type AllergenId } from "@shared/constants/allergens";` at the top):

```ts
/**
 * Maps OCRecipes allergen IDs to Spoonacular intolerance parameter values.
 * See: https://spoonacular.com/food-api/docs#Intolerances
 * (Moved from server/routes/recipe-catalog.ts so the recipe finder shares it.)
 */
const SPOONACULAR_INTOLERANCE_MAP: Partial<Record<AllergenId, string>> = {
  peanuts: "peanut",
  tree_nuts: "tree nut",
  milk: "dairy",
  eggs: "egg",
  wheat: "wheat",
  soy: "soy",
  fish: "seafood",
  shellfish: "shellfish",
  sesame: "sesame",
};

export function buildIntolerancesParam(allergies: unknown): string | undefined {
  const parsed = parseUserAllergies(allergies);
  if (parsed.length === 0) return undefined;
  const values: string[] = [];
  for (const allergy of parsed) {
    const spoonacularValue =
      SPOONACULAR_INTOLERANCE_MAP[allergy.name as AllergenId];
    if (spoonacularValue) values.push(spoonacularValue);
  }
  return values.length > 0 ? values.join(",") : undefined;
}
```

In `server/routes/recipe-catalog.ts`, delete lines 26-52 (the map and function) and the now-unused `parseUserAllergies, type AllergenId` import, and import `buildIntolerancesParam` alongside `searchCatalogRecipes` from `../services/recipe-catalog`.

```ts
// server/services/recipe-finder/find-online.ts
import {
  FINDER_MAX_ITEMS,
  type FinderItem,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";
import {
  searchCatalogRecipes,
  buildIntolerancesParam,
  CatalogQuotaError,
} from "../recipe-catalog";
import { isOnlineCatalogConfigured } from "./config";
import { createServiceLogger, toError } from "../../lib/logger";

const log = createServiceLogger("recipe-finder-online");

export type FindOnlineResult =
  | { status: "ok"; items: FinderItem[] }
  | { status: "unavailable" };

// Spoonacular's `type` vocabulary (complexSearch).
const SPOONACULAR_MEAL_TYPE: Record<
  NonNullable<RecipeQuery["mealType"]>,
  string
> = {
  breakfast: "breakfast",
  lunch: "main course",
  dinner: "main course",
  snack: "snack",
};

/**
 * List search only — no addRecipeNutrition (~1 quota point per search;
 * nutrition is fetched only when a preview opens). Any failure is
 * "unavailable", never "no results" (§6).
 */
export async function findOnline(
  query: RecipeQuery,
  allergies: unknown,
): Promise<FindOnlineResult> {
  if (!isOnlineCatalogConfigured()) return { status: "unavailable" };
  const intolerances = buildIntolerancesParam(allergies);
  try {
    const res = await searchCatalogRecipes({
      query: query.q,
      number: FINDER_MAX_ITEMS,
      ...(query.cuisine && { cuisine: query.cuisine }),
      ...(query.diet && { diet: query.diet }),
      ...(query.mealType && { type: SPOONACULAR_MEAL_TYPE[query.mealType] }),
      ...(query.maxPrepTime && { maxReadyTime: query.maxPrepTime }),
      ...(intolerances && { intolerances }),
    });
    const items: FinderItem[] = res.results
      .filter((r) => Number.isInteger(r.id) && r.id > 0)
      .slice(0, FINDER_MAX_ITEMS)
      .map((r) => ({
        id: r.id,
        source: "spoonacular",
        title: r.title.slice(0, 200),
        imageUrl: r.image ?? null,
        readyInMinutes:
          r.readyInMinutes !== undefined && r.readyInMinutes > 0
            ? Math.round(r.readyInMinutes)
            : null,
        calories: null,
      }));
    return { status: "ok", items };
  } catch (error) {
    log.warn(
      { err: toError(error), quota: error instanceof CatalogQuotaError },
      "findOnline failed; reporting unavailable",
    );
    return { status: "unavailable" };
  }
}
```

- [ ] **Step 4: Run**

`npx vitest run server/services/recipe-finder/__tests__/find-online.test.ts` → PASS (5).
`npx vitest run server/routes/__tests__/recipe-catalog.test.ts -t "intolerances"` → PASS (the moved function is still used; the route test's `...actual` spread keeps it real).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-11.txt`: `feat(recipe-finder): findOnline (no nutrition, unavailable on failure); share buildIntolerancesParam`.

### Task 12: `askClarifying` — 2–3 questions, fixed fallback

**Files:**

- Create: `server/services/recipe-finder/ask-clarifying.ts`
- Create: `server/services/recipe-finder/__tests__/ask-clarifying.test.ts`

**Interfaces:**

- Produces: `FALLBACK_QUESTIONS: ClarifyingQuestion[]` (time, cuisine, diet); `askClarifying(request: string, history: { role: "user" | "assistant"; content: string }[]): Promise<ClarifyingQuestion[]>` (never throws; always 2–3 items).

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/recipe-finder/__tests__/ask-clarifying.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { askClarifying, FALLBACK_QUESTIONS } from "../ask-clarifying";
import { openai } from "../../../lib/openai";

vi.mock("../../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  OPENAI_TIMEOUT_FAST_MS: 15_000,
  MODEL_FAST: "gpt-4o-mini",
}));
vi.mock("../../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  validateAiResponse: vi.fn(
    (
      data: unknown,
      schema: {
        safeParse: (d: unknown) => { success: boolean; data?: unknown };
      },
    ) => {
      const r = schema.safeParse(data);
      return r.success ? r.data : null;
    },
  ),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

beforeEach(() => vi.clearAllMocks());

describe("askClarifying", () => {
  it("returns the AI's 2–3 questions", async () => {
    const questions = [
      {
        question: "How much time do you have?",
        options: ["15 min", "30 min", "1 hour"],
      },
      { question: "Which protein?", options: ["Chicken", "Tofu"] },
    ];
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    } as never);
    await expect(askClarifying("Mediterranean", [])).resolves.toEqual(
      questions,
    );
  });

  it("falls back to fixed time/cuisine/diet questions when the AI throws", async () => {
    mockCreate.mockRejectedValue(new Error("timeout"));
    const out = await askClarifying("Mediterranean", []);
    expect(out).toEqual(FALLBACK_QUESTIONS);
    expect(out.map((q) => q.question)).toEqual([
      "How much time do you have?",
      "Any cuisine you're in the mood for?",
      "Any diet to follow?",
    ]);
  });

  it("falls back when the AI returns only one question", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              questions: [{ question: "Q?", options: ["a", "b"] }],
            }),
          },
        },
      ],
    } as never);
    await expect(askClarifying("x", [])).resolves.toEqual(FALLBACK_QUESTIONS);
  });

  it("falls back on invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "nope" } }],
    } as never);
    await expect(askClarifying("x", [])).resolves.toEqual(FALLBACK_QUESTIONS);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/ask-clarifying.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/ask-clarifying.ts
import { z } from "zod";
import { openai, OPENAI_TIMEOUT_FAST_MS, MODEL_FAST } from "../../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { createServiceLogger, toError } from "../../lib/logger";
import {
  clarifyingQuestionSchema,
  type ClarifyingQuestion,
} from "@shared/schemas/recipe-finder";

const log = createServiceLogger("recipe-finder-clarify");

/** §6: askClarifying failure → fixed questions: time, cuisine, diet. */
export const FALLBACK_QUESTIONS: ClarifyingQuestion[] = [
  {
    question: "How much time do you have?",
    options: ["Under 20 minutes", "About 30–45 minutes", "An hour or more"],
  },
  {
    question: "Any cuisine you're in the mood for?",
    options: ["Mediterranean", "Asian", "Mexican", "Italian", "Surprise me"],
  },
  {
    question: "Any diet to follow?",
    options: [
      "No preference",
      "Vegetarian",
      "Vegan",
      "Gluten free",
      "High protein",
    ],
  },
];

const responseSchema = z.object({
  questions: z.array(clarifyingQuestionSchema).min(2).max(3),
});

export async function askClarifying(
  request: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<ClarifyingQuestion[]> {
  const transcript = history
    .slice(-4)
    .map((m) =>
      m.role === "user"
        ? `User: ${sanitizeUserInput(m.content).slice(0, 300)}`
        : `Assistant: ${sanitizeContextField(m.content, 300)}`,
    )
    .join("\n");
  let content: string | null | undefined;
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        temperature: 0.3,
        max_completion_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `The user asked for a recipe and none of the suggestions fit.
Ask 2 or 3 short multiple-choice questions that would most narrow the search: time available, cuisine, diet, main ingredient, or meal type — whichever the request leaves open.
Return JSON: {"questions": [{"question": string (max 12 words), "options": [2-5 short answers, max 4 words each]}]}
Never ask about allergies (the app already filters them).

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          {
            role: "user",
            content: `Request: ${sanitizeUserInput(request)}\n\nRecent conversation:\n${transcript}`,
          },
        ],
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );
    content = response.choices[0]?.message?.content;
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "askClarifying failed; using fixed questions",
    );
    return FALLBACK_QUESTIONS;
  }
  if (!content) return FALLBACK_QUESTIONS;
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return FALLBACK_QUESTIONS;
  }
  const parsed = validateAiResponse(json, responseSchema);
  return parsed ? parsed.questions : FALLBACK_QUESTIONS;
}
```

- [ ] **Step 4: Run** → PASS (4).
- [ ] **Step 5: Commit** — `commit-msg-finder-task-12.txt`: `feat(recipe-finder): askClarifying with fixed-question fallback`.

### Task 13: `classifyTurn` — `new_request` fallback + gold-set accuracy

**Files:**

- Create: `server/services/recipe-finder/classify-turn.ts`
- Create: `server/services/recipe-finder/__tests__/classify-turn.test.ts`
- Create: `server/services/recipe-finder/__tests__/fixtures/classify-turn-gold-set.json`
- Create: `scripts/measure-classify-turn.ts`

**Interfaces:**

- Produces: `export type TurnClass = "new_request" | "refine_current" | "other"`; `CLASSIFY_TURN_TIMEOUT_MS = 6_000`; `classifyTurn(message: string, currentRecipeTitle: string): Promise<TurnClass>` (never throws; any failure → `"new_request"` — a wrong list is recoverable, a silent rewrite is not).

- [ ] **Step 1: Write the failing unit tests**

```ts
// server/services/recipe-finder/__tests__/classify-turn.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyTurn, CLASSIFY_TURN_TIMEOUT_MS } from "../classify-turn";
import { openai } from "../../../lib/openai";

vi.mock("../../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  MODEL_FAST: "gpt-4o-mini",
}));
vi.mock("../../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  validateAiResponse: vi.fn(
    (
      data: unknown,
      schema: {
        safeParse: (d: unknown) => { success: boolean; data?: unknown };
      },
    ) => {
      const r = schema.safeParse(data);
      return r.success ? r.data : null;
    },
  ),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(openai.chat.completions.create);
const returns = (json: unknown) =>
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(json) } }],
  } as never);

beforeEach(() => vi.clearAllMocks());

describe("classifyTurn", () => {
  it.each(["new_request", "refine_current", "other"] as const)(
    "returns %s from the model",
    async (cls) => {
      returns({ class: cls });
      await expect(
        classifyTurn("make it spicier", "Chicken Curry"),
      ).resolves.toBe(cls);
    },
  );

  it("falls back to new_request when the AI call throws", async () => {
    mockCreate.mockRejectedValue(new Error("Request timed out."));
    await expect(
      classifyTurn("make it spicier", "Chicken Curry"),
    ).resolves.toBe("new_request");
  });

  it("falls back to new_request on an out-of-vocabulary class", async () => {
    returns({ class: "refine" });
    await expect(classifyTurn("x", "y")).resolves.toBe("new_request");
  });

  it("uses a short timeout and JSON mode", async () => {
    returns({ class: "other" });
    await classifyTurn("thanks!", "Chicken Curry");
    const [body, opts] = mockCreate.mock.calls[0] as [
      { response_format: unknown },
      { timeout: number },
    ];
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(opts.timeout).toBe(CLASSIFY_TURN_TIMEOUT_MS);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/classify-turn.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/classify-turn.ts
import { z } from "zod";
import { openai, MODEL_FAST } from "../../lib/openai";
import {
  sanitizeUserInput,
  sanitizeContextField,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
} from "../../lib/ai-safety";
import { createServiceLogger, toError } from "../../lib/logger";

const log = createServiceLogger("recipe-finder-classify-turn");

export type TurnClass = "new_request" | "refine_current" | "other";

/** Runs on every message after a recipe card — keep it short. */
export const CLASSIFY_TURN_TIMEOUT_MS = 6_000;

const responseSchema = z.object({
  class: z.enum(["new_request", "refine_current", "other"]),
});

/**
 * §3.3: after a recipe card, decide whether a message starts a new search,
 * refines the card on screen, or is ordinary chat. Any failure returns
 * "new_request": a list shown by mistake is recoverable (tap Generate, or
 * type again); silently rewriting the user's recipe is not.
 */
export async function classifyTurn(
  message: string,
  currentRecipeTitle: string,
): Promise<TurnClass> {
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        temperature: 0,
        max_completion_tokens: 20,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `A recipe for "${sanitizeContextField(currentRecipeTitle, 120)}" is on screen. Classify the user's next message.
- "refine_current": change THIS recipe (spicier, swap an ingredient, scale servings, make it vegan, less salt).
- "new_request": ask for a DIFFERENT dish or meal (now a dessert, something with salmon instead, what about breakfast, another recipe).
- "other": anything else (thanks, storage or technique questions about this recipe, small talk).
Return JSON: {"class": "new_request" | "refine_current" | "other"}

${SYSTEM_PROMPT_BOUNDARY}`,
          },
          { role: "user", content: sanitizeUserInput(message) },
        ],
      },
      { timeout: CLASSIFY_TURN_TIMEOUT_MS },
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return "new_request";
    const parsed = validateAiResponse(JSON.parse(content), responseSchema);
    return parsed ? parsed.class : "new_request";
  } catch (error) {
    log.warn(
      { err: toError(error) },
      "classifyTurn failed; defaulting to new_request",
    );
    return "new_request";
  }
}
```

- [ ] **Step 4: Run** → PASS (6).

- [ ] **Step 5: Gold set + measurement script**

Create `server/services/recipe-finder/__tests__/fixtures/classify-turn-gold-set.json`:

```json
[
  {
    "message": "make it spicier",
    "recipeTitle": "Chicken Tikka Masala",
    "expected": "refine_current"
  },
  {
    "message": "swap chicken for tofu",
    "recipeTitle": "Chicken Stir Fry",
    "expected": "refine_current"
  },
  {
    "message": "double it for 8",
    "recipeTitle": "Beef Chili",
    "expected": "refine_current"
  },
  {
    "message": "can you make it dairy free?",
    "recipeTitle": "Creamy Tuscan Chicken",
    "expected": "refine_current"
  },
  {
    "message": "less salt please",
    "recipeTitle": "Miso Soup",
    "expected": "refine_current"
  },
  {
    "message": "use brown rice instead",
    "recipeTitle": "Salmon Rice Bowl",
    "expected": "refine_current"
  },
  {
    "message": "make it vegan",
    "recipeTitle": "Lasagna",
    "expected": "refine_current"
  },
  {
    "message": "cut the calories a bit",
    "recipeTitle": "Mac and Cheese",
    "expected": "refine_current"
  },
  {
    "message": "now a dessert",
    "recipeTitle": "Grilled Salmon",
    "expected": "new_request"
  },
  {
    "message": "something vegan instead",
    "recipeTitle": "Beef Tacos",
    "expected": "new_request"
  },
  {
    "message": "what about breakfast?",
    "recipeTitle": "Chicken Curry",
    "expected": "new_request"
  },
  {
    "message": "something with salmon instead",
    "recipeTitle": "Pork Chops",
    "expected": "new_request"
  },
  {
    "message": "give me another recipe",
    "recipeTitle": "Greek Salad",
    "expected": "new_request"
  },
  {
    "message": "I also need a side dish",
    "recipeTitle": "Roast Chicken",
    "expected": "new_request"
  },
  {
    "message": "any soup ideas?",
    "recipeTitle": "Caesar Salad",
    "expected": "new_request"
  },
  {
    "message": "now something for lunch tomorrow",
    "recipeTitle": "Pancakes",
    "expected": "new_request"
  },
  {
    "message": "can I freeze this",
    "recipeTitle": "Lentil Soup",
    "expected": "other"
  },
  { "message": "thanks!", "recipeTitle": "Banana Bread", "expected": "other" },
  {
    "message": "how long does it keep?",
    "recipeTitle": "Chicken Salad",
    "expected": "other"
  },
  {
    "message": "what does braise mean?",
    "recipeTitle": "Braised Short Ribs",
    "expected": "other"
  },
  {
    "message": "perfect, saving it",
    "recipeTitle": "Shrimp Pasta",
    "expected": "other"
  },
  {
    "message": "is this good for meal prep?",
    "recipeTitle": "Turkey Chili",
    "expected": "other"
  },
  {
    "message": "what wine goes with it?",
    "recipeTitle": "Beef Bourguignon",
    "expected": "other"
  },
  { "message": "ok", "recipeTitle": "Overnight Oats", "expected": "other" }
]
```

Create `scripts/measure-classify-turn.ts`:

```ts
/**
 * Spec §7: measure classifyTurn against the gold set with the REAL model.
 *   set -a; source .env; set +a; NODE_ENV=development npx tsx scripts/measure-classify-turn.ts
 * Needs AI_INTEGRATIONS_OPENAI_API_KEY (and _BASE_URL if used). Prints
 * accuracy and every miss; paste the output into the PR body.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  classifyTurn,
  type TurnClass,
} from "../server/services/recipe-finder/classify-turn";

interface Case {
  message: string;
  recipeTitle: string;
  expected: TurnClass;
}

async function main(): Promise<void> {
  const cases: Case[] = JSON.parse(
    readFileSync(
      path.resolve(
        process.cwd(),
        "server/services/recipe-finder/__tests__/fixtures/classify-turn-gold-set.json",
      ),
      "utf8",
    ),
  );
  let correct = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const got = await classifyTurn(c.message, c.recipeTitle);
    if (got === c.expected) correct++;
    else
      misses.push(
        `  "${c.message}" (${c.recipeTitle}): expected ${c.expected}, got ${got}`,
      );
  }
  console.log(
    `classifyTurn accuracy: ${correct}/${cases.length} (${((100 * correct) / cases.length).toFixed(1)}%)`,
  );
  // The dangerous direction: anything classified refine_current that is not.
  if (misses.length > 0) console.log(`misses:\n${misses.join("\n")}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
```

Run: `set -a; source .env; set +a; NODE_ENV=development npx tsx scripts/measure-classify-turn.ts` (loads the OpenAI key from the user's `.env`; the shell otherwise exports `NODE_ENV=production`).
Expected: an accuracy line. **Record it (and every miss) for the PR body.** If any `other`/`new_request` case is classified `refine_current`, do one prompt-tuning pass and re-measure; report both runs.

- [ ] **Step 6: Commit** — `commit-msg-finder-task-13.txt`: `feat(recipe-finder): classifyTurn with new_request fallback + gold-set measurement (accuracy X/24)`.

### Task 14: The pure transition — `planFinderStep` / `finderOutcome` (table-driven, written first per §7)

**Files:**

- Create: `server/services/recipe-finder/transition.ts`
- Create: `server/services/recipe-finder/__tests__/transition.test.ts`

**Interfaces:**

- Consumes: `FinderBlock`, `FinderFlow`, `FinderAction`, `FinderAnswer`, `FinderItem`, `RecipeQuery`, `ClarifyingQuestion`, `FinderButton` (Task 5); `FindOnlineResult` (Task 11).
- Produces:

```ts
export type FinderInput =
  | { kind: "start"; text: string }
  | { kind: "action"; action: FinderAction }
  | {
      kind: "typed";
      text: string;
      command: "generate" | "none_of_these" | null;
    };
export interface FinderCtx {
  onlineConfigured: boolean;
  canSearchOnline: boolean;
  canGenerate: boolean;
  nextFlowId: string;
}
export type FinderStep =
  | {
      kind: "ignore";
      reason: "stale_flow" | "no_active_flow" | "invalid_for_stage";
    }
  | {
      kind: "search_community";
      request: string;
      round: 0 | 1;
      excludeIds: string[];
      priorShownIds: string[];
    }
  | { kind: "search_online"; flow: FinderFlow }
  | { kind: "ask_clarifying"; flow: FinderFlow }
  | { kind: "generate"; request: string; flow: FinderFlow };
export type FinderStepResult =
  | { kind: "community"; query: RecipeQuery; items: FinderItem[] }
  | { kind: "online"; result: FindOnlineResult }
  | { kind: "questions"; questions: ClarifyingQuestion[] }
  | { kind: "none" };
export type FinderOutcome =
  | { kind: "ignore" }
  | { kind: "message"; block: FinderBlock }
  | { kind: "generate"; request: string; flow: FinderFlow };
export function planFinderStep(
  latest: FinderBlock | null,
  input: FinderInput,
): FinderStep;
export function finderOutcome(
  step: FinderStep,
  result: FinderStepResult,
  ctx: FinderCtx,
): FinderOutcome;
export function blockedGenerateBlock(
  flow: FinderFlow,
  notice: "generate_limit" | "generate_premium",
  ctx: FinderCtx,
): RecipeResultsBlock;
export function communityActions(ctx: FinderCtx): FinderButton[];
export function appendToRequest(request: string, addition: string): string;
export function appendAnswers(request: string, answers: FinderAnswer[]): string;
export function finderStatusLabel(step: FinderStep): string | null;
```

- [ ] **Step 1: Write the failing table tests**

```ts
// server/services/recipe-finder/__tests__/transition.test.ts
import { describe, it, expect } from "vitest";
import type {
  FinderBlock,
  FinderFlow,
  FinderItem,
  RecipeResultsBlock,
  RecipeQuestionsBlock,
} from "@shared/schemas/recipe-finder";
import {
  planFinderStep,
  finderOutcome,
  blockedGenerateBlock,
  communityActions,
  appendAnswers,
  finderStatusLabel,
  type FinderCtx,
  type FinderInput,
  type FinderStep,
  type FinderStepResult,
} from "../transition";

const F0 = "00000000-0000-4000-8000-000000000000";
const F_OTHER = "99999999-9999-4999-8999-999999999999";
const NEXT = "11111111-1111-4111-8111-111111111111";

const flow = (over: Partial<FinderFlow> = {}): FinderFlow => ({
  flowId: F0,
  stage: "results",
  request: "Mediterranean",
  query: { q: "mediterranean" },
  round: 0,
  shownIds: ["community:1"],
  ...over,
});
const item = (
  id: number,
  source: FinderItem["source"] = "community",
): FinderItem => ({
  id,
  source,
  title: `R${id}`,
  imageUrl: null,
  readyInMinutes: null,
  calories: 300,
});
const results = (
  over: Partial<RecipeResultsBlock> = {},
): RecipeResultsBlock => ({
  type: "recipe_results",
  source: "community",
  items: [item(1)],
  actions: ["search_online", "generate", "none_of_these"],
  notice: null,
  flow: flow(),
  ...over,
});
const questions = (
  over: Partial<RecipeQuestionsBlock> = {},
): RecipeQuestionsBlock => ({
  type: "recipe_questions",
  questions: [{ question: "Time?", options: ["20 min", "1 hour"] }],
  flow: flow({ stage: "clarifying" }),
  ...over,
});
const ctx: FinderCtx = {
  onlineConfigured: true,
  canSearchOnline: true,
  canGenerate: true,
  nextFlowId: NEXT,
};
const act = (
  type: "search_online" | "generate" | "none_of_these" | "answers",
  flowId = F0,
): FinderInput => ({
  kind: "action",
  action:
    type === "answers"
      ? { type, flowId, answers: [{ question: "Time?", answer: "20 min" }] }
      : { type, flowId },
});
const typed = (
  text: string,
  command: "generate" | "none_of_these" | null = null,
): FinderInput => ({ kind: "typed", text, command });

describe("planFinderStep — stage × input", () => {
  const rows: {
    name: string;
    latest: FinderBlock | null;
    input: FinderInput;
    expected: FinderStep;
  }[] = [
    {
      name: "start → community search, round 0",
      latest: null,
      input: { kind: "start", text: " Mediterranean " },
      expected: {
        kind: "search_community",
        request: "Mediterranean",
        round: 0,
        excludeIds: [],
        priorShownIds: [],
      },
    },
    {
      name: "action with no active flow → ignore",
      latest: null,
      input: act("generate"),
      expected: { kind: "ignore", reason: "no_active_flow" },
    },
    {
      name: "stale flowId → ignore",
      latest: results(),
      input: act("generate", F_OTHER),
      expected: { kind: "ignore", reason: "stale_flow" },
    },
    {
      name: "results + Search Spoonacular → online",
      latest: results(),
      input: act("search_online"),
      expected: { kind: "search_online", flow: flow() },
    },
    {
      name: "Search Spoonacular on a Spoonacular list (button absent) → ignore",
      latest: results({
        source: "spoonacular",
        actions: ["generate", "none_of_these"],
      }),
      input: act("search_online"),
      expected: { kind: "ignore", reason: "invalid_for_stage" },
    },
    {
      name: "results + Generate → generate",
      latest: results(),
      input: act("generate"),
      expected: { kind: "generate", request: "Mediterranean", flow: flow() },
    },
    {
      name: "round 0 + None of these → clarifying",
      latest: results(),
      input: act("none_of_these"),
      expected: { kind: "ask_clarifying", flow: flow() },
    },
    {
      name: "round 1 + None of these → generate (round cap)",
      latest: results({ flow: flow({ round: 1 }) }),
      input: act("none_of_these"),
      expected: {
        kind: "generate",
        request: "Mediterranean",
        flow: flow({ round: 1 }),
      },
    },
    {
      name: "answers on a results block → ignore",
      latest: results(),
      input: act("answers"),
      expected: { kind: "ignore", reason: "invalid_for_stage" },
    },
    {
      name: "clarifying + answers → community search round 1 excluding shown",
      latest: questions(),
      input: act("answers"),
      expected: {
        kind: "search_community",
        request: "Mediterranean. Time? 20 min",
        round: 1,
        excludeIds: ["community:1"],
        priorShownIds: ["community:1"],
      },
    },
    {
      name: "None of these on a questions block → ignore",
      latest: questions(),
      input: act("none_of_these"),
      expected: { kind: "ignore", reason: "invalid_for_stage" },
    },
    {
      name: "typed text in results stage refines (same round, no exclusion)",
      latest: results(),
      input: typed("with chickpeas"),
      expected: {
        kind: "search_community",
        request: "Mediterranean. with chickpeas",
        round: 0,
        excludeIds: [],
        priorShownIds: ["community:1"],
      },
    },
    {
      name: "typed 'generate' command → generate (old-client guard)",
      latest: results(),
      input: typed("generate", "generate"),
      expected: { kind: "generate", request: "Mediterranean", flow: flow() },
    },
    {
      name: "typed 'none of these' command → clarifying (old-client guard)",
      latest: results(),
      input: typed("none of these", "none_of_these"),
      expected: { kind: "ask_clarifying", flow: flow() },
    },
    {
      name: "typed text in clarifying stage counts as answers",
      latest: questions(),
      input: typed("under 20 min, vegan"),
      expected: {
        kind: "search_community",
        request: "Mediterranean. under 20 min, vegan",
        round: 1,
        excludeIds: ["community:1"],
        priorShownIds: ["community:1"],
      },
    },
    {
      name: "typed 'generate' in clarifying stage → generate",
      latest: questions(),
      input: typed("generate", "generate"),
      expected: {
        kind: "generate",
        request: "Mediterranean",
        flow: flow({ stage: "clarifying" }),
      },
    },
  ];
  it.each(rows)("$name", ({ latest, input, expected }) => {
    expect(planFinderStep(latest, input)).toEqual(expected);
  });
});

describe("finderOutcome — step × result", () => {
  const community = (items: FinderItem[]): FinderStepResult => ({
    kind: "community",
    query: { q: "mediterranean" },
    items,
  });
  const search = (round: 0 | 1): FinderStep => ({
    kind: "search_community",
    request: "Mediterranean",
    round,
    excludeIds: [],
    priorShownIds: ["community:1"],
  });

  it("community matches → results list with the three buttons and merged shownIds", () => {
    expect(
      finderOutcome(search(0), community([item(2), item(3)]), ctx),
    ).toEqual({
      kind: "message",
      block: {
        type: "recipe_results",
        source: "community",
        items: [item(2), item(3)],
        actions: ["search_online", "generate", "none_of_these"],
        notice: null,
        flow: {
          flowId: NEXT,
          stage: "results",
          request: "Mediterranean",
          query: { q: "mediterranean" },
          round: 0,
          shownIds: ["community:1", "community:2", "community:3"],
        },
      },
    });
  });

  it("round 0 with no matches → 'no community recipes' + same three buttons", () => {
    const out = finderOutcome(search(0), community([]), ctx);
    expect(out.kind).toBe("message");
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("no_matches");
    expect(out.block.actions).toEqual([
      "search_online",
      "generate",
      "none_of_these",
    ]);
  });

  it("round 1 with no matches → generate (clarified and still nothing)", () => {
    const out = finderOutcome(search(1), community([]), ctx);
    expect(out).toEqual({
      kind: "generate",
      request: "Mediterranean",
      flow: {
        flowId: NEXT,
        stage: "results",
        request: "Mediterranean",
        query: { q: "mediterranean" },
        round: 1,
        shownIds: ["community:1"],
      },
    });
  });

  it("Search Spoonacular hidden when the catalog is not configured (§6)", () => {
    expect(communityActions({ ...ctx, onlineConfigured: false })).toEqual([
      "generate",
      "none_of_these",
    ]);
  });

  const online: FinderStep = { kind: "search_online", flow: flow() };
  it("Spoonacular results → list with Generate + None of these", () => {
    const out = finderOutcome(
      online,
      {
        kind: "online",
        result: { status: "ok", items: [item(715538, "spoonacular")] },
      },
      ctx,
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.source).toBe("spoonacular");
    expect(out.block.actions).toEqual(["generate", "none_of_these"]);
    expect(out.block.notice).toBeNull();
    expect(out.block.flow.shownIds).toEqual([
      "community:1",
      "spoonacular:715538",
    ]);
  });

  it("Spoonacular unavailable (402/error/cap) → 'unavailable', never 'no matches'", () => {
    const out = finderOutcome(
      online,
      { kind: "online", result: { status: "unavailable" } },
      ctx,
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("unavailable");
    expect(out.block.actions).toEqual(["generate", "none_of_these"]);
  });

  it("Spoonacular genuinely empty → 'no matches'", () => {
    const out = finderOutcome(
      online,
      { kind: "online", result: { status: "ok", items: [] } },
      ctx,
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("no_matches");
  });

  it("clarifying → questions block, new flowId, round unchanged", () => {
    const qs = [{ question: "Time?", options: ["a", "b"] }];
    expect(
      finderOutcome(
        { kind: "ask_clarifying", flow: flow() },
        { kind: "questions", questions: qs },
        ctx,
      ),
    ).toEqual({
      kind: "message",
      block: {
        type: "recipe_questions",
        questions: qs,
        flow: flow({ flowId: NEXT, stage: "clarifying" }),
      },
    });
  });

  it("ignore passes through", () => {
    expect(
      finderOutcome(
        { kind: "ignore", reason: "stale_flow" },
        { kind: "none" },
        ctx,
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("a blocked Generate keeps the flow alive with a notice and no Generate button", () => {
    const block = blockedGenerateBlock(
      flow({ round: 1 }),
      "generate_limit",
      ctx,
    );
    expect(block).toEqual({
      type: "recipe_results",
      source: "community",
      items: [],
      actions: ["search_online"],
      notice: "generate_limit",
      flow: flow({ round: 1, flowId: NEXT, stage: "results" }),
    });
  });
});

describe("helpers", () => {
  it("appendAnswers folds answers into the request", () => {
    expect(
      appendAnswers("Mediterranean", [
        { question: "Time?", answer: "20 min" },
        { question: "Diet?", answer: "Vegan" },
      ]),
    ).toBe("Mediterranean. Time? 20 min; Diet? Vegan");
  });

  it.each([
    [
      {
        kind: "search_community",
        request: "x",
        round: 0,
        excludeIds: [],
        priorShownIds: [],
      },
      "Searching community recipes…",
    ],
    [{ kind: "search_online", flow: flow() }, "Searching Spoonacular…"],
    [{ kind: "ask_clarifying", flow: flow() }, "Thinking of a few questions…"],
    [{ kind: "generate", request: "x", flow: flow() }, "Creating your recipe…"],
    [{ kind: "ignore", reason: "stale_flow" }, null],
  ] as [FinderStep, string | null][])("status label for %j", (step, label) => {
    expect(finderStatusLabel(step)).toBe(label);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/transition.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/transition.ts
// The flow's pure state machine (spec §3.1, §4). The server derives every
// step from the latest STORED finder block, never from action text.
import type {
  ClarifyingQuestion,
  FinderAction,
  FinderAnswer,
  FinderBlock,
  FinderButton,
  FinderFlow,
  FinderItem,
  RecipeQuery,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import type { FindOnlineResult } from "./find-online";

export type FinderInput =
  | { kind: "start"; text: string }
  | { kind: "action"; action: FinderAction }
  | {
      kind: "typed";
      text: string;
      command: "generate" | "none_of_these" | null;
    };

export interface FinderCtx {
  /** SPOONACULAR_API_KEY set — else Search Spoonacular is hidden (§6). */
  onlineConfigured: boolean;
  /** Premium `catalogSave` (§6 premium). */
  canSearchOnline: boolean;
  /** Premium `recipeGeneration` (§6 premium). */
  canGenerate: boolean;
  /** flowId for any block this step produces (injected for purity). */
  nextFlowId: string;
}

export type FinderStep =
  | {
      kind: "ignore";
      reason: "stale_flow" | "no_active_flow" | "invalid_for_stage";
    }
  | {
      kind: "search_community";
      request: string;
      round: 0 | 1;
      excludeIds: string[];
      priorShownIds: string[];
    }
  | { kind: "search_online"; flow: FinderFlow }
  | { kind: "ask_clarifying"; flow: FinderFlow }
  | { kind: "generate"; request: string; flow: FinderFlow };

export type FinderStepResult =
  | { kind: "community"; query: RecipeQuery; items: FinderItem[] }
  | { kind: "online"; result: FindOnlineResult }
  | { kind: "questions"; questions: ClarifyingQuestion[] }
  | { kind: "none" };

export type FinderOutcome =
  | { kind: "ignore" }
  | { kind: "message"; block: FinderBlock }
  | { kind: "generate"; request: string; flow: FinderFlow };

const MAX_SHOWN_IDS = 40;

export function appendToRequest(request: string, addition: string): string {
  return `${request.trim()}. ${addition.trim()}`.slice(0, 2000);
}

export function appendAnswers(
  request: string,
  answers: FinderAnswer[],
): string {
  return appendToRequest(
    request,
    answers.map((a) => `${a.question} ${a.answer}`).join("; "),
  );
}

function noneOfThese(flow: FinderFlow): FinderStep {
  // At most one clarifying round: a second "None of these" generates.
  return flow.round === 0
    ? { kind: "ask_clarifying", flow }
    : { kind: "generate", request: flow.request, flow };
}

function answered(flow: FinderFlow, request: string): FinderStep {
  return {
    kind: "search_community",
    request,
    round: 1,
    excludeIds: flow.shownIds,
    priorShownIds: flow.shownIds,
  };
}

export function planFinderStep(
  latest: FinderBlock | null,
  input: FinderInput,
): FinderStep {
  if (input.kind === "start") {
    return {
      kind: "search_community",
      request: input.text.trim(),
      round: 0,
      excludeIds: [],
      priorShownIds: [],
    };
  }
  if (!latest) return { kind: "ignore", reason: "no_active_flow" };
  const { flow } = latest;

  if (input.kind === "action") {
    const { action } = input;
    if (action.flowId !== flow.flowId) {
      return { kind: "ignore", reason: "stale_flow" };
    }
    switch (action.type) {
      case "generate":
        return { kind: "generate", request: flow.request, flow };
      case "search_online":
        return latest.type === "recipe_results" &&
          latest.actions.includes("search_online")
          ? { kind: "search_online", flow }
          : { kind: "ignore", reason: "invalid_for_stage" };
      case "none_of_these":
        return latest.type === "recipe_results"
          ? noneOfThese(flow)
          : { kind: "ignore", reason: "invalid_for_stage" };
      case "answers":
        return latest.type === "recipe_questions" && action.answers
          ? answered(flow, appendAnswers(flow.request, action.answers))
          : { kind: "ignore", reason: "invalid_for_stage" };
    }
  }

  // Typed text during an active flow (§4 "Typed input").
  if (input.command === "generate") {
    return { kind: "generate", request: flow.request, flow };
  }
  if (latest.type === "recipe_questions") {
    return answered(flow, appendToRequest(flow.request, input.text));
  }
  if (input.command === "none_of_these") return noneOfThese(flow);
  return {
    kind: "search_community",
    request: appendToRequest(flow.request, input.text),
    round: flow.round,
    excludeIds: [],
    priorShownIds: flow.shownIds,
  };
}

function mergeShown(prior: string[], items: FinderItem[]): string[] {
  const merged = [
    ...new Set([...prior, ...items.map((i) => `${i.source}:${i.id}`)]),
  ];
  return merged.slice(-MAX_SHOWN_IDS);
}

export function communityActions(ctx: FinderCtx): FinderButton[] {
  return ctx.onlineConfigured
    ? ["search_online", "generate", "none_of_these"]
    : ["generate", "none_of_these"];
}

/** Generate refused (limit or premium): keep the flow alive, minus Generate. */
export function blockedGenerateBlock(
  flow: FinderFlow,
  notice: "generate_limit" | "generate_premium",
  ctx: FinderCtx,
): RecipeResultsBlock {
  return {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ctx.onlineConfigured ? ["search_online"] : [],
    notice,
    flow: { ...flow, flowId: ctx.nextFlowId, stage: "results" },
  };
}

export function finderOutcome(
  step: FinderStep,
  result: FinderStepResult,
  ctx: FinderCtx,
): FinderOutcome {
  switch (step.kind) {
    case "ignore":
      return { kind: "ignore" };
    case "generate":
      return { kind: "generate", request: step.request, flow: step.flow };
    case "search_community": {
      if (result.kind !== "community") {
        throw new Error("search_community requires a community result");
      }
      const flow: FinderFlow = {
        flowId: ctx.nextFlowId,
        stage: "results",
        request: step.request,
        query: result.query,
        round: step.round,
        shownIds: mergeShown(step.priorShownIds, result.items),
      };
      if (result.items.length === 0 && step.round === 1) {
        return { kind: "generate", request: step.request, flow };
      }
      return {
        kind: "message",
        block: {
          type: "recipe_results",
          source: "community",
          items: result.items,
          actions: communityActions(ctx),
          notice: result.items.length === 0 ? "no_matches" : null,
          flow,
        },
      };
    }
    case "search_online": {
      if (result.kind !== "online") {
        throw new Error("search_online requires an online result");
      }
      const items = result.result.status === "ok" ? result.result.items : [];
      return {
        kind: "message",
        block: {
          type: "recipe_results",
          source: "spoonacular",
          items,
          actions: ["generate", "none_of_these"],
          notice:
            result.result.status === "unavailable"
              ? "unavailable"
              : items.length === 0
                ? "no_matches"
                : null,
          flow: {
            ...step.flow,
            flowId: ctx.nextFlowId,
            stage: "results",
            shownIds: mergeShown(step.flow.shownIds, items),
          },
        },
      };
    }
    case "ask_clarifying": {
      if (result.kind !== "questions") {
        throw new Error("ask_clarifying requires questions");
      }
      return {
        kind: "message",
        block: {
          type: "recipe_questions",
          questions: result.questions,
          flow: { ...step.flow, flowId: ctx.nextFlowId, stage: "clarifying" },
        },
      };
    }
  }
}

/** Thinking-bubble progress text (§5). */
export function finderStatusLabel(step: FinderStep): string | null {
  switch (step.kind) {
    case "search_community":
      return "Searching community recipes…";
    case "search_online":
      return "Searching Spoonacular…";
    case "ask_clarifying":
      return "Thinking of a few questions…";
    case "generate":
      return "Creating your recipe…";
    case "ignore":
      return null;
  }
}
```

- [ ] **Step 4: Run** → PASS (all rows).
- [ ] **Step 5: Commit** — `commit-msg-finder-task-14.txt`: `feat(recipe-finder): pure transition (planFinderStep/finderOutcome) with table tests`.

### Task 15: Plain-text fallback + entry rules + typed-command guard

**Files:**

- Create: `server/services/recipe-finder/fallback-text.ts`, `server/services/recipe-finder/entry.ts`
- Create: `server/services/recipe-finder/__tests__/fallback-text.test.ts`, `server/services/recipe-finder/__tests__/entry.test.ts`

**Interfaces:**

- Produces (fallback-text): `finderFallbackText(block: FinderBlock): string` — every finder message's `content`, readable on an app without the component (§3.2), and it tells an old client exactly which phrases to type.
- Produces (entry):
  - `finderBlockFromMetadata(metadata: unknown): FinderBlock | null` (RecipeChef `{metadataVersion, finder}` or Coach `{blocks:[…]}`)
  - `getLatestFinderBlock(history: ChatMessage[]): FinderBlock | null` (only the MOST RECENT assistant message counts — older lists are stale)
  - `isActionCurrent(latest: FinderBlock | null, action: FinderAction): boolean`
  - `getLatestRecipe(history: ChatMessage[], opts: { latestOnly: boolean }): { title: string; messageId: number } | null`
  - `normalizeCommand(text: string): string`; `matchTypedFinderCommand(text: string, stage: FinderBlock["type"]): "generate" | "none_of_these" | null`
  - `type RecipeChefEntry = { kind: "finder"; input: FinderInput } | { kind: "classify"; recipeTitle: string } | { kind: "legacy" }`; `decideRecipeChefEntry(historyBeforeTurn: ChatMessage[], text: string): RecipeChefEntry`
  - `type CoachFinderEntry = { kind: "finder"; input: FinderInput } | { kind: "classify"; recipeTitle: string } | { kind: "none" }`; `decideCoachFinderEntry(history: ChatMessage[], text: string, intent: CoachIntent, action?: FinderAction): CoachFinderEntry`

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/recipe-finder/__tests__/fallback-text.test.ts
import { describe, it, expect } from "vitest";
import { finderFallbackText } from "../fallback-text";
import type {
  RecipeResultsBlock,
  RecipeQuestionsBlock,
} from "@shared/schemas/recipe-finder";

const flow = {
  flowId: "00000000-0000-4000-8000-000000000000",
  stage: "results" as const,
  request: "x",
  query: { q: "x" },
  round: 0 as const,
  shownIds: [],
};
const list: RecipeResultsBlock = {
  type: "recipe_results",
  source: "community",
  notice: null,
  flow,
  actions: ["search_online", "generate", "none_of_these"],
  items: [
    {
      id: 1,
      source: "community",
      title: "Mediterranean Quinoa Salad",
      imageUrl: null,
      readyInMinutes: 20,
      calories: 350,
    },
    {
      id: 2,
      source: "community",
      title: "Greek Bowl",
      imageUrl: null,
      readyInMinutes: null,
      calories: null,
    },
  ],
};

describe("finderFallbackText", () => {
  it("lists community recipes and tells an old client what to type", () => {
    expect(finderFallbackText(list)).toBe(
      'Here are 2 community recipes:\n1. Mediterranean Quinoa Salad (20 min · 350 cal)\n2. Greek Bowl\n\nReply "generate" to create a new recipe, or "none of these" to narrow it down.',
    );
  });

  it("round 1 'none of these' promises a recipe instead of questions", () => {
    expect(
      finderFallbackText({ ...list, flow: { ...flow, round: 1 } }),
    ).toContain('"none of these" to create one instead');
  });

  it("no community matches", () => {
    expect(
      finderFallbackText({ ...list, items: [], notice: "no_matches" }),
    ).toMatch(/^No community recipes matched\./);
  });

  it("Spoonacular unavailable never reads as 'no results'", () => {
    const text = finderFallbackText({
      ...list,
      source: "spoonacular",
      items: [],
      notice: "unavailable",
      actions: ["generate", "none_of_these"],
    });
    expect(text).toMatch(
      /^Spoonacular isn't available right now\. Try Generate or a community pick\./,
    );
    expect(text).not.toMatch(/no matches|no results/i);
  });

  it("generate limit", () => {
    expect(
      finderFallbackText({
        ...list,
        items: [],
        notice: "generate_limit",
        actions: ["search_online"],
      }),
    ).toBe(
      "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.",
    );
  });

  it("questions with options", () => {
    const q: RecipeQuestionsBlock = {
      type: "recipe_questions",
      flow: { ...flow, stage: "clarifying" },
      questions: [
        {
          question: "How much time do you have?",
          options: ["Under 20 minutes", "An hour or more"],
        },
      ],
    };
    expect(finderFallbackText(q)).toBe(
      'A few quick questions:\n1. How much time do you have? (Under 20 minutes / An hour or more)\n\nReply with your answers, or "generate" to create a recipe now.',
    );
  });
});
```

```ts
// server/services/recipe-finder/__tests__/entry.test.ts
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@shared/schema";
import type { FinderBlock } from "@shared/schemas/recipe-finder";
import {
  finderBlockFromMetadata,
  getLatestFinderBlock,
  isActionCurrent,
  matchTypedFinderCommand,
  decideRecipeChefEntry,
  decideCoachFinderEntry,
} from "../entry";

const F0 = "00000000-0000-4000-8000-000000000000";
const block: FinderBlock = {
  type: "recipe_results",
  source: "community",
  items: [],
  actions: ["generate"],
  notice: "no_matches",
  flow: {
    flowId: F0,
    stage: "results",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};
const recipe = {
  title: "Chicken Curry",
  description: "d",
  difficulty: "Easy",
  timeEstimate: "30 min",
  servings: 2,
  ingredients: [],
  instructions: ["cook"],
  dietTags: [],
};
let nextId = 1;
const msg = (
  role: ChatMessage["role"],
  metadata: unknown = null,
  content = "c",
): ChatMessage => ({
  id: nextId++,
  conversationId: 1,
  role,
  content,
  metadata,
  turnKey: null,
  createdAt: new Date(),
});

describe("finderBlockFromMetadata", () => {
  it("reads RecipeChef metadata and Coach blocks", () => {
    expect(
      finderBlockFromMetadata({ metadataVersion: 1, finder: block }),
    ).toEqual(block);
    expect(
      finderBlockFromMetadata({
        blocks: [{ type: "quick_replies", options: [] }, block],
      }),
    ).toEqual(block);
    expect(finderBlockFromMetadata(null)).toBeNull();
  });
});

describe("getLatestFinderBlock / isActionCurrent", () => {
  it("only the most recent assistant message's block is active", () => {
    const active = [
      msg("user"),
      msg("assistant", { metadataVersion: 1, finder: block }),
      msg("user"),
    ];
    expect(getLatestFinderBlock(active)).toEqual(block);
    const superseded = [
      ...active,
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
    ];
    expect(getLatestFinderBlock(superseded)).toBeNull();
  });

  it("matches flowIds exactly", () => {
    expect(isActionCurrent(block, { type: "generate", flowId: F0 })).toBe(true);
    expect(
      isActionCurrent(block, {
        type: "generate",
        flowId: "99999999-9999-4999-8999-999999999999",
      }),
    ).toBe(false);
    expect(isActionCurrent(null, { type: "generate", flowId: F0 })).toBe(false);
  });
});

describe("matchTypedFinderCommand (old-client guard, §9 item 7)", () => {
  it.each([
    ["generate", "recipe_results", "generate"],
    ["Generate!", "recipe_results", "generate"],
    ['"generate"', "recipe_results", "generate"],
    ["  generate a recipe. ", "recipe_results", "generate"],
    ["None of these", "recipe_results", "none_of_these"],
    ["none of those.", "recipe_results", "none_of_these"],
    ["generate", "recipe_questions", "generate"],
    // "none" is a valid clarifying ANSWER ("Any diet?" → "none") — never a command there.
    ["none of these", "recipe_questions", null],
    ["none", "recipe_results", null],
    ["generate something spicy with chicken", "recipe_results", null],
    ["can you generate it with tofu", "recipe_results", null],
  ] as const)("%j at %s → %s", (text, stage, expected) => {
    expect(matchTypedFinderCommand(text, stage)).toBe(expected);
  });
});

describe("decideRecipeChefEntry (§3.3)", () => {
  it("first user message → start the flow", () => {
    expect(decideRecipeChefEntry([], "Mediterranean")).toEqual({
      kind: "finder",
      input: { kind: "start", text: "Mediterranean" },
    });
  });
  it("active flow → typed input with command detection", () => {
    const h = [
      msg("user"),
      msg("assistant", { metadataVersion: 1, finder: block }),
    ];
    expect(decideRecipeChefEntry(h, "generate")).toEqual({
      kind: "finder",
      input: { kind: "typed", text: "generate", command: "generate" },
    });
  });
  it("after a card → classify", () => {
    const h = [
      msg("user"),
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
    ];
    expect(decideRecipeChefEntry(h, "make it spicier")).toEqual({
      kind: "classify",
      recipeTitle: "Chicken Curry",
    });
  });
  it("otherwise legacy", () => {
    const h = [
      msg("user"),
      msg("assistant", null, "Sorry, I'm having trouble…"),
    ];
    expect(decideRecipeChefEntry(h, "try again")).toEqual({ kind: "legacy" });
  });
});

describe("decideCoachFinderEntry", () => {
  const cardLatest = [
    msg("user"),
    msg("assistant", {
      metadataVersion: 1,
      recipe,
      allergenWarning: null,
      imageUrl: null,
    }),
    msg("user"),
  ];
  it("a button action always enters the flow", () => {
    const action = { type: "generate" as const, flowId: F0 };
    expect(
      decideCoachFinderEntry([], "Generate", "vague_request", action),
    ).toEqual({ kind: "finder", input: { kind: "action", action } });
  });
  it("safety_refusal never enters the flow, even mid-flow", () => {
    const h = [msg("assistant", { blocks: [block] }), msg("user")];
    expect(
      decideCoachFinderEntry(h, "I have diabetes", "safety_refusal"),
    ).toEqual({ kind: "none" });
  });
  it("recipe_request starts the flow", () => {
    expect(
      decideCoachFinderEntry(
        [msg("user")],
        "find me a chicken recipe",
        "recipe_request",
      ),
    ).toEqual({
      kind: "finder",
      input: { kind: "start", text: "find me a chicken recipe" },
    });
  });
  it("a card as the latest assistant message → classify", () => {
    expect(
      decideCoachFinderEntry(
        cardLatest,
        "make it spicier",
        "personalized_advice",
      ),
    ).toEqual({ kind: "classify", recipeTitle: "Chicken Curry" });
  });
  it("a card further back does not trigger classifyTurn in Coach", () => {
    const h = [
      ...cardLatest,
      msg("assistant", null, "You're at 1,400 cal"),
      msg("user"),
    ];
    expect(
      decideCoachFinderEntry(h, "how am I doing?", "personalized_advice"),
    ).toEqual({ kind: "none" });
  });
  it("ordinary coaching stays on the coach path", () => {
    expect(
      decideCoachFinderEntry(
        [msg("user")],
        "How am I doing today?",
        "personalized_advice",
      ),
    ).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/fallback-text.test.ts server/services/recipe-finder/__tests__/entry.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/fallback-text.ts
// §3.2: every finder message's `content` must stand on its own — an app
// build without the finder component shows exactly this text, and the typed
// "generate" / "none of these" guard is how it keeps going.
import type {
  FinderBlock,
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";

function itemLine(item: FinderItem, index: number): string {
  const meta = [
    item.readyInMinutes ? `${item.readyInMinutes} min` : null,
    item.calories !== null ? `${item.calories} cal` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${index + 1}. ${item.title}${meta ? ` (${meta})` : ""}`;
}

function footer(block: RecipeResultsBlock): string {
  const parts: string[] = [];
  if (block.actions.includes("generate")) {
    parts.push('"generate" to create a new recipe');
  }
  if (block.actions.includes("none_of_these")) {
    parts.push(
      block.flow.round === 0
        ? '"none of these" to narrow it down'
        : '"none of these" to create one instead',
    );
  }
  return parts.length > 0 ? `\n\nReply ${parts.join(", or ")}.` : "";
}

export function finderFallbackText(block: FinderBlock): string {
  if (block.type === "recipe_questions") {
    const lines = block.questions.map(
      (q, i) => `${i + 1}. ${q.question} (${q.options.join(" / ")})`,
    );
    return `A few quick questions:\n${lines.join("\n")}\n\nReply with your answers, or "generate" to create a recipe now.`;
  }
  switch (block.notice) {
    case "generate_limit":
      return "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
    case "generate_premium":
      return "Generating recipes is a Premium feature. Try a community pick instead.";
    case "unavailable":
      return `Spoonacular isn't available right now. Try Generate or a community pick.${footer(block)}`;
    case "no_matches":
      return `${block.source === "community" ? "No community recipes matched." : "Spoonacular had no matches."}${footer(block)}`;
    case null: {
      const n = block.items.length;
      const head =
        block.source === "community"
          ? `Here are ${n} community recipe${n === 1 ? "" : "s"}:`
          : `Here are ${n} recipe${n === 1 ? "" : "s"} from Spoonacular:`;
      return `${head}\n${block.items.map(itemLine).join("\n")}${footer(block)}`;
    }
  }
}
```

```ts
// server/services/recipe-finder/entry.ts
// When does a message enter the finder? (spec §3.3, §4 "Typed input")
import type { ChatMessage } from "@shared/schema";
import {
  finderBlockSchema,
  type FinderAction,
  type FinderBlock,
} from "@shared/schemas/recipe-finder";
import { recipeChatMetadataSchema } from "@shared/schemas/recipe-chat";
import type { CoachIntent } from "../coach-intent-classifier";
import type { FinderInput } from "./transition";

export function finderBlockFromMetadata(metadata: unknown): FinderBlock | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const direct = finderBlockSchema.safeParse(m.finder);
  if (direct.success) return direct.data;
  if (Array.isArray(m.blocks)) {
    for (const b of m.blocks) {
      const parsed = finderBlockSchema.safeParse(b);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

function latestAssistant(history: ChatMessage[]): ChatMessage | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i];
  }
  return undefined;
}

/** Only the most recent assistant message's flow is live (§4). */
export function getLatestFinderBlock(
  history: ChatMessage[],
): FinderBlock | null {
  const last = latestAssistant(history);
  return last ? finderBlockFromMetadata(last.metadata) : null;
}

export function isActionCurrent(
  latest: FinderBlock | null,
  action: FinderAction,
): boolean {
  return latest !== null && latest.flow.flowId === action.flowId;
}

export function getLatestRecipe(
  history: ChatMessage[],
  opts: { latestOnly: boolean },
): { title: string; messageId: number } | null {
  const candidates = opts.latestOnly
    ? [latestAssistant(history)].filter((m): m is ChatMessage => !!m)
    : [...history].reverse().filter((m) => m.role === "assistant");
  for (const m of candidates) {
    const parsed = recipeChatMetadataSchema.safeParse(m.metadata);
    if (parsed.success) {
      return { title: parsed.data.recipe.title, messageId: m.id };
    }
  }
  return null;
}

const GENERATE_PHRASES = new Set([
  "generate",
  "generate one",
  "generate it",
  "generate recipe",
  "generate a recipe",
]);
const NONE_PHRASES = new Set([
  "none of these",
  "none of those",
  "none of them",
]);

export function normalizeCommand(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’.!?,]+$/, "")
    .trim();
}

/**
 * §9 item 7 old-client guard: exact short phrases act as the button. "none
 * of these" only in the results stage — in the clarifying stage free text is
 * an answer, and "none" is a legitimate one.
 */
export function matchTypedFinderCommand(
  text: string,
  stage: FinderBlock["type"],
): "generate" | "none_of_these" | null {
  const t = normalizeCommand(text);
  if (GENERATE_PHRASES.has(t)) return "generate";
  if (stage === "recipe_results" && NONE_PHRASES.has(t)) return "none_of_these";
  return null;
}

export type RecipeChefEntry =
  | { kind: "finder"; input: FinderInput }
  | { kind: "classify"; recipeTitle: string }
  | { kind: "legacy" };

/** `history` is the conversation BEFORE this turn's user row is inserted. */
export function decideRecipeChefEntry(
  history: ChatMessage[],
  text: string,
): RecipeChefEntry {
  const latest = getLatestFinderBlock(history);
  if (latest) {
    return {
      kind: "finder",
      input: {
        kind: "typed",
        text,
        command: matchTypedFinderCommand(text, latest.type),
      },
    };
  }
  const card = getLatestRecipe(history, { latestOnly: false });
  if (card) return { kind: "classify", recipeTitle: card.title };
  if (!history.some((m) => m.role === "user")) {
    return { kind: "finder", input: { kind: "start", text } };
  }
  return { kind: "legacy" };
}

export type CoachFinderEntry =
  | { kind: "finder"; input: FinderInput }
  | { kind: "classify"; recipeTitle: string }
  | { kind: "none" };

/**
 * `history` INCLUDES this turn's user row (Coach inserts it first). Coach runs
 * classifyTurn only while the generated card is the LATEST assistant message:
 * a Coach conversation moves on to other topics, and classifyTurn's
 * new_request fallback must never turn "how am I doing?" into a recipe list.
 */
export function decideCoachFinderEntry(
  history: ChatMessage[],
  text: string,
  intent: CoachIntent,
  action?: FinderAction,
): CoachFinderEntry {
  if (action) return { kind: "finder", input: { kind: "action", action } };
  if (intent === "safety_refusal") return { kind: "none" };
  const latest = getLatestFinderBlock(history);
  if (latest) {
    return {
      kind: "finder",
      input: {
        kind: "typed",
        text,
        command: matchTypedFinderCommand(text, latest.type),
      },
    };
  }
  const card = getLatestRecipe(history, { latestOnly: true });
  if (card) return { kind: "classify", recipeTitle: card.title };
  if (intent === "recipe_request") {
    return { kind: "finder", input: { kind: "start", text } };
  }
  return { kind: "none" };
}
```

(`CoachIntent` gains `"recipe_request"` in Task 19; until then the `intent === "recipe_request"` comparison is a type error — so implement Task 19's one-line union change (`| "recipe_request"` in `coach-intent-classifier.ts:1-5`) as part of this step, with Task 19 adding its rule and tests.)

- [ ] **Step 4: Run** both files → PASS.
- [ ] **Step 5: Commit** — `commit-msg-finder-task-15.txt`: `feat(recipe-finder): plain-text fallback, entry rules, typed-command guard`.

### Task 16: Storage — one generation count, finder user rows, atomic Generate + Spoonacular claims

**Cap-storage decision (spec §6 asked the plan to choose):** no migration. But counting "today's `source: spoonacular` `recipe_results` _assistant_ messages" (the spec's first option) is **not atomic**: that row can only be written after Spoonacular answers, so two concurrent taps both pass the check. Following the `chat.ts:312` precedent (lock → count → write the record in one transaction, _before_ the work), the record is instead a marker on the tap's own **user** row: `metadata.spoonacularSearch = true`, set by `claimSpoonacularSearch` under the per-user advisory lock. Same for generations (`metadata.recipeGeneration = true`). Consequences, stated in the PR: a claimed search that then fails (402/timeout) still uses a slot (conservative — Spoonacular may already have charged), and deleting a conversation cascades its rows and frees their slots (the same property today's daily generation/message limits already have).

**The quota trap (R2):** `createChatMessageWithLimitCheck(…, "recipe")` counts every user row in recipe conversations. Finder-step rows are marked `metadata.finderInput = true` and excluded; a finder Generate is counted through its `recipeGeneration` marker — in recipe **and** coach conversations — so both chats share the one 20/day limit.

**Files:**

- Modify: `server/storage/chat.ts:1-12` (imports), `:297-469` (extract the count), append three functions
- Modify: `server/storage/index.ts:165-168`
- Test: `server/storage/__tests__/chat.test.ts` (append; real-DB transaction harness — needs the dev Postgres)

**Interfaces:**

- Produces:
  - `type FinderUserMessageResult = { status: "created"; message: ChatMessage } | { status: "duplicate" } | { status: "limit_reached" }`
  - `createFinderUserMessage(conversationId: number, userId: string, content: string, opts?: { action?: { flowId: string; type: string }; coachDailyLimit?: number }): Promise<FinderUserMessageResult>`
  - `claimRecipeGeneration(userId: string, messageId: number, dailyLimit: number): Promise<boolean>`
  - `claimSpoonacularSearch(userId: string, messageId: number, dailyCap: number): Promise<boolean>`
  - (internal) `countRecipeGenerationsToday(tx, userId): Promise<number>` = A (recipe-conv user rows **not** `finderInput`) + B (any user row with `recipeGeneration`) + C (distinct remix conversations today, unchanged)

- [ ] **Step 1: Write the failing DB tests**

Add `createFinderUserMessage, claimRecipeGeneration, claimSpoonacularSearch` to the `await import("../chat")` destructure, then append inside `describe("chat storage")`:

```ts
// ---- Recipe finder quota (spec §6, R2) ----

describe("recipe finder — generation quota and Spoonacular cap", () => {
  const FLOW_A = "11111111-1111-4111-8111-111111111111";
  const FLOW_B = "22222222-2222-4222-8222-222222222222";

  it("finder-step rows in a recipe conversation never count as generations", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    for (const text of ["Mediterranean", "None of these", "Under 20 minutes"]) {
      const r = await createFinderUserMessage(conv.id, testUser.id, text);
      expect(r.status).toBe("created");
    }
    // Limit 1: the three finder rows must not have used it up.
    const legacy = await createChatMessageWithLimitCheck(
      conv.id,
      testUser.id,
      "Make pasta",
      1,
      "recipe",
    );
    expect(legacy).not.toBeNull();
  });

  it("a claimed Generate counts, and shares the limit with the legacy path", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const r1 = await createFinderUserMessage(conv.id, testUser.id, "Generate", {
      action: { flowId: FLOW_A, type: "generate" },
    });
    if (r1.status !== "created") throw new Error("expected created");
    expect(await claimRecipeGeneration(testUser.id, r1.message.id, 1)).toBe(
      true,
    );

    const r2 = await createFinderUserMessage(conv.id, testUser.id, "Generate", {
      action: { flowId: FLOW_B, type: "generate" },
    });
    if (r2.status !== "created") throw new Error("expected created");
    expect(await claimRecipeGeneration(testUser.id, r2.message.id, 1)).toBe(
      false,
    );
    expect(
      await createChatMessageWithLimitCheck(
        conv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).toBeNull();
  });

  it("a Coach Generate counts against the same 20/day recipe limit", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    const row = await createChatMessage(
      coach.id,
      testUser.id,
      "user",
      "Generate",
    );
    expect(await claimRecipeGeneration(testUser.id, row.id, 1)).toBe(true);
    const recipeConv = await createChatConversation(
      testUser.id,
      "Recipe",
      "recipe",
    );
    expect(
      await createChatMessageWithLimitCheck(
        recipeConv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).toBeNull();
  });

  it("control: without a claim, a Coach row does not touch the recipe limit", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    await createChatMessage(coach.id, testUser.id, "user", "How am I doing?");
    const recipeConv = await createChatConversation(
      testUser.id,
      "Recipe",
      "recipe",
    );
    expect(
      await createChatMessageWithLimitCheck(
        recipeConv.id,
        testUser.id,
        "Make pasta",
        1,
        "recipe",
      ),
    ).not.toBeNull();
  });

  it("a repeated action on the same flowId is a duplicate (double tap)", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const first = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Generate",
      { action: { flowId: FLOW_A, type: "generate" } },
    );
    const second = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Generate",
      { action: { flowId: FLOW_A, type: "generate" } },
    );
    expect(first.status).toBe("created");
    expect(second).toEqual({ status: "duplicate" });
    const other = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "None of these",
      { action: { flowId: FLOW_B, type: "none_of_these" } },
    );
    expect(other.status).toBe("created");
  });

  it("enforces the Coach Pro message limit for Coach button taps", async () => {
    const coach = await createChatConversation(testUser.id, "Coach", "coach");
    await createChatMessage(coach.id, testUser.id, "user", "hi");
    const r = await createFinderUserMessage(coach.id, testUser.id, "Generate", {
      action: { flowId: FLOW_A, type: "generate" },
      coachDailyLimit: 1,
    });
    expect(r).toEqual({ status: "limit_reached" });
  });

  it("caps Spoonacular searches per user per day", async () => {
    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const claims: boolean[] = [];
    for (const flowId of [
      FLOW_A,
      FLOW_B,
      "33333333-3333-4333-8333-333333333333",
    ]) {
      const r = await createFinderUserMessage(
        conv.id,
        testUser.id,
        "Search Spoonacular",
        { action: { flowId, type: "search_online" } },
      );
      if (r.status !== "created") throw new Error("expected created");
      claims.push(await claimSpoonacularSearch(testUser.id, r.message.id, 2));
    }
    expect(claims).toEqual([true, true, false]);
  });

  it("another user's searches do not count toward this user's cap", async () => {
    const other = await createTestUser(tx);
    const otherConv = await createChatConversation(
      other.id,
      "Recipe",
      "recipe",
    );
    const o = await createFinderUserMessage(
      otherConv.id,
      other.id,
      "Search Spoonacular",
      { action: { flowId: FLOW_A, type: "search_online" } },
    );
    if (o.status !== "created") throw new Error("expected created");
    expect(await claimSpoonacularSearch(other.id, o.message.id, 1)).toBe(true);

    const conv = await createChatConversation(testUser.id, "Recipe", "recipe");
    const r = await createFinderUserMessage(
      conv.id,
      testUser.id,
      "Search Spoonacular",
      { action: { flowId: FLOW_B, type: "search_online" } },
    );
    if (r.status !== "created") throw new Error("expected created");
    expect(await claimSpoonacularSearch(testUser.id, r.message.id, 1)).toBe(
      true,
    );
  });

  it("cannot claim another user's message", async () => {
    const other = await createTestUser(tx);
    const otherConv = await createChatConversation(
      other.id,
      "Recipe",
      "recipe",
    );
    const o = await createFinderUserMessage(otherConv.id, other.id, "Generate");
    if (o.status !== "created") throw new Error("expected created");
    expect(await claimRecipeGeneration(testUser.id, o.message.id, 20)).toBe(
      false,
    );
  });

  it("rejects a conversation the user does not own", async () => {
    const other = await createTestUser(tx);
    const otherConv = await createChatConversation(
      other.id,
      "Recipe",
      "recipe",
    );
    await expect(
      createFinderUserMessage(otherConv.id, testUser.id, "x"),
    ).rejects.toThrow("Conversation not found");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/storage/__tests__/chat.test.ts -t "recipe finder"` — Expected: FAIL (`createFinderUserMessage is not a function`). If Postgres is unreachable the suite errors on connect — start it first; never report a skipped DB suite as green.

- [ ] **Step 3: Implement**

In `server/storage/chat.ts`, add below `assertChatMessageRole`:

```ts
type ChatTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lockUser = (tx: ChatTx, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

/**
 * Today's recipe generations — the ONE count the legacy recipe/remix path and
 * the recipe finder's Generate step both enforce (spec §6):
 *   A: user rows in recipe conversations that are not finder-step rows
 *   B: user rows anywhere claimed as a finder Generate (recipe or coach)
 *   C: distinct remix conversations with a user row, created today
 * Rows written before the finder existed carry neither marker, so for them
 * this equals the previous recipe+remix count exactly.
 */
async function countRecipeGenerationsToday(
  tx: ChatTx,
  userId: string,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(new Date());
  const today = and(
    eq(chatConversations.userId, userId),
    eq(chatMessages.role, "user"),
    gte(chatMessages.createdAt, startOfDay),
    lt(chatMessages.createdAt, endOfDay),
  );
  const [legacyRecipeRows, claimedRows, remixConvCount] = await Promise.all([
    tx
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(
        and(
          today,
          eq(chatConversations.type, "recipe"),
          sql`coalesce(${chatMessages.metadata}->>'finderInput', 'false') <> 'true'`,
        ),
      ),
    tx
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(
        and(today, sql`${chatMessages.metadata}->>'recipeGeneration' = 'true'`),
      ),
    tx
      .select({ count: sql<number>`count(DISTINCT ${chatConversations.id})` })
      .from(chatConversations)
      .innerJoin(
        chatMessages,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(
        and(
          eq(chatConversations.userId, userId),
          eq(chatConversations.type, "remix"),
          eq(chatMessages.role, "user"),
          gte(chatConversations.createdAt, startOfDay),
          lt(chatConversations.createdAt, endOfDay),
        ),
      ),
  ]);
  return (
    Number(legacyRecipeRows[0]?.count ?? 0) +
    Number(claimedRows[0]?.count ?? 0) +
    Number(remixConvCount[0]?.count ?? 0)
  );
}
```

In `createChatMessageWithLimitCheck`, replace the remix first-message `Promise.all([...])` + `totalGenerations` block (lines 370-419) and the recipe-branch `Promise.all([...])` + `totalGenerations` block (lines 425-469) each with:

```ts
const totalGenerations = await countRecipeGenerationsToday(tx, userId);
```

(keeping the `if (totalGenerations >= dailyLimit) return null;` that follows each). The `const { startOfDay, endOfDay } = getDayBounds(new Date());` line stays — the coach branch still uses it. Replace the lock `tx.execute(...)` at the top with `await lockUser(tx, userId);`.

Append:

```ts
export type FinderUserMessageResult =
  | { status: "created"; message: ChatMessage }
  | { status: "duplicate" }
  | { status: "limit_reached" };

/**
 * A recipe-finder user row (typed request or button tap). Never counted as a
 * recipe generation (`finderInput`). A button tap's flowId is recorded so a
 * repeated tap on the same flow is a duplicate — checked under the same
 * per-user advisory lock every chat write takes, so concurrent double taps
 * serialize. Coach taps also enforce the Coach Pro message limit.
 */
export async function createFinderUserMessage(
  conversationId: number,
  userId: string,
  content: string,
  opts: {
    action?: { flowId: string; type: string };
    coachDailyLimit?: number;
  } = {},
): Promise<FinderUserMessageResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const owned = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      )
      .limit(1);
    if (owned.length === 0) throw new Error("Conversation not found");

    if (opts.action) {
      const dup = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            eq(chatMessages.role, "user"),
            sql`${chatMessages.metadata}->'finderAction'->>'flowId' = ${opts.action.flowId}`,
          ),
        )
        .limit(1);
      if (dup.length > 0) return { status: "duplicate" as const };
    }

    if (opts.coachDailyLimit !== undefined) {
      const { startOfDay, endOfDay } = getDayBounds(new Date());
      const [row] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .innerJoin(
          chatConversations,
          eq(chatMessages.conversationId, chatConversations.id),
        )
        .where(
          and(
            eq(chatConversations.userId, userId),
            eq(chatConversations.type, "coach"),
            eq(chatMessages.role, "user"),
            gte(chatMessages.createdAt, startOfDay),
            lt(chatMessages.createdAt, endOfDay),
          ),
        );
      if (Number(row?.count ?? 0) >= opts.coachDailyLimit) {
        return { status: "limit_reached" as const };
      }
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        role: "user",
        content,
        metadata: {
          finderInput: true,
          ...(opts.action ? { finderAction: opts.action } : {}),
        },
      })
      .returning();
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    return { status: "created" as const, message };
  });
}

/** Sets a boolean marker on the user's own user row. Returns false if no row matched. */
async function markUserRow(
  tx: ChatTx,
  userId: string,
  messageId: number,
  marker: "recipeGeneration" | "spoonacularSearch",
): Promise<boolean> {
  const updated = await tx
    .update(chatMessages)
    .set({
      metadata: sql`coalesce(${chatMessages.metadata}, '{}'::jsonb) || jsonb_build_object(${marker}::text, true)`,
    })
    .where(
      and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.role, "user"),
        inArray(
          chatMessages.conversationId,
          tx
            .select({ id: chatConversations.id })
            .from(chatConversations)
            .where(eq(chatConversations.userId, userId)),
        ),
      ),
    )
    .returning({ id: chatMessages.id });
  return updated.length > 0;
}

/**
 * Atomically check the 20/day recipe generation limit and record this
 * Generate against it (lock → count → mark, one transaction — the
 * createChatMessageWithLimitCheck precedent). Both chats call this.
 */
export async function claimRecipeGeneration(
  userId: string,
  messageId: number,
  dailyLimit: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if ((await countRecipeGenerationsToday(tx, userId)) >= dailyLimit) {
      return false;
    }
    return markUserRow(tx, userId, messageId, "recipeGeneration");
  });
}

/** D9: DB-backed per-user Spoonacular list-search cap (never in-memory). */
export async function claimSpoonacularSearch(
  userId: string,
  messageId: number,
  dailyCap: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const { startOfDay, endOfDay } = getDayBounds(new Date());
    const [row] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(
        and(
          eq(chatConversations.userId, userId),
          eq(chatMessages.role, "user"),
          gte(chatMessages.createdAt, startOfDay),
          lt(chatMessages.createdAt, endOfDay),
          sql`${chatMessages.metadata}->>'spoonacularSearch' = 'true'`,
        ),
      );
    if (Number(row?.count ?? 0) >= dailyCap) return false;
    return markUserRow(tx, userId, messageId, "spoonacularSearch");
  });
}
```

In `server/storage/index.ts` after line 167 add:

```ts
  createFinderUserMessage: chat.createFinderUserMessage,
  claimRecipeGeneration: chat.claimRecipeGeneration,
  claimSpoonacularSearch: chat.claimSpoonacularSearch,
```

- [ ] **Step 4: Run** `npx vitest run server/storage/__tests__/chat.test.ts` → PASS (the 10 new tests **and** the pre-existing remix/recipe quota tests — the refactor must keep `recipe type correctly counts remix conversations as 1 each` green).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-16.txt`: `feat(storage): one recipe-generation count; finder user rows; atomic Generate + Spoonacular claims (no migration)`.

### Task 17: Orchestration — `gateRecipeGeneration`, generation messages, `executeFinderStep`

**Files:**

- Create: `server/services/recipe-finder/generate.ts`, `server/services/recipe-finder/run-turn.ts`, `server/services/recipe-finder/index.ts`
- Create: `server/services/recipe-finder/__tests__/run-turn.test.ts`

**Interfaces:**

- Consumes: Tasks 6, 8, 9, 11–16; `buildRecipeContext` (`server/services/recipe-chat.ts:126`).
- Produces:
  - `type GenerateGate = { status: "allowed" } | { status: "premium_required" } | { status: "limit_reached" }`
  - `gateRecipeGeneration(args: { userId: string; userMessageId: number; canGenerate: boolean; dailyLimit: number }): Promise<GenerateGate>` — the premium check **and** the 20/day limit live here, so the Coach path cannot bypass them (§3.1).
  - `type GenerationMessages = { role: "user" | "assistant" | "system"; content: string }[]`
  - `buildFinderGenerationMessages(input: { mode: "fresh"; request: string } | { mode: "refine"; history: ChatMessage[] }): GenerationMessages`
  - `type FinderFeatures = Pick<PremiumFeatures, "catalogSave" | "recipeGeneration" | "dailyRecipeGenerations">`
  - `interface FinderTurnContext { userId: string; userMessageId: number; history: ChatMessage[]; profile: UserProfile | null | undefined; features: FinderFeatures; nextFlowId?: () => string }`
  - `type FinderTurnResult = { kind: "ignored" } | { kind: "message"; content: string; block: FinderBlock } | { kind: "generate"; request: string; messages: GenerationMessages }`
  - `prepareFinderTurn(history: ChatMessage[], input: FinderInput): { latest: FinderBlock | null; step: FinderStep }`
  - `executeFinderStep(step: FinderStep, ctx: FinderTurnContext): Promise<FinderTurnResult>`
  - `index.ts` re-exports everything the route and Coach need.

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/recipe-finder/__tests__/run-turn.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatMessage } from "@shared/schema";
import type { FinderFlow } from "@shared/schemas/recipe-finder";
import {
  executeFinderStep,
  prepareFinderTurn,
  type FinderTurnContext,
} from "../run-turn";
import { buildFinderGenerationMessages } from "../generate";
import { storage } from "../../../storage";
import { extractQuery } from "../extract-query";
import { findCommunity } from "../find-community";
import { findOnline } from "../find-online";
import { askClarifying } from "../ask-clarifying";

vi.mock("../../../storage", () => ({
  storage: { claimRecipeGeneration: vi.fn(), claimSpoonacularSearch: vi.fn() },
}));
vi.mock("../extract-query", () => ({ extractQuery: vi.fn() }));
vi.mock("../find-community", () => ({ findCommunity: vi.fn() }));
vi.mock("../find-online", () => ({ findOnline: vi.fn() }));
vi.mock("../ask-clarifying", () => ({ askClarifying: vi.fn() }));

const NEXT = "11111111-1111-4111-8111-111111111111";
const flow: FinderFlow = {
  flowId: "00000000-0000-4000-8000-000000000000",
  stage: "results",
  request: "Mediterranean",
  query: { q: "mediterranean" },
  round: 0,
  shownIds: [],
};
const ctx = (over: Partial<FinderTurnContext> = {}): FinderTurnContext => ({
  userId: "u1",
  userMessageId: 50,
  history: [],
  profile: null,
  features: {
    catalogSave: true,
    recipeGeneration: true,
    dailyRecipeGenerations: 20,
  },
  nextFlowId: () => NEXT,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SPOONACULAR_API_KEY", "k");
  vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "10");
});
afterEach(() => vi.unstubAllEnvs());

describe("executeFinderStep", () => {
  it("community: extract → search → list with the plain-text fallback", async () => {
    vi.mocked(extractQuery).mockResolvedValue({ q: "mediterranean" });
    vi.mocked(findCommunity).mockResolvedValue([
      {
        id: 12,
        source: "community",
        title: "Quinoa Salad",
        imageUrl: null,
        readyInMinutes: null,
        calories: 350,
      },
    ]);
    const out = await executeFinderStep(
      {
        kind: "search_community",
        request: "Mediterranean",
        round: 0,
        excludeIds: [],
        priorShownIds: [],
      },
      ctx(),
    );
    expect(out.kind).toBe("message");
    if (out.kind !== "message") return;
    expect(out.block.type).toBe("recipe_results");
    expect(out.block.flow.flowId).toBe(NEXT);
    expect(out.content).toMatch(/^Here are 1 community recipe:/);
    expect(findCommunity).toHaveBeenCalledWith(
      { q: "mediterranean" },
      "u1",
      [],
    );
  });

  it("online: claims a cap slot before calling Spoonacular", async () => {
    vi.mocked(storage.claimSpoonacularSearch).mockResolvedValue(true);
    vi.mocked(findOnline).mockResolvedValue({ status: "ok", items: [] });
    await executeFinderStep({ kind: "search_online", flow }, ctx());
    expect(storage.claimSpoonacularSearch).toHaveBeenCalledWith("u1", 50, 10);
    expect(findOnline).toHaveBeenCalledWith({ q: "mediterranean" }, undefined);
  });

  it("online at the per-user cap → 'unavailable', Spoonacular never called", async () => {
    vi.mocked(storage.claimSpoonacularSearch).mockResolvedValue(false);
    const out = await executeFinderStep({ kind: "search_online", flow }, ctx());
    expect(findOnline).not.toHaveBeenCalled();
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("unavailable");
  });

  it("online without catalogSave (premium deny) → 'unavailable' with no claim", async () => {
    const out = await executeFinderStep(
      { kind: "search_online", flow },
      ctx({
        features: {
          catalogSave: false,
          recipeGeneration: true,
          dailyRecipeGenerations: 20,
        },
      }),
    );
    expect(storage.claimSpoonacularSearch).not.toHaveBeenCalled();
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("unavailable");
  });

  it("clarifying: returns a questions block", async () => {
    vi.mocked(askClarifying).mockResolvedValue([
      { question: "Time?", options: ["a", "b"] },
    ]);
    const out = await executeFinderStep(
      { kind: "ask_clarifying", flow },
      ctx(),
    );
    expect(out.kind === "message" && out.block.type).toBe("recipe_questions");
  });

  it("generate allowed → fresh generation messages; the claim is on this turn's user row", async () => {
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    const out = await executeFinderStep(
      { kind: "generate", request: "Mediterranean", flow },
      ctx(),
    );
    expect(storage.claimRecipeGeneration).toHaveBeenCalledWith("u1", 50, 20);
    expect(out).toEqual({
      kind: "generate",
      request: "Mediterranean",
      messages: [
        { role: "user", content: "Create a recipe for: Mediterranean" },
      ],
    });
  });

  it("generate at the daily limit → blocked block (generate_limit), no generation", async () => {
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(false);
    const out = await executeFinderStep(
      { kind: "generate", request: "Mediterranean", flow },
      ctx(),
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("generate_limit");
    expect(out.block.actions).toEqual(["search_online"]);
  });

  it("generate without recipeGeneration (premium deny) → generate_premium, no claim", async () => {
    const out = await executeFinderStep(
      { kind: "generate", request: "x", flow },
      ctx({
        features: {
          catalogSave: true,
          recipeGeneration: false,
          dailyRecipeGenerations: 0,
        },
      }),
    );
    expect(storage.claimRecipeGeneration).not.toHaveBeenCalled();
    if (out.kind !== "message" || out.block.type !== "recipe_results")
      throw new Error("expected results");
    expect(out.block.notice).toBe("generate_premium");
  });

  it("round 1 with no community matches generates (and claims)", async () => {
    vi.mocked(extractQuery).mockResolvedValue({ q: "x" });
    vi.mocked(findCommunity).mockResolvedValue([]);
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    const out = await executeFinderStep(
      {
        kind: "search_community",
        request: "x. Time? 20 min",
        round: 1,
        excludeIds: [],
        priorShownIds: [],
      },
      ctx(),
    );
    expect(out.kind).toBe("generate");
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
  });

  it("ignore → ignored, with no AI or DB work", async () => {
    await expect(
      executeFinderStep({ kind: "ignore", reason: "stale_flow" }, ctx()),
    ).resolves.toEqual({ kind: "ignored" });
    expect(extractQuery).not.toHaveBeenCalled();
  });
});

describe("prepareFinderTurn", () => {
  it("plans from the latest stored block", () => {
    const history = [
      {
        id: 1,
        conversationId: 1,
        role: "assistant",
        content: "c",
        metadata: {
          metadataVersion: 1,
          finder: {
            type: "recipe_results",
            source: "community",
            items: [],
            actions: ["generate"],
            notice: "no_matches",
            flow,
          },
        },
        turnKey: null,
        createdAt: new Date(),
      },
    ] as ChatMessage[];
    expect(
      prepareFinderTurn(history, {
        kind: "action",
        action: { type: "generate", flowId: flow.flowId },
      }).step,
    ).toEqual({ kind: "generate", request: "Mediterranean", flow });
  });
});

describe("buildFinderGenerationMessages", () => {
  it("refine mode reuses RecipeChef's context builder (latest recipe JSON included)", () => {
    const recipe = {
      title: "Curry",
      description: "d",
      difficulty: "Easy",
      timeEstimate: "30 min",
      servings: 2,
      ingredients: [],
      instructions: ["x"],
      dietTags: [],
    };
    const history = [
      {
        id: 1,
        conversationId: 1,
        role: "assistant",
        content: "Here!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
        turnKey: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        conversationId: 1,
        role: "user",
        content: "make it spicier",
        metadata: null,
        turnKey: null,
        createdAt: new Date(),
      },
    ] as ChatMessage[];
    const msgs = buildFinderGenerationMessages({ mode: "refine", history });
    expect(msgs[0].content).toContain('[Recipe: {"title":"Curry"');
    expect(msgs[1]).toEqual({ role: "user", content: "make it spicier" });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/recipe-finder/__tests__/run-turn.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// server/services/recipe-finder/generate.ts
import type { ChatMessage } from "@shared/schema";
import { storage } from "../../storage";
import { buildRecipeContext } from "../recipe-chat";

export type GenerateGate =
  | { status: "allowed" }
  | { status: "premium_required" }
  | { status: "limit_reached" };

/**
 * §3.1: the Generate step applies the recipeGeneration premium check and the
 * 20/day limit ITSELF — today they live only in the recipe/remix route, so
 * the Coach path would otherwise bypass both.
 */
export async function gateRecipeGeneration(args: {
  userId: string;
  userMessageId: number;
  canGenerate: boolean;
  dailyLimit: number;
}): Promise<GenerateGate> {
  if (!args.canGenerate) return { status: "premium_required" };
  const claimed = await storage.claimRecipeGeneration(
    args.userId,
    args.userMessageId,
    args.dailyLimit,
  );
  return claimed ? { status: "allowed" } : { status: "limit_reached" };
}

export type GenerationMessages = {
  role: "user" | "assistant" | "system";
  content: string;
}[];

export function buildFinderGenerationMessages(
  input:
    | { mode: "fresh"; request: string }
    | { mode: "refine"; history: ChatMessage[] },
): GenerationMessages {
  if (input.mode === "refine") return buildRecipeContext(input.history);
  return [{ role: "user", content: `Create a recipe for: ${input.request}` }];
}
```

```ts
// server/services/recipe-finder/run-turn.ts
import { randomUUID } from "node:crypto";
import type { ChatMessage, UserProfile } from "@shared/schema";
import type { FinderBlock } from "@shared/schemas/recipe-finder";
import type { PremiumFeatures } from "@shared/types/premium";
import { storage } from "../../storage";
import { extractQuery } from "./extract-query";
import { findCommunity } from "./find-community";
import { findOnline } from "./find-online";
import { askClarifying } from "./ask-clarifying";
import { getSpoonacularDailyCap, isOnlineCatalogConfigured } from "./config";
import { getLatestFinderBlock } from "./entry";
import { finderFallbackText } from "./fallback-text";
import {
  gateRecipeGeneration,
  buildFinderGenerationMessages,
  type GenerationMessages,
} from "./generate";
import {
  planFinderStep,
  finderOutcome,
  blockedGenerateBlock,
  type FinderCtx,
  type FinderInput,
  type FinderStep,
  type FinderStepResult,
} from "./transition";

export type FinderFeatures = Pick<
  PremiumFeatures,
  "catalogSave" | "recipeGeneration" | "dailyRecipeGenerations"
>;

export interface FinderTurnContext {
  userId: string;
  /** This turn's user row — the Generate / Spoonacular claims mark it. */
  userMessageId: number;
  history: ChatMessage[];
  profile: UserProfile | null | undefined;
  features: FinderFeatures;
  nextFlowId?: () => string;
}

export type FinderTurnResult =
  | { kind: "ignored" }
  | { kind: "message"; content: string; block: FinderBlock }
  | { kind: "generate"; request: string; messages: GenerationMessages };

export function prepareFinderTurn(
  history: ChatMessage[],
  input: FinderInput,
): { latest: FinderBlock | null; step: FinderStep } {
  const latest = getLatestFinderBlock(history);
  return { latest, step: planFinderStep(latest, input) };
}

function recentTranscript(history: ChatMessage[]) {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export async function executeFinderStep(
  step: FinderStep,
  ctx: FinderTurnContext,
): Promise<FinderTurnResult> {
  if (step.kind === "ignore") return { kind: "ignored" };
  const finderCtx: FinderCtx = {
    onlineConfigured: isOnlineCatalogConfigured(),
    canSearchOnline: ctx.features.catalogSave,
    canGenerate: ctx.features.recipeGeneration,
    nextFlowId: (ctx.nextFlowId ?? randomUUID)(),
  };

  let result: FinderStepResult = { kind: "none" };
  switch (step.kind) {
    case "search_community": {
      const query = await extractQuery(step.request, {
        dietType: ctx.profile?.dietType ?? null,
      });
      const items = await findCommunity(query, ctx.userId, step.excludeIds);
      result = { kind: "community", query, items };
      break;
    }
    case "search_online": {
      // Premium, configuration and the DB-backed cap all resolve to the same
      // "not available right now" (§6) — never "no results".
      const allowed =
        finderCtx.onlineConfigured &&
        finderCtx.canSearchOnline &&
        (await storage.claimSpoonacularSearch(
          ctx.userId,
          ctx.userMessageId,
          getSpoonacularDailyCap(),
        ));
      result = {
        kind: "online",
        result: allowed
          ? await findOnline(step.flow.query, ctx.profile?.allergies)
          : { status: "unavailable" },
      };
      break;
    }
    case "ask_clarifying":
      result = {
        kind: "questions",
        questions: await askClarifying(
          step.flow.request,
          recentTranscript(ctx.history),
        ),
      };
      break;
    case "generate":
      break;
  }

  const outcome = finderOutcome(step, result, finderCtx);
  if (outcome.kind === "ignore") return { kind: "ignored" };
  if (outcome.kind === "message") {
    return {
      kind: "message",
      block: outcome.block,
      content: finderFallbackText(outcome.block),
    };
  }
  const gate = await gateRecipeGeneration({
    userId: ctx.userId,
    userMessageId: ctx.userMessageId,
    canGenerate: finderCtx.canGenerate,
    dailyLimit: ctx.features.dailyRecipeGenerations,
  });
  if (gate.status !== "allowed") {
    const block = blockedGenerateBlock(
      outcome.flow,
      gate.status === "limit_reached" ? "generate_limit" : "generate_premium",
      finderCtx,
    );
    return { kind: "message", block, content: finderFallbackText(block) };
  }
  return {
    kind: "generate",
    request: outcome.request,
    messages: buildFinderGenerationMessages({
      mode: "fresh",
      request: outcome.request,
    }),
  };
}
```

```ts
// server/services/recipe-finder/index.ts
export {
  isRecipeFinderEnabled,
  getSpoonacularDailyCap,
  isOnlineCatalogConfigured,
} from "./config";
export { classifyTurn, type TurnClass } from "./classify-turn";
export {
  decideRecipeChefEntry,
  decideCoachFinderEntry,
  getLatestFinderBlock,
  isActionCurrent,
  matchTypedFinderCommand,
} from "./entry";
export {
  finderStatusLabel,
  type FinderInput,
  type FinderStep,
} from "./transition";
export {
  prepareFinderTurn,
  executeFinderStep,
  type FinderFeatures,
  type FinderTurnContext,
  type FinderTurnResult,
} from "./run-turn";
export { type GenerationMessages } from "./generate";
```

(`ctx.profile?.allergies` is the jsonb `allergies` column of `UserProfile`; `findOnline` runs it through `parseUserAllergies`.)

- [ ] **Step 4: Run** → PASS (12).
- [ ] **Step 5: Commit** — `commit-msg-finder-task-17.txt`: `feat(recipe-finder): executeFinderStep orchestration; Generate gate (premium + daily limit) for both chats`.

### Task 18: Chat route — `finderAction`, stale/duplicate guard, RecipeChef finder branch before the quota check

**Files:**

- Modify: `server/routes/chat.ts:1-40` (imports), `:290-295` (schema), `:336-360` (message creation), `:417-548` (recipe path), `:809` (append `endQuietly`)
- Test: `server/routes/__tests__/chat.test.ts:24-58` (storage mock), after `:121` (step-module mocks), append a describe inside `describe("POST /api/chat/conversations/:id/messages")`

**Interfaces:**

- Consumes: everything exported from `server/services/recipe-finder/index.ts` (Task 17); `finderActionSchema` (Task 5); `storage.createFinderUserMessage` (Task 16).
- Produces (wire contract):
  - Request body gains `finderAction?: FinderAction`.
  - RecipeChef finder SSE: `data: {"status":"Searching community recipes…"}` → `data: {"finder": FinderBlock}` → `data: {"done":true}`; the assistant row persists `content = finderFallbackText(block)`, `metadata = { metadataVersion: 1, finder: block }`.
  - A stale or duplicate action: `data: {"done":true}` only — no row, no AI call.
  - `finderAction` with the flag off, on a remix conversation, or on free Coach → `409 CONFLICT` "Recipe finder isn't available right now."

- [ ] **Step 1: Write the failing route tests**

In the storage mock (lines 24-58) add `createFinderUserMessage: vi.fn(), claimRecipeGeneration: vi.fn(), claimSpoonacularSearch: vi.fn(),`. After the `recipe-chat` mock add:

```ts
// Recipe finder: stub only the AI/Spoonacular/search boundaries — the entry
// rules, transition, fallback text and orchestration stay real.
vi.mock("../../services/recipe-finder/extract-query", () => ({
  extractQuery: vi.fn(async (text: string) => ({ q: text.slice(0, 200) })),
  rawQuery: vi.fn((text: string) => ({ q: text.slice(0, 200) })),
}));
vi.mock("../../services/recipe-finder/find-community", () => ({
  findCommunity: vi.fn(),
}));
vi.mock("../../services/recipe-finder/find-online", () => ({
  findOnline: vi.fn(),
}));
vi.mock("../../services/recipe-finder/ask-clarifying", () => ({
  askClarifying: vi.fn(),
  FALLBACK_QUESTIONS: [],
}));
vi.mock("../../services/recipe-finder/classify-turn", () => ({
  classifyTurn: vi.fn(),
  CLASSIFY_TURN_TIMEOUT_MS: 6000,
}));
```

and import `findCommunity`, `findOnline`, `classifyTurn` from those paths at the top. Append:

```ts
describe("recipe finder — RecipeChef (flag on)", () => {
  const FLOW = "11111111-1111-4111-8111-111111111111";
  const OTHER_FLOW = "22222222-2222-4222-8222-222222222222";
  const listBlock = {
    type: "recipe_results",
    source: "community",
    items: [
      {
        id: 12,
        source: "community",
        title: "Mediterranean Quinoa Salad",
        imageUrl: null,
        readyInMinutes: null,
        calories: 350,
      },
    ],
    actions: ["search_online", "generate", "none_of_these"],
    notice: null,
    flow: {
      flowId: FLOW,
      stage: "results",
      request: "Mediterranean",
      query: { q: "mediterranean" },
      round: 0,
      shownIds: ["community:12"],
    },
  };
  const recipe = {
    title: "Chicken Curry",
    description: "d",
    difficulty: "Easy" as const,
    timeEstimate: "30 min",
    servings: 2,
    ingredients: [],
    instructions: ["cook"],
    dietTags: [],
  };
  const flowHistory = () => [
    createMockChatMessage({ id: 1, role: "user", content: "Mediterranean" }),
    createMockChatMessage({
      id: 2,
      role: "assistant",
      content: "Here are 1 community recipe:…",
      metadata: { metadataVersion: 1, finder: listBlock },
    }),
  ];
  const cardHistory = () => [
    createMockChatMessage({ id: 1, role: "user", content: "curry" }),
    createMockChatMessage({
      id: 2,
      role: "assistant",
      content: "Here!",
      metadata: {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      },
    }),
  ];
  const userRow = createMockChatMessage({ id: 50, role: "user", content: "x" });
  const send = (body: object) =>
    request(app)
      .post("/api/chat/conversations/1/messages")
      .set("Authorization", "Bearer token")
      .send(body);

  beforeEach(() => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    vi.stubEnv("SPOONACULAR_API_KEY", "k");
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ type: "recipe" }),
    );
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "premium",
      expiresAt: null,
    });
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
    vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
    vi.mocked(storage.getChatMessages).mockResolvedValue([]);
    vi.mocked(storage.createChatMessage).mockResolvedValue(
      createMockChatMessage(),
    );
    vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
      createMockChatMessage(),
    );
    // fireAndForget calls .catch on this — a bare vi.fn() returns undefined and throws.
    vi.mocked(storage.updateChatConversationTitle).mockResolvedValue(
      createMockChatConversation(),
    );
    vi.mocked(storage.deleteChatMessage).mockResolvedValue(true);
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "created",
      message: userRow,
    });
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    vi.mocked(storage.claimSpoonacularSearch).mockResolvedValue(true);
    vi.mocked(findCommunity).mockResolvedValue(listBlock.items as never);
    vi.mocked(findOnline).mockResolvedValue({ status: "ok", items: [] });
    vi.mocked(classifyTurn).mockResolvedValue("new_request");
    vi.mocked(generateRecipeChatResponse).mockImplementation(
      async function* () {
        yield { content: "Here you go!" };
        yield { content: "", recipe, allergenWarning: null };
        yield { done: true };
      },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("control: flag off keeps today's path (generation quota, no finder)", async () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "");
    const res = await send({ content: "Mediterranean" });
    expect(res.status).toBe(200);
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      1,
      "1",
      "Mediterranean",
      20,
      "recipe",
    );
    expect(storage.createFinderUserMessage).not.toHaveBeenCalled();
    expect(res.text).not.toContain('"finder"');
  });

  it("first message runs the finder and never touches the generation quota (R2)", async () => {
    const res = await send({ content: "Mediterranean" });
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      'data: {"status":"Searching community recipes…"}',
    );
    expect(res.text).toContain('"finder":{"type":"recipe_results"');
    expect(res.text).toContain('"done":true');
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
    expect(storage.claimRecipeGeneration).not.toHaveBeenCalled();
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
    expect(storage.createFinderUserMessage).toHaveBeenCalledWith(
      1,
      "1",
      "Mediterranean",
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      expect.stringMatching(
        /^Here are 1 community recipe:\n1\. Mediterranean Quinoa Salad \(350 cal\)/,
      ),
      {
        metadataVersion: 1,
        finder: expect.objectContaining({ type: "recipe_results" }),
      },
    );
  });

  it("ignores an action whose flowId is not the latest finder message", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    const res = await send({
      content: "Generate",
      finderAction: { type: "generate", flowId: OTHER_FLOW },
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('data: {"done":true}\n\n');
    expect(storage.createFinderUserMessage).not.toHaveBeenCalled();
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
  });

  it("a duplicate action (double tap) is a quiet no-op", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    vi.mocked(storage.createFinderUserMessage).mockResolvedValue({
      status: "duplicate",
    });
    const res = await send({
      content: "Generate",
      finderAction: { type: "generate", flowId: FLOW },
    });
    expect(res.text).toBe('data: {"done":true}\n\n');
    expect(storage.createChatMessage).not.toHaveBeenCalled();
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
  });

  it("Generate claims a generation and streams through the existing recipe path", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    const res = await send({
      content: "Generate",
      finderAction: { type: "generate", flowId: FLOW },
    });
    expect(res.status).toBe(200);
    expect(storage.createFinderUserMessage).toHaveBeenCalledWith(
      1,
      "1",
      "Generate",
      { action: { flowId: FLOW, type: "generate" } },
    );
    expect(storage.claimRecipeGeneration).toHaveBeenCalledWith("1", 50, 20);
    expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
    expect(vi.mocked(generateRecipeChatResponse).mock.calls[0][0]).toEqual([
      { role: "user", content: "Create a recipe for: Mediterranean" },
    ]);
    expect(res.text).toContain('"status":"Creating your recipe…"');
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "1",
      "assistant",
      "Here you go!",
      { metadataVersion: 1, recipe, allergenWarning: null, imageUrl: null },
    );
  });

  it("Generate at the daily limit explains the limit and does not generate", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(false);
    const res = await send({
      content: "Generate",
      finderAction: { type: "generate", flowId: FLOW },
    });
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
    expect(res.text).toContain('"notice":"generate_limit"');
  });

  it('treats typed "generate" in the results stage as the Generate action', async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    await send({ content: "Generate!" });
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
    expect(generateRecipeChatResponse).toHaveBeenCalled();
    expect(findCommunity).not.toHaveBeenCalled();
  });

  it("typed text in the results stage refines the search (no generation)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    await send({ content: "with chickpeas" });
    expect(findCommunity).toHaveBeenCalled();
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
  });

  it("search_online at the per-user cap reports unavailable and never calls Spoonacular", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(flowHistory());
    vi.mocked(storage.claimSpoonacularSearch).mockResolvedValue(false);
    const res = await send({
      content: "Search Spoonacular",
      finderAction: { type: "search_online", flowId: FLOW },
    });
    expect(findOnline).not.toHaveBeenCalled();
    expect(res.text).toContain('"notice":"unavailable"');
  });

  it("routes a refine_current follow-up to the legacy recipe path", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(cardHistory());
    vi.mocked(classifyTurn).mockResolvedValue("refine_current");
    await send({ content: "make it spicier" });
    expect(classifyTurn).toHaveBeenCalledWith(
      "make it spicier",
      "Chicken Curry",
    );
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      1,
      "1",
      "make it spicier",
      20,
      "recipe",
    );
    expect(generateRecipeChatResponse).toHaveBeenCalled();
    expect(storage.createFinderUserMessage).not.toHaveBeenCalled();
  });

  it("starts a new list for a new_request after a card (D10)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue(cardHistory());
    vi.mocked(classifyTurn).mockResolvedValue("new_request");
    const res = await send({ content: "now a dessert" });
    expect(res.text).toContain('"finder":{"type":"recipe_results"');
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
  });

  it("remix never enters the flow", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation({ type: "remix" }),
    );
    await send({ content: "make it vegan" });
    expect(storage.createFinderUserMessage).not.toHaveBeenCalled();
    expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
      1,
      "1",
      "make it vegan",
      20,
      "remix",
    );
  });

  it("rejects finderAction when the flag is off (409)", async () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "");
    const res = await send({
      content: "Generate",
      finderAction: { type: "generate", flowId: FLOW },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("rejects finderAction from free Coach (409 — D7)", async () => {
    vi.mocked(storage.getChatConversation).mockResolvedValue(
      createMockChatConversation(),
    );
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "free",
      expiresAt: null,
    });
    const res = await send({
      content: "Generate",
      finderAction: { type: "generate", flowId: FLOW },
    });
    expect(res.status).toBe(409);
  });

  it("rejects a malformed finderAction (400)", async () => {
    const res = await send({
      content: "Generate",
      finderAction: { type: "answers", flowId: FLOW },
    });
    expect(res.status).toBe(400);
  });
});
```

(Add `afterEach` to the file's `vitest` import if it is not already imported.)

- [ ] **Step 2: Run** `npx vitest run server/routes/__tests__/chat.test.ts -t "recipe finder"` — Expected: FAIL — the flag-off control passes; every flag-on test fails (the route never branches: `createChatMessageWithLimitCheck` is called for the first message, no `"finder"` in the body, `finderAction` is stripped by the schema so the stale/409 tests stream normally).

- [ ] **Step 3: Implement**

Imports (add):

```ts
import type { ChatMessage } from "@shared/schema";
import { finderActionSchema } from "@shared/schemas/recipe-finder";
import {
  isRecipeFinderEnabled,
  decideRecipeChefEntry,
  getLatestFinderBlock,
  isActionCurrent,
  classifyTurn,
  prepareFinderTurn,
  executeFinderStep,
  finderStatusLabel,
  type FinderInput,
  type GenerationMessages,
} from "../services/recipe-finder";
```

Schema (lines 290-295):

```ts
const schema = z.object({
  content: z.string().min(1).max(2000),
  screenContext: z.string().max(1500).optional(),
  warmUpId: z.string().max(100).optional(),
  turnKey: z.string().uuid().optional(),
  // Recipe finder button taps (R2): structured, never parsed from
  // `content`, and never from route params (#1147/#1148).
  finderAction: finderActionSchema.optional(),
});
```

Replace lines 336-360 (from `// Atomically check daily limit…` through the 429 block) with:

```ts
const sanitizedContent = sanitizeUserInput(parsed.data.content);
const finderEnabled = isRecipeFinderEnabled();
const finderAction = parsed.data.finderAction;
if (
  finderAction &&
  (!finderEnabled || isRemixChat || (!isRecipeChat && !features.coachPro))
) {
  return sendError(
    res,
    409,
    "Recipe finder isn't available right now.",
    ErrorCode.CONFLICT,
  );
}

// ─── RECIPE FINDER ENTRY (flag on) ───────────────────
// Must run BEFORE createChatMessageWithLimitCheck: that check counts
// every recipe-chat user row as a generation (R2 quota trap). Finder
// rows go through createFinderUserMessage (never counted); only a
// Generate step claims a generation (executeFinderStep).
let message: ChatMessage | null = null;
let finderHistory: ChatMessage[] = [];
let recipeFinderInput: FinderInput | null = null;
if (finderEnabled && (finderAction || isRecipeChat)) {
  finderHistory = await storage.getChatMessages(id, 20, req.userId);
  if (finderAction) {
    // Stale (an older list's button) → quiet no-op, before any row.
    if (!isActionCurrent(getLatestFinderBlock(finderHistory), finderAction)) {
      return endQuietly(res);
    }
    const created = await storage.createFinderUserMessage(
      id,
      req.userId,
      sanitizedContent,
      {
        action: { flowId: finderAction.flowId, type: finderAction.type },
        ...(isRecipeChat
          ? {}
          : { coachDailyLimit: features.coachProDailyMessages }),
      },
    );
    // Double tap: the same flowId already has a row → quiet no-op.
    if (created.status === "duplicate") return endQuietly(res);
    if (created.status === "limit_reached") {
      return sendError(
        res,
        429,
        "Daily Coach Pro message limit reached",
        ErrorCode.DAILY_LIMIT_REACHED,
      );
    }
    message = created.message;
    if (isRecipeChat) {
      recipeFinderInput = { kind: "action", action: finderAction };
    }
  } else {
    // RecipeChef typed turn (§3.3). Remix never gets here.
    const entry = decideRecipeChefEntry(finderHistory, sanitizedContent);
    if (entry.kind === "finder") {
      recipeFinderInput = entry.input;
    } else if (entry.kind === "classify") {
      const turn = await classifyTurn(sanitizedContent, entry.recipeTitle);
      if (turn === "new_request") {
        recipeFinderInput = { kind: "start", text: sanitizedContent };
      }
    }
    if (recipeFinderInput) {
      const created = await storage.createFinderUserMessage(
        id,
        req.userId,
        sanitizedContent,
      );
      if (created.status !== "created") return endQuietly(res);
      message = created.message;
    }
  }
}

if (!message) {
  // Atomically check daily limit and create message in a single
  // transaction to prevent TOCTOU races bypassing the limit.
  const dailyLimit =
    isRecipeChat || isRemixChat
      ? features.dailyRecipeGenerations
      : features.coachPro
        ? features.coachProDailyMessages
        : features.dailyCoachMessages;
  message = await storage.createChatMessageWithLimitCheck(
    id,
    req.userId,
    sanitizedContent,
    dailyLimit,
    conversationType,
  );
  if (!message) {
    return sendError(
      res,
      429,
      isRecipeChat || isRemixChat
        ? "Daily recipe generation limit reached"
        : features.coachPro
          ? "Daily Coach Pro message limit reached"
          : "Daily chat message limit reached",
      ErrorCode.DAILY_LIMIT_REACHED,
    );
  }
}
```

(The old `const sanitizedContent = sanitizeUserInput(...)` at line 344 is removed — it now sits at the top of this block. `message` is narrowed to `ChatMessage` after the `if (!message)` block, so the H6 settle's `message.id` still type-checks.)

In the recipe path, immediately inside `if (isRecipeChat || isRemixChat) {` (line 417), insert:

```ts
// ─── RECIPE FINDER STEP (RecipeChef, flag on) ────────
let finderGeneration: GenerationMessages | null = null;
if (recipeFinderInput) {
  const finderProfile = await storage.getUserProfile(req.userId);
  const { step } = prepareFinderTurn(finderHistory, recipeFinderInput);
  const label = finderStatusLabel(step);
  if (label) res.write(`data: ${JSON.stringify({ status: label })}\n\n`);
  const turn = await executeFinderStep(step, {
    userId: req.userId,
    userMessageId: message.id,
    history: finderHistory,
    profile: finderProfile,
    features,
  });
  if (turn.kind === "message") {
    await storage.createChatMessage(id, req.userId, "assistant", turn.content, {
      metadataVersion: 1,
      finder: turn.block,
    });
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ finder: turn.block })}\n\n`);
    }
    if (!finderHistory.some((m) => m.role === "user")) {
      fireAndForget(
        "recipe-finder-auto-title",
        storage.updateChatConversationTitle(
          id,
          req.userId,
          sanitizedContent.slice(0, 50),
        ),
      );
    }
  } else if (turn.kind === "ignored") {
    // e.g. Search Spoonacular on a Spoonacular list — nothing to
    // answer, so don't leave a dangling user bubble.
    await storage.deleteChatMessage(message.id, req.userId);
  } else {
    finderGeneration = turn.messages;
    // A round-1 search that found nothing falls through to
    // Generate: update the thinking bubble.
    if (step.kind !== "generate") {
      res.write(
        `data: ${JSON.stringify({ status: "Creating your recipe…" })}\n\n`,
      );
    }
  }
}
```

and wrap the entire pre-existing recipe/remix body (from `const remixSourceId = …` through the auto-title `fireAndForget` block, lines 418-560) in:

```ts
            if (!recipeFinderInput || finderGeneration) {
              …existing body, unchanged except the next line…
            }
```

changing `const contextMessages = buildRecipeContext(history);` to:

```ts
// A finder Generate sends only the refined request (spec §3.1).
const contextMessages = finderGeneration ?? buildRecipeContext(history);
```

Append at the end of the file (outside `register`):

```ts
/** A no-op turn (stale or repeated finder action): open and close the SSE. */
function endQuietly(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}
```

- [ ] **Step 4: Run** `npx vitest run server/routes/__tests__/chat.test.ts` → PASS (15 new + every existing test; the existing recipe tests run flag-off because nothing stubs the env outside this describe).

- [ ] **Step 5: Commit** — `commit-msg-finder-task-18.txt`: `feat(chat): recipe finder branch for RecipeChef before the generation quota; finderAction with stale/duplicate guard`.

### Task 19: Coach intent `recipe_request` (R4)

**Files:**

- Modify: `server/services/coach-intent-classifier.ts:1-5` (union — the one-line part may already be in from Task 15), `:95-163` (rule + option)
- Modify: `server/services/nutrition-coach.ts:490-500` (template-version list), `:533`, `:629` (fallback classification)
- Test: `server/services/__tests__/coach-intent-classifier.test.ts:14-66` (EXPECTED map), `:149` (meal ideas), append

**Interfaces:**

- Produces: `CoachIntent` includes `"recipe_request"`; `classifyIntent(message: string, opts?: { recipeRequests?: boolean }): IntentClassification` — `recipeRequests: false` skips the new rule (used where a recipe_request must keep its legacy prompt intent: flag off, free Coach, the generators' self-classification fallback).
- Order: safety → **recipe_request** → vague → general_fact → personalized.

- [ ] **Step 1: Update/add the failing tests**

In `EXPECTED`, change exactly these five (the regex was run against all 41 cases on 2026-09-28; these are the only matches):

```ts
  "helpfulness-specific-suggestion-01": "recipe_request", // "I don't know what to eat for dinner. Any ideas?"
  "personalization-vegetarian-high-protein-01": "recipe_request", // "…What should I make?"
  "personalization-about-user-skill-01": "recipe_request", // "I'm bored of my dinners lately, any ideas?"
  "helpfulness-hearty-dinner-01": "recipe_request", // "Any hearty dinner ideas for tonight?"
  "personalization-frequent-foods-01": "recipe_request", // "Ideas for a higher-protein breakfast?"
```

(`personalization-screen-context-recipe-01` — "Is this a good recipe for me today?" — stays `personalized_advice`; the count assertion stays 41.) Change the `:149` test to:

```ts
it("classifies 'meal ideas' as recipe_request (was vague_request before the finder)", () => {
  expect(classifyIntent("meal ideas").intent).toBe("recipe_request");
});

it("legacy control: with recipeRequests off, 'meal ideas' is still vague_request", () => {
  expect(classifyIntent("meal ideas", { recipeRequests: false }).intent).toBe(
    "vague_request",
  );
});
```

Append:

```ts
describe("recipe_request routing (R4)", () => {
  it.each([
    "meal ideas",
    "dinner ideas",
    "Any hearty dinner ideas for tonight?",
    "Find me a chicken recipe",
    "Give me a recipe for salmon",
    "I want a vegan pasta recipe",
    "Suggest a recipe with tofu",
    "Recipe for banana bread?",
    "Chicken recipe with rice",
    "Show me some dessert recipes",
    "What can I cook tonight?",
    "What should I make for lunch?",
    "Ideas for a higher-protein breakfast?",
  ])("routes %j", (msg) => {
    expect(classifyIntent(msg).intent).toBe("recipe_request");
  });

  it.each([
    "Is this a good recipe for me today?",
    "log this recipe",
    "Log my breakfast",
    "Save this recipe to my cookbook",
    "How many calories are in this recipe?",
    "What should I eat for dinner?",
    "How do I cook kidney beans?",
    "Snack ideas for this afternoon?",
    "What are some good snack ideas for me?",
    "I logged my dinner, any ideas how to hit protein?",
    "Can you track my lunch?",
    "I need more protein",
  ])("does NOT route %j", (msg) => {
    expect(classifyIntent(msg).intent).not.toBe("recipe_request");
  });

  it("safety still wins over a recipe request", () => {
    expect(classifyIntent("Give me a recipe for my diabetes").intent).toBe(
      "safety_refusal",
    );
  });
});

describe("prompt template version covers every intent", () => {
  it("getSystemPromptTemplateVersion's hard-coded list names all CoachIntent members", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../nutrition-coach.ts"),
      "utf8",
    );
    const start = src.indexOf("const allIntents: CoachIntent[] = [");
    const list = src.slice(start, src.indexOf("];", start));
    for (const intent of [
      "safety_refusal",
      "general_fact",
      "vague_request",
      "personalized_advice",
      "recipe_request",
    ]) {
      expect(list).toContain(`"${intent}"`);
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/services/__tests__/coach-intent-classifier.test.ts` — Expected: FAIL — the five eval cases, `meal ideas`, every must-route row, the `recipeRequests: false` control (unknown option is ignored, so it passes — fine) and the template-list test.

- [ ] **Step 3: Implement**

`coach-intent-classifier.ts`:

```ts
export type CoachIntent =
  | "safety_refusal"
  | "general_fact"
  | "vague_request"
  | "personalized_advice"
  | "recipe_request";
```

Add after `TEMPORAL_PERSONAL_RE`:

```ts
// ── Recipe request (recipe finder, spec R4) ──────────────────────────────────

/**
 * A request for a dish/recipe → the server-run recipe finder (Coach Pro, flag
 * on). Checked AFTER safety and BEFORE vague/general_fact, so "meal ideas"
 * (≤3 words) and "What's a …" stems route here. Measured 2026-09-28 against
 * evals/datasets/coach-cases.json: exactly 5 of 41 cases route.
 * `[^.?!]{0,40}` / `[^?!]{0,40}` bound each gap (routing heuristic, not a
 * safety detector — see GENERAL_FACT_RE's note on bounded gaps).
 */
const RECIPE_REQUEST_PATTERNS: { pattern: RegExp; name: string }[] = [
  {
    pattern:
      /\b(?:find|give|show|suggest|recommend|send|share|need|want|get|looking for|search for)\b[^.?!]{0,40}\brecipes?\b/i,
    name: "recipe_verb",
  },
  {
    pattern:
      /^(?:a |an |any |some )?(?:[\w-]+ ){0,3}recipes? (?:for|with|using)\b/i,
    name: "recipe_leading",
  },
  {
    pattern: /\bwhat (?:should|can|could|shall) (?:i|we) (?:make|cook|bake)\b/i,
    name: "what_to_cook",
  },
  {
    pattern:
      /\b(?:meal|dinner|lunch|breakfast|brunch)s?\b[^?!]{0,40}\bideas?\b/i,
    name: "meal_ideas",
  },
  {
    pattern:
      /\bideas?\b[^.?!]{0,40}\b(?:meal|dinner|lunch|breakfast|brunch)s?\b/i,
    name: "ideas_for_meal",
  },
];

/** Logging/saving/tracking a meal or recipe is a coach action, not a search. */
const RECIPE_REQUEST_EXCLUSION_RE =
  /\b(?:log|logged|logging|save|saved|delete|track)\b[^.?!]{0,30}\b(?:recipe|meal|dinner|lunch|breakfast|brunch)s?\b/i;
```

`classifyIntent` signature and the new rule (between the calorie check and Rule 2):

```ts
export function classifyIntent(
  message: string,
  opts: { recipeRequests?: boolean } = {},
): IntentClassification {
  …safety rules unchanged…

  // ── Rule 2: recipe_request (after safety, before vague/general_fact) ──
  if (
    opts.recipeRequests !== false &&
    !RECIPE_REQUEST_EXCLUSION_RE.test(trimmed)
  ) {
    for (const { pattern, name } of RECIPE_REQUEST_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { intent: "recipe_request", matchedRule: name };
      }
    }
  }

  // ── Rule 3: vague_request … (renumber the remaining comments)
```

and update the doc comment: `Rule precedence: safety > recipe_request > vague > general_fact > personalized.`

`nutrition-coach.ts` — the template list:

```ts
// Hash all intent × tier variants (5 × 2 = 10) so any prompt change —
// including Pro-only lines — invalidates the cache. recipe_request renders
// the default (personalized) block; it is listed so the hash covers it (R4).
const allIntents: CoachIntent[] = [
  "safety_refusal",
  "general_fact",
  "vague_request",
  "personalized_advice",
  "recipe_request",
];
```

and both self-classification fallbacks (lines 533 and 629) become:

```ts
const resolvedIntent =
  intent ?? classifyIntent(lastUserMessage, { recipeRequests: false }).intent;
```

(Callers that reach the prompt never want `recipe_request` — the finder handles it or `handleCoachChat` remaps it (Task 20); evals call `generateCoachResponse` without an intent, so their prompts are unchanged. Adding the fifth variant changes the template hash once, which invalidates free-tier cached answers once — expected, 7-day TTL.)

- [ ] **Step 4: Run** `npx vitest run server/services/__tests__/coach-intent-classifier.test.ts server/services/__tests__/nutrition-coach.test.ts` → PASS.
- [ ] **Step 5: Commit** — `commit-msg-finder-task-19.txt`: `feat(coach): recipe_request intent (after safety, before vague) — 5/41 eval cases route`.

### Task 20: Coach Pro — finder branch in `handleCoachChat`, generated card with top-level recipe metadata

**Files:**

- Create: `server/services/recipe-finder/coach-turn.ts`
- Modify: `server/services/coach-pro-chat.ts:17-50` (imports), `:188-217` (`CoachChatParams`), `:528-531` (intent + finder branch)
- Modify: `server/routes/chat.ts:569-588` (pass `finder`)
- Test: `server/services/__tests__/coach-pro-chat.test.ts` (mocks at 39-106 + append a describe)

**Interfaces:**

- Consumes: `decideCoachFinderEntry`, `classifyTurn`, `prepareFinderTurn`, `executeFinderStep`, `finderStatusLabel`, `gateRecipeGeneration`, `buildFinderGenerationMessages`, `generateRecipeChatResponse(messages, profile)`.
- Produces:
  - `CoachChatParams.finder?: { action?: FinderAction; userMessageId: number; features: FinderFeatures }` — present only when the flag is on and the user is Coach Pro (the route decides).
  - `type CoachFinderTurnEntry = { kind: "finder"; input: FinderInput } | { kind: "refine" }`
  - `runCoachFinderTurn(p: CoachFinderTurnParams): AsyncGenerator<CoachChatEvent>` — finder steps yield `status` then `blocks: [finderBlock]` (no `content` — the persisted `content` is the plain-text fallback, which the new client hides and an old client shows after refetch); Generate/refine yields `status` then `content` (conversational text), persisting `{ metadataVersion: 1, recipe, allergenWarning, imageUrl }` at the top level so `POST /save-recipe` works unchanged (R5). **No new `CoachChatEvent` type**, so the route's event ternary (`chat.ts:589-597`, fallback arm `{blocks}`) needs no new arm; the card appears on the post-`done` refetch.

- [ ] **Step 1: Write the failing tests**

In `coach-pro-chat.test.ts`, extend the storage mock with `getChatMessageByTurnKey: vi.fn(), deleteChatMessage: vi.fn(), claimRecipeGeneration: vi.fn(), claimSpoonacularSearch: vi.fn(),`; change the `../coach-blocks` mock to also export `getBlocksSystemPrompt: vi.fn().mockReturnValue("[BLOCKS_SYSTEM_PROMPT]")` (Task 21 introduces it; add it now so the mock is complete); and add:

```ts
vi.mock("../recipe-chat", async () => {
  const actual =
    await vi.importActual<typeof import("../recipe-chat")>("../recipe-chat");
  return { ...actual, generateRecipeChatResponse: vi.fn() };
});
vi.mock("../recipe-finder/extract-query", () => ({
  extractQuery: vi.fn(async (t: string) => ({ q: t })),
}));
vi.mock("../recipe-finder/find-community", () => ({ findCommunity: vi.fn() }));
vi.mock("../recipe-finder/find-online", () => ({ findOnline: vi.fn() }));
vi.mock("../recipe-finder/ask-clarifying", () => ({ askClarifying: vi.fn() }));
vi.mock("../recipe-finder/classify-turn", () => ({ classifyTurn: vi.fn() }));
```

(with matching imports of `generateRecipeChatResponse`, `findCommunity`, `classifyTurn`). Append:

````ts
describe("handleCoachChat — recipe finder (Coach Pro, flag on)", () => {
  const FLOW = "11111111-1111-4111-8111-111111111111";
  const finder = {
    userMessageId: 77,
    features: {
      catalogSave: true,
      recipeGeneration: true,
      dailyRecipeGenerations: 20,
    },
  };
  const item = {
    id: 12,
    source: "community" as const,
    title: "Chicken Tray Bake",
    imageUrl: null,
    readyInMinutes: null,
    calories: 480,
  };
  const recipe = {
    title: "Chicken Curry",
    description: "d",
    difficulty: "Easy" as const,
    timeEstimate: "30 min",
    servings: 2,
    ingredients: [],
    instructions: ["cook"],
    dietTags: [],
  };
  const listBlock = {
    type: "recipe_results",
    source: "community",
    items: [item],
    actions: ["search_online", "generate", "none_of_these"],
    notice: null,
    flow: {
      flowId: FLOW,
      stage: "results",
      request: "chicken",
      query: { q: "chicken" },
      round: 0,
      shownIds: ["community:12"],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultStorage();
    vi.stubEnv("SPOONACULAR_API_KEY", "k");
    vi.mocked(findCommunity).mockResolvedValue([item]);
    vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    vi.mocked(generateRecipeChatResponse).mockImplementation(
      async function* () {
        yield { content: "Here's a curry!\n```json\n{}\n```" };
        yield { content: "", recipe, allergenWarning: null };
        yield { content: "", imageUrl: "https://img/curry.png" };
        yield { done: true };
      },
    );
    vi.mocked(generateCoachProResponse).mockReturnValue(
      fakeProStream(["coach reply"]),
    );
    vi.mocked(parseBlocksFromContent).mockReturnValue({
      text: "coach reply",
      blocks: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("routes a recipe_request to the finder and persists a recipe_results block", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "user",
        content: "Find me a chicken recipe",
      }),
    ]);
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Find me a chicken recipe",
          finder,
          turnKey: "11111111-2222-4333-8444-555555555555",
        }),
      ),
    );
    expect(events[0]).toEqual({
      type: "status",
      label: "Searching community recipes…",
    });
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ type: "recipe_results" }],
    });
    expect(events.some((e) => e.type === "content")).toBe(false);
    expect(generateCoachProResponse).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      expect.stringMatching(/^Here are 1 community recipe:/),
      { blocks: [expect.objectContaining({ type: "recipe_results" })] },
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("flag off (no finder param): a recipe_request keeps its legacy prompt intent", async () => {
    await collectEvents(handleCoachChat(makeParams({ content: "meal ideas" })));
    // 6th arg of generateCoachProResponse is the intent.
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][5]).toBe(
      "vague_request",
    );
  });

  it("free Coach never enters the finder (D7)", async () => {
    vi.mocked(generateCoachResponse).mockReturnValue(
      fakeStream(["free reply"]),
    );
    await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Find me a chicken recipe",
          isCoachPro: false,
          finder,
        }),
      ),
    );
    expect(findCommunity).not.toHaveBeenCalled();
    expect(generateCoachResponse).toHaveBeenCalled();
  });

  it("safety_refusal never enters the finder, even mid-flow", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({
        role: "user",
        content: "I have diabetes, what should I eat?",
      }),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({ content: "I have diabetes, what should I eat?", finder }),
      ),
    );
    expect(findCommunity).not.toHaveBeenCalled();
    expect(generateCoachProResponse).toHaveBeenCalled();
  });

  it("Generate action generates a card with TOP-LEVEL recipe metadata (save-recipe works — R5)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({ id: 77, role: "user", content: "Generate" }),
    ]);
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Generate",
          finder: { ...finder, action: { type: "generate", flowId: FLOW } },
        }),
      ),
    );
    expect(storage.claimRecipeGeneration).toHaveBeenCalledWith(
      "user-42",
      77,
      20,
    );
    expect(vi.mocked(generateRecipeChatResponse).mock.calls[0][0]).toEqual([
      { role: "user", content: "Create a recipe for: chicken" },
    ]);
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      "Here's a curry!",
      {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: "https://img/curry.png",
      },
      undefined,
    );
    expect(events.at(-1)).toEqual({
      type: "content",
      content: "Here's a curry!",
    });
  });

  it("the daily generation limit is enforced in Coach too", async () => {
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(false);
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({ id: 77, role: "user", content: "Generate" }),
    ]);
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Generate",
          finder: { ...finder, action: { type: "generate", flowId: FLOW } },
        }),
      ),
    );
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ notice: "generate_limit" }],
    });
  });

  it("after a generated card, refine_current regenerates the card (and claims a generation)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        content: "Here!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
      createMockChatMessage({
        id: 77,
        role: "user",
        content: "make it spicier",
      }),
    ]);
    vi.mocked(classifyTurn).mockResolvedValue("refine_current");
    const events = await collectEvents(
      handleCoachChat(makeParams({ content: "make it spicier", finder })),
    );
    expect(events[0]).toEqual({
      type: "status",
      label: "Updating your recipe…",
    });
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
    expect(
      vi.mocked(generateRecipeChatResponse).mock.calls[0][0].at(-1),
    ).toEqual({ role: "user", content: "make it spicier" });
  });

  it("after a generated card, 'other' gets a normal coach reply", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
      createMockChatMessage({ role: "user", content: "thanks!" }),
    ]);
    vi.mocked(classifyTurn).mockResolvedValue("other");
    await collectEvents(
      handleCoachChat(makeParams({ content: "thanks!", finder })),
    );
    expect(generateCoachProResponse).toHaveBeenCalled();
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
  });
});
````

(Add `afterEach` to the file's `vitest` import.)

- [ ] **Step 2: Run** `npx vitest run server/services/__tests__/coach-pro-chat.test.ts -t "recipe finder"` — Expected: FAIL (`finder` is ignored; the coach generator runs every time; the flag-off control fails on `recipe_request` reaching the generator).

- [ ] **Step 3: Implement**

````ts
// server/services/recipe-finder/coach-turn.ts
// Coach Pro delivery for the recipe finder (R2): finder steps persist
// {blocks:[finderBlock]} with the turnKey and yield {type:"blocks"}; a
// Generate/refine persists RecipeChef's top-level recipe metadata (R5) and
// yields only conversational text — the card arrives on the post-`done`
// refetch, so the route's CoachChatEvent ternary needs no new arm.
import type { ChatMessage } from "@shared/schema";
import type { CoachChatEvent } from "../coach-pro-chat";
import { storage } from "../../storage";
import { fireAndForget } from "../../lib/fire-and-forget";
import {
  generateRecipeChatResponse,
  type RecipeChatRecipe,
} from "../recipe-chat";
import {
  prepareFinderTurn,
  executeFinderStep,
  type FinderFeatures,
} from "./run-turn";
import { finderStatusLabel, type FinderInput } from "./transition";
import {
  gateRecipeGeneration,
  buildFinderGenerationMessages,
  type GenerationMessages,
} from "./generate";

export type CoachFinderTurnEntry =
  | { kind: "finder"; input: FinderInput }
  | { kind: "refine" };

export interface CoachFinderTurnParams {
  conversationId: number;
  userId: string;
  content: string;
  turnKey?: string;
  /** Includes this turn's user row (Coach inserts it before the service). */
  history: ChatMessage[];
  userMessageId: number;
  entry: CoachFinderTurnEntry;
  features: FinderFeatures;
  isAborted: () => boolean;
}

const LIMIT_TEXT =
  "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
const PREMIUM_TEXT = "Generating recipes is a Premium feature.";

async function persistAssistant(
  p: CoachFinderTurnParams,
  content: string,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  if (p.turnKey) {
    const existing = await storage.getChatMessageByTurnKey(
      p.conversationId,
      p.turnKey,
    );
    if (existing) return;
  }
  await storage.createChatMessage(
    p.conversationId,
    p.userId,
    "assistant",
    content,
    metadata,
    p.turnKey,
  );
}

function maybeAutoTitle(p: CoachFinderTurnParams): void {
  if (p.history.length > 1) return;
  const title = p.content.slice(0, 50) + (p.content.length > 50 ? "..." : "");
  fireAndForget(
    "coach-chat-auto-title",
    storage.updateChatConversationTitle(p.conversationId, p.userId, title),
  );
}

export async function* runCoachFinderTurn(
  p: CoachFinderTurnParams,
): AsyncGenerator<CoachChatEvent> {
  const profile = await storage.getUserProfile(p.userId);
  let generation: GenerationMessages;

  if (p.entry.kind === "refine") {
    yield { type: "status", label: "Updating your recipe…" };
    const gate = await gateRecipeGeneration({
      userId: p.userId,
      userMessageId: p.userMessageId,
      canGenerate: p.features.recipeGeneration,
      dailyLimit: p.features.dailyRecipeGenerations,
    });
    if (gate.status !== "allowed") {
      const text = gate.status === "limit_reached" ? LIMIT_TEXT : PREMIUM_TEXT;
      await persistAssistant(p, text, null);
      yield { type: "content", content: text };
      return;
    }
    generation = buildFinderGenerationMessages({
      mode: "refine",
      history: p.history,
    });
  } else {
    const { step } = prepareFinderTurn(p.history, p.entry.input);
    const label = finderStatusLabel(step);
    if (label) yield { type: "status", label };
    const turn = await executeFinderStep(step, {
      userId: p.userId,
      userMessageId: p.userMessageId,
      history: p.history,
      profile,
      features: p.features,
    });
    if (p.isAborted()) return;
    if (turn.kind === "ignored") {
      await storage.deleteChatMessage(p.userMessageId, p.userId);
      return;
    }
    if (turn.kind === "message") {
      await persistAssistant(p, turn.content, { blocks: [turn.block] });
      maybeAutoTitle(p);
      yield { type: "blocks", blocks: [turn.block] };
      return;
    }
    generation = turn.messages;
    // A round-1 search that found nothing falls through to Generate.
    if (step.kind !== "generate") {
      yield { type: "status", label: "Creating your recipe…" };
    }
  }

  let text = "";
  let recipe: RecipeChatRecipe | null = null;
  let allergenWarning: string | null = null;
  let imageUrl: string | null = null;
  for await (const event of generateRecipeChatResponse(generation, profile)) {
    if (p.isAborted()) return;
    if ("recipe" in event && event.recipe) {
      recipe = event.recipe;
      allergenWarning = event.allergenWarning;
    } else if ("imageUrl" in event && event.imageUrl) {
      imageUrl = event.imageUrl;
    } else if ("content" in event && event.content) {
      text += event.content;
    }
  }
  const conversational =
    text.replace(/\n*```json[\s\S]*?```\s*/g, "").trim() ||
    (recipe
      ? "Here's a recipe for you!"
      : "Sorry, I couldn't create a recipe right now. Please try again.");
  await persistAssistant(
    p,
    conversational,
    recipe ? { metadataVersion: 1, recipe, allergenWarning, imageUrl } : null,
  );
  maybeAutoTitle(p);
  yield { type: "content", content: conversational };
}
````

In `coach-pro-chat.ts` add imports:

```ts
import type { FinderAction } from "@shared/schemas/recipe-finder";
import {
  classifyTurn,
  decideCoachFinderEntry,
  type FinderFeatures,
} from "./recipe-finder";
import {
  runCoachFinderTurn,
  type CoachFinderTurnEntry,
} from "./recipe-finder/coach-turn";
```

Add to `CoachChatParams` (after `tz?`):

```ts
  /**
   * Recipe finder (spec 2026-09-28). The route passes this ONLY when
   * RECIPE_FINDER_ENABLED is on and the user is Coach Pro; absent → today's
   * behavior exactly.
   */
  finder?: {
    action?: FinderAction;
    /** This turn's user row — Generate/Spoonacular claims mark it. */
    userMessageId: number;
    features: FinderFeatures;
  };
```

Replace line 530 (`const { intent } = classifyIntent(content);`) with:

```ts
const { intent: classifiedIntent } = classifyIntent(content);
// A recipe_request that does not enter the finder (flag off, free Coach, a
// turn routed elsewhere) keeps the prompt intent it had before this intent
// existed — flag-off Coach is unchanged (spec §8).
const intent: CoachIntent =
  classifiedIntent === "recipe_request"
    ? classifyIntent(content, { recipeRequests: false }).intent
    : classifiedIntent;

// ── Recipe finder (Coach Pro, flag on) — early return (R2) ──
if (params.finder && isCoachPro) {
  const recent = await storage.getChatMessages(conversationId, 20, userId);
  const entry = decideCoachFinderEntry(
    recent,
    content,
    classifiedIntent,
    params.finder.action,
  );
  let finderEntry: CoachFinderTurnEntry | null = null;
  if (entry.kind === "finder") {
    finderEntry = { kind: "finder", input: entry.input };
  } else if (entry.kind === "classify") {
    const turn = await classifyTurn(content, entry.recipeTitle);
    if (turn === "new_request") {
      finderEntry = { kind: "finder", input: { kind: "start", text: content } };
    } else if (turn === "refine_current") {
      finderEntry = { kind: "refine" };
    }
  }
  if (finderEntry) {
    yield *
      runCoachFinderTurn({
        conversationId,
        userId,
        content,
        turnKey,
        history: recent,
        userMessageId: params.finder.userMessageId,
        entry: finderEntry,
        features: params.finder.features,
        isAborted,
      });
    return;
  }
}
```

(Recent history is fetched separately only when `finder` is present — one extra indexed query per Coach Pro turn with the flag on; the non-finder path's `Promise.all` is untouched.)

In `server/routes/chat.ts`, add to the `handleCoachChat({ … })` argument (after `abortSignal`):

```ts
              finder:
                finderEnabled && features.coachPro
                  ? {
                      action: finderAction,
                      userMessageId: message.id,
                      features: {
                        catalogSave: features.catalogSave,
                        recipeGeneration: features.recipeGeneration,
                        dailyRecipeGenerations: features.dailyRecipeGenerations,
                      },
                    }
                  : undefined,
```

Add a route regression test to the Task 18 describe (Coach Pro action through the real endpoint):

```ts
it("Coach Pro: a finder action goes through the route to the Coach finder", async () => {
  vi.mocked(storage.getChatConversation).mockResolvedValue(
    createMockChatConversation(),
  );
  vi.mocked(storage.getChatMessages).mockResolvedValue([
    createMockChatMessage({
      id: 2,
      role: "assistant",
      metadata: { blocks: [listBlock] },
    }),
  ]);
  vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
  vi.mocked(storage.getDailySummary).mockResolvedValue({
    totalCalories: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    itemCount: 0,
  });
  const res = await send({
    content: "Search Spoonacular",
    finderAction: { type: "search_online", flowId: FLOW },
  });
  expect(res.status).toBe(200);
  expect(storage.createFinderUserMessage).toHaveBeenCalledWith(
    1,
    "1",
    "Search Spoonacular",
    {
      action: { flowId: FLOW, type: "search_online" },
      coachDailyLimit: expect.any(Number),
    },
  );
  expect(res.text).toContain('data: {"status":"Searching Spoonacular…"}');
  expect(res.text).toContain(
    '"blocks":[{"type":"recipe_results","source":"spoonacular"',
  );
  expect(generateCoachProResponse).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run** `npx vitest run server/services/__tests__/coach-pro-chat.test.ts server/routes/__tests__/chat.test.ts` → PASS.
- [ ] **Step 5: Commit** — `commit-msg-finder-task-20.txt`: `feat(coach): recipe finder in Coach Pro (early return, classifyTurn after a card, generated card saveable via top-level metadata)`.

### Task 21: Retire Coach's `search_recipes` — only while the flag is on

**Files:**

- Modify: `server/services/nutrition-coach.ts:630-640` (tools)
- Modify: `server/services/coach-blocks.ts:65-90` (add `getBlocksSystemPrompt`)
- Modify: `server/services/coach-pro-chat.ts:~436` (`context.blocksPrompt`)
- Modify: `server/routes/__tests__/chat.test.ts:66-71` (coach-blocks mock gains `getBlocksSystemPrompt`)
- Create: `server/services/__tests__/nutrition-coach-finder-tools.test.ts`
- Test: `server/services/__tests__/coach-blocks.test.ts` (append)

**Interfaces:**

- Produces: `getBlocksSystemPrompt(finderEnabled: boolean): string` — identical to `BLOCKS_SYSTEM_PROMPT` when false; when true, the two `search_recipes` rules are replaced (the model must not reach for a tool it no longer has, and must not build a `recipe_card` it can no longer ground).

- [ ] **Step 1: Write the failing tests**

```ts
// server/services/__tests__/nutrition-coach-finder-tools.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCoachProResponse } from "../nutrition-coach";
import type { CoachContext } from "../nutrition-coach";
import { openai } from "../../lib/openai";

vi.mock("../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  OPENAI_TIMEOUT_STREAM_MS: 30_000,
  MODEL_FAST: "gpt-4o-mini",
}));
vi.mock("../coach-tools", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    {
      type: "function",
      function: {
        name: "lookup_nutrition",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "search_recipes",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    },
  ]),
  executeToolCall: vi.fn(),
  MAX_TOOL_CALLS_PER_RESPONSE: 5,
  serviceUnavailable: vi.fn(),
}));
vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  containsUnsafeCoachAdvice: vi.fn().mockReturnValue(false),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));
vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

const CONTEXT: CoachContext = {
  goals: null,
  todayIntake: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
};

// Copied verbatim from nutrition-coach.test.ts (the chunk shape the tool loop
// reads: choices[0].delta.{content,tool_calls} + finish_reason).
function createMockStream(
  chunks: { content?: string; finish_reason?: string | null }[],
) {
  const iterator = chunks[Symbol.iterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = iterator.next();
          if (result.done) return { done: true, value: undefined };
          const chunk = result.value;
          return {
            done: false,
            value: {
              choices: [
                {
                  delta: {
                    content: chunk.content ?? null,
                    tool_calls: undefined,
                  },
                  finish_reason: chunk.finish_reason ?? null,
                },
              ],
            },
          };
        },
      };
    },
  };
}

async function toolNamesSent(): Promise<string[]> {
  vi.mocked(openai.chat.completions.create).mockResolvedValue(
    createMockStream([{ content: "hi" }, { finish_reason: "stop" }]) as never,
  );
  for await (const _ of generateCoachProResponse(
    [{ role: "user", content: "hi" }],
    CONTEXT,
    "u1",
  )) {
    // drain
  }
  const body = vi.mocked(openai.chat.completions.create).mock.calls[0][0] as {
    tools: { function: { name: string } }[];
  };
  return body.tools.map((t) => t.function.name);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("Coach Pro tool list vs RECIPE_FINDER_ENABLED", () => {
  it("control: flag off keeps search_recipes", async () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "");
    expect(await toolNamesSent()).toEqual([
      "lookup_nutrition",
      "search_recipes",
    ]);
  });

  it("flag on retires search_recipes (recipe discovery goes only through the finder)", async () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    expect(await toolNamesSent()).toEqual(["lookup_nutrition"]);
  });
});
```

Append to `server/services/__tests__/coach-blocks.test.ts` (import `getBlocksSystemPrompt`):

```ts
describe("getBlocksSystemPrompt", () => {
  it("is the unchanged prompt with the finder off", () => {
    expect(getBlocksSystemPrompt(false)).toBe(BLOCKS_SYSTEM_PROMPT);
  });

  it("drops every search_recipes instruction with the finder on", () => {
    // Positive control: the source prompt really has the lines being replaced.
    expect(BLOCKS_SYSTEM_PROMPT).toContain("search_recipes");
    const on = getBlocksSystemPrompt(true);
    expect(on).not.toContain("search_recipes");
    expect(on).toContain("recipe finder");
    // The example still validates.
    expect(parseBlocksFromContent(on).blocks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run** both files — Expected: FAIL (`search_recipes` still sent with the flag on; `getBlocksSystemPrompt` not exported).

- [ ] **Step 3: Implement**

`nutrition-coach.ts` (add `import { isRecipeFinderEnabled } from "./recipe-finder/config";`), line 638:

```ts
// With the recipe finder on, search_recipes is retired: otherwise the model
// could still call it on any message the classifier does not route to
// recipe_request and give the prose "couldn't find" answer the finder
// replaces (spec §3.3). Flag off → today's tools.
const tools = isRecipeFinderEnabled()
  ? TOOL_DEFINITIONS.filter(
      (t) => !("function" in t && t.function.name === "search_recipes"),
    )
  : [...TOOL_DEFINITIONS];
```

`coach-blocks.ts` — after `BLOCKS_SYSTEM_PROMPT`:

```ts
const SEARCH_RECIPES_RULE =
  "- For recipe suggestions, use search_recipes tool first to get real recipe data";
const RECIPE_CARD_RULE =
  "- Use a recipe_card only when you have real calories, protein and prep time for that recipe from a tool result — search_recipes does not return calories or protein, so never estimate them to fill a card; name the recipe in prose instead. When you do use a recipe_card, put its image URL in the imageUrl field.";
const FINDER_RECIPE_RULE =
  '- Recipe requests are answered by the app\'s recipe finder, not by you. If the user wants a recipe, tell them to ask for one directly (for example "find me a chicken dinner recipe") and do not search for or invent recipes yourself';
const FINDER_RECIPE_CARD_RULE =
  "- Never emit a recipe_card: you have no tool that returns real recipe data";

/** BLOCKS_SYSTEM_PROMPT, minus search_recipes when the finder is on. */
export function getBlocksSystemPrompt(finderEnabled: boolean): string {
  if (!finderEnabled) return BLOCKS_SYSTEM_PROMPT;
  return BLOCKS_SYSTEM_PROMPT.replace(
    SEARCH_RECIPES_RULE,
    FINDER_RECIPE_RULE,
  ).replace(RECIPE_CARD_RULE, FINDER_RECIPE_CARD_RULE);
}
```

`coach-pro-chat.ts`: import `getBlocksSystemPrompt` from `./coach-blocks` and `isRecipeFinderEnabled` from `./recipe-finder`, and replace `context.blocksPrompt = BLOCKS_SYSTEM_PROMPT;` with `context.blocksPrompt = getBlocksSystemPrompt(isRecipeFinderEnabled());` (drop the now-unused `BLOCKS_SYSTEM_PROMPT` import). In `server/routes/__tests__/chat.test.ts`'s `../../services/coach-blocks` mock add `getBlocksSystemPrompt: vi.fn().mockReturnValue("test prompt"),`.

- [ ] **Step 4: Run** `npx vitest run server/services/__tests__/nutrition-coach-finder-tools.test.ts server/services/__tests__/coach-blocks.test.ts server/services/__tests__/coach-pro-chat.test.ts server/routes/__tests__/chat.test.ts` → PASS.

- [ ] **Step 5: Commit, push, open PR B**

`commit-msg-finder-task-21.txt`: `feat(coach): retire search_recipes while RECIPE_FINDER_ENABLED is on`. Push `feat/recipe-finder-server` (the push gate runs `preflight:fast`). Open the PR via `mcp__github__create_pull_request`. The PR body must include: the flag default (off → merge changes nothing), the cap-storage decision and its two stated consequences (Task 16), the measured close-match sweep (chosen + provisional rows, N recipes — Task 10), the `classifyTurn` accuracy and misses (Task 13), the 5 flipped eval expectations (Task 19), and the spec deviations below. Review roster: `code-reviewer` + `server-reviewer` + `ai-reviewer` + `security-auditor` (a new body field on an authenticated endpoint that spends Spoonacular quota).

---

# PR C — Client (flag still off server-side)

Branch: `feat/recipe-finder-client` from `main` after PR B merges. Nothing here is visible until the server emits finder messages (flag on). Both platforms: every button/row ≥ 44pt, `accessibilityRole`/`accessibilityLabel`/`accessibilityState` on every control, and every success/failure has a visible surface (never an iOS-only announcement alone).

### Task 22: Pure client helpers — labels, meta line, a11y strings, nav params

**Files:**

- Create: `client/components/recipe-finder/recipe-finder-utils.ts`
- Create: `client/components/recipe-finder/__tests__/recipe-finder-utils.test.ts`

**Interfaces:**

- Produces:
  - `FINDER_BUTTON_LABELS: Record<FinderButton, string>` (`"Search Spoonacular"`, `"Generate"`, `"None of these"`)
  - `resultsHeader(source): "From the community" | "From Spoonacular"`
  - `formatItemMeta(item: FinderItem): string` — `"20 min · 350 cal"`, calories only when known
  - `itemAccessibilityLabel(item: FinderItem): string` — `"Title, N minutes, N calories. Opens recipe."`
  - `noticeText(notice: FinderNotice | null, source): string | null`
  - `resultsAnnouncement(block: RecipeResultsBlock): string` — `"Found N community recipes"`
  - `answersLabel(answers: FinderAnswer[]): string`
  - `finderItemNavParams(item: FinderItem): { recipeId: number; recipeType: "community" | "catalog" }`
  - `finderBlockFromMessageMetadata(metadata: unknown): FinderBlock | null`
  - `lockedFinderButtons(opts: { canSearchOnline: boolean; canGenerate: boolean }): FinderButton[]`

- [ ] **Step 1: Write the failing tests**

```ts
// client/components/recipe-finder/__tests__/recipe-finder-utils.test.ts
import { describe, it, expect } from "vitest";
import type {
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import {
  formatItemMeta,
  itemAccessibilityLabel,
  resultsAnnouncement,
  noticeText,
  answersLabel,
  finderItemNavParams,
  finderBlockFromMessageMetadata,
  lockedFinderButtons,
  resultsHeader,
} from "../recipe-finder-utils";

const item = (over: Partial<FinderItem> = {}): FinderItem => ({
  id: 12,
  source: "community",
  title: "Mediterranean Quinoa Salad",
  imageUrl: null,
  readyInMinutes: 20,
  calories: 350,
  ...over,
});
const block: RecipeResultsBlock = {
  type: "recipe_results",
  source: "community",
  items: [item(), item({ id: 13 })],
  actions: ["generate"],
  notice: null,
  flow: {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "results",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};

describe("recipe-finder-utils", () => {
  it("meta line shows time and calories, calories only when known", () => {
    expect(formatItemMeta(item())).toBe("20 min · 350 cal");
    expect(formatItemMeta(item({ calories: null }))).toBe("20 min");
    expect(formatItemMeta(item({ readyInMinutes: null, calories: null }))).toBe(
      "",
    );
  });

  it("row label reads as one button (§5 a11y)", () => {
    expect(itemAccessibilityLabel(item())).toBe(
      "Mediterranean Quinoa Salad, 20 minutes, 350 calories. Opens recipe.",
    );
    expect(
      itemAccessibilityLabel(item({ readyInMinutes: null, calories: null })),
    ).toBe("Mediterranean Quinoa Salad. Opens recipe.");
  });

  it("announces the list on arrival", () => {
    expect(resultsAnnouncement(block)).toBe("Found 2 community recipes");
    expect(
      resultsAnnouncement({ ...block, source: "spoonacular", items: [item()] }),
    ).toBe("Found 1 Spoonacular recipe");
    expect(
      resultsAnnouncement({ ...block, items: [], notice: "no_matches" }),
    ).toBe("No community recipes matched.");
  });

  it("notice copy never reports 'unavailable' as no results", () => {
    expect(noticeText("unavailable", "spoonacular")).toBe(
      "Spoonacular isn't available right now. Try Generate or a community pick.",
    );
    expect(noticeText(null, "community")).toBeNull();
  });

  it("headers", () => {
    expect(resultsHeader("community")).toBe("From the community");
    expect(resultsHeader("spoonacular")).toBe("From Spoonacular");
  });

  it("answers label is the visible user bubble text", () => {
    expect(
      answersLabel([
        { question: "Time?", answer: "Under 20 minutes" },
        { question: "Diet?", answer: "Vegan" },
      ]),
    ).toBe("Under 20 minutes, Vegan");
  });

  it("a Spoonacular row opens the catalog preview; a community row opens community (R1)", () => {
    expect(
      finderItemNavParams(item({ id: 715538, source: "spoonacular" })),
    ).toEqual({ recipeId: 715538, recipeType: "catalog" });
    expect(finderItemNavParams(item())).toEqual({
      recipeId: 12,
      recipeType: "community",
    });
  });

  it("reads a finder block from RecipeChef or Coach metadata", () => {
    expect(
      finderBlockFromMessageMetadata({ metadataVersion: 1, finder: block }),
    ).toEqual(block);
    expect(finderBlockFromMessageMetadata({ blocks: [block] })).toEqual(block);
    expect(finderBlockFromMessageMetadata({ recipe: {} })).toBeNull();
  });

  it("locks the buttons the account lacks (§6 premium)", () => {
    expect(
      lockedFinderButtons({ canSearchOnline: false, canGenerate: true }),
    ).toEqual(["search_online"]);
    expect(
      lockedFinderButtons({ canSearchOnline: true, canGenerate: false }),
    ).toEqual(["generate"]);
    expect(
      lockedFinderButtons({ canSearchOnline: true, canGenerate: true }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/components/recipe-finder/__tests__/recipe-finder-utils.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// client/components/recipe-finder/recipe-finder-utils.ts
import {
  finderBlockSchema,
  type FinderAnswer,
  type FinderBlock,
  type FinderButton,
  type FinderItem,
  type FinderNotice,
  type RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";

export const FINDER_BUTTON_LABELS: Record<FinderButton, string> = {
  search_online: "Search Spoonacular",
  generate: "Generate",
  none_of_these: "None of these",
};

export function resultsHeader(source: RecipeResultsBlock["source"]): string {
  return source === "community" ? "From the community" : "From Spoonacular";
}

export function formatItemMeta(item: FinderItem): string {
  return [
    item.readyInMinutes ? `${item.readyInMinutes} min` : null,
    item.calories !== null ? `${item.calories} cal` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function itemAccessibilityLabel(item: FinderItem): string {
  const parts = [item.title];
  if (item.readyInMinutes) parts.push(`${item.readyInMinutes} minutes`);
  if (item.calories !== null) parts.push(`${item.calories} calories`);
  return `${parts.join(", ")}. Opens recipe.`;
}

export function noticeText(
  notice: FinderNotice | null,
  source: RecipeResultsBlock["source"],
): string | null {
  switch (notice) {
    case "no_matches":
      return source === "community"
        ? "No community recipes matched."
        : "Spoonacular had no matches.";
    case "unavailable":
      return "Spoonacular isn't available right now. Try Generate or a community pick.";
    case "generate_limit":
      return "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
    case "generate_premium":
      return "Generating recipes is a Premium feature.";
    default:
      return null;
  }
}

export function resultsAnnouncement(block: RecipeResultsBlock): string {
  const n = block.items.length;
  if (n === 0) {
    return noticeText(block.notice, block.source) ?? "No recipes found";
  }
  const where = block.source === "community" ? "community" : "Spoonacular";
  return `Found ${n} ${where} recipe${n === 1 ? "" : "s"}`;
}

export function answersLabel(answers: FinderAnswer[]): string {
  return answers.map((a) => a.answer).join(", ");
}

export function finderItemNavParams(item: FinderItem): {
  recipeId: number;
  recipeType: "community" | "catalog";
} {
  return {
    recipeId: item.id,
    recipeType: item.source === "spoonacular" ? "catalog" : "community",
  };
}

/** RecipeChef stores `{metadataVersion, finder}`; Coach stores `{blocks:[…]}`. */
export function finderBlockFromMessageMetadata(
  metadata: unknown,
): FinderBlock | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const direct = finderBlockSchema.safeParse(m.finder);
  if (direct.success) return direct.data;
  if (Array.isArray(m.blocks)) {
    for (const b of m.blocks) {
      const parsed = finderBlockSchema.safeParse(b);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

export function lockedFinderButtons(opts: {
  canSearchOnline: boolean;
  canGenerate: boolean;
}): FinderButton[] {
  const locked: FinderButton[] = [];
  if (!opts.canSearchOnline) locked.push("search_online");
  if (!opts.canGenerate) locked.push("generate");
  return locked;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `commit-msg-finder-task-22.txt`: `feat(recipe-finder): client helpers (labels, a11y strings, nav params)`.

### Task 23: `RecipeResultsList`

**Files:**

- Create: `client/components/recipe-finder/RecipeResultsList.tsx`
- Create: `client/components/recipe-finder/__tests__/RecipeResultsList.test.tsx`

**Interfaces:**

- Produces: `export const RecipeResultsList: React.NamedExoticComponent<{ block: RecipeResultsBlock; isActive: boolean; lockedButtons?: FinderButton[]; onButton: (button: FinderButton) => void; onOpenItem: (item: FinderItem) => void }>`
- Behaviour: header; notice; rows (thumbnail or a neutral `book-open` placeholder — never an empty grey box; title; meta line; chevron); buttons in `block.actions` order — _Generate_ filled (`theme.accentSolid`), others outlined (`theme.link`); a locked button shows a lock icon and says "Premium feature"; when `!isActive` every button is disabled (old list) while rows stay tappable (viewing a result is not leaving the flow — D3); announces "Found N …" once per flowId while active.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// client/components/recipe-finder/__tests__/RecipeResultsList.test.tsx
import React from "react";
import * as RN from "react-native";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeResultsList } from "../RecipeResultsList";
import type { RecipeResultsBlock } from "@shared/schemas/recipe-finder";

const block: RecipeResultsBlock = {
  type: "recipe_results",
  source: "community",
  items: [
    {
      id: 12,
      source: "community",
      title: "Mediterranean Quinoa Salad",
      imageUrl: null,
      readyInMinutes: 20,
      calories: 350,
    },
    {
      id: 13,
      source: "community",
      title: "Greek Bowl",
      imageUrl: "https://img/greek.jpg",
      readyInMinutes: null,
      calories: null,
    },
  ],
  actions: ["search_online", "generate", "none_of_these"],
  notice: null,
  flow: {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "results",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};

describe("RecipeResultsList", () => {
  it("renders the header, rows with meta, and the three buttons", () => {
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(screen.getByText("From the community")).toBeDefined();
    expect(screen.getByText("20 min · 350 cal")).toBeDefined();
    expect(screen.getByRole("list")).toBeDefined();
    for (const name of ["Search Spoonacular", "Generate", "None of these"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
  });

  it("uses a placeholder icon, never an empty box, when a row has no image", () => {
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("finder-thumb-placeholder")).toHaveLength(1);
  });

  it("each row is one labelled button that opens the recipe", () => {
    const onOpenItem = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={onOpenItem}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mediterranean Quinoa Salad, 20 minutes, 350 calories. Opens recipe.",
      }),
    );
    expect(onOpenItem).toHaveBeenCalledWith(block.items[0]);
  });

  it("fires the tapped button", () => {
    const onButton = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={onButton}
        onOpenItem={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(onButton).toHaveBeenCalledWith("generate");
  });

  it("an old list's buttons are disabled and announce as disabled; rows still open", () => {
    const onButton = vi.fn();
    const onOpenItem = vi.fn();
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive={false}
        onButton={onButton}
        onOpenItem={onOpenItem}
      />,
    );
    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(generate);
    expect(onButton).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Greek Bowl. Opens recipe." }),
    );
    expect(onOpenItem).toHaveBeenCalled();
  });

  it("marks a locked button as a Premium feature", () => {
    renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        lockedButtons={["search_online"]}
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Search Spoonacular. Premium feature",
      }),
    ).toBeDefined();
  });

  it("shows the unavailable notice instead of 'no results'", () => {
    renderComponent(
      <RecipeResultsList
        block={{
          ...block,
          source: "spoonacular",
          items: [],
          notice: "unavailable",
          actions: ["generate", "none_of_these"],
        }}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Spoonacular isn't available right now. Try Generate or a community pick.",
      ),
    ).toBeDefined();
  });

  it("announces 'Found N community recipes' once when active", () => {
    const spy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    const { rerender } = renderComponent(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    rerender(
      <RecipeResultsList
        block={block}
        isActive
        onButton={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    );
    expect(spy).toHaveBeenCalledExactlyOnceWith("Found 2 community recipes");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/components/recipe-finder/__tests__/RecipeResultsList.test.tsx` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
// client/components/recipe-finder/RecipeResultsList.tsx
import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import type {
  FinderButton,
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import {
  FINDER_BUTTON_LABELS,
  formatItemMeta,
  itemAccessibilityLabel,
  noticeText,
  resultsAnnouncement,
  resultsHeader,
} from "./recipe-finder-utils";

export interface RecipeResultsListProps {
  block: RecipeResultsBlock;
  /** Only the latest finder message's buttons are live (spec §4). */
  isActive: boolean;
  lockedButtons?: FinderButton[];
  onButton: (button: FinderButton) => void;
  onOpenItem: (item: FinderItem) => void;
}

const THUMB = 48;
const NO_LOCKS: FinderButton[] = [];

export const RecipeResultsList = React.memo(function RecipeResultsList({
  block,
  isActive,
  lockedButtons = NO_LOCKS,
  onButton,
  onOpenItem,
}: RecipeResultsListProps) {
  const { theme } = useTheme();
  const announcedFlowRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive || announcedFlowRef.current === block.flow.flowId) return;
    announcedFlowRef.current = block.flow.flowId;
    AccessibilityInfo.announceForAccessibility(resultsAnnouncement(block));
  }, [isActive, block]);

  const header = resultsHeader(block.source);
  const notice = noticeText(block.notice, block.source);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      <ThemedText style={styles.header} accessibilityRole="header">
        {header}
      </ThemedText>
      {notice ? (
        <ThemedText style={[styles.notice, { color: theme.textSecondary }]}>
          {notice}
        </ThemedText>
      ) : null}
      {block.items.length > 0 ? (
        <View accessibilityRole="list" accessibilityLabel={header}>
          {block.items.map((item) => {
            const meta = formatItemMeta(item);
            return (
              <Pressable
                key={`${item.source}:${item.id}`}
                onPress={() => onOpenItem(item)}
                accessibilityRole="button"
                accessibilityLabel={itemAccessibilityLabel(item)}
                style={styles.row}
              >
                {item.imageUrl ? (
                  <FallbackImage
                    source={{ uri: item.imageUrl }}
                    style={styles.thumb}
                    fallbackIcon="book-open"
                    fallbackIconSize={20}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    testID="finder-thumb-placeholder"
                    style={[
                      styles.thumb,
                      styles.placeholder,
                      { backgroundColor: withOpacity(theme.link, 0.1) },
                    ]}
                  >
                    <Feather name="book-open" size={20} color={theme.link} />
                  </View>
                )}
                <View style={styles.rowText}>
                  <ThemedText numberOfLines={2} style={styles.title}>
                    {item.title}
                  </ThemedText>
                  {meta ? (
                    <ThemedText
                      style={[styles.meta, { color: theme.textSecondary }]}
                    >
                      {meta}
                    </ThemedText>
                  ) : null}
                </View>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={theme.textSecondary}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {block.actions.length > 0 ? (
        <View style={styles.buttons}>
          {block.actions.map((button) => {
            const label = FINDER_BUTTON_LABELS[button];
            const locked = lockedButtons.includes(button);
            const filled = button === "generate";
            const fg = filled ? theme.buttonText : theme.link;
            return (
              <Pressable
                key={button}
                onPress={() => onButton(button)}
                disabled={!isActive}
                accessibilityRole="button"
                accessibilityLabel={
                  locked ? `${label}. Premium feature` : label
                }
                accessibilityState={{ disabled: !isActive }}
                style={[
                  styles.button,
                  filled
                    ? { backgroundColor: theme.accentSolid }
                    : { borderWidth: 1, borderColor: theme.link },
                  !isActive && styles.inactive,
                ]}
              >
                {locked ? <Feather name="lock" size={14} color={fg} /> : null}
                <ThemedText style={[styles.buttonText, { color: fg }]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  header: { fontSize: 14, fontWeight: "600" },
  notice: { fontSize: 13 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: 8 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  title: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  buttonText: { fontSize: 14, fontWeight: "600" },
  inactive: { opacity: 0.45 },
});
```

(Use a static `style` array, not a `({ pressed }) => …` function: the jsdom RN mock forwards `style` to a DOM `<button>`, which rejects a function.)

- [ ] **Step 4: Run** → PASS (8). **Step 5: Commit** — `commit-msg-finder-task-23.txt`: `feat(recipe-finder): RecipeResultsList`.

### Task 24: `RecipeQuestions` — single-select chips + "Search with these"

**Files:**

- Create: `client/components/recipe-finder/RecipeQuestions.tsx`
- Create: `client/components/recipe-finder/__tests__/RecipeQuestions.test.tsx`

**Interfaces:**

- Consumes: `Chip` (`client/components/Chip.tsx`; `variant="filter"`, `selected`, `accessibilityRole="radio"` → `aria-selected`).
- Produces: `export const RecipeQuestions: React.NamedExoticComponent<{ block: RecipeQuestionsBlock; isActive: boolean; onSubmit: (answers: FinderAnswer[]) => void }>` — one single-select chip row per question (tapping the selected chip clears it); partial answers are fine; "Search with these" is enabled when active and ≥ 1 answer is chosen; the hint "Or type your answer." (typing works — the server treats clarifying-stage text as answers).

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// client/components/recipe-finder/__tests__/RecipeQuestions.test.tsx
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeQuestions } from "../RecipeQuestions";
import type { RecipeQuestionsBlock } from "@shared/schemas/recipe-finder";

const block: RecipeQuestionsBlock = {
  type: "recipe_questions",
  questions: [
    {
      question: "How much time do you have?",
      options: ["Under 20 minutes", "An hour or more"],
    },
    { question: "Any diet to follow?", options: ["No preference", "Vegan"] },
  ],
  flow: {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "clarifying",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};

describe("RecipeQuestions", () => {
  it("shows each question with single-select chips that expose selection", () => {
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("How much time do you have?")).toBeDefined();
    const chip = screen.getByRole("radio", { name: "Under 20 minutes" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "An hour or more" }));
    expect(
      screen
        .getByRole("radio", { name: "Under 20 minutes" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("'Search with these' is disabled until an answer is chosen, then sends partial answers", () => {
    const onSubmit = vi.fn();
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={onSubmit} />,
    );
    const submit = screen.getByRole("button", { name: "Search with these" });
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Vegan" }));
    fireEvent.click(screen.getByRole("button", { name: "Search with these" }));
    expect(onSubmit).toHaveBeenCalledWith([
      { question: "Any diet to follow?", answer: "Vegan" },
    ]);
  });

  it("an old question set is inert", () => {
    const onSubmit = vi.fn();
    renderComponent(
      <RecipeQuestions block={block} isActive={false} onSubmit={onSubmit} />,
    );
    // Chips render without onPress (static) — no radio controls to press.
    expect(screen.queryByRole("radio", { name: "Vegan" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Search with these" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("tells the user typing works too", () => {
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("Or type your answer.")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
// client/components/recipe-finder/RecipeQuestions.tsx
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import type {
  FinderAnswer,
  RecipeQuestionsBlock,
} from "@shared/schemas/recipe-finder";

export interface RecipeQuestionsProps {
  block: RecipeQuestionsBlock;
  isActive: boolean;
  onSubmit: (answers: FinderAnswer[]) => void;
}

export const RecipeQuestions = React.memo(function RecipeQuestions({
  block,
  isActive,
  onSubmit,
}: RecipeQuestionsProps) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState<Record<number, string | undefined>>(
    {},
  );
  const answers = useMemo(
    () =>
      block.questions.flatMap((q, i) => {
        const answer = selected[i];
        return answer ? [{ question: q.question, answer }] : [];
      }),
    [block.questions, selected],
  );
  const canSubmit = isActive && answers.length > 0;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      {block.questions.map((q, qi) => (
        <View
          key={q.question}
          style={styles.question}
          accessibilityRole="radiogroup"
          accessibilityLabel={q.question}
        >
          <ThemedText style={styles.questionText}>{q.question}</ThemedText>
          <View style={styles.chips}>
            {q.options.map((option) => (
              <Chip
                key={option}
                label={option}
                variant="filter"
                selected={selected[qi] === option}
                accessibilityRole="radio"
                style={styles.chip}
                onPress={
                  isActive
                    ? () =>
                        setSelected((prev) => ({
                          ...prev,
                          [qi]: prev[qi] === option ? undefined : option,
                        }))
                    : undefined
                }
              />
            ))}
          </View>
        </View>
      ))}
      <Pressable
        onPress={() => onSubmit(answers)}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Search with these"
        accessibilityState={{ disabled: !canSubmit }}
        style={[
          styles.submit,
          { backgroundColor: theme.accentSolid },
          !canSubmit && styles.inactive,
        ]}
      >
        <ThemedText style={{ color: theme.buttonText, fontWeight: "600" }}>
          Search with these
        </ThemedText>
      </Pressable>
      <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
        Or type your answer.
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  question: { gap: Spacing.xs },
  questionText: { fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: { minHeight: 44, justifyContent: "center" },
  submit: {
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  inactive: { opacity: 0.45 },
  hint: { fontSize: 12, textAlign: "center" },
});
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `commit-msg-finder-task-24.txt`: `feat(recipe-finder): RecipeQuestions with single-select chips`.

### Task 25: `RecipeFinderMessage` — the ONE component both chats render

**Files:**

- Create: `client/components/recipe-finder/RecipeFinderMessage.tsx`
- Create: `client/components/recipe-finder/__tests__/RecipeFinderMessage.test.tsx`

**Interfaces:**

- Produces: `export function RecipeFinderMessage(props: { block: FinderBlock; isActive: boolean; lockedButtons?: FinderButton[]; onAction: (action: FinderAction, label: string) => void; onLockedButton: (button: FinderButton) => void; onOpenItem: (item: FinderItem) => void }): JSX.Element` — builds the `FinderAction` with the block's own `flowId` (the client never mints flowIds), and the visible label (`"Generate"`, or the chosen answers) that becomes the user bubble and the request `content`.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// client/components/recipe-finder/__tests__/RecipeFinderMessage.test.tsx
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeFinderMessage } from "../RecipeFinderMessage";
import type { FinderBlock } from "@shared/schemas/recipe-finder";

const FLOW = "00000000-0000-4000-8000-000000000000";
const flow = {
  flowId: FLOW,
  stage: "results" as const,
  request: "x",
  query: { q: "x" },
  round: 0 as const,
  shownIds: [],
};
const results: FinderBlock = {
  type: "recipe_results",
  source: "community",
  items: [],
  actions: ["search_online", "generate", "none_of_these"],
  notice: "no_matches",
  flow,
};
const questions: FinderBlock = {
  type: "recipe_questions",
  questions: [{ question: "Diet?", options: ["Vegan", "None"] }],
  flow: { ...flow, stage: "clarifying" },
};

function setup(
  block: FinderBlock,
  over: Partial<React.ComponentProps<typeof RecipeFinderMessage>> = {},
) {
  const onAction = vi.fn();
  const onLockedButton = vi.fn();
  renderComponent(
    <RecipeFinderMessage
      block={block}
      isActive
      onAction={onAction}
      onLockedButton={onLockedButton}
      onOpenItem={vi.fn()}
      {...over}
    />,
  );
  return { onAction, onLockedButton };
}

describe("RecipeFinderMessage", () => {
  it("sends a button action with the block's own flowId and the button label", () => {
    const { onAction } = setup(results);
    fireEvent.click(screen.getByRole("button", { name: "None of these" }));
    expect(onAction).toHaveBeenCalledWith(
      { type: "none_of_these", flowId: FLOW },
      "None of these",
    );
  });

  it("a locked button opens the upgrade path instead of sending", () => {
    const { onAction, onLockedButton } = setup(results, {
      lockedButtons: ["search_online"],
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Search Spoonacular. Premium feature",
      }),
    );
    expect(onAction).not.toHaveBeenCalled();
    expect(onLockedButton).toHaveBeenCalledWith("search_online");
  });

  it("sends answers with the chosen answers as the label", () => {
    const { onAction } = setup(questions);
    fireEvent.click(screen.getByRole("radio", { name: "Vegan" }));
    fireEvent.click(screen.getByRole("button", { name: "Search with these" }));
    expect(onAction).toHaveBeenCalledWith(
      {
        type: "answers",
        flowId: FLOW,
        answers: [{ question: "Diet?", answer: "Vegan" }],
      },
      "Vegan",
    );
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
// client/components/recipe-finder/RecipeFinderMessage.tsx
// Spec §5 / D1: both chats render THIS component for a finder block —
// RecipeChatScreen from message metadata, Coach's BlockRenderer as a block.
import React, { useCallback } from "react";
import type {
  FinderAction,
  FinderAnswer,
  FinderBlock,
  FinderButton,
  FinderItem,
} from "@shared/schemas/recipe-finder";
import { RecipeResultsList } from "./RecipeResultsList";
import { RecipeQuestions } from "./RecipeQuestions";
import { FINDER_BUTTON_LABELS, answersLabel } from "./recipe-finder-utils";

export interface RecipeFinderMessageProps {
  block: FinderBlock;
  isActive: boolean;
  lockedButtons?: FinderButton[];
  onAction: (action: FinderAction, label: string) => void;
  onLockedButton: (button: FinderButton) => void;
  onOpenItem: (item: FinderItem) => void;
}

const NO_LOCKS: FinderButton[] = [];

export function RecipeFinderMessage({
  block,
  isActive,
  lockedButtons = NO_LOCKS,
  onAction,
  onLockedButton,
  onOpenItem,
}: RecipeFinderMessageProps) {
  const flowId = block.flow.flowId;

  const handleButton = useCallback(
    (button: FinderButton) => {
      if (!isActive) return;
      if (lockedButtons.includes(button)) {
        onLockedButton(button);
        return;
      }
      onAction({ type: button, flowId }, FINDER_BUTTON_LABELS[button]);
    },
    [isActive, lockedButtons, onLockedButton, onAction, flowId],
  );

  const handleSubmit = useCallback(
    (answers: FinderAnswer[]) => {
      if (!isActive || answers.length === 0) return;
      onAction({ type: "answers", flowId, answers }, answersLabel(answers));
    },
    [isActive, onAction, flowId],
  );

  if (block.type === "recipe_results") {
    return (
      <RecipeResultsList
        block={block}
        isActive={isActive}
        lockedButtons={lockedButtons}
        onButton={handleButton}
        onOpenItem={onOpenItem}
      />
    );
  }
  return (
    <RecipeQuestions
      block={block}
      isActive={isActive}
      onSubmit={handleSubmit}
    />
  );
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `commit-msg-finder-task-25.txt`: `feat(recipe-finder): RecipeFinderMessage (shared by both chats)`.

### Task 26: `useSendMessage` — `finder` + `status` SSE cases, `finderAction` option

**Files:**

- Modify: `client/hooks/useChat.ts:1-12` (imports), `:135-165` (state + signature), `:201-205` (body), `:215-250` (processLine), `:388-413` (finally + return)
- Test: `client/hooks/__tests__/useChat.test.ts` (append inside `describe("useSendMessage")`)

**Interfaces:**

- Produces: `sendMessage(content: string, screenContext?: string, conversationIdOverride?: number, options?: { finderAction?: FinderAction }): Promise<void>`; the hook also returns `streamingFinder: FinderBlock | null` and `streamingStatus: string | null`. An old server never sends either; unknown events stay ignored (no behaviour change without the flag).

- [ ] **Step 1: Write the failing tests**

```ts
describe("recipe finder events", () => {
  const block = {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ["generate"],
    notice: "no_matches",
    flow: {
      flowId: "00000000-0000-4000-8000-000000000000",
      stage: "results",
      request: "x",
      query: { q: "x" },
      round: 0,
      shownIds: [],
    },
  };

  it("sends finderAction in the body", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("t");
    const { result } = renderHook(() => useSendMessage(42), { wrapper });
    const finderAction = {
      type: "generate" as const,
      flowId: "00000000-0000-4000-8000-000000000000",
    };
    await act(async () => {
      const p = result.current.sendMessage("Generate", undefined, undefined, {
        finderAction,
      });
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(['data: {"done":true}\n']);
      await p;
    });
    expect(xhrInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ content: "Generate", finderAction }),
    );
  });

  it("exposes progress text and the finder block while streaming, then clears them", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("t");
    const { result } = renderHook(() => useSendMessage(42), { wrapper });
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.sendMessage("Mediterranean");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.responseText =
        'data: {"status":"Searching community recipes…"}\n';
      xhrInstance.onprogress?.(new ProgressEvent("progress"));
    });
    expect(result.current.streamingStatus).toBe("Searching community recipes…");
    await act(async () => {
      xhrInstance.responseText += `data: ${JSON.stringify({ finder: block })}\n`;
      xhrInstance.onprogress?.(new ProgressEvent("progress"));
    });
    expect(result.current.streamingFinder).toEqual(block);
    await act(async () => {
      xhrInstance.responseText += 'data: {"done":true}\n';
      xhrInstance.onload?.(new ProgressEvent("load"));
      await p;
    });
    expect(result.current.streamingFinder).toBeNull();
    expect(result.current.streamingStatus).toBeNull();
  });

  it("ignores a malformed finder event", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("t");
    const { result } = renderHook(() => useSendMessage(42), { wrapper });
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.sendMessage("x");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.responseText = 'data: {"finder":{"type":"recipe_results"}}\n';
      xhrInstance.onprogress?.(new ProgressEvent("progress"));
    });
    expect(result.current.streamingFinder).toBeNull();
    await act(async () => {
      xhrInstance.onload?.(new ProgressEvent("load"));
      await p;
    });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/hooks/__tests__/useChat.test.ts -t "recipe finder events"` — Expected: FAIL (`finderAction` absent from the body; `streamingStatus`/`streamingFinder` undefined).

- [ ] **Step 3: Implement**

Imports: `import { finderBlockSchema, type FinderAction, type FinderBlock } from "@shared/schemas/recipe-finder";`

State (after `allergenWarning`):

```ts
const [streamingFinder, setStreamingFinder] = useState<FinderBlock | null>(
  null,
);
// Recipe finder progress ("Searching community recipes…") for the thinking bubble.
const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
```

Signature:

```ts
    async (
      content: string,
      screenContext?: string,
      conversationIdOverride?: number,
      options?: { finderAction?: FinderAction },
    ) => {
```

At the start, after `setAllergenWarning(null);`: `setStreamingFinder(null); setStreamingStatus(null);`

Body:

```ts
const requestBody = JSON.stringify({
  content,
  ...(screenContext && { screenContext }),
  ...(options?.finderAction && { finderAction: options.finderAction }),
});
```

In `processLine`, before `if (data.recipe)`:

```ts
if (typeof data.status === "string") {
  setStreamingStatus(data.status);
}
if (data.finder) {
  const parsed = finderBlockSchema.safeParse(data.finder);
  if (parsed.success) setStreamingFinder(parsed.data);
}
```

In `finally`, after `setAllergenWarning(null);`: `setStreamingFinder(null); setStreamingStatus(null);`. The return object adds `streamingFinder, streamingStatus`.

- [ ] **Step 4: Run** `npx vitest run client/hooks/__tests__/useChat.test.ts` → PASS (new + existing; the existing body assertion `JSON.stringify({ content: "test message" })` is unchanged).
- [ ] **Step 5: Commit** — `commit-msg-finder-task-26.txt`: `feat(chat): useSendMessage finder/status events and finderAction`.

### Task 27: `RecipeChatScreen` — render, actions, "used" buttons, progress text

**Files:**

- Modify: `client/screens/RecipeChatScreen.tsx` — imports (1-55), `RecipeStreamingFooter` (105-151), `hasPendingRecipeReply` (154-159), hook destructure (221-229), pending bridge (238-258), handlers (after `handleSend`, ~348), `displayMessages` pending metadata (393-403), `renderMessage` (457-537), footer (539-544), `UpgradeModal` (end of JSX)
- Test: `client/screens/__tests__/RecipeChatScreen.test.tsx` (mocks 9-104 + append)

**Interfaces:**

- Consumes: `useSendMessage` → `streamingFinder`, `streamingStatus`, `sendMessage(…, { finderAction })` (Task 26); `RecipeFinderMessage` (Task 25); `finderBlockFromMessageMetadata`, `finderItemNavParams`, `lockedFinderButtons` (Task 22); `usePremiumFeature` (`client/hooks/usePremiumFeatures.ts:12`).
- Behaviour: a message whose metadata holds a finder block renders `RecipeFinderMessage` **instead of** its text bubble (the text is the old-client fallback); only the last assistant message's finder is active, and only while not streaming; a tap sends `label` as `content` with `finderAction`, showing `label` as the optimistic user bubble; a row opens `FeaturedRecipeDetail` (community or catalog); the thinking bubble shows the server's progress text; the pending-assistant bridge keeps a just-streamed finder visible until the refetch lands.

- [ ] **Step 1: Write the failing tests**

In the test's hoisted `mockSendMessageState.value` add `streamingFinder: null as unknown, streamingStatus: null as string | null` (and the same two keys in the `beforeEach` reset). Add mocks:

```ts
vi.mock("@/hooks/usePremiumFeatures", () => ({ usePremiumFeature: () => true }));
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="upgrade-modal" /> : null),
}));
```

Append:

```tsx
describe("RecipeChatScreen — recipe finder", () => {
  const FLOW_OLD = "00000000-0000-4000-8000-000000000000";
  const FLOW_NEW = "11111111-1111-4111-8111-111111111111";
  const block = (flowId: string) => ({
    type: "recipe_results",
    source: "community",
    items: [
      {
        id: 12,
        source: "community",
        title: "Mediterranean Quinoa Salad",
        imageUrl: null,
        readyInMinutes: null,
        calories: 350,
      },
    ],
    actions: ["search_online", "generate", "none_of_these"],
    notice: null,
    flow: {
      flowId,
      stage: "results",
      request: "Mediterranean",
      query: { q: "mediterranean" },
      round: 0,
      shownIds: [],
    },
  });
  const finderMessage = (id: number, flowId: string): ChatMessage => ({
    id,
    conversationId: 11,
    role: "assistant",
    content:
      "Here are 1 community recipe:\n1. Mediterranean Quinoa Salad (350 cal)",
    metadata: { metadataVersion: 1, finder: block(flowId) },
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    mockRouteParams.value = { conversationId: 11 };
  });

  it("renders the shared finder component instead of the fallback text", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("From the community")).toBeDefined();
    expect(screen.queryByText(/Here are 1 community recipe/)).toBeNull();
  });

  it("a button tap sends its label with the finderAction", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(mockSendMessage).toHaveBeenCalledWith("Generate", undefined, 11, {
      finderAction: { type: "generate", flowId: FLOW_NEW },
    });
  });

  it("only the latest finder message's buttons are active", () => {
    mockChatMessagesData.value = [
      finderMessage(2, FLOW_OLD),
      finderMessage(4, FLOW_NEW),
    ];
    renderComponent(<RecipeChatScreen />);
    const [older, newer] = screen.getAllByRole("button", { name: "Generate" });
    expect(older.getAttribute("aria-disabled")).toBe("true");
    expect(newer.getAttribute("aria-disabled")).toBe("false");
  });

  it("a row opens the recipe detail (viewing a result is not leaving the flow)", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    renderComponent(<RecipeChatScreen />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mediterranean Quinoa Salad, 350 calories. Opens recipe.",
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 12,
      recipeType: "community",
    });
  });

  it("the thinking bubble shows the finder's progress text", () => {
    mockChatMessagesData.value = [];
    mockSendMessageState.value = {
      ...mockSendMessageState.value,
      isStreaming: true,
      streamingStatus: "Searching community recipes…",
    };
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("Searching community recipes…")).toBeDefined();
  });

  it("buttons are inactive while a reply is streaming", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    mockSendMessageState.value = {
      ...mockSendMessageState.value,
      isStreaming: true,
    };
    renderComponent(<RecipeChatScreen />);
    expect(
      screen
        .getByRole("button", { name: "Generate" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/screens/__tests__/RecipeChatScreen.test.tsx -t "recipe finder"` — Expected: FAIL (the fallback text renders; no "From the community").

- [ ] **Step 3: Implement**

Imports:

```ts
import { UpgradeModal } from "@/components/UpgradeModal";
import { RecipeFinderMessage } from "@/components/recipe-finder/RecipeFinderMessage";
import {
  finderBlockFromMessageMetadata,
  finderItemNavParams,
  lockedFinderButtons,
} from "@/components/recipe-finder/recipe-finder-utils";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import type {
  FinderAction,
  FinderBlock,
  FinderItem,
} from "@shared/schemas/recipe-finder";
```

`RecipeStreamingFooter` gains a `status: string | null` prop; its thinking bubble (the `: (` branch, lines 128-142) becomes:

```tsx
<View
  style={[
    styles.messageBubble,
    styles.assistantBubble,
    styles.thinkingRow,
    { backgroundColor: withOpacity(theme.text, 0.06) },
  ]}
  accessible
  accessibilityRole="text"
  accessibilityLabel={status ?? "RecipeChef is thinking"}
  accessibilityLiveRegion="polite"
>
  <ActivityIndicator size="small" color={theme.textSecondary} />
  {status ? (
    <ThemedText style={{ color: theme.textSecondary }}>{status}</ThemedText>
  ) : null}
</View>
```

(add `thinkingRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm }` to `styles`).

`hasPendingRecipeReply`:

```ts
function hasPendingRecipeReply(value: {
  content: string;
  recipe: StreamingRecipe | null;
  finder: FinderBlock | null;
}): boolean {
  return !!value.content || !!value.recipe || !!value.finder;
}
```

The hook destructure adds `streamingFinder, streamingStatus`. The bridge value/type:

```ts
const pendingStreamingValue = useMemo(
  () => ({
    content: strippedStreamingContent,
    recipe: streamingRecipe,
    finder: streamingFinder,
  }),
  [strippedStreamingContent, streamingRecipe, streamingFinder],
);
const pendingAssistantMessage = usePendingAssistantBridge<{
  content: string;
  recipe: StreamingRecipe | null;
  finder: FinderBlock | null;
}>({
  isStreaming,
  streamingValue: pendingStreamingValue,
  hasStreamingValue:
    !!streamingContent || !!streamingRecipe || !!streamingFinder,
  isPresent: hasPendingRecipeReply,
  hasError: !!streamError || !!requestError,
  assistantMessageCount,
  announce: { message: "Recipe response received", always: false },
});
```

Premium + handlers (after `handleSend`):

```ts
const canSearchOnline = usePremiumFeature("catalogSave");
const canGenerate = usePremiumFeature("recipeGeneration");
const finderLocks = useMemo(
  () => lockedFinderButtons({ canSearchOnline, canGenerate }),
  [canSearchOnline, canGenerate],
);
const [showUpgrade, setShowUpgrade] = useState(false);

const handleFinderAction = useCallback(
  (action: FinderAction, label: string) => {
    if (!conversationId || isStreaming) return;
    setPendingUserMessage(label);
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    void sendMessage(label, undefined, conversationId, {
      finderAction: action,
    });
  },
  [conversationId, isStreaming, sendMessage, haptics],
);

const handleOpenFinderItem = useCallback(
  (item: FinderItem) => {
    navigation.navigate("FeaturedRecipeDetail", finderItemNavParams(item));
  },
  [navigation],
);

const openUpgrade = useCallback(() => setShowUpgrade(true), []);
```

`displayMessages` pending-assistant metadata:

```ts
        metadata: pendingAssistantMessage.recipe
          ? { recipe: pendingAssistantMessage.recipe }
          : pendingAssistantMessage.finder
            ? { metadataVersion: 1, finder: pendingAssistantMessage.finder }
            : null,
```

After `displayMessages`:

```ts
// Only the newest assistant reply's finder buttons are live (spec §4);
// error bubbles (-2, -4) never count as the newest reply.
const activeFinderMessageId = useMemo(() => {
  for (let i = displayMessages.length - 1; i >= 0; i--) {
    const m = displayMessages[i];
    const meta = m.metadata as Record<string, unknown> | null;
    if (m.role === "assistant" && !meta?.isError) return m.id;
  }
  return null;
}, [displayMessages]);
```

In `renderMessage`, after `const isError = …` add `const finder = finderBlockFromMessageMetadata(metadata);`, change the text-bubble condition from `{item.content ? (` to `{item.content && !finder ? (`, and after the recipe card add:

```tsx
{
  finder ? (
    <RecipeFinderMessage
      block={finder}
      isActive={!isStreaming && item.id === activeFinderMessageId}
      lockedButtons={finderLocks}
      onAction={handleFinderAction}
      onLockedButton={openUpgrade}
      onOpenItem={handleOpenFinderItem}
    />
  ) : null;
}
```

with deps `[theme, saveRecipeMutation.isPending, handleSaveRecipe, isStreaming, activeFinderMessageId, finderLocks, handleFinderAction, openUpgrade, handleOpenFinderItem]`. Pass `status={streamingStatus}` to `RecipeStreamingFooter`, and render `<UpgradeModal visible={showUpgrade} onClose={() => setShowUpgrade(false)} />` as the last child of the root `KeyboardAvoidingView`.

- [ ] **Step 4: Run** `npx vitest run client/screens/__tests__/RecipeChatScreen.test.tsx` → PASS (new + existing).
- [ ] **Step 5: Commit** — `commit-msg-finder-task-27.txt`: `feat(recipe-chat): render the recipe finder, send finder actions, show progress text`.

### Task 28: `useCoachStream` — `extras.finderAction`

**Files:**

- Modify: `client/hooks/useCoachStream.ts:84-88` (type), `:275-280` (signature), `:387-394` (body)
- Test: `client/hooks/__tests__/useCoachStream.test.ts` (append)

**Interfaces:**

- Produces: `startStream(conversationId: number, userMessage: string, extras?: { warmUpId?: string | null; screenContext?: string; finderAction?: FinderAction }): void`. The existing `turnKey` keeps using `randomUuidV4()` (Hermes has no global `crypto`).

- [ ] **Step 1: Write the failing test** — append to `client/hooks/__tests__/useCoachStream.test.ts`, reusing its `setupHook()` and module-level `mockXhr` (which records `sentBody`):

```ts
describe("useCoachStream recipe finder actions", () => {
  it("sends finderAction in the request body", async () => {
    const finderAction = {
      type: "generate" as const,
      flowId: "00000000-0000-4000-8000-000000000000",
    };
    const { result } = await setupHook();
    await act(async () => {
      result.current.startStream(7, "Generate", { finderAction });
      // Flush the tokenStorage.get() microtask so the XHR is sent.
      await Promise.resolve();
    });
    const body = JSON.parse(mockXhr.sentBody ?? "{}") as {
      content?: string;
      finderAction?: unknown;
    };
    expect(body.content).toBe("Generate");
    expect(body.finderAction).toEqual(finderAction);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/hooks/__tests__/useCoachStream.test.ts -t "finderAction"` — Expected: FAIL (`body.finderAction` undefined).

- [ ] **Step 3: Implement** — import `type FinderAction` from `@shared/schemas/recipe-finder`; widen both `extras` types (`UseCoachStreamReturn.startStream` and the `startStream` callback) to `{ warmUpId?: string | null; screenContext?: string; finderAction?: FinderAction }`; in the body builder (after the `screenContext` line) add `if (extras?.finderAction) body.finderAction = extras.finderAction;`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `commit-msg-finder-task-28.txt`: `feat(coach): useCoachStream forwards finderAction`.

### Task 29: Coach — finder blocks, actions, active state, generated card with Save

**Files:**

- Modify: `client/components/coach/blocks/index.tsx:1-65`
- Modify: `client/components/coach/CoachChat.tsx` — imports (1-65), hooks (93-110), `onDone` (266-277), new handlers (after `handleQuickReply`, ~727), `renderItem` (729-803)
- Test: `client/components/coach/blocks/__tests__/index.test.tsx`, `client/components/coach/__tests__/CoachChat.branches.test.tsx`; add `useSaveRecipeFromChat: () => ({ mutateAsync: vi.fn() })` to the `@/hooks/useChat` mocks in `CoachChat.test.tsx` and `CoachChat.render-item-stability.test.tsx` (and in `client/screens/__tests__/CoachProScreen.test.tsx` if it renders the real `CoachChat`)

**Interfaces:**

- `BlockRendererProps` gains `isActive?: boolean; lockedFinderButtons?: FinderButton[]; onFinderAction?: (action: FinderAction, label: string) => void; onLockedFinderButton?: (button: FinderButton) => void; onOpenFinderItem?: (item: FinderItem) => void`.
- `CoachChat`: `handleFinderAction(action, label)` → `startStream(convId, label, { finderAction: action })` with `label` as the optimistic bubble; finder blocks are dropped from `streamBlocks` in `onDone` (the refetched message renders them — avoids a duplicate live list); a message with a finder block hides its fallback text bubble; a message with top-level recipe metadata renders `client/components/recipe-chat/RecipeCard.tsx` (not the `recipe_card` block) with Save → `useSaveRecipeFromChat` (`POST /save-recipe`, server unchanged — R5).

- [ ] **Step 1: Write the failing tests**

`blocks/__tests__/index.test.tsx` — add a mock and rows:

```tsx
vi.mock("@/components/recipe-finder/RecipeFinderMessage", () => ({
  RecipeFinderMessage: ({ isActive }: { isActive: boolean }) => (
    <div data-testid="r-finder" data-active={String(isActive)} />
  ),
}));
```

```tsx
const finderFlow = {
  flowId: "00000000-0000-4000-8000-000000000000",
  stage: "results" as const,
  request: "x",
  query: { q: "x" },
  round: 0 as const,
  shownIds: [],
};
it.each([
  [
    {
      type: "recipe_results",
      source: "community",
      items: [],
      actions: [],
      notice: null,
      flow: finderFlow,
    },
  ],
  [
    {
      type: "recipe_questions",
      questions: [{ question: "Q?", options: ["a", "b"] }],
      flow: { ...finderFlow, stage: "clarifying" },
    },
  ],
] as [CoachBlock][])(
  "renders a finder block with the shared component",
  (block) => {
    renderComponent(<BlockRenderer block={block} isActive />);
    expect(screen.getByTestId("r-finder").getAttribute("data-active")).toBe(
      "true",
    );
  },
);
```

`CoachChat.branches.test.tsx` — extend `state` with `onFinderAction: null as ((a: unknown, label: string) => void) | null, saveRecipe: vi.fn().mockResolvedValue({ id: 5 })`; the `@/hooks/useChat` mock gains `useSaveRecipeFromChat: () => ({ mutateAsync: state.saveRecipe, isPending: false })`; the BlockRenderer double also destructures `onFinderAction` and `isActive`, sets `state.onFinderAction = onFinderAction ?? null;`, and puts `data-active={String(isActive)}` on its root; the StreamingBubble double also destructures `streamBlocks` and renders `data-blocks={String(streamBlocks.length)}`; add

```tsx
vi.mock("@/components/recipe-chat/RecipeCard", () => ({
  RecipeCard: ({
    recipe,
    onSave,
    isSaved,
  }: {
    recipe: { title: string };
    onSave?: () => void;
    isSaved?: boolean;
  }) => (
    <button
      data-testid="generated-card"
      onClick={onSave}
    >{`${recipe.title}${isSaved ? " saved" : ""}`}</button>
  ),
}));
```

and append:

```tsx
describe("CoachChat — recipe finder", () => {
  const FLOW = "11111111-1111-4111-8111-111111111111";
  const finderBlock = {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ["generate"],
    notice: "no_matches",
    flow: {
      flowId: FLOW,
      stage: "results",
      request: "x",
      query: { q: "x" },
      round: 0,
      shownIds: [],
    },
  };
  const recipe = {
    title: "Chicken Curry",
    description: "d",
    difficulty: "Easy",
    timeEstimate: "30 min",
    servings: 2,
    ingredients: [],
    instructions: ["cook"],
    dietTags: [],
  };

  it("a finder button sends a finder action with its label as the message", () => {
    state.messages = [
      makeMessage({
        id: 2,
        role: "assistant",
        content: "No community recipes matched.",
        metadata: { blocks: [finderBlock] },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    act(() => {
      state.onFinderAction?.({ type: "generate", flowId: FLOW }, "Generate");
    });
    expect(state.startStream).toHaveBeenCalledWith(1, "Generate", {
      finderAction: { type: "generate", flowId: FLOW },
    });
  });

  it("only the latest assistant message's finder block is active", () => {
    state.messages = [
      makeMessage({
        id: 2,
        role: "assistant",
        content: "a",
        metadata: { blocks: [finderBlock] },
      }),
      makeMessage({ id: 3, role: "user", content: "Generate" }),
      makeMessage({
        id: 4,
        role: "assistant",
        content: "b",
        metadata: {
          blocks: [
            {
              ...finderBlock,
              flow: {
                ...finderBlock.flow,
                flowId: "22222222-2222-4222-8222-222222222222",
              },
            },
          ],
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    const actives = screen
      .getAllByTestId("block-recipe_results")
      .map((el) => el.getAttribute("data-active"));
    expect(actives).toEqual(["false", "true"]);
  });

  it("hides a finder message's plain-text fallback", () => {
    state.messages = [
      makeMessage({
        id: 2,
        role: "assistant",
        content: "Here are 3 community recipes: …",
        metadata: { blocks: [finderBlock] },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    expect(screen.queryByText("Here are 3 community recipes: …")).toBeNull();
  });

  it("renders a generated recipe from top-level metadata and saves it via save-recipe", async () => {
    state.messages = [
      makeMessage({
        id: 9,
        role: "assistant",
        content: "Here's a curry!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    fireEvent.click(screen.getByTestId("generated-card"));
    await waitFor(() =>
      expect(state.saveRecipe).toHaveBeenCalledWith({
        conversationId: 1,
        messageId: 9,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("generated-card").textContent).toBe(
        "Chicken Curry saved",
      ),
    );
  });

  it("drops finder blocks from the live stream footer (the refetched message renders them)", () => {
    renderCoachChat({ conversationId: 1 });
    act(() => {
      state.onDone?.("", [finderBlock, { type: "quick_replies", options: [] }]);
    });
    expect(
      screen.getByTestId("streaming-bubble").getAttribute("data-blocks"),
    ).toBe("1");
  });
});
```

(Reset `state.onFinderAction = null` and `state.saveRecipe.mockClear()` in the file's `beforeEach`.)

- [ ] **Step 2: Run** `npx vitest run client/components/coach/blocks/__tests__/index.test.tsx client/components/coach/__tests__/CoachChat.branches.test.tsx` — Expected: FAIL on the new tests (default branch renders nothing; no `onFinderAction`; fallback text shown; no generated card; footer keeps 2 blocks).

- [ ] **Step 3: Implement**

`blocks/index.tsx`:

```tsx
import { RecipeFinderMessage } from "@/components/recipe-finder/RecipeFinderMessage";
import type {
  FinderAction,
  FinderButton,
  FinderItem,
} from "@shared/schemas/recipe-finder";

interface BlockRendererProps {
  block: CoachBlock;
  onAction?: (action: Record<string, unknown>) => void;
  onQuickReply?: (message: string, blockKey?: string) => void;
  onCommitmentAccept?: (
    notebookEntryId: number | undefined,
    title: string,
    followUpDate: string,
  ) => void;
  isUsed?: boolean;
  isCommitmentAccepted?: boolean;
  blockKey?: string;
  /** Recipe finder: only the latest assistant message's block is active. */
  isActive?: boolean;
  lockedFinderButtons?: FinderButton[];
  onFinderAction?: (action: FinderAction, label: string) => void;
  onLockedFinderButton?: (button: FinderButton) => void;
  onOpenFinderItem?: (item: FinderItem) => void;
}

const noop = () => {};
```

destructure the new props and add before `default:`

```tsx
    case "recipe_results":
    case "recipe_questions":
      return (
        <RecipeFinderMessage
          block={block}
          isActive={!!isActive}
          lockedButtons={lockedFinderButtons}
          onAction={onFinderAction ?? noop}
          onLockedButton={onLockedFinderButton ?? noop}
          onOpenItem={onOpenFinderItem ?? noop}
        />
      );
```

`CoachChat.tsx` — merge `useSaveRecipeFromChat, type StreamingRecipe` into the `@/hooks/useChat` import and add:

```ts
import { RecipeCard as GeneratedRecipeCard } from "@/components/recipe-chat/RecipeCard";
import {
  finderItemNavParams,
  lockedFinderButtons,
} from "@/components/recipe-finder/recipe-finder-utils";
import { recipeChatMetadataSchema } from "@shared/schemas/recipe-chat";
import {
  isFinderBlockType,
  type FinderAction,
  type FinderItem,
} from "@shared/schemas/recipe-finder";
```

Hooks (after `useAddMealPlanItem`):

```ts
const canGenerateRecipes = usePremiumFeature("recipeGeneration");
const finderLocks = useMemo(
  () =>
    lockedFinderButtons({
      canSearchOnline: canSaveCatalog,
      canGenerate: canGenerateRecipes,
    }),
  [canSaveCatalog, canGenerateRecipes],
);
const { mutateAsync: saveRecipeFromChat } = useSaveRecipeFromChat();
const savedRecipeIdsRef = useRef<Set<number>>(new Set());
const [savingRecipeMessageId, setSavingRecipeMessageId] = useState<
  number | null
>(null);
```

`onDone`:

```ts
    onDone: (_fullText, blocks) => {
      setOptimisticMessage(null);
      // Finder blocks render from the refetched message (with the right
      // active state); keeping them in the footer too would show two lists.
      const liveBlocks = (blocks ?? []).filter((b) => !isFinderBlockType(b.type));
      if (liveBlocks.length > 0) setStreamBlocks(liveBlocks);
      if (activeConvIdRef.current !== null) {
        void queryClient.invalidateQueries({
          queryKey: [`/api/chat/conversations/${activeConvIdRef.current}/messages`],
        });
      }
    },
```

Generated-recipe map (after `messageBlocks`):

```ts
// A Coach message generated by the recipe finder carries RecipeChef's
// top-level recipe metadata (R5) — render RecipeChef's card, not the
// recipe_card block (which needs a recipeId and macros).
const generatedRecipes = useMemo(() => {
  const map = new Map<
    number,
    { recipe: StreamingRecipe; allergenWarning: string | null }
  >();
  for (const msg of messages ?? []) {
    if (msg.role !== "assistant") continue;
    const parsed = recipeChatMetadataSchema.safeParse(msg.metadata);
    if (parsed.success) {
      map.set(msg.id, {
        recipe: { ...parsed.data.recipe, imageUrl: parsed.data.imageUrl },
        allergenWarning: parsed.data.allergenWarning,
      });
    }
  }
  return map;
}, [messages]);
```

Handlers (after `handleQuickReply`):

```ts
const handleFinderAction = useCallback(
  (action: FinderAction, label: string) => {
    if (isStreaming || !conversationId) return;
    setOptimisticMessage(label);
    setStreamBlocks([]);
    setStreamingError(null);
    setIsAtDailyLimit(false);
    ttsStop();
    activeConvIdRef.current = conversationId;
    startStream(conversationId, label, { finderAction: action });
    onMessageSent?.();
  },
  [isStreaming, conversationId, ttsStop, startStream, onMessageSent],
);

const handleOpenFinderItem = useCallback(
  (item: FinderItem) => {
    navigation.navigate("FeaturedRecipeDetail", finderItemNavParams(item));
  },
  [navigation],
);

const openUpgrade = useCallback(() => setShowUpgrade(true), []);

const handleSaveGeneratedRecipe = useCallback(
  async (messageId: number) => {
    if (
      !conversationId ||
      savedRecipeIdsRef.current.has(messageId) ||
      savingRecipeMessageId !== null
    )
      return;
    setSavingRecipeMessageId(messageId);
    try {
      await saveRecipeFromChat({ conversationId, messageId });
      savedRecipeIdsRef.current = new Set([
        ...savedRecipeIdsRef.current,
        messageId,
      ]);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      toast.success("Recipe saved");
    } catch {
      // useSaveRecipeFromChat has no silentError: the global net toasts it.
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingRecipeMessageId(null);
    }
  },
  [conversationId, savingRecipeMessageId, saveRecipeFromChat, haptics, toast],
);
```

In `renderItem`, compute `const blocksForMsg = messageBlocks.get(msg.id); const hasFinderBlock = blocksForMsg?.some((b) => isFinderBlockType(b.type)) ?? false; const generated = generatedRecipes.get(msg.id);`; render the `ChatBubble` only when `!hasFinderBlock`; iterate `blocksForMsg?.map(…)` and pass to each `BlockRenderer`:

```tsx
                  isActive={!isStreaming && msg.id === lastAssistantMessageId}
                  lockedFinderButtons={finderLocks}
                  onFinderAction={handleFinderAction}
                  onLockedFinderButton={openUpgrade}
                  onOpenFinderItem={handleOpenFinderItem}
```

and after the blocks:

```tsx
{
  generated ? (
    <GeneratedRecipeCard
      recipe={generated.recipe}
      allergenWarning={generated.allergenWarning}
      isSaved={savedRecipeIdsRef.current.has(msg.id)}
      isSaving={savingRecipeMessageId === msg.id}
      onSave={() => void handleSaveGeneratedRecipe(msg.id)}
    />
  ) : null;
}
```

Add `finderLocks, handleFinderAction, openUpgrade, handleOpenFinderItem, generatedRecipes, savingRecipeMessageId, handleSaveGeneratedRecipe` to `renderItem`'s deps — all stable across keystrokes, so `CoachChat.render-item-stability.test.tsx` must stay green.

Progress text needs no client change in Coach: the server's `status` events already drive `statusText` → `CoachStatusRow` (`useCoachStream.ts:318-323`).

- [ ] **Step 4: Run** `npx vitest run client/components/coach client/screens/__tests__/CoachProScreen.test.tsx` → PASS (all CoachChat suites, including render-item stability).
- [ ] **Step 5: Commit** — `commit-msg-finder-task-29.txt`: `feat(coach): render recipe finder blocks, send finder actions, save generated recipes`.

### Task 30: Both chats draw the same component (spec §7 client)

**Files:**

- Create: `client/components/recipe-finder/__tests__/both-chats.test.tsx`

- [ ] **Step 1: Write the test (it fails if either chat stops using the shared component)**

```tsx
// @vitest-environment jsdom
// Spec §5/§7, D1: RecipeChef and Coach Pro must render a finder block with the
// SAME component. The double is keyed on the one module both chats import.
import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import type { ChatMessage } from "@/hooks/useChat";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import RecipeChatScreen from "@/screens/RecipeChatScreen";
import BlockRenderer from "@/components/coach/blocks";

const { finderRenders, finderMessage, finderBlock } = vi.hoisted(() => {
  const block = {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ["generate"],
    notice: "no_matches",
    flow: {
      flowId: "00000000-0000-4000-8000-000000000000",
      stage: "results",
      request: "x",
      query: { q: "x" },
      round: 0,
      shownIds: [],
    },
  };
  return {
    finderRenders: [] as string[],
    finderBlock: block,
    finderMessage: {
      id: 2,
      conversationId: 11,
      role: "assistant",
      content: "No community recipes matched.",
      metadata: { metadataVersion: 1, finder: block },
      createdAt: new Date().toISOString(),
    } as ChatMessage,
  };
});

vi.mock("@/components/recipe-finder/RecipeFinderMessage", () => ({
  RecipeFinderMessage: ({ block }: { block: { type: string } }) => {
    finderRenders.push(block.type);
    return <div data-testid="shared-finder" />;
  },
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: vi.fn(),
    canGoBack: () => true,
    navigate: vi.fn(),
    reset: vi.fn(),
  }),
  useRoute: () => ({ params: { conversationId: 11 } }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));
vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatMessages: () => ({ data: [finderMessage] }),
  useSendMessage: () => ({
    sendMessage: vi.fn(),
    abortStream: vi.fn(),
    streamingContent: "",
    streamingRecipe: null,
    streamingFinder: null,
    streamingStatus: null,
    isStreaming: false,
    streamError: false,
    requestError: null,
  }),
  useSaveRecipeFromChat: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => true,
}));
vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));

describe("recipe finder — one component for both chats", () => {
  it("RecipeChef (message metadata) and Coach (block) both render RecipeFinderMessage", () => {
    renderComponent(<RecipeChatScreen />);
    expect(screen.getAllByTestId("shared-finder")).toHaveLength(1);
    cleanup();
    renderComponent(
      <BlockRenderer block={finderBlock as CoachBlock} isActive />,
    );
    expect(screen.getAllByTestId("shared-finder")).toHaveLength(1);
    expect(finderRenders.filter((t) => t === "recipe_results")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/components/recipe-finder/__tests__/both-chats.test.tsx` → PASS (Tasks 27 and 29 are in). **Positive control:** temporarily change `blocks/index.tsx`'s finder case to render `RecipeResultsList` directly, re-run and see it FAIL, then restore — record that in the PR.

- [ ] **Step 3: Commit, push, open PR C**

`commit-msg-finder-task-30.txt`: `test(recipe-finder): both chats render the shared finder component`. Push `feat/recipe-finder-client`, open the PR (review: `code-reviewer` + `mobile-reviewer`; apply the `interaction-feel` skill's guidance to the new controls). A preview OTA after merge is outward-facing: **ask the user first**, then run the repo's preview-OTA npm script (`update:preview`, with `--message "Recipe finder client (flag off)"`; the guard requires its one-command bypass).

---

# PR D — Enable

Branch: `chore/recipe-finder-enable` from `main` after PR C merges and its preview OTA is on the user's device.

### Task 31: Maestro run of the whole flow in both chats (spec §7 "Device")

**Files:**

- Create: `e2e/manual/recipe-finder.yaml`

This flow is **manual**: it lives outside `e2e/flows/**` (the only glob `e2e/config.yaml` discovers), so the nightly CI regression never runs it — CI has no real OpenAI key, no Premium account and no flag. It needs: the server running with `RECIPE_FINDER_ENABLED=true` and `SPOONACULAR_API_KEY` set, a dev-client build containing PR C, and a **Premium** account.

- [ ] **Step 1: Verify the selectors on a live screen first**

With the simulator running the PR C build and the server started as `RECIPE_FINDER_ENABLED=true npm run server:dev` (check `curl $EXPO_PUBLIC_DOMAIN/api/health` FIRST), use the Maestro MCP: `list_devices` → `inspect_screen` on (a) RecipeChat after one request and (b) Coach Pro after one request. Confirm these accessibility texts exist exactly: `Recipe request`, `Message your nutrition coach`, `Send message`, `Start a new coach conversation`, `From the community`, `Generate`, `None of these`, `Search with these`, `Search Spoonacular`, `Save to My Recipes`, `Close recipe`, `Save .* recipe` (RecipeCard save), `.* saved`. If any differs, use the inspected text in Step 2.

- [ ] **Step 2: Write the flow**

```yaml
# e2e/manual/recipe-finder.yaml
appId: com.ocrecipes.app
name: "Manual - Recipe finder in RecipeChef and Coach Pro"
# MANUAL ONLY (outside e2e/flows/** — CI never discovers it). Needs:
#   - server: RECIPE_FINDER_ENABLED=true npm run server:dev (+ SPOONACULAR_API_KEY)
#   - a dev-client build that includes the recipe-finder client (PR C)
#   - a Premium account:  maestro test -e USERNAME=… -e PASSWORD=… e2e/manual/recipe-finder.yaml
# AI output varies, so every assertion is on app-authored text, and every
# branch the AI can take (matches vs no matches, generate vs another list)
# is handled with a `when:` gate.
env:
  USERNAME: ${USERNAME}
  PASSWORD: ${PASSWORD}
---
- runFlow: ../helpers/launch-app.yaml
- runFlow:
    file: ../helpers/login.yaml
    env:
      USERNAME: ${USERNAME}
      PASSWORD: ${PASSWORD}

# ── RecipeChef ─────────────────────────────────────────────────────────
- openLink: "ocrecipes://recipe-chat"
- extendedWaitUntil:
    visible: "Recipe request"
    timeout: 15000
- tapOn: "Recipe request"
- inputText: "Mediterranean"
- tapOn: "Send message"
# Either a community list or the no-match notice — both carry the buttons.
- extendedWaitUntil:
    visible: "(From the community|No community recipes matched\\.)"
    timeout: 45000
- assertVisible: "Generate"
- assertVisible: "None of these"
# One clarifying round.
- tapOn: "None of these"
- extendedWaitUntil:
    visible: "Search with these"
    timeout: 45000
# Answer by typing (chips are AI-authored; typed answers are always valid).
- tapOn: "Recipe request"
- inputText: "under 30 minutes"
- tapOn: "Send message"
# Either a second list (tap Generate) or an automatic generation.
- extendedWaitUntil:
    visible: "(From the community|Save .* recipe)"
    timeout: 90000
- runFlow:
    when:
      visible: "From the community"
    commands:
      - tapOn: "Generate"
- extendedWaitUntil:
    visible: "Save .* recipe"
    timeout: 120000
- tapOn: "Save .* recipe"
- extendedWaitUntil:
    visible: ".* saved"
    timeout: 20000
- tapOn: "Close"

# ── Coach Pro ──────────────────────────────────────────────────────────
- tapOn:
    id: "tab-coach"
- extendedWaitUntil:
    visible: "Start a new coach conversation"
    timeout: 20000
- tapOn: "Start a new coach conversation"
- tapOn: "Message your nutrition coach"
- inputText: "Find me a chicken dinner recipe"
- tapOn: "Send message"
- extendedWaitUntil:
    visible: "(From the community|No community recipes matched\\.)"
    timeout: 45000
# Spoonacular list → open a preview (nothing saved) → back.
- tapOn: "Search Spoonacular"
- extendedWaitUntil:
    visible: "(From Spoonacular|Spoonacular isn't available right now.*|Spoonacular had no matches\\.)"
    timeout: 45000
- runFlow:
    when:
      visible: "From Spoonacular"
    commands:
      - tapOn:
          text: ".*Opens recipe\\."
          index: 0
      - extendedWaitUntil:
          visible: "Save to My Recipes"
          timeout: 30000
      - tapOn: "Close recipe"
# Generate in Coach → RecipeChef's card with Save.
- tapOn: "Generate"
- extendedWaitUntil:
    visible: "Save .* recipe"
    timeout: 120000
- tapOn: "Save .* recipe"
- extendedWaitUntil:
    visible: "(.* saved|Recipe saved)"
    timeout: 20000
```

- [ ] **Step 3: Run it on iOS and Android**

`maestro test -e USERNAME=<premium user> -e PASSWORD=<password> e2e/manual/recipe-finder.yaml` on the iOS simulator, then on the Android emulator (`adb reverse tcp:8081 tcp:8081` first). Both must pass. Record the two run results (and any selector changes from Step 1) for the PR body. This is a verification run, not CI — a red run blocks Task 32.

- [ ] **Step 4: Commit** — `commit-msg-finder-task-31.txt`: `test(e2e): manual Maestro flow for the recipe finder in both chats`; open PR D with the run evidence.

### Task 32: Flip `RECIPE_FINDER_ENABLED` in Railway — HUMAN-CONFIRMED ONLY

This is an **outward-facing production change**. The executor must **never** do it autonomously.

- [ ] **Step 1: Ask the user.** Report: PR A/B/C merged (verify each with a fresh `mcp__github__pull_request_read`), the preview OTA verified on the user's device, the Task 31 iOS + Android runs green. Ask verbatim: _"Turn on RECIPE_FINDER_ENABLED in Railway production now? It takes effect on the next request; turning it off again is one variable."_ Stop and wait for an explicit yes.
- [ ] **Step 2: On an explicit yes only**, set `RECIPE_FINDER_ENABLED=true` on the production API service (Railway MCP `set-variables`, or the user sets it in the dashboard) and leave `RECIPE_FINDER_SPOONACULAR_DAILY_CAP` unset (default 10). Confirm the service redeployed (`get-status`), then `curl $EXPO_PUBLIC_DOMAIN/api/health`.
- [ ] **Step 3: Smoke check with the user** — one RecipeChef request and one Coach Pro recipe request on the user's device. Rollback is `RECIPE_FINDER_ENABLED` unset/`false` (no deploy of code needed; server merges already shipped).
- [ ] **Step 4:** A production OTA of the PR C client is a separate outward-facing step — ask the user before running the production-OTA npm script.

---

## Self-Review

### Spec coverage

| Spec section / decision                                                                                                | Task(s)                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §1 Why (RecipeChef always generates; Coach can't show a recipe)                                                        | 18 (RecipeChef entry), 20 (Coach finder), 21 (retire `search_recipes`)                                                                                                                     |
| D1 Both chats identical                                                                                                | 15 (shared entry rules), 17 (one orchestrator), 20, 25, 30                                                                                                                                 |
| D2 Community only                                                                                                      | 9 (`source: "community"`, `safeForMe`), 10                                                                                                                                                 |
| D3 3–5 close matches, tap opens detail                                                                                 | 9 (`FINDER_MAX_ITEMS`, threshold), 10, 22 (`finderItemNavParams`), 23, 27, 29                                                                                                              |
| D4 Same three buttons on every list                                                                                    | 14 (`communityActions`, outcome rows), 23                                                                                                                                                  |
| D5 Whole flow in chat; Generate card with Save in chat                                                                 | 18 (RecipeChef card via existing path), 20 + 29 (Coach card + Save)                                                                                                                        |
| D6 None of these → clarify → search again → generate                                                                   | 12, 14 (round rows), 17                                                                                                                                                                    |
| D7 Coach Pro + RecipeChef only                                                                                         | 18 (409 for free Coach), 20 (`isCoachPro` gate + test)                                                                                                                                     |
| D8 Server runs the flow                                                                                                | 14, 17, 18, 20                                                                                                                                                                             |
| D9 10/day Spoonacular cap, DB-backed, changeable                                                                       | 6, 16, 17                                                                                                                                                                                  |
| D10 Repeat after a card; refinements in place                                                                          | 13, 15, 18, 20                                                                                                                                                                             |
| D11 Spoonacular preview + Save                                                                                         | 1, 2, 3, 4                                                                                                                                                                                 |
| §3.1 extractQuery                                                                                                      | 8                                                                                                                                                                                          |
| §3.1 findCommunity (q-only retry, cuisine→q, never maxPrepTime)                                                        | 9                                                                                                                                                                                          |
| §3.1 findOnline (no nutrition, intolerances)                                                                           | 11                                                                                                                                                                                         |
| §3.1 askClarifying (fixed fallback)                                                                                    | 12                                                                                                                                                                                         |
| §3.1 classifyTurn (`new_request` fallback)                                                                             | 13                                                                                                                                                                                         |
| §3.1 generate (premium + 20/day itself)                                                                                | 16, 17, 20                                                                                                                                                                                 |
| §3.1 pure transition function                                                                                          | 14                                                                                                                                                                                         |
| §3.2 message types + plain-text fallback                                                                               | 5, 15                                                                                                                                                                                      |
| §3.3 RecipeChef entry (first msg / active flow / classifyTurn; remix never)                                            | 15, 18                                                                                                                                                                                     |
| §3.3 Coach `recipe_request` + classifyTurn after a card                                                                | 19, 15, 20                                                                                                                                                                                 |
| §3.3 retire `search_recipes` (flag on only)                                                                            | 21                                                                                                                                                                                         |
| §3.4 structured actions, server derives step, never from route params                                                  | 5, 14, 18                                                                                                                                                                                  |
| §4 one clarifying round; stale flowId; idempotent repeat; typed input; relative threshold + floor                      | 14, 15, 16, 18, 9, 10                                                                                                                                                                      |
| §5 shared components; RecipeCard reused in Coach; row/button/placeholder design; clarifying chips; progress text; a11y | 22–30                                                                                                                                                                                      |
| §6 each failure row                                                                                                    | 8 (extractQuery), 9 (index not ready), 11 (402/error/timeout, key unset), 14 (unavailable/no-match), 16 + 17 (cap, limit), 12 (clarify), 18 (generation failure keeps existing error path) |
| §6 premium per action (lock + upgrade)                                                                                 | 17 (server), 22, 25, 27, 29 (client locks)                                                                                                                                                 |
| §7 transition table first                                                                                              | 14                                                                                                                                                                                         |
| §7 step fallbacks forced                                                                                               | 8, 9, 11, 12, 13                                                                                                                                                                           |
| §7 close-match gold set                                                                                                | 10                                                                                                                                                                                         |
| §7 classifyTurn gold set + forced fallback                                                                             | 13                                                                                                                                                                                         |
| §7 routes: each action, premium allow/deny, cap                                                                        | 18, 20, 17                                                                                                                                                                                 |
| §7 client: list, chips, both chats same component                                                                      | 23, 24, 30                                                                                                                                                                                 |
| §7 device Maestro                                                                                                      | 31                                                                                                                                                                                         |
| §8 rollout (flag default off; client via OTA; flip in Railway)                                                         | 6, PR B/C/D headers, 32                                                                                                                                                                    |
| R1 catalog preview                                                                                                     | 1–4                                                                                                                                                                                        |
| R2 delivery per chat + `finderAction` + quota trap                                                                     | 18, 20, 26, 28                                                                                                                                                                             |
| R3 `includeScores`; cuisine into q; never maxPrepTime                                                                  | 7, 9                                                                                                                                                                                       |
| R4 intent placement, eval expectations, "meal ideas", template list                                                    | 19                                                                                                                                                                                         |
| R5 Coach save via top-level metadata                                                                                   | 20, 29                                                                                                                                                                                     |
| R6 Coach block registration + BlockRenderer                                                                            | 5, 29                                                                                                                                                                                      |

### Placeholder scan

No "TBD"/"similar to Task N". Two items are data the executor must produce, with a fixed procedure: the gold-set ids (Task 10, from the exported fixture) and the measured `classifyTurn` accuracy (Task 13, needs a live key). Task 31's selectors are verified on-device first (Step 1) because four of them are rendered by screens whose exact runtime text only a live `inspect_screen` confirms.

### Type consistency

`FinderBlock`/`FinderAction`/`FinderFlow`/`FinderItem`/`FinderButton` come only from `shared/schemas/recipe-finder.ts` (Task 5). `FinderInput`/`FinderStep`/`FinderCtx`/`FinderOutcome` only from `transition.ts` (Task 14). `FinderFeatures`/`FinderTurnContext`/`FinderTurnResult` only from `run-turn.ts` (Task 17). `GenerationMessages` only from `generate.ts`. `CoachFinderTurnEntry` only from `coach-turn.ts`. Storage names (`createFinderUserMessage`, `claimRecipeGeneration`, `claimSpoonacularSearch`) match between Tasks 16, 17, 18, 20.

## Spec deviations

1. **Production has no Spoonacular list cache.** Spec §3.1/§6 say `findOnline` "goes through the existing `cachedFetch` 60-min cache". `cachedFetch` (`server/services/dev-api-cache.ts`) is a dev-only record/replay cache — a bare `fetch` passthrough in production. The only 60-minute cache is the _detail_ cache in `recipe-catalog.ts`. So repeat finder list searches each cost a Spoonacular point in production; the DB-backed per-user cap (D9) is the only bound. Not changed (out of scope); flagged for the PR.
2. **Cap record = a marker on the tap's user row, not a count of `recipe_results` assistant messages** (Task 16). The spec offered "count today's spoonacular `recipe_results` messages (no migration)" vs a table; that count cannot be reserved before the Spoonacular call, so it is not atomic. Still no migration.
3. **Block state field is `flow`, and it carries `request`.** §3.2 names the state `finder: {flowId, stage, query, round, shownIds}`. The block's state field is named `flow` (RecipeChef metadata is `{metadataVersion: 1, finder: <block>}` so `finder.finder` would be ambiguous), and it adds `request` (the original request plus refinements/answers) because §4's `extractQuery(request + answers)` and Generate both need the text, which `query` alone loses.
4. **flowId is per finder message, not per flow.** Needed so "only the latest message's buttons are active" and "a repeated action is idempotent" both hold when one flow has two _None of these_ taps (round 0 and round 1).
5. **The pure transition is two functions** (`planFinderStep`, `finderOutcome`) rather than one `(state, input, stepResults) → next`; together they are the same table, split at the I/O boundary.
6. **Coach runs `classifyTurn` only while the generated card is the latest assistant message**; RecipeChef runs it whenever a card exists (as specified). Reason: `classifyTurn`'s `new_request` fallback would otherwise turn later, unrelated Coach questions into recipe lists on any AI hiccup.
7. **Coach `refine_current` regenerates a new card** (claiming a generation) — Coach has no in-place card; RecipeChef's legacy refinement already counts as a generation today.
8. **Coach's generated card appears on the post-`done` refetch**, not as a live event, so no new `CoachChatEvent` type is needed (the route ternary's `{blocks}` fallback arm is untouched). The thinking bubble shows "Creating your recipe…" meanwhile.
9. **`finderAction` with the flag off, on remix, or on free Coach → `409 CONFLICT`** (spec silent).
10. **A malformed Spoonacular payload reads as "no matches".** `searchCatalogRecipes` returns an empty result on a Zod parse failure without throwing, so `findOnline` cannot tell it from a genuine empty result; 402/network/timeout are correctly "unavailable".
11. **§10 says detail screens are out of scope; R1 (binding) requires the `FeaturedRecipeDetailScreen` catalog branch.** R1 wins; the change is limited to that branch.
12. **Spec §8 "PR 0" (recipe image: server writes `metadata.imageUrl`, RecipeChef's card reads `metadata.recipe.imageUrl`) is not one of this plan's PR groups** (the dispatch defined A–D). Coach's new generated card (Task 29) reads the top-level `imageUrl`, so it is unaffected; RecipeChef's card is still affected until PR 0 ships separately.
13. **"Eval dataset expectations" live in the classifier test's `EXPECTED` map** — `evals/datasets/coach-cases.json` has no intent field, and the eval runner calls `generateCoachResponse` directly (whose fallback self-classification now skips `recipe_request`), so eval prompts are unchanged.
14. Coach finder button taps count against the Coach Pro daily _message_ limit like any Coach message (the spec constrains only the recipe-generation limit); adding `recipe_request` to the template-version list changes the hash once, invalidating free-tier cached answers once.
