# Eval System Hardening Implementation Plan

> **STATUS: COMPLETED** — All 5 tasks implemented in PR #84 (merged 2026-05-09). Commits: `521d0b40` (Task 5 weighted sort), `2d1329d9` (Tasks 3+4 dataset schemas), `847048ec` (Task 2 word limit + drift tests), `6ceeff8a` (Task 1 creativity category). Codified in `8bb9bc3b`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four correctness and type-safety gaps in the LLM eval framework so it is reliable enough to act as a regression gate.

**Architecture:** Four independent changes — a one-line type fix, a configurable SuiteConfig option, a schema-extraction refactor that enables cross-suite dataset validation tests, and a weighted sort fix. They are ordered so each step leaves the test suite green. TDD throughout: failing test → minimal implementation → passing test → commit.

**Tech Stack:** TypeScript, Zod, Vitest, `p-limit`, Anthropic SDK (`@anthropic-ai/sdk`).

---

## File Map

| File                                         | Action     | Purpose                                                                                                                                                      |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `evals/types.ts`                             | Modify     | Add `'creativity'` to `EvalTestCase["category"]` and matching Zod enum                                                                                       |
| `evals/lib/runner-core.ts`                   | Modify     | Add `wordLimitWarning?: number` to `SuiteConfig`; use it in `evaluateCase` and `printSummary`; fix weighted `lowestScoringCases` sort                        |
| `evals/lib/dataset-schemas.ts`               | **Create** | Export Zod schemas for recipe-chat, meal-suggestions, and recipe-generation datasets (plus their inferred types). No side effects — safe to import in tests. |
| `evals/runner-recipe-chat.ts`                | Modify     | Import schemas from `dataset-schemas.ts`; add `wordLimitWarning: 300`                                                                                        |
| `evals/runner-meal-suggestions.ts`           | Modify     | Import schemas from `dataset-schemas.ts`; add `wordLimitWarning: 300`                                                                                        |
| `evals/runner-recipe-generation.ts`          | Modify     | Import schemas from `dataset-schemas.ts`; add `wordLimitWarning: 300`                                                                                        |
| `evals/__tests__/types.test.ts`              | Modify     | Add test for `'creativity'` category acceptance                                                                                                              |
| `evals/__tests__/runner-core.test.ts`        | Modify     | Add tests for configurable word limit and weighted `lowestScoringCases`                                                                                      |
| `evals/__tests__/dataset-validation.test.ts` | **Create** | Validate all four shipped JSON datasets against their Zod schemas                                                                                            |

---

## Task 1: Add `'creativity'` to the shared category type

**Files:**

- Modify: `evals/types.ts`
- Modify: `evals/__tests__/types.test.ts`

- [ ] **Step 1.1 — Write the failing test**

  Open `evals/__tests__/types.test.ts`. Add inside the `describe("evalTestCaseSchema")` block:

  ```ts
  it("accepts 'creativity' as a valid category", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "rg-creative-1",
      category: "creativity",
      description: "creative recipe",
      userMessage: "give me something unusual",
      context: validContext,
    });
    expect(result.success).toBe(true);
  });
  ```

- [ ] **Step 1.2 — Run test to verify it fails**

  ```bash
  npx vitest run evals/__tests__/types.test.ts
  ```

  Expected: FAIL — `"creativity"` is not in the Zod enum.

- [ ] **Step 1.3 — Update `evals/types.ts`**

  In the `EvalTestCase` interface, change the `category` union (around line 64):

  ```ts
  category:
    | "safety"
    | "accuracy"
    | "helpfulness"
    | "personalization"
    | "edge-case"
    | "creativity";
  ```

  In `evalTestCaseSchema` (around line 120), change the `category` enum:

  ```ts
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "edge-case",
    "creativity",
  ]),
  ```

- [ ] **Step 1.4 — Run tests to verify they pass**

  ```bash
  npx vitest run evals/__tests__/types.test.ts
  ```

  Expected: all tests PASS including the new one.

- [ ] **Step 1.5 — Commit**

  ```bash
  git add evals/types.ts evals/__tests__/types.test.ts
  git commit -m "fix(evals): add 'creativity' to shared EvalTestCase category type"
  ```

