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
 * Order is preserved from the input `allergens` array.
 */
export function toRecipeAllergenLabels(
  allergens: DerivedRecipeAllergen[] | null | undefined,
): RecipeAllergenLabelEntry[] {
  if (!allergens || allergens.length === 0) return [];

  return allergens.map(({ id }) => ({
    id,
    label: ALLERGEN_INGREDIENT_MAP[id].label,
  }));
}
