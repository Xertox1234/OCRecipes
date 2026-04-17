# Recipe Creation Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "Tap to add" recipe creation screen with a 3-stage pipeline: Entry Hub (5 import methods) → Intake → Step-by-step Wizard (7 steps with preview) → Save.

**Architecture:** A new `RecipeEntryHubScreen` presents 5 action cards (write, AI, URL, photo, browse). All creation paths produce `ImportedRecipeData` and feed into a redesigned `RecipeCreateScreen` with a `WizardShell` that manages 7 steps via Reanimated transitions within a single screen. Existing import/photo screens are modified to route through the wizard instead of saving directly.

**Tech Stack:** React Native/Expo, Reanimated 4 (layout animations), React Navigation native-stack, TanStack Query v5, Vitest, Express.js, Zod

**Spec:** `docs/superpowers/specs/2026-04-16-recipe-creation-wizard-design.md`

---

## File Structure

### New Files

| File                                                   | Responsibility                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `client/components/recipe-wizard/types.ts`             | Wizard types, step config, diet tag constants (moved from recipe-builder) |
| `client/lib/recipe-tag-inference.ts`                   | Pure function: infer cuisine + diet tags from title and ingredients       |
| `client/lib/__tests__/recipe-tag-inference.test.ts`    | Tests for tag inference                                                   |
| `client/components/recipe-wizard/WizardShell.tsx`      | Wizard chrome: progress bar, step transitions, nav buttons, validation    |
| `client/components/recipe-wizard/TitleStep.tsx`        | Step 1: recipe name + description inputs                                  |
| `client/components/recipe-wizard/IngredientsStep.tsx`  | Step 2: ingredient list editor                                            |
| `client/components/recipe-wizard/InstructionsStep.tsx` | Step 3: instruction steps with reorder                                    |
| `client/components/recipe-wizard/TimeServingsStep.tsx` | Step 4: servings stepper + time inputs                                    |
| `client/components/recipe-wizard/NutritionStep.tsx`    | Step 5: 2x2 macro grid (skippable)                                        |
| `client/components/recipe-wizard/TagsStep.tsx`         | Step 6: auto-suggested cuisine + diet tag chips                           |
| `client/components/recipe-wizard/PreviewStep.tsx`      | Step 7: recipe card review with edit links                                |
| `client/screens/meal-plan/RecipeEntryHubScreen.tsx`    | Entry hub with 5 action cards                                             |
| `client/screens/meal-plan/RecipeAIGenerateScreen.tsx`  | AI generation intake screen                                               |
| `client/hooks/useRecipeGenerate.ts`                    | TanStack Query mutation for AI recipe generation                          |
| `server/routes/recipe-generate.ts`                     | `POST /api/meal-plan/recipes/generate` endpoint                           |
| `server/routes/__tests__/recipe-generate.test.ts`      | Route tests for generate endpoint                                         |

### Modified Files

| File                                                   | Changes                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `client/navigation/MealPlanStackNavigator.tsx`         | Add `RecipeEntryHub` and `RecipeAIGenerate` routes; update imports               |
| `client/screens/meal-plan/RecipeCreateScreen.tsx`      | Full rewrite: replace bottom-sheet form with WizardShell                         |
| `client/screens/meal-plan/RecipeImportScreen.tsx`      | After extraction, navigate to wizard with prefill instead of saving directly     |
| `client/screens/meal-plan/RecipePhotoImportScreen.tsx` | After photo analysis, navigate to wizard with prefill instead of saving directly |
| `client/hooks/useRecipeForm.ts`                        | Update DietTag import path from recipe-builder to recipe-wizard                  |
| `server/routes.ts`                                     | Register `recipe-generate` route                                                 |

### Removed Files

| File                                                     | Reason                       |
| -------------------------------------------------------- | ---------------------------- |
| `client/components/recipe-builder/SectionRow.tsx`        | Replaced by wizard steps     |
| `client/components/recipe-builder/SheetHeader.tsx`       | No more bottom sheets        |
| `client/components/recipe-builder/IngredientsSheet.tsx`  | Replaced by IngredientsStep  |
| `client/components/recipe-builder/InstructionsSheet.tsx` | Replaced by InstructionsStep |
| `client/components/recipe-builder/TimeServingsSheet.tsx` | Replaced by TimeServingsStep |
| `client/components/recipe-builder/NutritionSheet.tsx`    | Replaced by NutritionStep    |
| `client/components/recipe-builder/TagsCuisineSheet.tsx`  | Replaced by TagsStep         |

---

### Task 1: Wizard types and tag inference utility

**Files:**

- Create: `client/components/recipe-wizard/types.ts`
- Create: `client/lib/recipe-tag-inference.ts`
- Create: `client/lib/__tests__/recipe-tag-inference.test.ts`

- [ ] **Step 1: Create wizard types**

Move the shared types from `recipe-builder/types.ts` and add wizard-specific types:

```ts
// client/components/recipe-wizard/types.ts
import type { ReactNode } from "react";

export const DIET_TAG_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten Free",
  "Dairy Free",
  "Keto",
  "Paleo",
  "Low Carb",
  "High Protein",
] as const;

export type DietTag = (typeof DIET_TAG_OPTIONS)[number];

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface StepConfig {
  step: WizardStep;
  title: string;
  subtitle: string;
  nextLabel: string;
}

export const STEP_CONFIGS: StepConfig[] = [
  {
    step: 1,
    title: "What are you making?",
    subtitle: "Give your recipe a name",
    nextLabel: "Ingredients",
  },
  {
    step: 2,
    title: "Ingredients",
    subtitle: "What goes into this recipe?",
    nextLabel: "Instructions",
  },
  {
    step: 3,
    title: "Instructions",
    subtitle: "How do you make it?",
    nextLabel: "Time & Servings",
  },
  {
    step: 4,
    title: "Time & Servings",
    subtitle: "How long does it take?",
    nextLabel: "Nutrition",
  },
  {
    step: 5,
    title: "Nutrition",
    subtitle: "Per serving (optional — skip if you don't know)",
    nextLabel: "Tags",
  },
  {
    step: 6,
    title: "Tags & Cuisine",
    subtitle: "We suggested some based on your recipe — edit as needed",
    nextLabel: "Preview",
  },
  {
    step: 7,
    title: "Preview",
    subtitle: "Review your recipe before saving",
    nextLabel: "Save",
  },
];

export const TOTAL_STEPS = 7;
```

- [ ] **Step 2: Write tag inference tests**

```ts
// client/lib/__tests__/recipe-tag-inference.test.ts
import { describe, it, expect } from "vitest";
import { inferCuisine, inferDietTags } from "../recipe-tag-inference";

describe("inferCuisine", () => {
  it("infers Italian from parmesan and marinara", () => {
    expect(
      inferCuisine("Chicken Parmesan", [
        "parmesan",
        "marinara sauce",
        "mozzarella",
      ]),
    ).toBe("Italian");
  });

  it("infers Mexican from tortilla and salsa", () => {
    expect(inferCuisine("Fish Tacos", ["tortilla", "salsa", "avocado"])).toBe(
      "Mexican",
    );
  });

  it("infers Japanese from sushi-related terms", () => {
    expect(
      inferCuisine("Salmon Sushi Roll", ["sushi rice", "nori", "salmon"]),
    ).toBe("Japanese");
  });

  it("returns null when no cuisine matches", () => {
    expect(
      inferCuisine("My Special Dish", ["salt", "pepper", "water"]),
    ).toBeNull();
  });

  it("matches from title even when ingredients are empty", () => {
    expect(inferCuisine("Thai Basil Chicken", [])).toBe("Thai");
  });

  it("is case-insensitive", () => {
    expect(
      inferCuisine("CHICKEN TIKKA MASALA", ["GARAM MASALA", "YOGURT"]),
    ).toBe("Indian");
  });
});

describe("inferDietTags", () => {
  it("suggests Vegetarian when no meat ingredients", () => {
    const tags = inferDietTags(["flour", "sugar", "butter", "eggs"]);
    expect(tags).toContain("Vegetarian");
  });

  it("does not suggest Vegetarian when meat is present", () => {
    const tags = inferDietTags(["chicken breast", "rice", "soy sauce"]);
    expect(tags).not.toContain("Vegetarian");
  });

  it("suggests Vegan when no meat or dairy", () => {
    const tags = inferDietTags(["tofu", "rice", "soy sauce", "vegetables"]);
    expect(tags).toContain("Vegan");
    expect(tags).toContain("Vegetarian");
  });

  it("does not suggest Vegan when dairy is present", () => {
    const tags = inferDietTags(["pasta", "butter", "cream"]);
    expect(tags).not.toContain("Vegan");
  });

  it("suggests Gluten Free when no gluten ingredients", () => {
    const tags = inferDietTags(["chicken", "rice", "vegetables"]);
    expect(tags).toContain("Gluten Free");
  });

  it("does not suggest Gluten Free when flour is present", () => {
    const tags = inferDietTags(["flour", "sugar", "eggs"]);
    expect(tags).not.toContain("Gluten Free");
  });

  it("suggests Dairy Free when no dairy ingredients", () => {
    const tags = inferDietTags(["chicken", "rice", "soy sauce"]);
    expect(tags).toContain("Dairy Free");
  });

  it("returns empty array for empty ingredients", () => {
    expect(inferDietTags([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run client/lib/__tests__/recipe-tag-inference.test.ts
```

Expected: FAIL — `inferCuisine` and `inferDietTags` not found.

- [ ] **Step 4: Implement tag inference**

