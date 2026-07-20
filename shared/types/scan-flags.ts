import type { AllergenId } from "@shared/constants/allergens";

/** Phase 1 kinds. Later phases add "nutrient" | "processing". */
export type ScanFlagKind = "allergen" | "allergen-unavailable";
export type ScanFlagSeverity = "danger" | "warn" | "info";
/** "insight" is reserved for later (premium) phases; Phase 1 emits only "safety". */
export type ScanFlagTier = "safety" | "insight";

export interface ScanFlag {
  /** Stable id, e.g. "allergen:peanuts" or "allergen-unavailable". */
  id: string;
  kind: ScanFlagKind;
  severity: ScanFlagSeverity;
  tier: ScanFlagTier;
  /** Short headline, e.g. "Contains Peanuts". */
  title: string;
  /** Optional secondary line, e.g. "You listed a severe peanut allergy". */
  detail?: string;
  /** Present on positive allergen matches. */
  allergenId?: AllergenId;
}

const SEVERITY_RANK: Record<ScanFlagSeverity, number> = {
  danger: 3,
  warn: 2,
  info: 1,
};

/** Highest-severity safety flag, for the compact single-badge surfaces. */
export function pickTopSafetyFlag(flags: ScanFlag[]): ScanFlag | undefined {
  let top: ScanFlag | undefined;
  for (const f of flags) {
    if (f.tier !== "safety") continue;
    if (!top || SEVERITY_RANK[f.severity] > SEVERITY_RANK[top.severity])
      top = f;
  }
  return top;
}