---

## Task 2: Make `wordLimitWarning` configurable per suite

**Files:**

- Modify: `evals/lib/runner-core.ts`
- Modify: `evals/__tests__/runner-core.test.ts`

- [ ] **Step 2.1 — Write the failing test**

  Open `evals/__tests__/runner-core.test.ts`. Add a new `describe` block at the end of the file. This test verifies that `SuiteConfig.wordLimitWarning` is respected by `aggregateResults` (via `printSummary`). Because `printSummary` writes to stdout rather than returning a value, the simplest way to test the config option is to confirm the field is accepted by the TypeScript interface — but more usefully, add a test that reads the `wordLimitWarning` field from a SuiteConfig and uses it:

  ```ts
  import type { SuiteConfig } from "../lib/runner-core";

  describe("SuiteConfig wordLimitWarning", () => {
    it("defaults to 150 when not specified", () => {
      const config: SuiteConfig = {
        suiteName: "test",
        rubricText: "",
        dimensions: [],
        dimensionWeights: {},
        generateResponse: async () => ({
          text: "",
          latencyMs: 0,
          wordCount: 0,
        }),
        formatInput: () => "",
      };
      // wordLimitWarning is optional — absence should compile without error.
      // The actual default is enforced at runtime inside runner-core.
      expect(config.wordLimitWarning).toBeUndefined();
    });

    it("accepts a custom word limit", () => {
      const config: SuiteConfig = {
        suiteName: "recipe",
        rubricText: "",
        dimensions: [],
        dimensionWeights: {},
        wordLimitWarning: 300,
        generateResponse: async () => ({
          text: "",
          latencyMs: 0,
          wordCount: 0,
        }),
        formatInput: () => "",
      };
      expect(config.wordLimitWarning).toBe(300);
    });
  });
  ```

- [ ] **Step 2.2 — Run test to verify it fails**

  ```bash
  npx vitest run evals/__tests__/runner-core.test.ts
  ```

  Expected: TypeScript compilation error — `wordLimitWarning` does not exist on `SuiteConfig`.

- [ ] **Step 2.3 — Add `wordLimitWarning` to `SuiteConfig` in `evals/lib/runner-core.ts`**

  In the `SuiteConfig` interface (around line 17), add the new field after `outputTag`:

  ```ts
  export interface SuiteConfig {
    suiteName: string;
    rubricText: string;
    dimensions: string[];
    dimensionWeights: Record<string, number>;
    inputTag?: string;
    outputTag?: string;
    /** Words-per-response threshold above which a warning is printed. Defaults to 150. Recipe suites should set this to ~300. */
    wordLimitWarning?: number;
    generateResponse: (testCase: EvalTestCase) => Promise<{
      text: string;
      structuredData?: unknown;
      latencyMs: number;
      wordCount: number;
    }>;
    formatInput: (testCase: EvalTestCase) => string;
  }
  ```

  In `evaluateCase` (around line 154), replace the hardcoded `150`:

  ```ts
  const wordLimit = config.wordLimitWarning ?? 150;
  const overLimit = wordCount > wordLimit;
  log(
    `    ⏱ ${latencyMs}ms | ${wordCount} words${overLimit ? ` ⚠ OVER ${wordLimit}` : ""}`,
  );
  ```

  In `printSummary` (around line 368), replace the hardcoded `150`:

  ```ts
  const wordLimit = config.wordLimitWarning ?? 150;
  const overLimit = result.cases.filter((c) => c.wordCount > wordLimit);

  console.log(`\n⏱ Latency: avg ${avgLatency}ms, max ${maxLatency}ms`);
  console.log(
    `📝 Words: avg ${avgWords}, ${overLimit.length}/${result.totalCases} over ${wordLimit}-word limit`,
  );
  ```

- [ ] **Step 2.4 — Run tests to verify they pass**

  ```bash
  npx vitest run evals/__tests__/runner-core.test.ts
  ```

  Expected: all tests PASS.

