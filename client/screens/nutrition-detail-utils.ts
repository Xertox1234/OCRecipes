/**
 * Pure display helpers for NutritionDetailScreen.
 * Extracted for testability — no React or RN dependencies.
 */

interface ServingOption {
  label: string;
  grams: number;
}

interface ServingContextInput {
  servingQuantity: number;
  servingSizeGrams: number | null;
  servingOptions: ServingOption[];
  isPer100g: boolean;
}

/** Tolerance for matching a selected grams value back to a chip option —
 * shared with the active-chip check in ServingControls. */
export const OPTION_MATCH_TOLERANCE = 0.1;

function formatQuantity(quantity: number): string {
  return quantity % 1 === 0 ? String(quantity) : quantity.toFixed(1);
}

/**
 * Label for the hero card's "Per …" caption, derived from the SAME serving
 * state that scales the displayed nutrition values so the caption can never
 * desync from the numbers (e.g. "1.5 × 250 ml", "2 × 75 g", "100 g").
 */
export function getServingContextLabel({
  servingQuantity,
  servingSizeGrams,
  servingOptions,
  isPer100g,
}: ServingContextInput): string {
  if (servingSizeGrams === null) {
    return isPer100g ? "100 g" : "serving";
  }
  const match = servingOptions.find(
    (opt) => Math.abs(opt.grams - servingSizeGrams) < OPTION_MATCH_TOLERANCE,
  );
  const servingLabel = match ? match.label : `${servingSizeGrams} g`;
  return `${formatQuantity(servingQuantity)} × ${servingLabel}`;
}
