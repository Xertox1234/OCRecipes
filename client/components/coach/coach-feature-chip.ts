import type { TaughtFeature } from "@/lib/feature-tips-storage";

// In order: the first feature the person hasn't used gets the one chip.
const FEATURE_CHIPS: { feature: TaughtFeature; text: string }[] = [
  { feature: "import", text: "Help me import a recipe" },
  { feature: "receiptScan", text: "Help me scan a receipt" },
];

/**
 * Coach Pro's chips plus at most one for a feature the person hasn't used yet
 * (spec 2026-10-30). Tapping it sends it like any other chip.
 */
export function withFeatureChip(
  suggestions: readonly string[],
  hasUsed: (feature: TaughtFeature) => boolean,
): string[] {
  const chip = FEATURE_CHIPS.find((c) => !hasUsed(c.feature));
  return chip ? [...suggestions, chip.text] : [...suggestions];
}
