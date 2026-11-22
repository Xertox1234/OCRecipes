# Recipe Quality Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up junk recipes, enforce quality validation on all creation paths, normalize recipe data formatting, add ingredient icons to all ingredient-rendering screens, and auto-generate images for imageless recipes.

**Architecture:** Three-layer approach — (1) cleanup + server/client validation gates, (2) data normalization utilities applied at route level, (3) visual consistency with IngredientIcon and auto image generation. Each layer builds on the previous.

**Tech Stack:** TypeScript, Vitest, Express routes, Drizzle ORM, React Native, Runware/DALL-E image generation

**Spec:** `docs/superpowers/specs/2026-04-08-recipe-quality-standards-design.md`

---

## File Structure

### New Files

- `server/lib/recipe-validation.ts` — shared quality gate function
- `server/lib/__tests__/recipe-validation.test.ts` — validation tests
- `server/lib/recipe-normalization.ts` — title case, unit standardization, instruction formatting, ingredient splitting
- `server/lib/__tests__/recipe-normalization.test.ts` — normalization tests
- `scripts/cleanup-junk-recipes.ts` — one-time junk deletion
- `scripts/backfill-recipe-images.ts` — one-time image generation for imageless recipes

### Modified Files

- `server/routes/meal-plan.ts` — apply validation + normalization to POST `/api/meal-plan/recipes`
- `server/routes/recipes.ts` — apply validation + normalization to generate, import, catalog save routes
- `client/screens/meal-plan/RecipeCreateScreen.tsx` — strengthen client validation
- `client/components/recipe-builder/IngredientsSheet.tsx` — add IngredientIcon next to each row
- `client/screens/meal-plan/RecipePhotoImportScreen.tsx` — add IngredientIcon to ingredient preview
- `client/screens/meal-plan/ReceiptMealPlanScreen.tsx` — add IngredientIcon to ingredient list

---

## Task 1: Recipe Validation Utility (TDD)

**Files:**

- Create: `server/lib/recipe-validation.ts`
- Create: `server/lib/__tests__/recipe-validation.test.ts`

- [ ] **Step 1: Write failing tests for recipe validation**

```typescript
// server/lib/__tests__/recipe-validation.test.ts
import { describe, it, expect } from "vitest";
import { validateRecipeQuality } from "../recipe-validation";

describe("validateRecipeQuality", () => {
  it("accepts a recipe with title, instructions, and ingredients", () => {
    const result = validateRecipeQuality({
      title: "Chicken Parmesan",
      instructions: ["Preheat oven to 375F", "Season chicken"],
      ingredients: [{ name: "chicken breast" }],
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts a recipe with title and at least 1 instruction (no ingredients)", () => {
    const result = validateRecipeQuality({
      title: "Simple Toast",
      instructions: ["Toast the bread"],
      ingredients: [],
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts a recipe with title and at least 1 ingredient (no instructions)", () => {
    const result = validateRecipeQuality({
      title: "Simple Salad",
      instructions: [],
      ingredients: [{ name: "lettuce" }],
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a title shorter than 3 characters", () => {
    const result = validateRecipeQuality({
      title: "ab",
      instructions: ["Do something"],
      ingredients: [{ name: "flour" }],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/title/i);
  });

  it("rejects an empty title", () => {
    const result = validateRecipeQuality({
      title: "",
      instructions: ["Do something"],
      ingredients: [{ name: "flour" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    const result = validateRecipeQuality({
      title: "   ",
      instructions: ["Do something"],
      ingredients: [{ name: "flour" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects when both instructions and ingredients are empty", () => {
    const result = validateRecipeQuality({
      title: "Empty Recipe",
      instructions: [],
      ingredients: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ingredient|instruction/i);
  });

  it("rejects when both instructions and ingredients are null", () => {
    const result = validateRecipeQuality({
      title: "Null Recipe",
      instructions: null,
      ingredients: null,
    });
    expect(result.valid).toBe(false);
  });

  it("filters out whitespace-only instructions before checking", () => {
    const result = validateRecipeQuality({
      title: "Bad Instructions",
      instructions: ["   ", "", "  "],
      ingredients: [],
    });
    expect(result.valid).toBe(false);
  });

  it("filters out empty-name ingredients before checking", () => {
    const result = validateRecipeQuality({
      title: "Bad Ingredients",
      instructions: [],
      ingredients: [{ name: "" }, { name: "   " }],
    });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/lib/__tests__/recipe-validation.test.ts`
Expected: FAIL — module `../recipe-validation` not found

- [ ] **Step 3: Implement the validation function**

