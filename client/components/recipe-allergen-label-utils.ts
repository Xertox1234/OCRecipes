import {
  ALLERGEN_INGREDIENT_MAP,
  type AllergenId,
  type DerivedRecipeAllergen,
} from "@shared/constants/allergens";

export interface RecipeAllergenLabelEntry {
  id: AllergenId;
  label: string;
}

/**
 * Maps a recipe's derived allergen cache to display-ready `{ id, label }`
 * entries for the universal "Contains: <allergens>" label.
 *
 * Fail-dangerous by construction: `null`, `undefined`, and `[]` all return an
 * empty array — the caller must treat an empty result as "render nothing",
 * never as a synthesized "no allergens" / "safe" signal. Absence of derived
 * data is not a safety guarantee.
 *
 * Ids outside `ALLERGEN_INGREDIENT_MAP` are skipped, not dereferenced: the
 * input is DB-sourced jsonb that several surfaces read without a Zod wire
 * guard, and a stale id (rename, unvalidated backfill) must degrade to
 * "not rendered" rather than a render-time TypeError that unmounts the whole
 * list to the root ErrorBoundary.
 *
 * Possible-only entries are left out: they go on their own line through
 * `toPossibleRecipeAllergenLabels`.
 *
 * Order is preserved from the input `allergens` array.
 */
export function toRecipeAllergenLabels(
  allergens: DerivedRecipeAllergen[] | null | undefined,
): RecipeAllergenLabelEntry[] {
  return toLabels(allergens, false);
}

/**
 * The recipe's possible-only allergens ("cookies" for wheat), for the
 * separate "Possible: <allergens>" line. Never merged into "Contains": the
 * recipe may or may not carry them (owner ruling 2026-11-15). Same
 * fail-dangerous and stale-id contract as `toRecipeAllergenLabels`.
 */
export function toPossibleRecipeAllergenLabels(
  allergens: DerivedRecipeAllergen[] | null | undefined,
): RecipeAllergenLabelEntry[] {
  return toLabels(allergens, true);
}

function toLabels(
  allergens: DerivedRecipeAllergen[] | null | undefined,
  possible: boolean,
): RecipeAllergenLabelEntry[] {
  if (!allergens || allergens.length === 0) return [];

  return allergens
    .filter(
      (a) =>
        Object.hasOwn(ALLERGEN_INGREDIENT_MAP, a.id) &&
        (a.possible === true) === possible,
    )
    .map(({ id }) => ({
      id,
      label: ALLERGEN_INGREDIENT_MAP[id].label,
    }));
}

/**
 * The composed "Contains: A, B. Possible: C" text, or `""` when there is
 * nothing to show. ONE wording for the label and every card suffix.
 */
export function composeRecipeAllergenText(
  allergens: DerivedRecipeAllergen[] | null | undefined,
): string {
  const contains = toRecipeAllergenLabels(allergens);
  const possible = toPossibleRecipeAllergenLabels(allergens);
  const parts: string[] = [];
  if (contains.length > 0) {
    parts.push(`Contains: ${contains.map((l) => l.label).join(", ")}`);
  }
  if (possible.length > 0) {
    parts.push(`Possible: ${possible.map((l) => l.label).join(", ")}`);
  }
  return parts.join(". ");
}

/**
 * Sentence-separated accessibility suffix (`". Contains: Peanuts, Tree Nuts"`,
 * or `""` when there is nothing to show) for folding the allergen label into an
 * `accessible` parent card's own `accessibilityLabel` — the pattern used when
 * `RecipeAllergenLabel`'s own a11y container would be swallowed by the parent
 * focus stop. ONE derivation for every card surface: the wording deliberately
 * matches `RecipeAllergenLabel`'s composed label ("Contains: …. Possible: …"), so a
 * screen-reader user hears identical phrasing on every surface, and a future
 * wording change edits exactly one place.
 */
export function toRecipeAllergenA11ySuffix(
  allergens: DerivedRecipeAllergen[] | null | undefined,
): string {
  const text = composeRecipeAllergenText(allergens);
  return text ? `. ${text}` : "";
}