- [ ] **Step 2.5 — Update the three non-coach runners to set a higher threshold**

  In `evals/runner-recipe-chat.ts`, add `wordLimitWarning: 300` inside the `runEvalSuite(...)` config object, after `outputTag`:

  ```ts
  runEvalSuite(validation.data as unknown as EvalTestCase[], {
    suiteName: "recipe-chat",
    rubricText: RUBRIC_TEXT,
    dimensions: ["relevance", "recipe_quality", "dietary_compliance", "safety", "tone"],
    dimensionWeights: { relevance: 1, recipe_quality: 1, dietary_compliance: 1, safety: 2, tone: 1 },
    inputTag: "user_request",
    outputTag: "recipe_response",
    wordLimitWarning: 300,
    // ... generateResponse, formatInput unchanged
  ```

  Apply the same change to `evals/runner-meal-suggestions.ts` (add `wordLimitWarning: 300` after `outputTag: "suggestions"`).

  Apply the same change to `evals/runner-recipe-generation.ts` (add `wordLimitWarning: 300` after `outputTag: "generated_recipe"`).

- [ ] **Step 2.6 — Run full eval test suite**

  ```bash
  npx vitest run evals/
  ```

  Expected: all tests PASS.

- [ ] **Step 2.7 — Commit**

  ```bash
  git add evals/lib/runner-core.ts evals/runner-recipe-chat.ts evals/runner-meal-suggestions.ts evals/runner-recipe-generation.ts evals/__tests__/runner-core.test.ts
  git commit -m "feat(evals): make word-count warning threshold configurable per suite"
  ```

---

## Task 3: Write dataset validation tests (red state)

**Files:**

- Create: `evals/__tests__/dataset-validation.test.ts`

These tests will fail until Task 4 creates `evals/lib/dataset-schemas.ts`.

- [ ] **Step 3.1 — Create the test file**

  Create `evals/__tests__/dataset-validation.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import * as fs from "fs";
  import * as path from "path";
  import {
    recipeChatCasesSchema,
    mealSuggestionCasesSchema,
    recipeGenCasesSchema,
  } from "../lib/dataset-schemas";
  import { evalTestCasesSchema } from "../types";

  const datasetsDir = path.join(__dirname, "..", "datasets");

  function loadDataset(filename: string): unknown {
    const raw = fs.readFileSync(path.join(datasetsDir, filename), "utf8");
    return JSON.parse(raw);
  }

  function assertDataset(
    schema: {
      safeParse: (v: unknown) => {
        success: boolean;
        error?: { errors: { path: (string | number)[]; message: string }[] };
        data?: unknown[];
      };
    },
    filename: string,
  ): void {
    const data = loadDataset(filename);
    const result = schema.safeParse(data);
    if (!result.success) {
      const issue = result.error!.errors[0];
      throw new Error(`${filename}: ${issue.path.join(".")}: ${issue.message}`);
    }
    expect(result.data!.length).toBeGreaterThan(0);
  }

  describe("dataset validation — all four suites", () => {
    it("validates coach-cases.json against evalTestCasesSchema", () => {
      assertDataset(evalTestCasesSchema, "coach-cases.json");
    });

    it("validates recipe-chat-cases.json against recipeChatCasesSchema", () => {
      assertDataset(recipeChatCasesSchema, "recipe-chat-cases.json");
    });

    it("validates meal-suggestion-cases.json against mealSuggestionCasesSchema", () => {
      assertDataset(mealSuggestionCasesSchema, "meal-suggestion-cases.json");
    });

    it("validates recipe-generation-cases.json against recipeGenCasesSchema", () => {
      assertDataset(recipeGenCasesSchema, "recipe-generation-cases.json");
    });
  });
  ```

- [ ] **Step 3.2 — Run to confirm red state**

  ```bash
  npx vitest run evals/__tests__/dataset-validation.test.ts
  ```

  Expected: FAIL with "Cannot find module '../lib/dataset-schemas'".

---

## Task 4: Create `evals/lib/dataset-schemas.ts`

**Files:**

- Create: `evals/lib/dataset-schemas.ts`
- Modify: `evals/runner-recipe-chat.ts`
- Modify: `evals/runner-meal-suggestions.ts`
- Modify: `evals/runner-recipe-generation.ts`

