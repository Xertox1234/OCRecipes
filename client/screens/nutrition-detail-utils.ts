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
 * Rounds to one decimal place. Used for the sub-gram Additional Nutrients
 * rows (saturated fat, trans fat) where whole-number rounding would hide a
 * present-but-small value as a false "0 g".
 */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export type LogGate =
  | { kind: "open" }
  | { kind: "needsAcknowledgement"; buttonLabel: string };

/**
 * Whether the user may log this item in one tap.
 *
 * The label step exists for products whose database record is wrong, which is
 * exactly when a silent fallback does the most damage. When a photographed label
 * could not be used, the database value is still shown — but logging it now
 * takes a second, informed action instead of one tap.
 *
 * A barcode-only session (`ocrText === undefined`) is NEVER gated. It never
 * promised to use a label, and warning on the happy path would train the user to
 * dismiss the warning — the same dynamic that kept the wrong-calorie fallback
 * invisible in the first place.
 */
export function deriveLogGate(params: {
  ocrText: string | null | undefined;
  labelUsed: boolean;
}): LogGate {
  const { ocrText, labelUsed } = params;
  if (ocrText === undefined) return { kind: "open" };
  if (labelUsed) return { kind: "open" };
  return {
    kind: "needsAcknowledgement",
    buttonLabel: "Review values before logging",
  };
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
