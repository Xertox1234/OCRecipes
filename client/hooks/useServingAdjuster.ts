import { useCallback, useMemo, useState } from "react";
import type { IngredientItem } from "@/components/recipe-detail";
import { scaleIngredientQuantity } from "@/lib/serving-scale";

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 99;

export interface ScaledIngredientItem extends IngredientItem {
  annotation?: string;
}

export function useServingAdjuster(
  originalServings: number,
  ingredients: IngredientItem[],
) {
  const safeOriginal = originalServings || 1;
  const [servingCount, setServingCount] = useState(safeOriginal);

  const isAdjusted = servingCount !== safeOriginal;
  const ratio = servingCount / safeOriginal;

  const scaledIngredients = useMemo((): ScaledIngredientItem[] => {
    return ingredients.map((ing) => {
      const { scaled, isNumeric } = scaleIngredientQuantity(
        ing.quantity,
        ratio,
      );

      if (isNumeric && scaled !== null) {
        return { ...ing, quantity: scaled };
      }

      // Non-numeric: keep original, add annotation if adjusted
      if (isAdjusted) {
        return {
          ...ing,
          annotation: `(adjust for ${servingCount} servings)`,
        };
      }
      return { ...ing };
    });
  }, [ingredients, ratio, isAdjusted, servingCount]);

  const increment = useCallback(() => {
    setServingCount((prev) => Math.min(prev + 1, MAX_SERVINGS));
  }, []);

  const decrement = useCallback(() => {
    setServingCount((prev) => Math.max(prev - 1, MIN_SERVINGS));
  }, []);

  const setServings = useCallback((n: number) => {
    setServingCount(
      Math.max(MIN_SERVINGS, Math.min(MAX_SERVINGS, Math.round(n))),
    );
  }, []);

  const reset = useCallback(() => {
    setServingCount(safeOriginal);
  }, [safeOriginal]);

  return {
    servingCount,
    scaledIngredients,
    isAdjusted,
    increment,
    decrement,
    setServings,
    reset,
  };
}
