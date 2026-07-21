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
