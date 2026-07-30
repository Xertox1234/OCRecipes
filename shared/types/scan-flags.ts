import type { AllergenId } from "@shared/constants/allergens";

export type ScanFlagKind =
  | "allergen"
  | "allergen-unavailable"
  | "nutrient"
  | "nutrient-unavailable"
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

/**
 * Raised when a result's nutrient values are unknown, so the ABSENCE of
 * "High in sugar" / high sodium / high saturated fat cannot be read as their
 * absence in the product.
 *
 * The live case: a photographed label supplies calories that materially
 * disagree with the product record, so the record's per-100 basis is
 * demonstrably wrong and its other macros are dropped rather than shown at a
 * basis we know to be broken. `evaluateUniversalFlags` then sees `undefined`
 * for every nutrient and emits nothing — which renders identically to a
 * genuinely clean product. This flag is what keeps those two apart.
 *
 * Nutrition tier, not safety: it concerns nutrient warnings, not allergens.
 * Deliberately mirrors `createAllergenUnavailableFlag` — this codebase already
 * treats "we could not check" as something to say out loud, not to omit.
 */
export function createNutrientUnavailableFlag(detail?: string): ScanFlag {
  return {
    id: "nutrient-unavailable",
    kind: "nutrient-unavailable",
    severity: "warn",
    tier: "nutrition",
    title: "Nutrient details unavailable",
    detail:
      detail ??
      "The label's calories didn't match our record, so its other nutrient values weren't used. Sugar, sodium and fat warnings can't be shown for this scan.",
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

/**
 * Top single-badge flag for compact display surfaces (the scan-lock chip,
 * the returnAfterLog confirm-card overlay): the top safety-tier flag if ANY
 * safety flag is present (any severity — a personal allergen match must
 * never be hidden behind a universal nutrition heads-up), else the top
 * warn/danger-level non-safety (nutrition) flag, else nothing. Info-level
 * non-safety flags (Nutri-Score, "Contains caffeine", "Contains artificial
 * sweeteners") never reach this badge — they render on the detail screen's
 * "Heads up" section instead. Both display surfaces must call this shared
 * helper rather than re-deriving the composition inline — a prior refactor
 * updated one call site's inline logic without the other, producing a
 * parity gap between the two surfaces.
 */
export function pickTopDisplayFlag(flags: ScanFlag[]): ScanFlag | undefined {
  return (
    pickTopSafetyFlag(flags) ??
    pickTopFlag(
      flags.filter((f) => f.tier !== "safety" && f.severity !== "info"),
    )
  );
}
