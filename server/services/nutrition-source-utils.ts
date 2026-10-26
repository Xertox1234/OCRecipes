/**
 * Pieces shared by the nutrition source adapters (CNF, USDA) and the
 * nutrition-lookup orchestrator. A leaf module: it imports none of them, so
 * the adapters never import their orchestrator.
 */

export interface NutritionData {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  servingSize: string;
  source: "api-ninjas" | "usda" | "cnf" | "cache";
}

// Timeout for outbound API requests (10 seconds)
export const FETCH_TIMEOUT_MS = 10_000;

/** Generic nutrient search by substring match across a list of candidate names. */
export function findNutrientValue<T>(
  nutrients: T[],
  getName: (n: T) => string,
  getValue: (n: T) => number,
  names: string[],
): number {
  for (const name of names) {
    const n = nutrients.find((nut) =>
      getName(nut).toLowerCase().includes(name.toLowerCase()),
    );
    if (n) return getValue(n);
  }
  return 0;
}