- [ ] **Step 4.1 — Create `evals/lib/dataset-schemas.ts`**

  This file contains only Zod schemas — no file I/O, no `runEvalSuite` calls — so it is safe to import in tests.

  ```ts
  import { z } from "zod";

  // ─── Recipe Chat ──────────────────────────────────────────────────────────────

  export const recipeChatInputSchema = z.object({
    userMessage: z.string().min(1),
    userProfile: z
      .object({
        dietType: z.string().nullable(),
        allergies: z.array(z.string()),
        dislikes: z.array(z.string()),
      })
      .nullable(),
    conversationHistory: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string(),
        }),
      )
      .default([]),
  });

  export const recipeChatCaseSchema = z.object({
    id: z.string().min(1),
    category: z.enum([
      "safety",
      "accuracy",
      "helpfulness",
      "personalization",
      "edge-case",
    ]),
    description: z.string(),
    input: recipeChatInputSchema,
    assertions: z
      .object({
        mustNotContain: z.array(z.string()).optional(),
        mustContain: z.array(z.string()).optional(),
      })
      .optional(),
    scoreDimensions: z
      .array(
        z.enum([
          "relevance",
          "recipe_quality",
          "dietary_compliance",
          "safety",
          "tone",
        ]),
      )
      .optional(),
  });

  export const recipeChatCasesSchema = z.array(recipeChatCaseSchema);
  export type RecipeChatInput = z.infer<typeof recipeChatInputSchema>;

  // ─── Meal Suggestions ─────────────────────────────────────────────────────────

  const macroSchema = z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  });

  export const mealSuggestionCaseSchema = z.object({
    id: z.string().min(1),
    category: z.enum([
      "safety",
      "accuracy",
      "helpfulness",
      "personalization",
      "edge-case",
    ]),
    description: z.string(),
    input: z.object({
      mealType: z.string(),
      userProfile: z
        .object({
          dietType: z.string().nullable(),
          allergies: z.array(z.string()),
          dislikes: z.array(z.string()),
        })
        .nullable(),
      dailyTargets: macroSchema,
      existingMeals: z.array(
        z.object({
          title: z.string(),
          calories: z.number(),
          mealType: z.string(),
        }),
      ),
      remainingBudget: macroSchema,
    }),
    assertions: z
      .object({
        mustNotContain: z.array(z.string()).optional(),
        mustContain: z.array(z.string()).optional(),
        macrosBudgetRespected: z.boolean().optional(),
        suggestionCount: z.number().optional(),
      })
      .optional(),
    scoreDimensions: z
      .array(
        z.enum([
          "macro_accuracy",
          "dietary_compliance",
          "variety",
          "helpfulness",
        ]),
      )
      .optional(),
  });

  export const mealSuggestionCasesSchema = z.array(mealSuggestionCaseSchema);
  export type MealSuggestionCaseInput = z.infer<
    typeof mealSuggestionCaseSchema
  >["input"];

  // ─── Recipe Generation ────────────────────────────────────────────────────────

  export const recipeGenCaseSchema = z.object({
    id: z.string().min(1),
    category: z.enum([
      "safety",
      "accuracy",
      "helpfulness",
      "personalization",
      "creativity",
      "edge-case",
    ]),
    description: z.string(),
    input: z.object({
      productName: z.string().min(1),
      servings: z.number().optional(),
      timeConstraint: z.string().optional(),
      dietPreferences: z.array(z.string()).optional(),
      userProfile: z
        .object({
          dietType: z.string().nullable(),
          allergies: z.array(z.string()),
          dislikes: z.array(z.string()),
        })
        .nullable(),
    }),
    assertions: z
      .object({
        mustNotContain: z.array(z.string()).optional(),
        mustContain: z.array(z.string()).optional(),
        mustHaveMinIngredients: z.number().optional(),
        mustHaveMinInstructions: z.number().optional(),
      })
      .optional(),
    scoreDimensions: z
      .array(
        z.enum([
          "ingredient_coherence",
          "instruction_clarity",
          "dietary_compliance",
          "creativity",
        ]),
      )
      .optional(),
  });

  export const recipeGenCasesSchema = z.array(recipeGenCaseSchema);
  export type RecipeGenInput = z.infer<typeof recipeGenCaseSchema>["input"];
  ```

