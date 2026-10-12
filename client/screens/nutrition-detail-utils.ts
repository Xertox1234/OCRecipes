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

/**
 * True when the lookup came back with only a placeholder name (barcode not in
 * any database, or the lookup failed) and no calorie figure. Such a screen must
 * not offer to log an empty "Unknown Product" — it offers a way to supply the
 * data instead (QA sweep #86).
 */
export function isUnknownProduct(
  nutrition: { productName?: string; calories?: number } | null | undefined,
): boolean {
  if (!nutrition) return false;
  if (nutrition.calories !== undefined) return false;
  return (
    nutrition.productName === "Unknown Product" ||
    nutrition.productName === "Product Not Found"
  );
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
 * desync from the numbers (e.g. "250 ml", "1.5 × 250 ml", "2 × 75 g", "100 g").
 */
export function getServingContextLabel({
  servingQuantity,
  servingSizeGrams,
  servingOptions,
  isPer100g,
}: ServingContextInput): string {
  if (servingSizeGrams === null) {
    if (isPer100g) return "100 g";
    // A serving whose weight we don't know is still a serving that can be
    // multiplied — an Open Food Facts record can publish trustworthy
    // per-serving values against a serving_size like "1 bottle". Count them
    // rather than dropping the quantity, or the caption freezes at "serving"
    // while the values below it double.
    return servingQuantity === 1
      ? "serving"
      : `${formatQuantity(servingQuantity)} servings`;
  }
  const match = servingOptions.find(
    (opt) => Math.abs(opt.grams - servingSizeGrams) < OPTION_MATCH_TOLERANCE,
  );
  const servingLabel = match ? match.label : `${servingSizeGrams} g`;
  // A single serving reads as just its label ("250 ml", "1 portion"); the
  // multiplier prefix would otherwise give "1 × 1 portion" (QA sweep #86).
  if (servingQuantity === 1) return servingLabel;
  return `${formatQuantity(servingQuantity)} × ${servingLabel}`;
}