```typescript
// server/lib/recipe-validation.ts

export interface RecipeQualityInput {
  title: string;
  instructions?: string[] | null;
  ingredients?: { name: string }[] | null;
}

export interface RecipeQualityResult {
  valid: boolean;
  reason?: string;
}

const MIN_TITLE_LENGTH = 3;

export function validateRecipeQuality(
  input: RecipeQualityInput,
): RecipeQualityResult {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length < MIN_TITLE_LENGTH) {
    return {
      valid: false,
      reason: `Recipe title must be at least ${MIN_TITLE_LENGTH} characters`,
    };
  }

  const validInstructions = (input.instructions ?? []).filter(
    (s) => s.trim().length > 0,
  );
  const validIngredients = (input.ingredients ?? []).filter(
    (i) => i.name.trim().length > 0,
  );

  if (validInstructions.length === 0 && validIngredients.length === 0) {
    return {
      valid: false,
      reason:
        "Recipe must have at least one ingredient or one instruction step",
    };
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/lib/__tests__/recipe-validation.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/recipe-validation.ts server/lib/__tests__/recipe-validation.test.ts
git commit -m "feat: add shared recipe quality validation utility"
```

---

## Task 2: Recipe Normalization Utility (TDD)

**Files:**

- Create: `server/lib/recipe-normalization.ts`
- Create: `server/lib/__tests__/recipe-normalization.test.ts`

- [ ] **Step 1: Write failing tests for normalization**

