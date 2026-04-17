import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import type { DietTag } from "@/components/recipe-wizard/types";
import { parseIngredientText } from "@/lib/ingredient-parser";

export interface IngredientRow {
  key: string;
  text: string;
  /**
   * Structured snapshot captured at prefill time. Preserved verbatim when the
   * user has not edited the row so round-trip (prefill → formToPayload) does
   * not lose quantity/unit structure via text-join + re-parse.
   */
  original?: {
    name: string;
    quantity: string | null;
    unit: string | null;
  };
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

/** Build the display text for a structured ingredient. */
export function formatIngredientText(ing: {
  name: string;
  quantity?: string | null;
  unit?: string | null;
}): string {
  return [ing.quantity, ing.unit, ing.name].filter(Boolean).join(" ");
}

function buildIngredientsFromPrefill(
  prefill: ImportedRecipeData | undefined,
): IngredientRow[] {
  if (prefill?.ingredients?.length) {
    return prefill.ingredients.map((ing) => ({
      key: nextIngredientKey(),
      text: formatIngredientText(ing),
      original: {
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
      },
    }));
  }
  return [{ key: nextIngredientKey(), text: "" }];
}

function buildStepsFromPrefill(
  prefill: ImportedRecipeData | undefined,
): StepRow[] {
  if (prefill?.instructions && prefill.instructions.length > 0) {
    return prefill.instructions.map((s) => ({ key: nextStepKey(), text: s }));
  }
  return [{ key: nextStepKey(), text: "" }];
}

export interface UseRecipeFormOptions {
  /** Fired when isDirty transitions from false → true. Action-driven (not
   *  derived via useEffect on computed state). */
  onDirtyChange?: (dirty: boolean) => void;
}

export function useRecipeForm(
  prefill?: ImportedRecipeData,
  options?: UseRecipeFormOptions,
) {
  // Keep the latest onDirtyChange in a ref so transitions fire with the
  // current callback without adding it to every action's deps.
  const onDirtyChangeRef = useRef(options?.onDirtyChange);
  onDirtyChangeRef.current = options?.onDirtyChange;

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

  // ── Dirty tracking fired from actions (not derived via useEffect) ──
  // Prefill counts as "dirty" because backing out would lose the imported data.
  const initialDirty = Boolean(prefill);
  const [isDirty, setIsDirtyState] = useState(initialDirty);

  // Dedupe lives outside the setState updater — React treats updaters as pure
  // and may call them twice under StrictMode / concurrent rendering, which
  // would double-fire onDirtyChange if the check were inside.
  const lastFiredDirtyRef = useRef(initialDirty);

  // Mount-only notification of the initial dirty state (empty deps — this is
  // a lifecycle effect, NOT a value-derivation effect. The anti-pattern L22
  // addresses is useEffect deriving callbacks from a *changing* state value;
  // here we only fire once on mount).
  useEffect(() => {
    if (initialDirty) {
      onDirtyChangeRef.current?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only effect
  }, []);

  const setIsDirty = useCallback((value: boolean) => {
    setIsDirtyState(value);
    if (lastFiredDirtyRef.current !== value) {
      lastFiredDirtyRef.current = value;
      onDirtyChangeRef.current?.(value);
    }
  }, []);

  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, [setIsDirty]);

  const setTitleDirty = useCallback(
    (value: string) => {
      setTitle(value);
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const setDescriptionDirty = useCallback(
    (value: string) => {
      setDescription(value);
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const setTimeServingsDirty = useCallback(
    (value: TimeServingsData) => {
      setTimeServings(value);
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const setNutritionDirty = useCallback(
    (value: NutritionData) => {
      setNutrition(value);
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const setTagsDirty = useCallback(
    (value: TagsData) => {
      setTags(value);
      setIsDirty(true);
    },
    [setIsDirty],
  );

  // ── Ingredient Actions ──
  const addIngredient = useCallback(() => {
    setIngredients((prev) => [...prev, { key: nextIngredientKey(), text: "" }]);
    setIsDirty(true);
  }, [setIsDirty]);

  const removeIngredient = useCallback(
    (key: string) => {
      setIngredients((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((i) => i.key !== key);
      });
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const updateIngredient = useCallback(
    (key: string, text: string) => {
      setIngredients((prev) =>
        prev.map((i) => {
          if (i.key !== key) return i;
          // Keep the original snapshot when text exactly matches what we'd
          // render from it — handles "revert the edit" so "1/2" doesn't get
          // lost to parse-normalization. Otherwise invalidate.
          const keepOriginal =
            i.original != null && formatIngredientText(i.original) === text;
          return {
            ...i,
            text,
            original: keepOriginal ? i.original : undefined,
          };
        }),
      );
      setIsDirty(true);
    },
    [setIsDirty],
  );

  // ── Step Actions ──
  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, { key: nextStepKey(), text: "" }]);
    setIsDirty(true);
  }, [setIsDirty]);

  const removeStep = useCallback(
    (key: string) => {
      setSteps((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s.key !== key);
      });
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const updateStep = useCallback(
    (key: string, text: string) => {
      setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, text } : s)));
      setIsDirty(true);
    },
    [setIsDirty],
  );

  const moveStep = useCallback(
    (key: string, direction: "up" | "down") => {
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
      setIsDirty(true);
    },
    [setIsDirty],
  );

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

  // ── Serialize to mutation payload ──
  const formToPayload = useCallback(() => {
    const validIngredients = ingredients
      .filter((i) => i.text.trim())
      .map((i) => {
        // Prefer the structured snapshot captured at prefill time — this
        // preserves exact quantity/unit strings (e.g. "2.5" or "tablespoons")
        // that would otherwise be normalized/lost by text-join + re-parse.
        if (i.original) {
          return {
            name: i.original.name,
            quantity: i.original.quantity,
            unit: i.original.unit,
          };
        }
        const parsed = parseIngredientText(i.text.trim());
        return {
          name: parsed.name,
          quantity: parsed.quantity,
          unit: parsed.unit,
        };
      });

    const instructionSteps = steps
      .filter((s) => s.text.trim())
      .map((s) => s.text.trim());

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
      instructions: instructionSteps.length > 0 ? instructionSteps : undefined,
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
    setTitle: setTitleDirty,
    description,
    setDescription: setDescriptionDirty,
    ingredients,
    steps,
    timeServings,
    setTimeServings: setTimeServingsDirty,
    nutrition,
    setNutrition: setNutritionDirty,
    tags,
    setTags: setTagsDirty,

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
    markDirty,
    formToPayload,
  };
}
