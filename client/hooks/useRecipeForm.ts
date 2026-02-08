import { useState, useMemo, useCallback } from "react";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import type { DietTag } from "@/components/recipe-builder/types";
import { parseIngredientText } from "@/lib/ingredient-parser";

export interface IngredientRow {
  key: string;
  text: string;
}

export interface StepRow {
  key: string;
  text: string;
}

export interface TimeServingsData {
  servings: number;
  prepTime: string;
  cookTime: string;
}

export interface NutritionData {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export interface TagsData {
  cuisine: string;
  dietTags: DietTag[];
}

// Module-level counters ensure unique keys across all hook instances.
// They intentionally persist across mounts to avoid key collisions.
let ingredientKeyCounter = 0;
function nextIngredientKey() {
  return `ing_${++ingredientKeyCounter}`;
}

let stepKeyCounter = 0;
function nextStepKey() {
  return `step_${++stepKeyCounter}`;
}

/** Serialize step texts to numbered instruction string */
export function serializeSteps(steps: string[]): string {
  return steps
    .filter((s) => s.trim())
    .map((s, i) => `${i + 1}. ${s.trim()}`)
    .join("\n");
}

/** Deserialize instruction string to step texts */
export function deserializeSteps(text: string): string[] {
  if (!text.trim()) return [];
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|Step\s+\d+[:.]\s*)/i, ""))
    .filter((s) => s.trim());
}

function buildIngredientsFromPrefill(
  prefill: ImportedRecipeData | undefined,
): IngredientRow[] {
  if (prefill?.ingredients?.length) {
    return prefill.ingredients.map((ing) => ({
      key: nextIngredientKey(),
      text: [ing.quantity, ing.unit, ing.name].filter(Boolean).join(" "),
    }));
  }
  return [{ key: nextIngredientKey(), text: "" }];
}

function buildStepsFromPrefill(
  prefill: ImportedRecipeData | undefined,
): StepRow[] {
  if (prefill?.instructions) {
    const steps = deserializeSteps(prefill.instructions);
    if (steps.length > 0) {
      return steps.map((s) => ({ key: nextStepKey(), text: s }));
    }
  }
  return [{ key: nextStepKey(), text: "" }];
}