```typescript
// server/lib/__tests__/recipe-normalization.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeDifficulty,
  normalizeInstructions,
  normalizeIngredient,
  normalizeUnit,
} from "../recipe-normalization";

describe("normalizeTitle", () => {
  it("converts to title case", () => {
    expect(normalizeTitle("chicken parmesan")).toBe("Chicken Parmesan");
  });

  it("handles already title-cased input", () => {
    expect(normalizeTitle("Chicken Parmesan")).toBe("Chicken Parmesan");
  });

  it("handles ALL CAPS", () => {
    expect(normalizeTitle("CHICKEN PARMESAN")).toBe("Chicken Parmesan");
  });

  it("preserves short words in the middle", () => {
    expect(normalizeTitle("toast with butter and jam")).toBe(
      "Toast with Butter and Jam",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeTitle("  chicken parmesan  ")).toBe("Chicken Parmesan");
  });
});

describe("normalizeDescription", () => {
  it("capitalizes the first letter", () => {
    expect(normalizeDescription("a delicious meal")).toBe("A delicious meal.");
  });

  it("adds trailing period if missing", () => {
    expect(normalizeDescription("A delicious meal")).toBe("A delicious meal.");
  });

  it("does not double-add period", () => {
    expect(normalizeDescription("A delicious meal.")).toBe("A delicious meal.");
  });

  it("does not add period after question mark", () => {
    expect(normalizeDescription("Ready for dinner?")).toBe("Ready for dinner?");
  });

  it("does not add period after exclamation mark", () => {
    expect(normalizeDescription("So tasty!")).toBe("So tasty!");
  });

  it("returns null for empty/whitespace input", () => {
    expect(normalizeDescription("")).toBeNull();
    expect(normalizeDescription("   ")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeDescription(null)).toBeNull();
  });
});

describe("normalizeDifficulty", () => {
  it('maps "easy" to "Easy"', () => {
    expect(normalizeDifficulty("easy")).toBe("Easy");
  });

  it('maps "beginner" to "Easy"', () => {
    expect(normalizeDifficulty("beginner")).toBe("Easy");
  });

  it('maps "medium" to "Medium"', () => {
    expect(normalizeDifficulty("medium")).toBe("Medium");
  });

  it('maps "moderate" to "Medium"', () => {
    expect(normalizeDifficulty("moderate")).toBe("Medium");
  });

  it('maps "hard" to "Hard"', () => {
    expect(normalizeDifficulty("hard")).toBe("Hard");
  });

  it('maps "advanced" to "Hard"', () => {
    expect(normalizeDifficulty("advanced")).toBe("Hard");
  });

  it("returns null for unrecognized input", () => {
    expect(normalizeDifficulty("impossible")).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(normalizeDifficulty(null)).toBeNull();
    expect(normalizeDifficulty(undefined)).toBeNull();
  });
});

describe("normalizeInstructions", () => {
  it("strips leading numbering", () => {
    expect(
      normalizeInstructions(["1. Preheat oven", "2. Season chicken"]),
    ).toEqual(["Preheat oven", "Season chicken"]);
  });

  it("strips 'Step N:' prefix", () => {
    expect(normalizeInstructions(["Step 1: Preheat oven"])).toEqual([
      "Preheat oven",
    ]);
  });

  it("capitalizes first letter", () => {
    expect(normalizeInstructions(["preheat oven"])).toEqual(["Preheat oven"]);
  });

  it("trims whitespace", () => {
    expect(normalizeInstructions(["  preheat oven  "])).toEqual([
      "Preheat oven",
    ]);
  });

  it("filters out empty steps", () => {
    expect(normalizeInstructions(["Preheat", "", "  ", "Season"])).toEqual([
      "Preheat",
      "Season",
    ]);
  });

  it("returns empty array for null input", () => {
    expect(normalizeInstructions(null)).toEqual([]);
  });
});

describe("normalizeUnit", () => {
  it('normalizes "tablespoon" to "tbsp"', () => {
    expect(normalizeUnit("tablespoon")).toBe("tbsp");
  });

  it('normalizes "Tbsp" to "tbsp"', () => {
    expect(normalizeUnit("Tbsp")).toBe("tbsp");
  });

  it('normalizes "tablespoons" to "tbsp"', () => {
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
  });

  it('normalizes "teaspoon" to "tsp"', () => {
    expect(normalizeUnit("teaspoon")).toBe("tsp");
  });

  it('normalizes "ounce" to "oz"', () => {
    expect(normalizeUnit("ounce")).toBe("oz");
  });

  it('normalizes "ounces" to "oz"', () => {
    expect(normalizeUnit("ounces")).toBe("oz");
  });

  it('normalizes "pound" to "lb"', () => {
    expect(normalizeUnit("pound")).toBe("lb");
  });

  it('normalizes "pounds" to "lb"', () => {
    expect(normalizeUnit("pounds")).toBe("lb");
  });

  it('normalizes "cups" to "cup"', () => {
    expect(normalizeUnit("cups")).toBe("cup");
  });

  it("passes through unknown units unchanged (lowercased)", () => {
    expect(normalizeUnit("pinch")).toBe("pinch");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizeUnit(null)).toBe("");
    expect(normalizeUnit(undefined)).toBe("");
  });
});

describe("normalizeIngredient", () => {
  it("title-cases the name", () => {
    const result = normalizeIngredient({
      name: "chicken breast",
      quantity: "2",
      unit: "lb",
    });
    expect(result.name).toBe("Chicken Breast");
  });

  it("normalizes the unit", () => {
    const result = normalizeIngredient({
      name: "Flour",
      quantity: "2",
      unit: "cups",
    });
    expect(result.unit).toBe("cup");
  });

  it("splits measurement from name field when quantity/unit are empty", () => {
    const result = normalizeIngredient({
      name: "2 cups diced tomatoes",
      quantity: "",
      unit: "",
    });
    expect(result.quantity).toBe("2");
    expect(result.unit).toBe("cup");
    expect(result.name).toBe("Diced Tomatoes");
  });

  it("splits fractional measurement from name field", () => {
    const result = normalizeIngredient({
      name: "1/2 tsp salt",
      quantity: "",
      unit: "",
    });
    expect(result.quantity).toBe("1/2");
    expect(result.unit).toBe("tsp");
    expect(result.name).toBe("Salt");
  });

  it("does not split if quantity is already provided", () => {
    const result = normalizeIngredient({
      name: "2 cups flour",
      quantity: "3",
      unit: "tbsp",
    });
    expect(result.quantity).toBe("3");
    expect(result.unit).toBe("tbsp");
    expect(result.name).toBe("2 Cups Flour");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/lib/__tests__/recipe-normalization.test.ts`
Expected: FAIL — module `../recipe-normalization` not found

- [ ] **Step 3: Implement normalization functions**

