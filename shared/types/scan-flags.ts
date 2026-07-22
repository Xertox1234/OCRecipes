import type { AllergenId } from "@shared/constants/allergens";

export type ScanFlagKind =
  | "allergen"
  | "allergen-unavailable"
  | "nutrient"
  | "processing"
  | "sweetener"
  | "nutriscore";
export type ScanFlagSeverity = "danger" | "warn" | "info";
/** "nutrition" = free universal (Phase 2). "insight" stays RESERVED for the v2 premium boost. */
export type ScanFlagTier = "safety" | "nutrition" | "insight";

export type NutrientKind = "sugar" | "saturated_fat" | "sodium" | "caffeine";

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
  /** Present on kind==="nutrient". */
  nutrient?: NutrientKind;
  /** Optional numeric detail, e.g. { amount: 160, unit: "mg" } for caffeine. */
  value?: { amount: number; unit: string };
  /** Present on kind==="nutriscore". */
  grade?: "a" | "b" | "c" | "d" | "e";
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

export interface AllergenUnavailableFlagOptions {
  /** Overrides the default `"allergen-unavailable"` id (e.g. a profile-read failure uses `"profile-unavailable"`). */
  id?: string;
  /** Overrides the default `"Couldn't verify allergens"` title. */
  title?: string;
  /** Situation-specific detail copy — server (no data), client (connectivity down), and profile-read-failure are legitimately different messages. */
  detail: string;
}

/**
 * Shared shape for the fail-dangerous "couldn't verify allergens" flag.
 * `kind`/`severity`/`tier` are fixed here so every call site stays in sync;
 * `id`/`title`/`detail` are parameterized because the situations that raise
 * this flag (server has no allergen data, client can't reach the server,
 * the user's profile couldn't be read) legitimately need different copy.
 */
export function createAllergenUnavailableFlag(
  options: AllergenUnavailableFlagOptions,
): ScanFlag {
  return {
    id: options.id ?? "allergen-unavailable",
    kind: "allergen-unavailable",
    severity: "warn",
    tier: "safety",
    title: options.title ?? "Couldn't verify allergens",
    detail: options.detail,
  };
}

/** Highest-severity flag across ALL kinds; severity ties break toward allergen (safety). */
export function pickTopFlag(flags: ScanFlag[]): ScanFlag | undefined {
  let top: ScanFlag | undefined;
  const isAllergen = (fl: ScanFlag) =>
    fl.kind === "allergen" || fl.kind === "allergen-unavailable";
  for (const fl of flags) {
    if (!top) {
      top = fl;
      continue;
    }
    const delta = SEVERITY_RANK[fl.severity] - SEVERITY_RANK[top.severity];
    if (delta > 0 || (delta === 0 && isAllergen(fl) && !isAllergen(top)))
      top = fl;
  }
  return top;
}