```ts
// client/lib/recipe-tag-inference.ts
import type { DietTag } from "@/components/recipe-wizard/types";

const CUISINE_KEYWORDS: Record<string, string[]> = {
  Italian: [
    "parmesan",
    "marinara",
    "mozzarella",
    "pasta",
    "risotto",
    "pesto",
    "prosciutto",
    "bruschetta",
    "gnocchi",
    "lasagna",
    "ravioli",
    "focaccia",
    "tiramisu",
  ],
  Mexican: [
    "tortilla",
    "salsa",
    "cilantro",
    "jalapeño",
    "jalapeno",
    "cumin",
    "enchilada",
    "taco",
    "burrito",
    "quesadilla",
    "guacamole",
    "chipotle",
  ],
  Chinese: [
    "soy sauce",
    "ginger",
    "sesame",
    "wok",
    "stir fry",
    "tofu",
    "bok choy",
    "hoisin",
    "dim sum",
    "chow mein",
    "dumpling",
  ],
  Japanese: [
    "miso",
    "sushi",
    "wasabi",
    "teriyaki",
    "dashi",
    "nori",
    "edamame",
    "ramen",
    "tempura",
    "udon",
    "sake",
  ],
  Indian: [
    "curry",
    "turmeric",
    "garam masala",
    "naan",
    "tikka",
    "masala",
    "cardamom",
    "tandoori",
    "paneer",
    "biryani",
    "dal",
    "chutney",
  ],
  Thai: [
    "coconut milk",
    "lemongrass",
    "thai basil",
    "fish sauce",
    "galangal",
    "pad thai",
    "green curry",
    "red curry",
    "tom yum",
  ],
  French: [
    "beurre",
    "croissant",
    "roux",
    "gratin",
    "soufflé",
    "souffle",
    "crème",
    "creme",
    "béchamel",
    "bechamel",
    "brioche",
  ],
  Greek: [
    "feta",
    "tzatziki",
    "gyro",
    "oregano",
    "pita",
    "souvlaki",
    "moussaka",
    "spanakopita",
  ],
  Korean: [
    "kimchi",
    "gochujang",
    "bulgogi",
    "sesame oil",
    "bibimbap",
    "japchae",
    "doenjang",
  ],
  American: [
    "burger",
    "bbq",
    "barbecue",
    "ranch",
    "mac and cheese",
    "cornbread",
    "brisket",
  ],
};

const MEAT_KEYWORDS = [
  "chicken",
  "beef",
  "pork",
  "lamb",
  "turkey",
  "bacon",
  "sausage",
  "steak",
  "ham",
  "veal",
  "duck",
  "venison",
  "prosciutto",
  "pepperoni",
  "salami",
  "ground beef",
  "ground turkey",
  "ground pork",
  "shrimp",
  "salmon",
  "tuna",
  "fish",
  "crab",
  "lobster",
  "anchovy",
  "anchovies",
  "sardine",
];

const DAIRY_KEYWORDS = [
  "milk",
  "cheese",
  "butter",
  "cream",
  "yogurt",
  "mozzarella",
  "parmesan",
  "cheddar",
  "ricotta",
  "mascarpone",
  "ghee",
  "sour cream",
  "whey",
  "heavy cream",
  "half and half",
  "brie",
  "gouda",
  "feta",
  "paneer",
];

const GLUTEN_KEYWORDS = [
  "flour",
  "bread",
  "pasta",
  "noodle",
  "breadcrumb",
  "wheat",
  "tortilla",
  "crouton",
  "couscous",
  "barley",
  "rye",
  "soy sauce",
  "beer",
  "pie crust",
  "pizza dough",
  "pita",
  "naan",
  "croissant",
  "brioche",
];

const EGG_KEYWORDS = ["egg", "eggs", "egg white", "egg yolk", "mayonnaise"];

/**
 * Infer cuisine from recipe title and ingredient names.
 * Returns the best-matching cuisine or null.
 */
export function inferCuisine(
  title: string,
  ingredientNames: string[],
): string | null {
  const searchText = [title, ...ingredientNames].join(" ").toLowerCase();

  let bestCuisine: string | null = null;
  let bestScore = 0;

  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCuisine = cuisine;
    }
  }

  return bestScore >= 1 ? bestCuisine : null;
}

/**
 * Infer diet tags from ingredient names.
 * Returns an array of applicable DietTag values.
 */
export function inferDietTags(ingredientNames: string[]): DietTag[] {
  if (ingredientNames.length === 0) return [];

  const lowerIngredients = ingredientNames.map((n) => n.toLowerCase());
  const allText = lowerIngredients.join(" ");

  const hasMeat = MEAT_KEYWORDS.some((kw) => allText.includes(kw));
  const hasDairy = DAIRY_KEYWORDS.some((kw) => allText.includes(kw));
  const hasGluten = GLUTEN_KEYWORDS.some((kw) => allText.includes(kw));
  const hasEggs = EGG_KEYWORDS.some((kw) => allText.includes(kw));

  const tags: DietTag[] = [];

  if (!hasMeat) tags.push("Vegetarian");
  if (!hasMeat && !hasDairy && !hasEggs) tags.push("Vegan");
  if (!hasGluten) tags.push("Gluten Free");
  if (!hasDairy) tags.push("Dairy Free");

  return tags;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run client/lib/__tests__/recipe-tag-inference.test.ts
```

Expected: All 14 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add client/components/recipe-wizard/types.ts client/lib/recipe-tag-inference.ts client/lib/__tests__/recipe-tag-inference.test.ts
git commit -m "feat: add wizard types and recipe tag inference utility"
```

---

### Task 2: Update navigation types and imports

**Files:**

- Modify: `client/navigation/MealPlanStackNavigator.tsx`
- Modify: `client/hooks/useRecipeForm.ts`

- [ ] **Step 1: Add new routes to MealPlanStackParamList**

In `client/navigation/MealPlanStackNavigator.tsx`, add imports and routes:

```ts
// Add these imports at the top (after existing imports)
import RecipeEntryHubScreen from "@/screens/meal-plan/RecipeEntryHubScreen";
import RecipeAIGenerateScreen from "@/screens/meal-plan/RecipeAIGenerateScreen";
```

Add to the `MealPlanStackParamList` type:

```ts
export type MealPlanStackParamList = {
  MealPlanHome: undefined;
  RecipeBrowser: {
    mealType?: string;
    plannedDate?: string;
    searchQuery?: string;
    planDays?: MealPlanDay[];
  };
  RecipeEntryHub:
    | { returnToMealPlan?: { mealType: string; plannedDate: string } }
    | undefined;
  RecipeAIGenerate:
    | { returnToMealPlan?: { mealType: string; plannedDate: string } }
    | undefined;
  RecipeCreate: {
    prefill?: ImportedRecipeData;
    returnToMealPlan?: { mealType: string; plannedDate: string };
  };
  RecipeImport:
    | { returnToMealPlan?: { mealType: string; plannedDate: string } }
    | undefined;
  RecipePhotoImport: {
    photoUri: string;
    returnToMealPlan?: { mealType: string; plannedDate: string };
  };
  GroceryLists: undefined;
  GroceryList: { listId: number };
  Pantry: undefined;
  CookbookCreate: { cookbookId?: number } | undefined;
  CookbookList: undefined;
  CookbookDetail: { cookbookId: number };
  FavouriteRecipes: undefined;
};
```

Add the screen registrations inside `<Stack.Navigator>`, after the `RecipeBrowser` screen:

```tsx
<Stack.Screen
  name="RecipeEntryHub"
  component={RecipeEntryHubScreen}
  options={{
    headerTitle: () => (
      <HeaderTitle title="Add Recipe" showIcon={false} />
    ),
  }}
/>
<Stack.Screen
  name="RecipeAIGenerate"
  component={RecipeAIGenerateScreen}
  options={{
    headerTitle: () => (
      <HeaderTitle title="Generate Recipe" showIcon={false} />
    ),
  }}
/>
```

- [ ] **Step 2: Update DietTag import in useRecipeForm**

In `client/hooks/useRecipeForm.ts`, change line 4:

```ts
// Before:
import type { DietTag } from "@/components/recipe-builder/types";

// After:
import type { DietTag } from "@/components/recipe-wizard/types";
```

- [ ] **Step 3: Update any other files importing DietTag from recipe-builder**

Search for other imports of `DietTag` from `recipe-builder/types` and update them to `recipe-wizard/types`. The recipe-builder sheets still import it but will be deleted in a later task, so only update non-sheet files.

- [ ] **Step 4: Verify types compile**

```bash
npm run check:types
```

Expected: No new type errors (the new screens don't exist yet, but the imports will error — that's expected at this stage; create placeholder files if needed for the type check to pass).

Note: If the type checker fails because `RecipeEntryHubScreen` and `RecipeAIGenerateScreen` don't exist yet, create minimal placeholder files:

```tsx
// client/screens/meal-plan/RecipeEntryHubScreen.tsx
import React from "react";
import { View, Text } from "react-native";

export default function RecipeEntryHubScreen() {
  return (
    <View>
      <Text>Entry Hub - TODO</Text>
    </View>
  );
}
```

```tsx
// client/screens/meal-plan/RecipeAIGenerateScreen.tsx
import React from "react";
import { View, Text } from "react-native";