```typescript
// server/lib/recipe-normalization.ts

// ── Title Case ──────────────────────────────────────────────────────────────

const LOWERCASE_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "for",
  "nor",
  "on",
  "at",
  "to",
  "in",
  "of",
  "with",
  "by",
  "from",
]);

export function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      i === 0 || !LOWERCASE_WORDS.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word,
    )
    .join(" ");
}

// ── Description ─────────────────────────────────────────────────────────────

export function normalizeDescription(
  desc: string | null | undefined,
): string | null {
  if (!desc || !desc.trim()) return null;
  let result = desc.trim();
  result = result.charAt(0).toUpperCase() + result.slice(1);
  if (!/[.!?]$/.test(result)) {
    result += ".";
  }
  return result;
}

// ── Difficulty ──────────────────────────────────────────────────────────────

const DIFFICULTY_MAP: Record<string, string> = {
  easy: "Easy",
  simple: "Easy",
  beginner: "Easy",
  medium: "Medium",
  moderate: "Medium",
  intermediate: "Medium",
  hard: "Hard",
  difficult: "Hard",
  advanced: "Hard",
  expert: "Hard",
};

export function normalizeDifficulty(
  difficulty: string | null | undefined,
): string | null {
  if (!difficulty) return null;
  return DIFFICULTY_MAP[difficulty.toLowerCase().trim()] ?? null;
}

// ── Instructions ────────────────────────────────────────────────────────────

const STEP_PREFIX_RE = /^\s*(?:\d+[.)]\s*|step\s+\d+[:.]\s*)/i;

export function normalizeInstructions(
  instructions: string[] | null | undefined,
): string[] {
  if (!instructions) return [];
  return instructions
    .map((step) => step.replace(STEP_PREFIX_RE, "").trim())
    .filter((step) => step.length > 0)
    .map((step) => step.charAt(0).toUpperCase() + step.slice(1));
}

// ── Units ───────────────────────────────────────────────────────────────────

const UNIT_MAP: Record<string, string> = {
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  pound: "lb",
  pounds: "lb",
  lb: "lb",
  lbs: "lb",
  cup: "cup",
  cups: "cup",
  gram: "g",
  grams: "g",
  g: "g",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  milliliter: "ml",
  milliliters: "ml",
  ml: "ml",
  liter: "l",
  liters: "l",
  l: "l",
};

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const lower = unit.toLowerCase().trim();
  return UNIT_MAP[lower] ?? lower;
}

// ── Ingredients ─────────────────────────────────────────────────────────────

const MEASUREMENT_RE =
  /^(\d+(?:\/\d+)?(?:\.\d+)?)\s+(tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|cups?|grams?|g|kg|ml|l)\s+(.+)$/i;

export interface IngredientInput {
  name: string;
  quantity: string;
  unit: string;
}

export function normalizeIngredient(ing: IngredientInput): IngredientInput {
  let { name, quantity, unit } = ing;

  // If quantity is empty, try to extract measurement from the name field
  if (!quantity.trim() && !unit.trim()) {
    const match = name.match(MEASUREMENT_RE);
    if (match) {
      quantity = match[1];
      unit = match[2];
      name = match[3];
    }
  }

  return {
    name: normalizeTitle(name),
    quantity: quantity.trim(),
    unit: normalizeUnit(unit),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/lib/__tests__/recipe-normalization.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/recipe-normalization.ts server/lib/__tests__/recipe-normalization.test.ts
git commit -m "feat: add recipe data normalization utilities"
```

---

## Task 3: Apply Validation & Normalization to Manual Create Route

**Files:**

- Modify: `server/routes/meal-plan.ts:27-28` (Zod schema `title` min) and `:124-161` (POST handler)

- [ ] **Step 1: Update Zod schema title minimum length**

In `server/routes/meal-plan.ts`, change:

```typescript
  title: z.string().min(1).max(200),
```

to:

```typescript
  title: z.string().min(3).max(200),
```

- [ ] **Step 2: Add validation and normalization imports**

At the top of `server/routes/meal-plan.ts`, add:

```typescript
import { validateRecipeQuality } from "../lib/recipe-validation";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeDifficulty,
  normalizeInstructions,
  normalizeIngredient,
} from "../lib/recipe-normalization";
```

- [ ] **Step 3: Add quality gate and normalization to the POST handler**

In the POST `/api/meal-plan/recipes` handler, after the Zod parse succeeds (after line ~142 `const { ingredients, sourceType, ...recipeData } = parsed.data;`), add:

```typescript
// Quality gate
const quality = validateRecipeQuality({
  title: recipeData.title,
  instructions: recipeData.instructions,
  ingredients: ingredients ?? null,
});
if (!quality.valid) {
  sendError(res, 400, quality.reason!, ErrorCode.VALIDATION_ERROR);
  return;
}

// Normalize data
recipeData.title = normalizeTitle(recipeData.title);
recipeData.description = normalizeDescription(recipeData.description ?? null);
recipeData.difficulty = normalizeDifficulty(recipeData.difficulty ?? null);
if (recipeData.instructions) {
  recipeData.instructions = normalizeInstructions(recipeData.instructions);
}

const normalizedIngredients = ingredients?.map((ing) =>
  normalizeIngredient({
    name: ing.name,
    quantity: ing.quantity,
    unit: ing.unit,
  }),
);
```

Then update the `storage.createMealPlanRecipe` call to use `normalizedIngredients` instead of `ingredients`:

```typescript
const recipe = await storage.createMealPlanRecipe(
  { ...recipeData, userId: req.userId, sourceType, mealTypes },
  normalizedIngredients?.map((ing) => ({
    ...ing,
    recipeId: 0,
  })),
);
```

- [ ] **Step 4: Run the existing route tests to verify nothing is broken**

