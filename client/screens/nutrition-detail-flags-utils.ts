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
import { logger } from "@/lib/logger";

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
  // Sits beside "nutrient" on purpose: it is the ABSENCE of nutrient data
  // reported as a heads-up, so it belongs in the same section as the warnings
  // it stands in for. Omitting it here would send it to the defensive default
  // below, which warns and drops — i.e. the "no data reads as no warning"
  // failure this flag exists to prevent.
  "nutrient-unavailable",
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
      // `grade` is optional on ScanFlag — a gradeless nutriscore flag must
      // not flow through, since NutritionDetailScreen renders it via
      // `NutriScoreChip`, which calls `.toUpperCase()` on the grade
      // (final-review fix, Smart Scan Universal Nutrition Flags v1). This is
      // an intentional, silent drop — not the unmodeled-kind case below.
      if (flag.grade) {
        nutriScore = flag;
      }
    } else {
      // Defensive default: a flag kind outside PERSONAL_KINDS/UNIVERSAL_KINDS
      // and not "nutriscore" has no bucket here — e.g. a future addition to
      // ScanFlagKind, or an "insight"-tier flag once that tier ships. Warn
      // instead of silently dropping it from both display sections, so a gap
      // surfaces in dev/test rather than shipping invisible.
      logger.warn(
        `partitionScanFlags: unhandled flag kind "${flag.kind}" (id: ${flag.id}) — dropped from both sections`,
      );
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
