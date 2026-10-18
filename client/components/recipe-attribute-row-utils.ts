import {
  getRecipeAttributes,
  RECIPE_ATTRIBUTE_LABELS,
  type RecipeAttributeFacts,
} from "@shared/constants/recipe-attributes";
import { toRecipeAllergenA11ySuffix } from "./recipe-allergen-label-utils";

/** "Vegan, Gluten-free, Quick, 30 minutes or less" — or "" when none show. */
export function toRecipeAttributeSpokenList(
  facts: RecipeAttributeFacts,
): string {
  return getRecipeAttributes(facts)
    .map((id) => RECIPE_ATTRIBUTE_LABELS[id].spoken)
    .join(", ");
}

/**
 * Suffix for an accessible card's own label: the diet/quick list, then the
 * UNCHANGED allergen suffix, so "Contains: …" reads identically on every
 * surface.
 */
export function toRecipeAttributeA11ySuffix(
  facts: RecipeAttributeFacts,
): string {
  const list = toRecipeAttributeSpokenList(facts);
  return `${list ? `. ${list}` : ""}${toRecipeAllergenA11ySuffix(facts.allergens)}`;
}