Run: `npx vitest run server/routes/__tests__/meal-plan.test.ts`
Expected: All tests PASS (existing tests that submit valid recipes should still work)

- [ ] **Step 5: Commit**

```bash
git add server/routes/meal-plan.ts
git commit -m "feat: apply quality validation and normalization to manual recipe create"
```

---

## Task 4: Apply Validation & Normalization to AI Generate, Import, and Catalog Save Routes

**Files:**

- Modify: `server/routes/recipes.ts:69-75` (Zod schema), `:259-361` (generate handler), `:692-791` (import handler), `:601-689` (catalog save handler)

- [ ] **Step 1: Update Zod schema title minimum**

In `server/routes/recipes.ts`, change `recipeGenerationSchema`:

```typescript
  productName: z.string().min(1).max(200),
```

to:

```typescript
  productName: z.string().min(3).max(200),
```

- [ ] **Step 2: Add imports**

At the top of `server/routes/recipes.ts`, add:

```typescript
import { validateRecipeQuality } from "../lib/recipe-validation";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeDifficulty,
  normalizeInstructions,
  normalizeIngredient,
} from "../lib/recipe-normalization";
```

- [ ] **Step 3: Normalize AI-generated recipe data before saving**

In the POST `/api/recipes/generate` handler, after `const generatedRecipe = await generateFullRecipe(...)` and before `storage.createRecipeWithLimitCheck(...)`, add normalization:

```typescript
// Normalize generated recipe data
generatedRecipe.title = normalizeTitle(generatedRecipe.title);
generatedRecipe.description =
  normalizeDescription(generatedRecipe.description ?? null) ?? undefined;
generatedRecipe.difficulty =
  normalizeDifficulty(generatedRecipe.difficulty ?? null) ?? undefined;
generatedRecipe.instructions = normalizeInstructions(
  generatedRecipe.instructions,
);
if (generatedRecipe.ingredients) {
  generatedRecipe.ingredients = generatedRecipe.ingredients.map((ing) =>
    normalizeIngredient({
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
    }),
  );
}
```

- [ ] **Step 4: Normalize imported recipe data before saving**

In the POST `/api/meal-plan/recipes/import-url` handler, after the quality gate check that already exists and before `const ingredientData = data.ingredients.map(...)`, add:

```typescript
// Normalize imported data
data.title = normalizeTitle(data.title);
data.description = normalizeDescription(data.description ?? null) ?? "";
if (data.instructions) {
  data.instructions = normalizeInstructions(data.instructions);
}
```

And update the `ingredientData` mapping to normalize each ingredient:

```typescript
const ingredientData = data.ingredients.map((ing, idx) => {
  const normalized = normalizeIngredient({
    name: ing.name,
    quantity: ing.quantity,
    unit: ing.unit,
  });
  return {
    recipeId: 0,
    name: normalized.name,
    quantity: normalized.quantity,
    unit: normalized.unit,
    category: "other" as const,
    displayOrder: idx,
  };
});
```

- [ ] **Step 5: Run route tests**

Run: `npx vitest run server/routes/__tests__/recipes.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/recipes.ts
git commit -m "feat: apply quality validation and normalization to generate, import, and catalog save routes"
```

---

## Task 5: Strengthen Client-Side Validation in RecipeCreateScreen

**Files:**

- Modify: `client/screens/meal-plan/RecipeCreateScreen.tsx:193-230` (handleSave)

- [ ] **Step 1: Update handleSave validation**

In `client/screens/meal-plan/RecipeCreateScreen.tsx`, replace the existing title check in `handleSave`:

```typescript
  const handleSave = useCallback(async () => {
    if (!form.title.trim()) {
      setValidationError("Please enter a recipe title.");
      return;
    }
```

with:

```typescript
  const handleSave = useCallback(async () => {
    if (form.title.trim().length < 3) {
      setValidationError("Recipe title must be at least 3 characters.");
      return;
    }

    const hasIngredients = form.ingredients.some((i) => i.text.trim());
    const hasInstructions = form.steps.some((s) => s.text.trim());
    if (!hasIngredients && !hasInstructions) {
      setValidationError(
        "Please add at least one ingredient or instruction step.",
      );
      return;
    }
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run client/hooks/__tests__/useRecipeForm.test.ts`
Expected: PASS (we only changed the screen, not the hook)

- [ ] **Step 3: Commit**

```bash
git add client/screens/meal-plan/RecipeCreateScreen.tsx
git commit -m "feat: strengthen client-side recipe validation (min 3 char title, require content)"
```

---

## Task 6: Add IngredientIcon to IngredientsSheet (Recipe Create)

**Files:**

- Modify: `client/components/recipe-builder/IngredientsSheet.tsx`