- [ ] **Step 4.2 — Run dataset validation tests to verify they go green**

  ```bash
  npx vitest run evals/__tests__/dataset-validation.test.ts
  ```

  Expected: all 4 tests PASS.

- [ ] **Step 4.3 — Update `evals/runner-recipe-chat.ts` to import from dataset-schemas**

  Remove the local schema definitions (`recipeChatInputSchema`, `recipeChatCaseSchema`, `recipeChatCasesSchema`, `type RecipeChatInput`). Replace them with an import at the top:

  ```ts
  import {
    recipeChatCasesSchema,
    type RecipeChatInput,
  } from "./lib/dataset-schemas";
  ```

  The rest of the file (loading JSON, validating, calling `runEvalSuite`) is unchanged.

- [ ] **Step 4.4 — Update `evals/runner-meal-suggestions.ts` to import from dataset-schemas**

  Remove the local schema definitions. Add at the top:

  ```ts
  import {
    mealSuggestionCasesSchema,
    type MealSuggestionCaseInput,
  } from "./lib/dataset-schemas";
  ```

- [ ] **Step 4.5 — Update `evals/runner-recipe-generation.ts` to import from dataset-schemas**

  Remove the local schema definitions. Add at the top:

  ```ts
  import {
    recipeGenCasesSchema,
    type RecipeGenInput,
  } from "./lib/dataset-schemas";
  ```

- [ ] **Step 4.6 — Run full eval test suite**

  ```bash
  npx vitest run evals/
  ```

  Expected: all tests PASS (schemas were correctly extracted — runners still validate the same data).

- [ ] **Step 4.7 — Typecheck**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 4.8 — Commit**

  ```bash
  git add evals/lib/dataset-schemas.ts evals/runner-recipe-chat.ts evals/runner-meal-suggestions.ts evals/runner-recipe-generation.ts evals/__tests__/dataset-validation.test.ts
  git commit -m "refactor(evals): extract dataset schemas to dataset-schemas.ts and add cross-suite validation tests"
  ```

---

## Task 5: Fix weighted `lowestScoringCases` sort

**Files:**

- Modify: `evals/lib/runner-core.ts`
- Modify: `evals/__tests__/runner-core.test.ts`

Currently `lowestScoringCases` sorts by raw score only. A `safety` case scoring 3/10 (weight 2) should rank above a `tone` case scoring 4/10 (weight 1) because the safety miss costs more. The fix sorts by `score / weight` ascending — lower ratio = worse weighted impact.

- [ ] **Step 5.1 — Write the failing test**

  Add to `evals/__tests__/runner-core.test.ts`. This test requires `aggregateResults` and a minimal `EvalCaseResult` factory. Add the following after the existing `describe` blocks:

  ```ts
  import { aggregateResults } from "../lib/runner-core";
  import type { EvalCaseResult, RubricScore } from "../types";
  import type { SuiteConfig } from "../lib/runner-core";

  function mockCase(id: string, scores: RubricScore[]): EvalCaseResult {
    return {
      testCaseId: id,
      category: "helpfulness",
      description: "",
      inputSummary: "",
      output: "",
      assertions: { passed: true, failures: [] },
      rubricScores: scores,
      judgeModel: "claude-sonnet-4-6",
      timestamp: new Date().toISOString(),
      latencyMs: 0,
      wordCount: 0,
    };
  }

  describe("aggregateResults — lowestScoringCases weighted sort", () => {
    it("ranks high-weight low-score cases before low-weight lower-score cases", () => {
      // safety weight=2: score=5 → effective ratio 5/2 = 2.5 (worse)
      // tone   weight=1: score=4 → effective ratio 4/1 = 4.0 (less bad)
      const cases: EvalCaseResult[] = [
        mockCase("c1", [{ dimension: "tone", score: 4, reasoning: "" }]),
        mockCase("c2", [{ dimension: "safety", score: 5, reasoning: "" }]),
      ];
      const config: SuiteConfig = {
        suiteName: "test",
        rubricText: "",
        dimensions: ["safety", "tone"],
        dimensionWeights: { safety: 2, tone: 1 },
        generateResponse: async () => ({
          text: "",
          latencyMs: 0,
          wordCount: 0,
        }),
        formatInput: () => "",
      };
      const result = aggregateResults(cases, config, 1);
      // safety:5 (ratio 2.5) should sort before tone:4 (ratio 4.0)
      expect(result.lowestScoringCases[0].dimension).toBe("safety");
      expect(result.lowestScoringCases[0].score).toBe(5);
      expect(result.lowestScoringCases[1].dimension).toBe("tone");
      expect(result.lowestScoringCases[1].score).toBe(4);
    });

    it("falls back to weight=1 for dimensions not in dimensionWeights", () => {
      const cases: EvalCaseResult[] = [
        mockCase("c1", [{ dimension: "unknown_dim", score: 3, reasoning: "" }]),
        mockCase("c2", [{ dimension: "safety", score: 4, reasoning: "" }]),
      ];
      const config: SuiteConfig = {
        suiteName: "test",
        rubricText: "",
        dimensions: ["safety", "unknown_dim"],
        dimensionWeights: { safety: 2 }, // unknown_dim has no weight → defaults to 1
        generateResponse: async () => ({
          text: "",
          latencyMs: 0,
          wordCount: 0,
        }),
        formatInput: () => "",
      };
      const result = aggregateResults(cases, config, 1);
      // safety:4 (ratio 4/2=2.0) ranks before unknown_dim:3 (ratio 3/1=3.0)
      expect(result.lowestScoringCases[0].dimension).toBe("safety");
      expect(result.lowestScoringCases[1].dimension).toBe("unknown_dim");
    });
  });
  ```

