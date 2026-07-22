/**
 * Pure partition helpers for NutritionDetailScreen's flags section.
 * Extracted for testability — no React or RN dependencies.
 *
 * Splits the server's mixed `flags[]` (Phase-1 allergen flags + the newer
 * universal nutrition flags) into two display groups:
 * - `personal` ("For you") — allergen / allergen-unavailable, safety tier.
 * - `universal` ("Heads up") — nutrient / processing / sweetener, nutrition
 *   tier, sorted danger → warn → info so the worst issue always leads.
 * The single `nutriscore` flag (if present) is split out separately since it
 * renders as a grade chip (`NutriScoreChip`), not a `ScanFlagBadge`.
 */
import type { ScanFlag, ScanFlagSeverity } from "@shared/types/scan-flags";

const SEVERITY_RANK: Record<ScanFlagSeverity, number> = {
  danger: 3,
  warn: 2,
  info: 1,
};

const PERSONAL_KINDS = new Set<ScanFlag["kind"]>([
  "allergen",
  "allergen-unavailable",
]);
const UNIVERSAL_KINDS = new Set<ScanFlag["kind"]>([
  "nutrient",
  "processing",
  "sweetener",
]);

export interface PartitionedScanFlags {
  personal: ScanFlag[];
  universal: ScanFlag[];
  nutriScore?: ScanFlag;
}

/** Splits `flags[]` into the "For you" / "Heads up" / Nutri-Score groups. */
export function partitionScanFlags(flags: ScanFlag[]): PartitionedScanFlags {
  const personal: ScanFlag[] = [];
  const universal: ScanFlag[] = [];
  let nutriScore: ScanFlag | undefined;

  for (const flag of flags) {
    if (PERSONAL_KINDS.has(flag.kind)) {
      personal.push(flag);
    } else if (UNIVERSAL_KINDS.has(flag.kind)) {
      universal.push(flag);
    } else if (flag.kind === "nutriscore") {
      nutriScore = flag;
    }
  }

  universal.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  return { personal, universal, nutriScore };
}

/**
 * Summarizing sentence for the "Heads up" section's single grouped
 * `accessibilityLabel`, e.g. "3 nutrition flags: high in sugar, high in
 * caffeine, ultra-processed" — so VoiceOver/TalkBack announce the whole
 * group once instead of stepping through each badge individually.
 */
export function headsUpSummaryLabel(universal: ScanFlag[]): string {
  if (universal.length === 0) {
    return "No additional nutrition flags.";
  }
  const noun = universal.length === 1 ? "flag" : "flags";
  const titles = universal.map((f) => f.title).join(", ");
  return `${universal.length} nutrition ${noun}: ${titles}`;
}