- [ ] **Step 1: Add IngredientIcon import**

At the top of `IngredientsSheet.tsx`, add:

```typescript
import { IngredientIcon } from "@/components/IngredientIcon";
```

- [ ] **Step 2: Add IngredientIcon to each ingredient row**

In the `IngredientItem` component's return JSX, add the icon before the text input. Change:

```typescript
    return (
      <View style={styles.ingredientRow}>
        <BottomSheetTextInput
```

to:

```typescript
    return (
      <View style={styles.ingredientRow}>
        <IngredientIcon name={item.text} size={24} />
        <BottomSheetTextInput
```

- [ ] **Step 3: Verify visually in simulator**

Run the app, navigate to Plan → Create Recipe → Ingredients sheet. Each ingredient row should now show the clay-style icon next to the text input. Empty rows show the generic circle fallback.

- [ ] **Step 4: Commit**

```bash
git add client/components/recipe-builder/IngredientsSheet.tsx
git commit -m "feat: add IngredientIcon to recipe create ingredients sheet"
```

---

## Task 7: Add IngredientIcon to RecipePhotoImportScreen

**Files:**

- Modify: `client/screens/meal-plan/RecipePhotoImportScreen.tsx:369-396`

- [ ] **Step 1: Add import**

At the top of `RecipePhotoImportScreen.tsx`, add:

```typescript
import { IngredientIcon } from "@/components/IngredientIcon";
```

- [ ] **Step 2: Replace plain text ingredient list with icon rows**

Replace the ingredients preview section (lines ~369-396) that currently renders a comma-separated text list:

```typescript
              {/* Ingredients preview */}
              {result.ingredients.length > 0 && (
                <View style={styles.ingredientsPreview}>
                  <ThemedText
                    style={[
                      styles.ingredientsLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {result.ingredients.length} ingredient
                    {result.ingredients.length !== 1 ? "s" : ""}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.ingredientsList,
                      { color: theme.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    {result.ingredients
                      .slice(0, 5)
                      .map((i) => i.name)
                      .join(", ")}
                    {result.ingredients.length > 5
                      ? `, +${result.ingredients.length - 5} more`
                      : ""}
                  </ThemedText>
                </View>
              )}
```

with:

```typescript
              {/* Ingredients preview */}
              {result.ingredients.length > 0 && (
                <View style={styles.ingredientsPreview}>
                  <ThemedText
                    style={[
                      styles.ingredientsLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {result.ingredients.length} ingredient
                    {result.ingredients.length !== 1 ? "s" : ""}
                  </ThemedText>
                  {result.ingredients.slice(0, 5).map((ing, idx) => (
                    <View key={idx} style={styles.ingredientRow}>
                      <IngredientIcon name={ing.name} size={20} />
                      <ThemedText
                        style={[
                          styles.ingredientsList,
                          { color: theme.textSecondary, flex: 1 },
                        ]}
                        numberOfLines={1}
                      >
                        {ing.quantity} {ing.unit} {ing.name}
                      </ThemedText>
                    </View>
                  ))}
                  {result.ingredients.length > 5 && (
                    <ThemedText
                      style={[
                        styles.ingredientsList,
                        { color: theme.textSecondary },
                      ]}
                    >
                      +{result.ingredients.length - 5} more
                    </ThemedText>
                  )}
                </View>
              )}
```

- [ ] **Step 3: Add `ingredientRow` style**

In the `StyleSheet.create` block, add:

```typescript
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
```

- [ ] **Step 4: Commit**

```bash
git add client/screens/meal-plan/RecipePhotoImportScreen.tsx
git commit -m "feat: add IngredientIcon to photo import ingredient preview"
```

---

## Task 8: Add IngredientIcon to ReceiptMealPlanScreen

**Files:**

- Modify: `client/screens/meal-plan/ReceiptMealPlanScreen.tsx:489-500`

- [ ] **Step 1: Add import**

At the top of `ReceiptMealPlanScreen.tsx`, add:

```typescript
import { IngredientIcon } from "@/components/IngredientIcon";
```

- [ ] **Step 2: Replace plain text ingredient rows with icon rows**

Replace the ingredient rendering (lines ~493-500):

```typescript
          {meal.ingredients.map((ing, i) => (
            <ThemedText
              key={i}
              style={[styles.ingredientText, { color: theme.textSecondary }]}
            >
              {ing.quantity} {ing.unit} {ing.name}
            </ThemedText>
          ))}
```

with:

```typescript
          {meal.ingredients.map((ing, i) => (
            <View key={i} style={styles.ingredientRow}>
              <IngredientIcon name={ing.name} size={20} />
              <ThemedText
                style={[styles.ingredientText, { color: theme.textSecondary, flex: 1 }]}
              >
                {ing.quantity} {ing.unit} {ing.name}
              </ThemedText>
            </View>
          ))}
```