export default function RecipeAIGenerateScreen() {
  return (
    <View>
      <Text>AI Generate - TODO</Text>
    </View>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add client/navigation/MealPlanStackNavigator.tsx client/hooks/useRecipeForm.ts client/screens/meal-plan/RecipeEntryHubScreen.tsx client/screens/meal-plan/RecipeAIGenerateScreen.tsx
git commit -m "feat: add navigation routes for recipe entry hub and AI generate"
```

---

### Task 3: WizardShell component

**Files:**

- Create: `client/components/recipe-wizard/WizardShell.tsx`

The WizardShell is the core container rendered by `RecipeCreateScreen`. It manages step state, renders the progress bar, the current step component, and the navigation buttons.

- [ ] **Step 1: Create WizardShell**

```tsx
// client/components/recipe-wizard/WizardShell.tsx
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  AccessibilityInfo,
  Alert,
} from "react-native";
import Animated, {
  SlideInRight,
  SlideOutLeft,
  SlideInLeft,
  SlideOutRight,
  FadeIn,
  LinearTransition,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useRecipeForm } from "@/hooks/useRecipeForm";
import {
  useCreateMealPlanRecipe,
  useAddMealPlanItem,
} from "@/hooks/useMealPlanRecipes";
import { inferCuisine, inferDietTags } from "@/lib/recipe-tag-inference";
import {
  STEP_CONFIGS,
  TOTAL_STEPS,
  type WizardStep,
  type DietTag,
} from "./types";
import TitleStep from "./TitleStep";
import IngredientsStep from "./IngredientsStep";
import InstructionsStep from "./InstructionsStep";
import TimeServingsStep from "./TimeServingsStep";
import NutritionStep from "./NutritionStep";
import TagsStep from "./TagsStep";
import PreviewStep from "./PreviewStep";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

interface WizardShellProps {
  prefill?: ImportedRecipeData;
  returnToMealPlan?: { mealType: string; plannedDate: string };
  onGoBack: () => void;
  onSaveComplete: () => void;
}

export default function WizardShell({
  prefill,
  returnToMealPlan,
  onGoBack,
  onSaveComplete,
}: WizardShellProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const form = useRecipeForm(prefill);
  const createMutation = useCreateMealPlanRecipe();
  const addItemMutation = useAddMealPlanItem();

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [returnToPreview, setReturnToPreview] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [hasSuggestedTags, setHasSuggestedTags] = useState(false);

  const stepConfig = STEP_CONFIGS[currentStep - 1];

  // Auto-suggest tags when arriving at step 6 for the first time
  const applySuggestions = useCallback(() => {
    if (hasSuggestedTags) return;
    setHasSuggestedTags(true);

    const ingredientNames = form.ingredients
      .filter((i) => i.text.trim())
      .map((i) => i.text.trim());

    const suggestedCuisine = inferCuisine(form.title, ingredientNames);
    const suggestedDietTags = inferDietTags(ingredientNames);

    // Only set suggestions if user hasn't already filled them
    if (!form.tags.cuisine && suggestedCuisine) {
      form.setTags({
        ...form.tags,
        cuisine: suggestedCuisine,
        dietTags:
          suggestedDietTags.length > 0 ? suggestedDietTags : form.tags.dietTags,
      });
    } else if (
      form.tags.dietTags.length === 0 &&
      suggestedDietTags.length > 0
    ) {
      form.setTags({ ...form.tags, dietTags: suggestedDietTags });
    }
  }, [form, hasSuggestedTags]);

  const validateStep = useCallback((): boolean => {
    setValidationError("");
    switch (currentStep) {
      case 1:
        if (form.title.trim().length < 3) {
          setValidationError("Recipe name must be at least 3 characters");
          return false;
        }
        return true;
      case 2: {
        const hasIngredient = form.ingredients.some((i) => i.text.trim());
        if (!hasIngredient) {
          setValidationError("Add at least one ingredient");
          return false;
        }
        return true;
      }
      case 3: {
        const hasStep = form.steps.some((s) => s.text.trim());
        if (!hasStep) {
          setValidationError("Add at least one instruction step");
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  }, [currentStep, form.title, form.ingredients, form.steps]);

  const goNext = useCallback(() => {
    if (!validateStep()) return;
    setDirection("forward");

    if (returnToPreview) {
      setReturnToPreview(false);
      setCurrentStep(7);
      return;
    }

    const nextStep = (currentStep + 1) as WizardStep;
    if (nextStep === 6) applySuggestions();
    setCurrentStep(nextStep);
    setValidationError("");

    AccessibilityInfo.announceForAccessibility(
      `Step ${nextStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[nextStep - 1].title}`,
    );
  }, [currentStep, validateStep, returnToPreview, applySuggestions]);

  const goBack = useCallback(() => {
    setDirection("back");
    setValidationError("");

    if (currentStep === 1) {
      if (form.isDirty) {
        Alert.alert(
          "Discard changes?",
          "You have unsaved changes. Are you sure you want to go back?",
          [
            { text: "Keep editing", style: "cancel" },
            { text: "Discard", style: "destructive", onPress: onGoBack },
          ],
        );
        return;
      }
      onGoBack();
      return;
    }

    if (returnToPreview) {
      setReturnToPreview(false);
      setCurrentStep(7);
      return;
    }

    const prevStep = (currentStep - 1) as WizardStep;
    setCurrentStep(prevStep);

    AccessibilityInfo.announceForAccessibility(
      `Step ${prevStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[prevStep - 1].title}`,
    );
  }, [currentStep, onGoBack, returnToPreview]);

  const editFromPreview = useCallback((targetStep: WizardStep) => {
    setReturnToPreview(true);
    setDirection("back");
    setCurrentStep(targetStep);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const payload = form.formToPayload();
      const created = await createMutation.mutateAsync(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (returnToMealPlan) {
        await addItemMutation.mutateAsync({
          recipeId: created.id,
          recipeType: "personal",
          mealType: returnToMealPlan.mealType,
          plannedDate: returnToMealPlan.plannedDate,
        });
      }

      onSaveComplete();
    } catch {
      Alert.alert("Error", "Failed to save recipe. Please try again.");
    }
  }, [form, createMutation, addItemMutation, returnToMealPlan, onSaveComplete]);

  // Determine if nutrition step should show "Skip" instead of "Next"
  const isNutritionEmpty =
    !form.nutrition.calories &&
    !form.nutrition.protein &&
    !form.nutrition.carbs &&
    !form.nutrition.fat;

  const nextButtonLabel = useMemo(() => {
    if (currentStep === 7) return "Save Recipe";
    if (currentStep === 5 && isNutritionEmpty) return "Skip";
    return `Next: ${stepConfig.nextLabel}`;
  }, [currentStep, isNutritionEmpty, stepConfig.nextLabel]);

  const entering =
    direction === "forward"
      ? SlideInRight.duration(250)
      : SlideInLeft.duration(250);
  const exiting =
    direction === "forward"
      ? SlideOutLeft.duration(250)
      : SlideOutRight.duration(250);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <TitleStep
            title={form.title}
            setTitle={form.setTitle}
            description={form.description}
            setDescription={form.setDescription}
          />
        );
      case 2:
        return (
          <IngredientsStep
            ingredients={form.ingredients}
            addIngredient={form.addIngredient}
            removeIngredient={form.removeIngredient}
            updateIngredient={form.updateIngredient}
          />
        );
      case 3:
        return (
          <InstructionsStep
            steps={form.steps}
            addStep={form.addStep}
            removeStep={form.removeStep}
            updateStep={form.updateStep}
            moveStep={form.moveStep}
          />
        );
      case 4:
        return (
          <TimeServingsStep
            timeServings={form.timeServings}
            setTimeServings={form.setTimeServings}
          />
        );
      case 5:
        return (
          <NutritionStep
            nutrition={form.nutrition}
            setNutrition={form.setNutrition}
          />
        );
      case 6:
        return <TagsStep tags={form.tags} setTags={form.setTags} />;
      case 7:
        return <PreviewStep form={form} onEditStep={editFromPreview} />;
      default:
        return null;
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
    >
      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                {
                  backgroundColor:
                    i < currentStep
                      ? theme.link
                      : withOpacity(theme.link, 0.12),
                },
              ]}
            />
          ))}
        </View>
        <Text
          style={[styles.stepLabel, { color: theme.link }]}
          accessibilityRole="text"
          accessibilityLabel={`Step ${currentStep} of ${TOTAL_STEPS}, ${stepConfig.title}`}
        >
          Step {currentStep} of {TOTAL_STEPS}
        </Text>
      </View>

      {/* Step Title */}
      <View style={styles.headerContainer}>
        <Text style={[styles.title, { color: theme.text }]}>
          {stepConfig.title}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {stepConfig.subtitle}
        </Text>
      </View>

      {/* Step Content */}
      <View style={styles.contentContainer}>
        <Animated.View
          key={`step-${currentStep}`}
          entering={entering}
          exiting={exiting}
          style={styles.stepContent}
        >
          {renderStep()}
        </Animated.View>
      </View>

      {/* Validation Error */}
      {validationError ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={styles.errorContainer}
        >
          <Text style={[styles.errorText, { color: theme.error }]}>
            {validationError}
          </Text>
        </Animated.View>
      ) : null}

      {/* Navigation Buttons */}
      <View
        style={[
          styles.navContainer,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) },
        ]}
      >
        {currentStep > 1 && (
          <Pressable
            onPress={goBack}
            style={[
              styles.navButton,
              styles.backButton,
              { backgroundColor: theme.backgroundSecondary },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${STEP_CONFIGS[currentStep - 2]?.title ?? "Entry Hub"}`}
          >
            <Text style={[styles.navButtonText, { color: theme.link }]}>
              ← Back
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={currentStep === 7 ? handleSave : goNext}
          disabled={createMutation.isPending}
          style={[
            styles.navButton,
            styles.nextButton,
            { backgroundColor: theme.link },
            currentStep === 1 && styles.fullWidth,
            createMutation.isPending && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={nextButtonLabel}
        >
          <Text style={[styles.navButtonText, { color: "#FFFFFF" }]}>
            {createMutation.isPending ? "Saving..." : nextButtonLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progressContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  progressBar: {
    flexDirection: "row",
    gap: 3,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  stepLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    marginTop: Spacing.xs,
  },
  headerContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
  },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    marginTop: 2,
  },
  contentContainer: {
    flex: 1,
    overflow: "hidden",
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  errorContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  errorText: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    textAlign: "center",
  },
  navContainer: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  navButton: {
    paddingVertical: 12,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    flex: 1,
  },
  nextButton: {
    flex: 2,
  },
  fullWidth: {
    flex: 1,
  },
  navButtonText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add client/components/recipe-wizard/WizardShell.tsx
git commit -m "feat: add WizardShell component with progress bar and step transitions"
```

---

### Task 4: TitleStep and IngredientsStep

**Files:**

- Create: `client/components/recipe-wizard/TitleStep.tsx`
- Create: `client/components/recipe-wizard/IngredientsStep.tsx`

- [ ] **Step 1: Create TitleStep**

```tsx
// client/components/recipe-wizard/TitleStep.tsx
import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface TitleStepProps {
  title: string;
  setTitle: (title: string) => void;
  description: string;
  setDescription: (description: string) => void;
}

export default function TitleStep({
  title,
  setTitle,
  description,
  setDescription,
}: TitleStepProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: theme.link }]}>RECIPE NAME</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: withOpacity(theme.link, 0.25),
            },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g., Chicken Parmesan"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          maxLength={200}
          returnKeyType="next"
          accessibilityLabel="Recipe name"
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={[styles.label, { color: theme.link }]}>
          DESCRIPTION{" "}
          <Text
            style={{
              color: theme.textSecondary,
              fontFamily: FontFamily.regular,
            }}
          >
            (optional)
          </Text>
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.descriptionInput,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: withOpacity(theme.border, 0.5),
            },
          ]}
          value={description}
          onChangeText={setDescription}
          placeholder="A brief description of your recipe..."
          placeholderTextColor={theme.textSecondary}
          multiline
          maxLength={2000}
          textAlignVertical="top"
          accessibilityLabel="Recipe description, optional"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing.lg,
  },
  fieldGroup: {
    gap: Spacing.xs + 2,
  },
  label: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
  },
  input: {
    borderRadius: BorderRadius.xs,
    padding: 14,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
  },
  descriptionInput: {
    minHeight: 60,
  },
});
```

- [ ] **Step 2: Create IngredientsStep**

```tsx
// client/components/recipe-wizard/IngredientsStep.tsx
import React, { useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { IngredientRow } from "@/hooks/useRecipeForm";

interface IngredientsStepProps {
  ingredients: IngredientRow[];
  addIngredient: () => void;
  removeIngredient: (key: string) => void;
  updateIngredient: (key: string, text: string) => void;
}

export default function IngredientsStep({
  ingredients,
  addIngredient,
  removeIngredient,
  updateIngredient,
}: IngredientsStepProps) {
  const theme = useTheme();
  const inputRefs = useRef<Map<string, TextInput>>(new Map());

  const handleAdd = () => {
    addIngredient();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemove = (key: string) => {
    removeIngredient(key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const renderItem = ({
    item,
    index,
  }: {
    item: IngredientRow;
    index: number;
  }) => (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.row, { backgroundColor: theme.backgroundSecondary }]}
    >
      <Text style={[styles.bullet, { color: theme.link }]}>•</Text>
      <TextInput
        ref={(ref) => {
          if (ref) inputRefs.current.set(item.key, ref);
          else inputRefs.current.delete(item.key);
        }}
        style={[styles.input, { color: theme.text }]}
        value={item.text}
        onChangeText={(text) => updateIngredient(item.key, text)}
        placeholder={index === 0 ? 'e.g., "2 cups flour"' : "Add ingredient..."}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="next"
        onSubmitEditing={handleAdd}
        accessibilityLabel={`Ingredient ${index + 1}`}
      />
      {ingredients.length > 1 && (
        <Pressable
          onPress={() => handleRemove(item.key)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ingredient ${index + 1}`}
        >
          <Feather name="x" size={18} color={theme.error} />
        </Pressable>
      )}
    </Animated.View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={ingredients}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          <Pressable
            onPress={handleAdd}
            style={[
              styles.addRow,
              { borderColor: withOpacity(theme.link, 0.25) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add ingredient"
          >
            <Text style={[styles.addIcon, { color: theme.link }]}>+</Text>
            <Text style={[styles.addText, { color: theme.textSecondary }]}>
              Add ingredient...
            </Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
  },
  bullet: {
    fontSize: 14,
  },
  input: {
    flex: 1,
    fontSize: 13,
    fontFamily: FontFamily.regular,
    padding: 0,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.sm,
  },
  addIcon: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  addText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    fontStyle: "italic",
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add client/components/recipe-wizard/TitleStep.tsx client/components/recipe-wizard/IngredientsStep.tsx
git commit -m "feat: add TitleStep and IngredientsStep wizard components"
```

---

### Task 5: InstructionsStep and TimeServingsStep

**Files:**

- Create: `client/components/recipe-wizard/InstructionsStep.tsx`
- Create: `client/components/recipe-wizard/TimeServingsStep.tsx`

- [ ] **Step 1: Create InstructionsStep**

```tsx
// client/components/recipe-wizard/InstructionsStep.tsx
import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { StepRow } from "@/hooks/useRecipeForm";

interface InstructionsStepProps {
  steps: StepRow[];
  addStep: () => void;
  removeStep: (key: string) => void;
  updateStep: (key: string, text: string) => void;
  moveStep: (key: string, direction: "up" | "down") => void;
}

export default function InstructionsStep({
  steps,
  addStep,
  removeStep,
  updateStep,
  moveStep,
}: InstructionsStepProps) {
  const theme = useTheme();

  const handleAdd = () => {
    addStep();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemove = (key: string) => {
    removeStep(key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const renderItem = ({ item, index }: { item: StepRow; index: number }) => (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.row, { backgroundColor: theme.backgroundSecondary }]}
    >
      <View style={[styles.stepBadge, { backgroundColor: theme.link }]}>
        <Text style={styles.stepNumber}>{index + 1}</Text>
      </View>

      <TextInput
        style={[styles.input, { color: theme.text }]}
        value={item.text}
        onChangeText={(text) => updateStep(item.key, text)}
        placeholder={
          index === 0 ? "e.g., Preheat oven to 350°F" : "Next step..."
        }
        placeholderTextColor={theme.textSecondary}
        multiline
        accessibilityLabel={`Step ${index + 1}`}
      />

      <View style={styles.actionColumn}>
        <Pressable
          onPress={() => moveStep(item.key, "up")}
          disabled={index === 0}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Move step ${index + 1} up`}
        >
          <Feather
            name="chevron-up"
            size={16}
            color={
              index === 0
                ? withOpacity(theme.textSecondary, 0.3)
                : theme.textSecondary
            }
          />
        </Pressable>
        <Pressable
          onPress={() => moveStep(item.key, "down")}
          disabled={index === steps.length - 1}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Move step ${index + 1} down`}
        >
          <Feather
            name="chevron-down"
            size={16}
            color={
              index === steps.length - 1
                ? withOpacity(theme.textSecondary, 0.3)
                : theme.textSecondary
            }
          />
        </Pressable>
        {steps.length > 1 && (
          <Pressable
            onPress={() => handleRemove(item.key)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Remove step ${index + 1}`}
          >
            <Feather name="x" size={16} color={theme.error} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={steps}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          <Pressable
            onPress={handleAdd}
            style={[
              styles.addRow,
              { borderColor: withOpacity(theme.link, 0.25) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add step"
          >
            <Text style={[styles.addIcon, { color: theme.link }]}>+</Text>
            <Text style={[styles.addText, { color: theme.textSecondary }]}>
              Add step...
            </Text>
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: BorderRadius.xs,
    gap: Spacing.sm,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepNumber: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
  input: {
    flex: 1,
    fontSize: 13,
    fontFamily: FontFamily.regular,
    padding: 0,
    lineHeight: 18,
  },
  actionColumn: {
    gap: 2,
    alignItems: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.sm,
  },
  addIcon: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginLeft: 4,
  },
  addText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    fontStyle: "italic",
  },
});
```

- [ ] **Step 2: Create TimeServingsStep**

```tsx
// client/components/recipe-wizard/TimeServingsStep.tsx
import React from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { TimeServingsData } from "@/hooks/useRecipeForm";

interface TimeServingsStepProps {
  timeServings: TimeServingsData;
  setTimeServings: (data: TimeServingsData) => void;
}

export default function TimeServingsStep({
  timeServings,
  setTimeServings,
}: TimeServingsStepProps) {
  const theme = useTheme();
  const { servings, prepTime, cookTime } = timeServings;

  const adjustServings = (delta: number) => {
    const next = Math.max(1, Math.min(99, servings + delta));
    if (next !== servings) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeServings({ ...timeServings, servings: next });
    }
  };

  const setTime = (field: "prepTime" | "cookTime", value: string) => {
    // Allow only digits
    const digits = value.replace(/\D/g, "");
    setTimeServings({ ...timeServings, [field]: digits });
  };

  const totalMinutes =
    (parseInt(prepTime, 10) || 0) + (parseInt(cookTime, 10) || 0);

  return (
    <View style={styles.container}>
      {/* Servings Stepper */}
      <View style={styles.servingsSection}>
        <Text style={[styles.sectionLabel, { color: theme.link }]}>
          SERVINGS
        </Text>
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => adjustServings(-1)}
            style={[
              styles.stepperButton,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.link, 0.25),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Decrease servings"
            disabled={servings <= 1}
          >
            <Feather
              name="minus"
              size={20}
              color={servings <= 1 ? theme.textSecondary : theme.link}
            />
          </Pressable>
          <Text style={[styles.servingsValue, { color: theme.text }]}>
            {servings}
          </Text>
          <Pressable
            onPress={() => adjustServings(1)}
            style={[
              styles.stepperButton,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.link, 0.25),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Increase servings"
            disabled={servings >= 99}
          >
            <Feather
              name="plus"
              size={20}
              color={servings >= 99 ? theme.textSecondary : theme.link}
            />
          </Pressable>
        </View>
      </View>

      {/* Time Inputs */}
      <View style={styles.timeRow}>
        <View style={styles.timeField}>
          <Text style={[styles.sectionLabel, { color: theme.link }]}>
            PREP TIME
          </Text>
          <View
            style={[
              styles.timeInputContainer,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.border, 0.5),
              },
            ]}
          >
            <TextInput
              style={[styles.timeInput, { color: theme.text }]}
              value={prepTime}
              onChangeText={(v) => setTime("prepTime", v)}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              textAlign="center"
              maxLength={4}
              accessibilityLabel="Prep time in minutes"
            />
            <Text style={[styles.timeUnit, { color: theme.textSecondary }]}>
              minutes
            </Text>
          </View>
        </View>

        <View style={styles.timeField}>
          <Text style={[styles.sectionLabel, { color: theme.link }]}>
            COOK TIME
          </Text>
          <View
            style={[
              styles.timeInputContainer,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.border, 0.5),
              },
            ]}
          >
            <TextInput
              style={[styles.timeInput, { color: theme.text }]}
              value={cookTime}
              onChangeText={(v) => setTime("cookTime", v)}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              textAlign="center"
              maxLength={4}
              accessibilityLabel="Cook time in minutes"
            />
            <Text style={[styles.timeUnit, { color: theme.textSecondary }]}>
              minutes
            </Text>
          </View>
        </View>
      </View>

      {totalMinutes > 0 && (
        <Text style={[styles.totalTime, { color: theme.textSecondary }]}>
          Total: {totalMinutes} minutes
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing["2xl"],
  },
  servingsSection: {
    alignItems: "center",
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    marginBottom: Spacing.sm,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xl,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  servingsValue: {
    fontFamily: FontFamily.bold,
    fontSize: 32,
    width: 50,
    textAlign: "center",
  },
  timeRow: {
    flexDirection: "row",
    gap: Spacing.lg,
  },
  timeField: {
    flex: 1,
    alignItems: "center",
  },
  timeInputContainer: {
    borderRadius: BorderRadius.xs,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
    width: "100%",
  },
  timeInput: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    padding: 0,
    width: "100%",
  },
  timeUnit: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    marginTop: 2,
  },
  totalTime: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    textAlign: "center",
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add client/components/recipe-wizard/InstructionsStep.tsx client/components/recipe-wizard/TimeServingsStep.tsx
git commit -m "feat: add InstructionsStep and TimeServingsStep wizard components"
```

---

### Task 6: NutritionStep and TagsStep

**Files:**

- Create: `client/components/recipe-wizard/NutritionStep.tsx`
- Create: `client/components/recipe-wizard/TagsStep.tsx`

- [ ] **Step 1: Create NutritionStep**

```tsx
// client/components/recipe-wizard/NutritionStep.tsx
import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { NutritionData } from "@/hooks/useRecipeForm";

interface NutritionStepProps {
  nutrition: NutritionData;
  setNutrition: (data: NutritionData) => void;
}

interface NutrientField {
  key: keyof NutritionData;
  label: string;
  unit: string;
  colorKey: "calorieAccent" | "proteinAccent" | "carbsAccent" | "fatAccent";
}

const FIELDS: NutrientField[] = [
  {
    key: "calories",
    label: "CALORIES",
    unit: "kcal",
    colorKey: "calorieAccent",
  },
  {
    key: "protein",
    label: "PROTEIN",
    unit: "grams",
    colorKey: "proteinAccent",
  },
  { key: "carbs", label: "CARBS", unit: "grams", colorKey: "carbsAccent" },
  { key: "fat", label: "FAT", unit: "grams", colorKey: "fatAccent" },
];

export default function NutritionStep({
  nutrition,
  setNutrition,
}: NutritionStepProps) {
  const theme = useTheme();

  const updateField = (key: keyof NutritionData, value: string) => {
    // Allow digits and one decimal point
    const cleaned = value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setNutrition({ ...nutrition, [key]: cleaned });
  };

  return (
    <View style={styles.grid}>
      {FIELDS.map((field) => (
        <View
          key={field.key}
          style={[
            styles.cell,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: withOpacity(theme.border, 0.5),
            },
          ]}
        >
          <Text style={[styles.cellLabel, { color: theme[field.colorKey] }]}>
            {field.label}
          </Text>
          <TextInput
            style={[styles.cellInput, { color: theme.text }]}
            value={nutrition[field.key]}
            onChangeText={(v) => updateField(field.key, v)}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={theme.textSecondary}
            textAlign="center"
            maxLength={7}
            accessibilityLabel={`${field.label} per serving`}
          />
          <Text style={[styles.cellUnit, { color: theme.textSecondary }]}>
            {field.unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  cell: {
    width: "47%",
    borderRadius: BorderRadius.xs,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  cellLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    marginBottom: Spacing.xs + 2,
  },
  cellInput: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    padding: 0,
    width: "100%",
  },
  cellUnit: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    marginTop: 2,
  },
});
```

- [ ] **Step 2: Create TagsStep**

```tsx
// client/components/recipe-wizard/TagsStep.tsx
import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { DIET_TAG_OPTIONS, type DietTag } from "./types";
import type { TagsData } from "@/hooks/useRecipeForm";

interface TagsStepProps {
  tags: TagsData;
  setTags: (data: TagsData) => void;
}

export default function TagsStep({ tags, setTags }: TagsStepProps) {
  const theme = useTheme();

  const toggleTag = (tag: DietTag) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = tags.dietTags.includes(tag)
      ? tags.dietTags.filter((t) => t !== tag)
      : [...tags.dietTags, tag];
    setTags({ ...tags, dietTags: next });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Cuisine */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: theme.link }]}>
          CUISINE
        </Text>
        <View
          style={[
            styles.cuisineInput,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: withOpacity(theme.border, 0.5),
            },
          ]}
        >
          <TextInput
            style={[styles.input, { color: theme.text }]}
            value={tags.cuisine}
            onChangeText={(cuisine) => setTags({ ...tags, cuisine })}
            placeholder="e.g., Italian, Mexican, Thai"
            placeholderTextColor={theme.textSecondary}
            maxLength={100}
            accessibilityLabel="Cuisine type"
          />
          {tags.cuisine && (
            <View
              style={[
                styles.suggestedBadge,
                { backgroundColor: withOpacity(theme.warning, 0.15) },
              ]}
            >
              <Text style={[styles.suggestedText, { color: theme.warning }]}>
                suggested
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Diet Tags */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: theme.link }]}>
          DIET TAGS
        </Text>
        <View style={styles.tagsGrid}>
          {DIET_TAG_OPTIONS.map((tag) => {
            const isActive = tags.dietTags.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => toggleTag(tag)}
                style={[
                  styles.tagChip,
                  isActive
                    ? { backgroundColor: theme.link }
                    : {
                        backgroundColor: theme.backgroundSecondary,
                        borderColor: withOpacity(theme.border, 0.5),
                        borderWidth: 1,
                      },
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isActive }}
                accessibilityLabel={tag}
              >
                <Text
                  style={[
                    styles.tagText,
                    { color: isActive ? "#FFFFFF" : theme.text },
                  ]}
                >
                  {tag}
                  {isActive ? " ✓" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
  },
  cuisineInput: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.regular,
    padding: 0,
  },
  suggestedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  suggestedText: {
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
  tagsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.chipFilled,
  },
  tagText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add client/components/recipe-wizard/NutritionStep.tsx client/components/recipe-wizard/TagsStep.tsx
git commit -m "feat: add NutritionStep and TagsStep wizard components"
```

---

### Task 7: PreviewStep

**Files:**

- Create: `client/components/recipe-wizard/PreviewStep.tsx`

- [ ] **Step 1: Create PreviewStep**

```tsx
// client/components/recipe-wizard/PreviewStep.tsx
import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { useRecipeForm } from "@/hooks/useRecipeForm";
import type { WizardStep } from "./types";

interface PreviewStepProps {
  form: ReturnType<typeof useRecipeForm>;
  onEditStep: (step: WizardStep) => void;
}

export default function PreviewStep({ form, onEditStep }: PreviewStepProps) {
  const theme = useTheme();

  const totalTime =
    (parseInt(form.timeServings.prepTime, 10) || 0) +
    (parseInt(form.timeServings.cookTime, 10) || 0);

  const filledIngredients = form.ingredients.filter((i) => i.text.trim());
  const filledSteps = form.steps.filter((s) => s.text.trim());

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View
        style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}
      >
        {/* Image placeholder */}
        <View
          style={[
            styles.imagePlaceholder,
            { backgroundColor: withOpacity(theme.link, 0.08) },
          ]}
        >
          <Feather name="image" size={20} color={theme.link} />
          <Text style={[styles.imagePlaceholderText, { color: theme.link }]}>
            Image will be generated after save
          </Text>
        </View>

        <View style={styles.cardBody}>
          {/* Title */}
          <PreviewSection
            label={form.title}
            onEdit={() => onEditStep(1)}
            theme={theme}
          >
            {form.description ? (
              <Text
                style={[styles.descriptionText, { color: theme.textSecondary }]}
              >
                {form.description}
              </Text>
            ) : null}
          </PreviewSection>

          {/* Meta row */}
          <Pressable onPress={() => onEditStep(4)} style={styles.metaRow}>
            <View style={styles.metaContent}>
              {totalTime > 0 && (
                <Text style={[styles.metaItem, { color: theme.textSecondary }]}>
                  ⏱ {totalTime} min
                </Text>
              )}
              <Text style={[styles.metaItem, { color: theme.textSecondary }]}>
                🍽 {form.timeServings.servings} serving
                {form.timeServings.servings !== 1 ? "s" : ""}
              </Text>
              {form.tags.cuisine ? (
                <Text style={[styles.metaItem, { color: theme.textSecondary }]}>
                  {form.tags.cuisine}
                </Text>
              ) : null}
            </View>
            <EditButton onPress={() => onEditStep(4)} theme={theme} />
          </Pressable>

          {/* Ingredients */}
          <PreviewSection
            label={`Ingredients (${filledIngredients.length})`}
            onEdit={() => onEditStep(2)}
            theme={theme}
          >
            <Text
              style={[styles.summaryText, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {filledIngredients.map((i) => `• ${i.text.trim()}`).join("  ")}
            </Text>
          </PreviewSection>

          {/* Instructions */}
          <PreviewSection
            label={`Instructions (${filledSteps.length} step${filledSteps.length !== 1 ? "s" : ""})`}
            onEdit={() => onEditStep(3)}
            theme={theme}
          >
            <Text
              style={[styles.summaryText, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {filledSteps
                .map((s, i) => `${i + 1}. ${s.text.trim()}`)
                .join("  ")}
            </Text>
          </PreviewSection>

          {/* Nutrition */}
          <PreviewSection
            label="Nutrition"
            onEdit={() => onEditStep(5)}
            theme={theme}
          >
            {form.nutrition.calories ||
            form.nutrition.protein ||
            form.nutrition.carbs ||
            form.nutrition.fat ? (
              <View style={styles.nutritionRow}>
                {form.nutrition.calories ? (
                  <Text
                    style={[styles.macroText, { color: theme.calorieAccent }]}
                  >
                    {form.nutrition.calories} cal
                  </Text>
                ) : null}
                {form.nutrition.protein ? (
                  <Text
                    style={[styles.macroText, { color: theme.proteinAccent }]}
                  >
                    {form.nutrition.protein}g protein
                  </Text>
                ) : null}
                {form.nutrition.carbs ? (
                  <Text
                    style={[styles.macroText, { color: theme.carbsAccent }]}
                  >
                    {form.nutrition.carbs}g carbs
                  </Text>
                ) : null}
                {form.nutrition.fat ? (
                  <Text style={[styles.macroText, { color: theme.fatAccent }]}>
                    {form.nutrition.fat}g fat
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text
                style={[styles.summaryText, { color: theme.textSecondary }]}
              >
                Not specified
              </Text>
            )}
          </PreviewSection>

          {/* Tags */}
          <PreviewSection
            label="Tags"
            onEdit={() => onEditStep(6)}
            theme={theme}
          >
            {form.tags.dietTags.length > 0 ? (
              <View style={styles.tagsRow}>
                {form.tags.dietTags.map((tag) => (
                  <View
                    key={tag}
                    style={[
                      styles.tagChip,
                      { backgroundColor: withOpacity(theme.link, 0.15) },
                    ]}
                  >
                    <Text style={[styles.tagChipText, { color: theme.link }]}>
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text
                style={[styles.summaryText, { color: theme.textSecondary }]}
              >
                None
              </Text>
            )}
          </PreviewSection>
        </View>
      </View>
    </ScrollView>
  );
}

function EditButton({
  onPress,
  theme,
}: {
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Edit"
    >
      <Text style={[editStyles.text, { color: theme.link }]}>Edit ✎</Text>
    </Pressable>
  );
}

const editStyles = StyleSheet.create({
  text: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
});

function PreviewSection({
  label,
  onEdit,
  theme,
  children,
}: {
  label: string;
  onEdit: () => void;
  theme: ReturnType<typeof useTheme>;
  children?: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Text style={[sectionStyles.label, { color: theme.link }]}>
          {label}
        </Text>
        <EditButton onPress={onEdit} theme={theme} />
      </View>
      {children}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing.md,
  },
  card: {
    borderRadius: BorderRadius.card,
    overflow: "hidden",
  },
  imagePlaceholder: {
    height: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  imagePlaceholderText: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  cardBody: {
    padding: 14,
  },
  descriptionText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  metaContent: {
    flex: 1,
    flexDirection: "row",
    gap: Spacing.md,
  },
  metaItem: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
  },
  summaryText: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
    lineHeight: 16,
  },
  nutritionRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  macroText: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  tagsRow: {
    flexDirection: "row",
    gap: Spacing.xs + 2,
    flexWrap: "wrap",
  },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tagChipText: {
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add client/components/recipe-wizard/PreviewStep.tsx
git commit -m "feat: add PreviewStep wizard component with edit links"
```

---

### Task 8: Rewrite RecipeCreateScreen to use WizardShell

**Files:**

- Modify: `client/screens/meal-plan/RecipeCreateScreen.tsx`

- [ ] **Step 1: Rewrite RecipeCreateScreen**

Replace the entire contents of `client/screens/meal-plan/RecipeCreateScreen.tsx`:

```tsx
// client/screens/meal-plan/RecipeCreateScreen.tsx
import React, { useCallback, useEffect } from "react";
import { Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import WizardShell from "@/components/recipe-wizard/WizardShell";
import { useRecipeForm } from "@/hooks/useRecipeForm";

type RecipeCreateScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeCreate"
>;

type RecipeCreateRouteProp = RouteProp<MealPlanStackParamList, "RecipeCreate">;

export default function RecipeCreateScreen() {
  const navigation = useNavigation<RecipeCreateScreenNavigationProp>();
  const route = useRoute<RecipeCreateRouteProp>();
  const { prefill, returnToMealPlan } = route.params ?? {};

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSaveComplete = useCallback(() => {
    if (returnToMealPlan) {
      navigation.popToTop();
    } else {
      navigation.goBack();
    }
  }, [navigation, returnToMealPlan]);

  // Unsaved changes guard is handled inside WizardShell via form.isDirty.
  // We also add a navigation guard here for the hardware back button.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      // Let programmatic navigation through (from handleGoBack/handleSaveComplete)
      if (e.data.action.type === "POP_TO_TOP") return;

      // The WizardShell internally tracks dirty state.
      // We rely on the shell's own back button handling for dirty checks.
    });

    return unsubscribe;
  }, [navigation]);

  return (
    <WizardShell
      prefill={prefill}
      returnToMealPlan={returnToMealPlan}
      onGoBack={handleGoBack}
      onSaveComplete={handleSaveComplete}
    />
  );
}
```

- [ ] **Step 2: Run type check**

```bash
npm run check:types
```

Expected: No type errors.

- [ ] **Step 3: Run tests**

```bash
npm run test:run
```

Expected: All existing tests pass (the old RecipeCreateScreen tests, if any, may need updating if they test the bottom-sheet structure directly).

- [ ] **Step 4: Commit**

```bash
git add client/screens/meal-plan/RecipeCreateScreen.tsx
git commit -m "feat: rewrite RecipeCreateScreen to use WizardShell"
```

---

### Task 9: RecipeEntryHubScreen

**Files:**

- Modify: `client/screens/meal-plan/RecipeEntryHubScreen.tsx` (replace placeholder)

- [ ] **Step 1: Implement RecipeEntryHubScreen**

Replace the placeholder file:

```tsx
// client/screens/meal-plan/RecipeEntryHubScreen.tsx
import React, { useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  AccessibilityInfo,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type EntryHubNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeEntryHub"
>;

type EntryHubRouteProp = RouteProp<MealPlanStackParamList, "RecipeEntryHub">;

interface ActionCard {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  gradientColors: [string, string];
  title: string;
  description: string;
  onPress: () => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ActionCardItem({ card }: { card: ActionCard }) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
  };

  const onPressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return (
    <AnimatedPressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        card.onPress();
      }}
      style={[
        animatedStyle,
        styles.card,
        { backgroundColor: theme.backgroundSecondary },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${card.title}. ${card.description}`}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: card.gradientColors[0] },
        ]}
      >
        <Feather name={card.icon} size={20} color="#FFFFFF" />
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          {card.title}
        </Text>
        <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
          {card.description}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.textSecondary} />
    </AnimatedPressable>
  );
}

export default function RecipeEntryHubScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<EntryHubNavigationProp>();
  const route = useRoute<EntryHubRouteProp>();
  const returnToMealPlan = route.params?.returnToMealPlan;

  const cards: ActionCard[] = [
    {
      id: "write",
      icon: "edit-2",
      gradientColors: ["#7c6ffa", "#a78bfa"],
      title: "Write from scratch",
      description: "Type your own recipe step by step",
      onPress: () => navigation.navigate("RecipeCreate", { returnToMealPlan }),
    },
    {
      id: "ai",
      icon: "zap",
      gradientColors: ["#f59e0b", "#fbbf24"],
      title: "Generate with AI",
      description: "Describe what you want, AI does the rest",
      onPress: () =>
        navigation.navigate("RecipeAIGenerate", { returnToMealPlan }),
    },
    {
      id: "url",
      icon: "link",
      gradientColors: ["#22c55e", "#4ade80"],
      title: "Import from URL",
      description: "Paste a link from any recipe site",
      onPress: () => navigation.navigate("RecipeImport", { returnToMealPlan }),
    },
    {
      id: "photo",
      icon: "camera",
      gradientColors: ["#3b82f6", "#60a5fa"],
      title: "Scan a recipe",
      description: "Take a photo of a cookbook or card",
      onPress: () => {
        // Photo import needs a photoUri, so we launch the camera/picker first.
        // For now, navigate to RecipePhotoImport with a picker flow.
        // This will be handled by the existing photo capture flow.
        navigation.navigate(
          "RecipePhotoImport" as never,
          { returnToMealPlan } as never,
        );
      },
    },
    {
      id: "browse",
      icon: "search",
      gradientColors: ["#ec4899", "#f472b6"],
      title: "Browse recipes",
      description: "Search community & catalog recipes",
      onPress: () => navigation.navigate("RecipeBrowser", {}),
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
      ]}
    >
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        How would you like to start?
      </Text>

      <View style={styles.cardList}>
        {cards.map((card) => (
          <ActionCardItem key={card.id} card={card} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    textAlign: "center",
  },
  cardList: {
    gap: Spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: BorderRadius.card,
    gap: 14,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
  cardDescription: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    marginTop: 2,
  },
});
```

**Note on "Scan a recipe" card:** The photo import screen requires a `photoUri` param. The entry hub should launch an image picker or camera first, then navigate to `RecipePhotoImport` with the result. Alternatively, the entry hub card can navigate to a simple picker screen. For the initial implementation, use `as never` to navigate — the photo flow will need to be adapted in Task 11 to support launching from the hub (either adding a picker wrapper or making `photoUri` optional on `RecipePhotoImport`).

- [ ] **Step 2: Update RecipeBrowserScreen to navigate to RecipeEntryHub instead of RecipeCreate**

Find where `RecipeBrowserScreen` has navigation to `RecipeCreate` for the "New Recipe" button and update it to navigate to `RecipeEntryHub` instead. Search for `navigate("RecipeCreate"` or `navigate('RecipeCreate'` in `RecipeBrowserScreen.tsx` and replace with `navigate("RecipeEntryHub"`.

- [ ] **Step 3: Run type check**

```bash
npm run check:types
```

- [ ] **Step 4: Commit**

```bash
git add client/screens/meal-plan/RecipeEntryHubScreen.tsx client/screens/meal-plan/RecipeBrowserScreen.tsx
git commit -m "feat: add RecipeEntryHubScreen with 5 action cards"
```

---

### Task 10: Backend recipe-generate endpoint

**Files:**

- Create: `server/routes/recipe-generate.ts`
- Create: `server/routes/__tests__/recipe-generate.test.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Write route tests**

```ts
// server/routes/__tests__/recipe-generate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../recipe-generate";
import { generateRecipeContent } from "../../services/recipe-generation";

vi.mock("../../services/recipe-generation", () => ({
  generateRecipeContent: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("POST /api/meal-plan/recipes/generate", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is too short", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({ prompt: "ab" });

    expect(res.status).toBe(400);
  });

  it("returns ImportedRecipeData on success", async () => {
    vi.mocked(generateRecipeContent).mockResolvedValue({
      title: "Chicken Stir Fry",
      description: "A quick weeknight dinner",
      difficulty: "Easy",
      timeEstimate: "25 minutes",
      ingredients: [
        { name: "chicken breast", quantity: "2", unit: "pieces" },
        { name: "soy sauce", quantity: "3", unit: "tbsp" },
      ],
      instructions: ["Cut chicken", "Stir fry with sauce"],
      dietTags: ["Dairy Free", "Gluten Free"],
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({ prompt: "quick chicken stir fry" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Chicken Stir Fry");
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.ingredients[0]).toEqual({
      name: "chicken breast",
      quantity: "2",
      unit: "pieces",
    });
    expect(res.body.instructions).toEqual([
      "Cut chicken",
      "Stir fry with sauce",
    ]);
    expect(res.body.dietTags).toEqual(["Dairy Free", "Gluten Free"]);
    expect(res.body.sourceUrl).toBe("");
  });

  it("returns 500 when generation fails", async () => {
    vi.mocked(generateRecipeContent).mockRejectedValue(
      new Error("OpenAI error"),
    );

    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({ prompt: "chocolate cake" });

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/routes/__tests__/recipe-generate.test.ts
```

Expected: FAIL — `../recipe-generate` module not found.

- [ ] **Step 3: Implement the route**

```ts
// server/routes/recipe-generate.ts
import type { Express, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { generateRecipeContent } from "../services/recipe-generation";
import { sendError, ErrorCode } from "../lib/errors";
import { createServiceLogger, toError } from "../lib/logger";
import type {
  ImportedRecipeData,
  ParsedIngredient,
} from "@shared/types/recipe-import";

const log = createServiceLogger("recipe-generate");

const generateRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { error: "Too many generation requests, please wait a moment" },
});

const generateSchema = z.object({
  prompt: z.string().min(3).max(500),
});

export function register(app: Express): void {
  app.post(
    "/api/meal-plan/recipes/generate",
    requireAuth,
    generateRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          "Prompt must be 3-500 characters",
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }

      const { prompt } = parsed.data;

      try {
        const content = await generateRecipeContent({
          productName: prompt,
          userProfile: null,
        });

        // Parse timeEstimate string to minutes (e.g., "25 minutes" → 25)
        const timeMinutes = parseInt(content.timeEstimate, 10) || null;

        // Convert GeneratedIngredient[] to ParsedIngredient[]
        const ingredients: ParsedIngredient[] = content.ingredients.map(
          (ing) => ({
            name: ing.name,
            quantity: ing.quantity || null,
            unit: ing.unit || null,
          }),
        );

        const result: ImportedRecipeData = {
          title: content.title,
          description: content.description,
          servings: null,
          prepTimeMinutes: null,
          cookTimeMinutes: timeMinutes,
          cuisine: null,
          dietTags: content.dietTags,
          ingredients,
          instructions: content.instructions,
          imageUrl: null,
          caloriesPerServing: null,
          proteinPerServing: null,
          carbsPerServing: null,
          fatPerServing: null,
          sourceUrl: "",
        };

        res.json(result);
      } catch (error) {
        log.error({ err: toError(error) }, "recipe generation failed");
        sendError(
          res,
          500,
          "Failed to generate recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
```

- [ ] **Step 4: Register route in server/routes.ts**

Add to `server/routes.ts`:

```ts
// Add import at top:
import { register as registerRecipeGenerate } from "./routes/recipe-generate";

// Add registration after registerMealPlan(app):
registerRecipeGenerate(app);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run server/routes/__tests__/recipe-generate.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/recipe-generate.ts server/routes/__tests__/recipe-generate.test.ts server/routes.ts
git commit -m "feat: add POST /api/meal-plan/recipes/generate endpoint"
```

---

### Task 11: RecipeAIGenerateScreen and hook

**Files:**

- Create: `client/hooks/useRecipeGenerate.ts`
- Modify: `client/screens/meal-plan/RecipeAIGenerateScreen.tsx` (replace placeholder)

- [ ] **Step 1: Create useRecipeGenerate hook**

```ts
// client/hooks/useRecipeGenerate.ts
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

export function useRecipeGenerate() {
  return useMutation({
    mutationFn: async (prompt: string): Promise<ImportedRecipeData> => {
      const res = await apiRequest("POST", "/api/meal-plan/recipes/generate", {
        prompt,
      });
      return res.json();
    },
  });
}
```

- [ ] **Step 2: Implement RecipeAIGenerateScreen**

Replace the placeholder:

```tsx
// client/screens/meal-plan/RecipeAIGenerateScreen.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useRecipeGenerate } from "@/hooks/useRecipeGenerate";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type AIGenerateNavProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeAIGenerate"
>;

type AIGenerateRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeAIGenerate"
>;

const SUGGESTION_CHIPS = [
  "Quick dinner",
  "Healthy lunch",
  "Comfort food",
  "Dessert",
  "Meal prep",
  "Snack",
];

export default function RecipeAIGenerateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<AIGenerateNavProp>();
  const route = useRoute<AIGenerateRouteProp>();
  const returnToMealPlan = route.params?.returnToMealPlan;

  const [prompt, setPrompt] = useState("");
  const generateMutation = useRecipeGenerate();

  const handleGenerate = async () => {
    if (prompt.trim().length < 3) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await generateMutation.mutateAsync(prompt.trim());
      navigation.replace("RecipeCreate", {
        prefill: result,
        returnToMealPlan,
      });
    } catch {
      // Error state shown inline
    }
  };

  const handleChipPress = (chip: string) => {
    setPrompt(chip);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Icon */}
        <View style={styles.iconSection}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: withOpacity("#f59e0b", 0.15) },
            ]}
          >
            <Feather name="zap" size={32} color="#f59e0b" />
          </View>
        </View>

        {/* Prompt Input */}
        <View style={styles.inputSection}>
          <TextInput
            style={[
              styles.promptInput,
              {
                backgroundColor: theme.backgroundSecondary,
                color: theme.text,
                borderColor: withOpacity(theme.link, 0.25),
              },
            ]}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What do you want to make? e.g., 'Chicken stir fry with vegetables' or 'a quick weeknight pasta'"
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={500}
            autoFocus
            textAlignVertical="top"
            accessibilityLabel="Describe the recipe you want to generate"
          />
        </View>

        {/* Suggestion Chips */}
        <View style={styles.chipsSection}>
          <Text style={[styles.chipsLabel, { color: theme.textSecondary }]}>
            Or try:
          </Text>
          <View style={styles.chipsRow}>
            {SUGGESTION_CHIPS.map((chip) => (
              <Pressable
                key={chip}
                onPress={() => handleChipPress(chip)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: withOpacity(theme.border, 0.5),
                  },
                ]}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, { color: theme.text }]}>
                  {chip}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Error */}
        {generateMutation.isError && (
          <Animated.View
            entering={FadeIn.duration(200)}
            style={styles.errorContainer}
          >
            <Text style={[styles.errorText, { color: theme.error }]}>
              Failed to generate recipe. Please try again.
            </Text>
          </Animated.View>
        )}

        {/* Generate Button */}
        <Pressable
          onPress={handleGenerate}
          disabled={prompt.trim().length < 3 || generateMutation.isPending}
          style={[
            styles.generateButton,
            {
              backgroundColor: theme.link,
              opacity:
                prompt.trim().length < 3 || generateMutation.isPending
                  ? 0.5
                  : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Generate recipe"
        >
          {generateMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.generateButtonText}>
                Creating your recipe...
              </Text>
            </View>
          ) : (
            <Text style={styles.generateButtonText}>Generate Recipe</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.xl,
  },
  iconSection: {
    alignItems: "center",
    paddingTop: Spacing.xl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  inputSection: {},
  promptInput: {
    borderRadius: BorderRadius.sm,
    padding: 16,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
    minHeight: 100,
    lineHeight: 22,
  },
  chipsSection: {
    gap: Spacing.sm,
  },
  chipsLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.chipFilled,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
  },
  errorContainer: {
    alignItems: "center",
  },
  errorText: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
  },
  generateButton: {
    paddingVertical: 14,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  generateButtonText: {
    color: "#FFFFFF",
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
});
```

- [ ] **Step 3: Run type check**

```bash
npm run check:types
```

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useRecipeGenerate.ts client/screens/meal-plan/RecipeAIGenerateScreen.tsx
git commit -m "feat: add RecipeAIGenerateScreen with AI recipe generation"
```

---

### Task 12: Modify RecipeImportScreen to route through wizard

**Files:**

- Modify: `client/screens/meal-plan/RecipeImportScreen.tsx`

- [ ] **Step 1: Modify the import success flow**

In `RecipeImportScreen.tsx`, find the handler that runs after a successful import (the function called when `importMutation` succeeds). Instead of saving the recipe directly, navigate to the wizard with prefill.

Find the code that calls `createRecipeMutation` or `addItemMutation` after import, and replace it with:

```ts
// After importMutation succeeds and you have the importedData:
navigation.replace("RecipeCreate", {
  prefill: importedData,
  returnToMealPlan,
});
```

The specific change depends on the current flow structure. The key points:

1. Remove the direct save after URL extraction
2. Instead, navigate to `RecipeCreate` with the imported data as `prefill`
3. Keep the `returnToMealPlan` param passing through

Read the file to find the exact location. Look for where `useImportRecipeFromUrl` result is used and where the success handler navigates. The imported data should already be in `ImportedRecipeData` format — pass it directly as `prefill`.

- [ ] **Step 2: Run type check**

```bash
npm run check:types
```

- [ ] **Step 3: Commit**

```bash
git add client/screens/meal-plan/RecipeImportScreen.tsx
git commit -m "refactor: route RecipeImportScreen through wizard with prefill"
```

---

### Task 13: Modify RecipePhotoImportScreen to route through wizard

**Files:**

- Modify: `client/screens/meal-plan/RecipePhotoImportScreen.tsx`

- [ ] **Step 1: Modify the photo import success flow**

In `RecipePhotoImportScreen.tsx`, find the `handleSave` function. Instead of calling `createRecipeMutation.mutateAsync()` directly, convert the photo result to `ImportedRecipeData` and navigate to the wizard.

The file already has a `handleEdit` function that calls `mapPhotoResultToImportedRecipeData(result)` and navigates to `RecipeCreate` with prefill. Make the save flow use the same pattern — always route through the wizard:

```ts
const handleSave = async () => {
  // Convert photo result to ImportedRecipeData
  const prefill = mapPhotoResultToImportedRecipeData(result);
  navigation.replace("RecipeCreate", {
    prefill,
    returnToMealPlan,
  });
};
```

This means the separate "Edit" and "Save" buttons on the photo review screen both lead to the wizard — the only difference is the user intent (but they can review/edit in the wizard either way).

- [ ] **Step 2: Run type check**

```bash
npm run check:types
```

- [ ] **Step 3: Commit**

```bash
git add client/screens/meal-plan/RecipePhotoImportScreen.tsx
git commit -m "refactor: route RecipePhotoImportScreen through wizard with prefill"
```

---

### Task 14: Remove old recipe-builder components and final cleanup

**Files:**

- Delete: `client/components/recipe-builder/SectionRow.tsx`
- Delete: `client/components/recipe-builder/SheetHeader.tsx`
- Delete: `client/components/recipe-builder/IngredientsSheet.tsx`
- Delete: `client/components/recipe-builder/InstructionsSheet.tsx`
- Delete: `client/components/recipe-builder/TimeServingsSheet.tsx`
- Delete: `client/components/recipe-builder/NutritionSheet.tsx`
- Delete: `client/components/recipe-builder/TagsCuisineSheet.tsx`
- Modify: `client/components/recipe-builder/types.ts` (keep but re-export from wizard)

- [ ] **Step 1: Check for other imports of recipe-builder components**

Search for any files that import from the recipe-builder components being deleted:

```bash
grep -r "recipe-builder/" client/ --include="*.ts" --include="*.tsx" -l
```

The only file that should still import from `recipe-builder/types.ts` is `useRecipeForm.ts`, which was already updated in Task 2 to import from `recipe-wizard/types.ts`.

If any other files import from `recipe-builder/`, update them first.

- [ ] **Step 2: Update recipe-builder/types.ts to re-export**

Replace `client/components/recipe-builder/types.ts` with a re-export to avoid breaking any missed imports:

```ts
// client/components/recipe-builder/types.ts
// Re-export from new location for backwards compatibility
export { DIET_TAG_OPTIONS, type DietTag } from "../recipe-wizard/types";
export type { SectionRowProps } from "../recipe-wizard/types";
```

Actually, since `SectionRowProps` no longer exists in the new types, and no other code should reference it, just re-export what exists:

```ts
// client/components/recipe-builder/types.ts
// Deprecated: import from @/components/recipe-wizard/types instead
export { DIET_TAG_OPTIONS, type DietTag } from "../recipe-wizard/types";
```

- [ ] **Step 3: Delete old recipe-builder sheet components**

```bash
rm client/components/recipe-builder/SectionRow.tsx
rm client/components/recipe-builder/SheetHeader.tsx
rm client/components/recipe-builder/IngredientsSheet.tsx
rm client/components/recipe-builder/InstructionsSheet.tsx
rm client/components/recipe-builder/TimeServingsSheet.tsx
rm client/components/recipe-builder/NutritionSheet.tsx
rm client/components/recipe-builder/TagsCuisineSheet.tsx
```

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```

Expected: All tests pass. If any tests import deleted files, update or remove those tests.

- [ ] **Step 5: Run type check**

```bash
npm run check:types
```

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove old recipe-builder sheet components, replaced by wizard"
```

---

### Task 15: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

```bash
npm run server:dev &
```

Wait for "express server serving on port 3000"

- [ ] **Step 2: Start the Expo app**

```bash
npx expo run:ios
```

- [ ] **Step 3: Test the Entry Hub**

Navigate to Plan tab → tap "Add Recipe" on RecipeBrowser → verify you see the Entry Hub with 5 action cards.

- [ ] **Step 4: Test "Write from scratch" flow**

Tap "Write from scratch" → verify you land on wizard step 1. Fill in:

- Title: "Test Recipe" → tap Next
- Ingredients: "2 cups flour", "1 cup sugar" → tap Next
- Instructions: "Mix ingredients", "Bake at 350°F" → tap Next
- Time & Servings: 4 servings, 10 min prep, 30 min cook → tap Next
- Nutrition: skip → verify button says "Skip" → tap Skip
- Tags: verify cuisine is auto-suggested (or empty), toggle a tag → tap Next
- Preview: verify all data shows correctly, tap "Edit ✎" on ingredients → verify it jumps to step 2, tap Next → verify it returns to Preview
- Tap "Save Recipe" → verify success and navigation back

- [ ] **Step 5: Test "Generate with AI" flow**

Tap "Generate with AI" → type "chocolate chip cookies" → tap "Generate Recipe" → verify loading state → verify it lands in wizard with prefilled data → review in Preview → Save.

- [ ] **Step 6: Test "Import from URL" flow**

Tap "Import from URL" → paste a recipe URL → verify it extracts and lands in wizard with prefilled data.

- [ ] **Step 7: Run full test suite one more time**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: end-to-end verification fixes for recipe wizard"
```
