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

/**
 * Tri-state result of a nutrition source lookup. `not-found` means the source
 * answered and has no match; `unavailable` means it could not be asked (rate
 * limit, bad key, 5xx, network/timeout). Never cache or report `unavailable`
 * as a miss.
 */
export type NutritionLookupOutcome =
  | { status: "found"; data: NutritionData }
  | { status: "not-found" }
  | { status: "unavailable" };

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