- [ ] **Step 3: Add `View` to imports and `ingredientRow` style**

Add `View` to the RN import if not already present. Add to `StyleSheet.create`:

```typescript
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
```

- [ ] **Step 4: Commit**

```bash
git add client/screens/meal-plan/ReceiptMealPlanScreen.tsx
git commit -m "feat: add IngredientIcon to receipt meal plan ingredient list"
```

---

## Task 9: Auto-Generate Images for Imageless Recipes on Create

**Files:**

- Modify: `server/routes/meal-plan.ts:124-161` (POST handler)
- Modify: `server/routes/recipes.ts:692-791` (import handler)

- [ ] **Step 1: Add image generation import to meal-plan.ts**

At the top of `server/routes/meal-plan.ts`, add:

```typescript
import { generateRecipeImage } from "../services/recipe-generation";
import { fireAndForget } from "../lib/fire-and-forget";
```

- [ ] **Step 2: Add async image generation after recipe creation in meal-plan.ts**

In the POST `/api/meal-plan/recipes` handler, after `const recipe = await storage.createMealPlanRecipe(...)` and before `res.status(201).json(recipe)`, add:

```typescript
// Auto-generate image if none provided (async, non-blocking)
if (!recipe.imageUrl) {
  fireAndForget(
    "recipe-image-gen",
    (async () => {
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await storage.updateMealPlanRecipe(recipe.id, req.userId, { imageUrl });
      }
    })(),
  );
}
```

- [ ] **Step 3: Add async image generation after URL import in recipes.ts**

In the POST `/api/meal-plan/recipes/import-url` handler, after `const recipe = await storage.createMealPlanRecipe(...)` and before `res.status(201).json(recipe)`, add the same pattern:

```typescript
// Auto-generate image if source had none (async, non-blocking)
if (!recipe.imageUrl) {
  fireAndForget(
    "recipe-image-gen",
    (async () => {
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await storage.updateMealPlanRecipe(recipe.id, req.userId, { imageUrl });
      }
    })(),
  );
}
```

- [ ] **Step 4: Run route tests**