export function useRecipeForm(prefill?: ImportedRecipeData) {
  // ── Title & Description ──
  const [title, setTitle] = useState(prefill?.title || "");
  const [description, setDescription] = useState(prefill?.description || "");

  // ── Ingredients ──
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    buildIngredientsFromPrefill(prefill),
  );

  // ── Instructions ──
  const [steps, setSteps] = useState<StepRow[]>(() =>
    buildStepsFromPrefill(prefill),
  );

  // ── Time & Servings ──
  const [timeServings, setTimeServings] = useState<TimeServingsData>({
    servings: prefill?.servings ?? 2,
    prepTime: prefill?.prepTimeMinutes ? String(prefill.prepTimeMinutes) : "",
    cookTime: prefill?.cookTimeMinutes ? String(prefill.cookTimeMinutes) : "",
  });

  // ── Nutrition ──
  const [nutrition, setNutrition] = useState<NutritionData>({
    calories: prefill?.caloriesPerServing ?? "",
    protein: prefill?.proteinPerServing ?? "",
    carbs: prefill?.carbsPerServing ?? "",
    fat: prefill?.fatPerServing ?? "",
  });

  // ── Tags & Cuisine ──
  const [tags, setTags] = useState<TagsData>({
    cuisine: prefill?.cuisine || "",
    dietTags: (prefill?.dietTags as DietTag[]) || [],
  });

  // ── Ingredient Actions ──
  const addIngredient = useCallback(() => {
    setIngredients((prev) => [...prev, { key: nextIngredientKey(), text: "" }]);
  }, []);

  const removeIngredient = useCallback((key: string) => {
    setIngredients((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((i) => i.key !== key);
    });
  }, []);

  const updateIngredient = useCallback((key: string, text: string) => {
    setIngredients((prev) =>
      prev.map((i) => (i.key === key ? { ...i, text } : i)),
    );
  }, []);

  // ── Step Actions ──
  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, { key: nextStepKey(), text: "" }]);
  }, []);

  const removeStep = useCallback((key: string) => {
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.key !== key);
    });
  }, []);

  const updateStep = useCallback((key: string, text: string) => {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, text } : s)));
  }, []);

  const moveStep = useCallback((key: string, direction: "up" | "down") => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx === -1) return prev;
      if (direction === "up" && idx === 0) return prev;
      if (direction === "down" && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  // ── Summaries ──
  const ingredientsSummary = useMemo(() => {
    const filled = ingredients.filter((i) => i.text.trim());
    return filled.length > 0
      ? `${filled.length} ingredient${filled.length !== 1 ? "s" : ""}`
      : undefined;
  }, [ingredients]);

  const instructionsSummary = useMemo(() => {
    const filled = steps.filter((s) => s.text.trim());
    if (filled.length === 0) return undefined;
    const first = filled[0].text.trim();
    const truncated = first.length > 40 ? first.slice(0, 40) + "..." : first;
    return `Step 1: ${truncated}`;
  }, [steps]);

  const timeServingsSummary = useMemo(() => {
    const { servings, prepTime, cookTime } = timeServings;
    const parts: string[] = [];
    if (servings !== 2 || prepTime || cookTime) {
      parts.push(`${servings} serving${servings !== 1 ? "s" : ""}`);
    }
    const total = (parseInt(prepTime, 10) || 0) + (parseInt(cookTime, 10) || 0);
    if (total > 0) parts.push(`${total} min`);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }, [timeServings]);

  const nutritionSummary = useMemo(() => {
    const { calories, protein } = nutrition;
    const parts: string[] = [];
    if (calories) parts.push(`${calories} cal`);
    if (protein) parts.push(`${protein}g protein`);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }, [nutrition]);

  const tagsSummary = useMemo(() => {
    const parts: string[] = [];
    if (tags.cuisine) parts.push(tags.cuisine);
    parts.push(...tags.dietTags.slice(0, 3));
    if (tags.dietTags.length > 3) {
      parts.push(`+${tags.dietTags.length - 3} more`);
    }
    return parts.length > 0 ? parts.join(", ") : undefined;
  }, [tags]);

  // ── Dirty Check ──
  const isDirty = useMemo(() => {
    if (title.trim()) return true;
    if (description.trim()) return true;
    if (ingredients.some((i) => i.text.trim())) return true;
    if (steps.some((s) => s.text.trim())) return true;
    if (timeServings.prepTime || timeServings.cookTime) return true;
    if (timeServings.servings !== 2) return true;
    if (nutrition.calories || nutrition.protein) return true;
    if (nutrition.carbs || nutrition.fat) return true;
    if (tags.cuisine || tags.dietTags.length > 0) return true;
    return false;
  }, [title, description, ingredients, steps, timeServings, nutrition, tags]);

  // ── Serialize to mutation payload ──
  const formToPayload = useCallback(() => {
    const validIngredients = ingredients
      .filter((i) => i.text.trim())
      .map((i) => {
        const parsed = parseIngredientText(i.text.trim());
        return {
          name: parsed.name,
          quantity: parsed.quantity,
          unit: parsed.unit,
        };
      });

    const instructionText = serializeSteps(
      steps.filter((s) => s.text.trim()).map((s) => s.text),
    );

    return {
      title: title.trim(),
      description: description.trim() || null,
      servings: timeServings.servings,
      prepTimeMinutes: timeServings.prepTime
        ? parseInt(timeServings.prepTime, 10)
        : null,
      cookTimeMinutes: timeServings.cookTime
        ? parseInt(timeServings.cookTime, 10)
        : null,
      cuisine: tags.cuisine.trim() || null,
      dietTags: tags.dietTags as string[],
      instructions: instructionText || null,
      caloriesPerServing: nutrition.calories || null,
      proteinPerServing: nutrition.protein || null,
      carbsPerServing: nutrition.carbs || null,
      fatPerServing: nutrition.fat || null,
      ingredients: validIngredients,
    };
  }, [title, description, ingredients, steps, timeServings, nutrition, tags]);

  return {
    // State
    title,
    setTitle,
    description,
    setDescription,
    ingredients,
    steps,
    timeServings,
    setTimeServings,
    nutrition,
    setNutrition,
    tags,
    setTags,

    // Ingredient actions
    addIngredient,
    removeIngredient,
    updateIngredient,

    // Step actions
    addStep,
    removeStep,
    updateStep,
    moveStep,

    // Summaries
    ingredientsSummary,
    instructionsSummary,
    timeServingsSummary,
    nutritionSummary,
    tagsSummary,

    // Utilities
    isDirty,
    formToPayload,
  };
}