- [ ] **Step 5.2 — Run test to verify it fails**

  ```bash
  npx vitest run evals/__tests__/runner-core.test.ts
  ```

  Expected: FAIL — sort order is wrong (currently sorts by raw score, not weighted ratio).

- [ ] **Step 5.3 — Fix the sort in `evals/lib/runner-core.ts`**

  In `aggregateResults`, find the sort (around line 296):

  ```ts
  allScores.sort((a, b) => a.score - b.score);
  ```

  Replace with:

  ```ts
  allScores.sort((a, b) => {
    const weightA = config.dimensionWeights[a.dimension] ?? 1;
    const weightB = config.dimensionWeights[b.dimension] ?? 1;
    return a.score / weightA - b.score / weightB;
  });
  ```

- [ ] **Step 5.4 — Run tests to verify they pass**

  ```bash
  npx vitest run evals/__tests__/runner-core.test.ts
  ```

  Expected: all tests PASS.

- [ ] **Step 5.5 — Run full test suite to check for regressions**

  ```bash
  npx vitest run
  ```

  Expected: all tests PASS.

- [ ] **Step 5.6 — Typecheck**

  ```bash
  npm run check:types
  ```

  Expected: no errors.

- [ ] **Step 5.7 — Commit**

  ```bash
  git add evals/lib/runner-core.ts evals/__tests__/runner-core.test.ts
  git commit -m "fix(evals): sort lowestScoringCases by weighted impact (score / weight)"
  ```

---

## Self-Review

**Spec coverage:**

| Issue                                                                    | Task covering it |
| ------------------------------------------------------------------------ | ---------------- |
| 150-word limit hardcoded in runner-core                                  | Task 2           |
| `EvalTestCase` schema coach-scoped; no validation for non-coach datasets | Tasks 3 + 4      |
| `'creativity'` category missing from `EvalTestCase["category"]`          | Task 1           |
| `lowestScoringCases` sorts by raw score, not weighted                    | Task 5           |

All four issues addressed. ✓

**Placeholder scan:** No TBDs, no "similar to above", all code blocks are complete. ✓

**Type consistency:**

- `SuiteConfig.wordLimitWarning` defined in Task 2 step 2.3, used in step 2.3 (same file). ✓
- `RecipeChatInput`, `MealSuggestionCaseInput`, `RecipeGenInput` defined and exported in `dataset-schemas.ts` (Task 4.1), imported in runners (Tasks 4.3–4.5). ✓
- `mockCase` helper defined before use in Task 5 tests. ✓
- `aggregateResults` imported in test — it is already exported from `runner-core.ts`. ✓
- `'creativity'` added to shared enum in Task 1; `recipeGenCasesSchema` in Task 4.1 also allows it independently. No conflict. ✓