Run: `npx vitest run server/routes/__tests__/meal-plan.test.ts server/routes/__tests__/recipes.test.ts`
Expected: PASS (image generation is fire-and-forget, won't affect test assertions)

- [ ] **Step 5: Commit**

```bash
git add server/routes/meal-plan.ts server/routes/recipes.ts
git commit -m "feat: auto-generate images for imageless recipes on create (async)"
```

---

## Task 10: Junk Recipe Cleanup Script

**Files:**

- Create: `scripts/cleanup-junk-recipes.ts`

- [ ] **Step 1: Write the cleanup script**

```typescript
// scripts/cleanup-junk-recipes.ts
/**
 * One-time script to delete junk community recipes from the database.
 *
 * Criteria for junk:
 * - Title is exactly "Test Recipe" (case-insensitive)
 * - Title is under 3 characters
 * - Empty instructions AND empty ingredients
 *
 * Usage: npx tsx scripts/cleanup-junk-recipes.ts
 * Add --dry-run to preview what would be deleted without actually deleting.
 */
import { db } from "../server/db";
import { communityRecipes, cookbookRecipes } from "../shared/schema";
import { eq, and, sql, or, ilike } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");

  // Find junk recipes
  const junkRecipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      authorId: communityRecipes.authorId,
    })
    .from(communityRecipes)
    .where(
      or(
        // Exact "Test Recipe" match (case-insensitive)
        ilike(communityRecipes.title, "test recipe"),
        // Title under 3 chars
        sql`LENGTH(TRIM(${communityRecipes.title})) < 3`,
        // Empty instructions AND empty ingredients
        and(
          sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) = 0`,
          sql`COALESCE(jsonb_array_length(${communityRecipes.ingredients}), 0) = 0`,
        ),
      ),
    );

  console.log(`Found ${junkRecipes.length} junk recipes:`);
  for (const r of junkRecipes) {
    console.log(
      `  ID=${r.id} title="${r.title}" author=${r.authorId ?? "NULL"}`,
    );
  }

  if (DRY_RUN || junkRecipes.length === 0) {
    console.log("No changes made.");
    process.exit(0);
  }

  // Delete in transaction
  const ids = junkRecipes.map((r) => r.id);
  await db.transaction(async (tx) => {
    // Clean up cookbook junction rows first
    for (const id of ids) {
      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, id),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        );
    }
    // Delete the recipes
    for (const id of ids) {
      await tx.delete(communityRecipes).where(eq(communityRecipes.id, id));
    }
  });

  console.log(
    `Deleted ${ids.length} junk recipes and associated cookbook entries.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Test with dry run**

Run: `npx tsx scripts/cleanup-junk-recipes.ts --dry-run`
Expected: Lists junk recipes found without deleting them. Verify the list looks correct.

- [ ] **Step 3: Run for real**

Run: `npx tsx scripts/cleanup-junk-recipes.ts`
Expected: Deletes the junk recipes and prints confirmation.

- [ ] **Step 4: Commit**

```bash
git add scripts/cleanup-junk-recipes.ts
git commit -m "feat: add one-time junk recipe cleanup script"
```

---

## Task 11: Image Backfill Script

**Files:**

- Create: `scripts/backfill-recipe-images.ts`

- [ ] **Step 1: Write the backfill script**

```typescript
// scripts/backfill-recipe-images.ts
/**
 * One-time script to generate images for existing imageless recipes.
 * Processes sequentially with delay to avoid rate limits.
 *
 * Usage: npx tsx scripts/backfill-recipe-images.ts
 * Add --dry-run to preview what would be updated without generating.
 * Add --delay=5000 to set delay between generations in ms (default: 3000).
 * Add --limit=10 to limit the number of recipes processed.
 */
import { db } from "../server/db";
import { communityRecipes, mealPlanRecipes } from "../shared/schema";
import { sql, isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { generateRecipeImage } from "../server/services/recipe-generation";

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = parseInt(
  process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? "3000",
  10,
);
const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "999999",
  10,
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log(`Delay: ${DELAY_MS}ms, Limit: ${LIMIT}`);

  // Find imageless community recipes
  const imagelessCommunity = await db
    .select({ id: communityRecipes.id, title: communityRecipes.title })
    .from(communityRecipes)
    .where(isNull(communityRecipes.imageUrl))
    .limit(LIMIT);

  // Find imageless meal plan recipes
  const imagelessMealPlan = await db
    .select({
      id: mealPlanRecipes.id,
      title: mealPlanRecipes.title,
      userId: mealPlanRecipes.userId,
    })
    .from(mealPlanRecipes)
    .where(isNull(mealPlanRecipes.imageUrl))
    .limit(LIMIT);

  const totalCount = imagelessCommunity.length + imagelessMealPlan.length;
  console.log(
    `Found ${imagelessCommunity.length} community + ${imagelessMealPlan.length} meal plan = ${totalCount} imageless recipes`,
  );

  if (DRY_RUN || totalCount === 0) {
    for (const r of imagelessCommunity)
      console.log(`  [community] ID=${r.id} "${r.title}"`);
    for (const r of imagelessMealPlan)
      console.log(`  [meal-plan] ID=${r.id} "${r.title}"`);
    console.log("No changes made.");
    process.exit(0);
  }

  let success = 0;
  let failed = 0;

  // Process community recipes
  for (const recipe of imagelessCommunity) {
    try {
      console.log(
        `Generating image for community recipe ${recipe.id}: "${recipe.title}"...`,
      );
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await db
          .update(communityRecipes)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(communityRecipes.id, recipe.id));
        success++;
        console.log(`  ✓ ${imageUrl}`);
      } else {
        failed++;
        console.log(`  ✗ No image returned`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ Error:`, err);
    }
    await sleep(DELAY_MS);
  }

  // Process meal plan recipes
  for (const recipe of imagelessMealPlan) {
    try {
      console.log(
        `Generating image for meal-plan recipe ${recipe.id}: "${recipe.title}"...`,
      );
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await db
          .update(mealPlanRecipes)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(mealPlanRecipes.id, recipe.id));
        success++;
        console.log(`  ✓ ${imageUrl}`);
      } else {
        failed++;
        console.log(`  ✗ No image returned`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ Error:`, err);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Test with dry run**

Run: `npx tsx scripts/backfill-recipe-images.ts --dry-run`
Expected: Lists imageless recipes without generating anything.

- [ ] **Step 3: Run with small limit to verify**

Run: `npx tsx scripts/backfill-recipe-images.ts --limit=2`
Expected: Generates images for first 2 imageless recipes and updates DB.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-recipe-images.ts
git commit -m "feat: add one-time image backfill script for imageless recipes"
```

---

## Task 12: Run Full Test Suite and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: All tests PASS

- [ ] **Step 2: Run linting**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Run type checking**

Run: `npm run check:types`
Expected: No errors

- [ ] **Step 4: Commit any remaining fixes if needed**

If any tests or lint issues surfaced, fix and commit:

```bash
git commit -m "fix: address test/lint issues from recipe quality standards"
```
