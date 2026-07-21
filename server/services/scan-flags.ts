import {
  ALLERGEN_INGREDIENT_MAP,
  detectAllergens,
  normalizeAllergenId,
  type AllergenId,
  type AllergySeverity,
} from "@shared/constants/allergens";
import {
  createAllergenUnavailableFlag,
  type ScanFlag,
  type ScanFlagSeverity,
} from "@shared/types/scan-flags";
import { mapOffAllergenTags } from "./off-allergen-tags";

export interface ScanFlagProductInput {
  /** Raw OFF allergens_tags, e.g. ["en:milk"]. */
  allergenTags: string[];
  /** Raw OFF ingredients text (any locale), or null. */
  ingredientsText: string | null;
  /** True only when the source actually returned ingredient/allergen data. */
  allergenDataAvailable: boolean;
}

const SEVERITY_TO_FLAG: Record<AllergySeverity, ScanFlagSeverity> = {
  severe: "danger",
  moderate: "warn",
  mild: "info",
};

/** Fail-dangerous flag when we have allergies but no product allergen data. */
const ALLERGEN_UNAVAILABLE_FLAG: ScanFlag = createAllergenUnavailableFlag({
  detail:
    "We don't have allergen data for this product — check the package label.",
});

/** Fail-dangerous flag when the user's profile couldn't be read at all. */
export const PROFILE_UNAVAILABLE_FLAG: ScanFlag = createAllergenUnavailableFlag(
  {
    id: "profile-unavailable",
    title: "Couldn't check against your profile",
    detail:
      "We couldn't load your allergy profile just now — check the package label.",
  },
);

/** Split OFF ingredient text into rough ingredient names for keyword matching. */
function splitIngredientsText(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/[,()[\];.]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function evaluateScanFlags(
  product: ScanFlagProductInput,
  allergies: { name: string; severity: AllergySeverity }[],
): ScanFlag[] {
  if (allergies.length === 0) return [];

  // Fail-dangerous: allergies declared but nothing to check against.
  if (!product.allergenDataAvailable) return [ALLERGEN_UNAVAILABLE_FLAG];

  // Index the user's declared allergens by canonical id → severity.
  const userSeverity = new Map<AllergenId, AllergySeverity>();
  for (const a of allergies) {
    const id = normalizeAllergenId(a.name);
    if (id) userSeverity.set(id, a.severity);
  }
  if (userSeverity.size === 0) return [];

  const matched = new Set<AllergenId>();

  // Signal (a): OFF declared allergen tags (authoritative — flag at any severity).
  for (const id of mapOffAllergenTags(product.allergenTags)) {
    if (userSeverity.has(id)) matched.add(id);
  }

  // Signal (b): ingredient-text detection (respects the engine's severity tiers).
  for (const m of detectAllergens(
    splitIngredientsText(product.ingredientsText),
    allergies,
  )) {
    matched.add(m.allergenId);
  }

  const flags: ScanFlag[] = [];
  for (const id of matched) {
    const severity = userSeverity.get(id)!;
    const label = ALLERGEN_INGREDIENT_MAP[id].label;
    flags.push({
      id: `allergen:${id}`,
      kind: "allergen",
      severity: SEVERITY_TO_FLAG[severity],
      tier: "safety",
      title: `Contains ${label}`,
      detail: `You listed a ${severity} ${label.toLowerCase()} allergy`,
      allergenId: id,
    });
  }
  return flags;
}

export type ProfileOutcome =
  | { ok: true; allergies: { name: string; severity: AllergySeverity }[] }
  | { ok: false };

export function buildScanResponseFlags(
  product: ScanFlagProductInput,
  outcome: ProfileOutcome,
): ScanFlag[] {
  if (!outcome.ok) return [PROFILE_UNAVAILABLE_FLAG];
  return evaluateScanFlags(product, outcome.allergies);
}
