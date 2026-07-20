import type { AllergenId } from "@shared/constants/allergens";

/**
 * Open Food Facts `allergens_tags` → our canonical AllergenId.
 *
 * NOT 1:1: OFF splits shellfish into crustaceans + molluscs, calls tree nuts
 * "nuts", and tags gluten (not wheat). Tags outside our 9-allergen model
 * (mustard, celery, lupin, sulphites, …) are intentionally absent — they map to
 * nothing rather than to a wrong ID.
 */
const OFF_ALLERGEN_TAG_MAP: Record<string, AllergenId> = {
  "en:peanuts": "peanuts",
  "en:nuts": "tree_nuts",
  "en:tree-nuts": "tree_nuts",
  "en:milk": "milk",
  "en:eggs": "eggs",
  "en:gluten": "wheat",
  "en:soybeans": "soy",
  "en:soy": "soy",
  "en:fish": "fish",
  "en:crustaceans": "shellfish",
  "en:molluscs": "shellfish",
  "en:sesame-seeds": "sesame",
  "en:sesame": "sesame",
};

export function mapOffAllergenTags(tags: readonly string[]): AllergenId[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<AllergenId>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const id = OFF_ALLERGEN_TAG_MAP[tag.toLowerCase().trim()];
    if (id) out.add(id);
  }
  return [...out];
}
