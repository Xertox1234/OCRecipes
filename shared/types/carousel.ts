import type { DerivedRecipeAllergen } from "@shared/constants/allergens";
import type { DietConflictId } from "@shared/constants/diet-conflicts";

export interface CarouselRecipeCard {
  /** Community recipe ID */
  id: number;
  title: string;
  imageUrl: string | null;
  prepTimeMinutes: number | null;
  recommendationReason: string;
  isRemix?: boolean;
  isCanonical?: boolean;
  // Threaded straight from the source recipe's derived-allergen cache —
  // `null` means "not yet derived" (fail-closed), `[]` means "derived, none
  // found". Never coerce with `?? []`. See
  // docs/solutions/conventions/nullable-not-empty-for-derived-safety-columns-2026-05-17.md.
  allergens: DerivedRecipeAllergen[] | null;
  // Facts for the attribute icons (spec 2026-10-17). `dietConflicts` follows
  // the same contract as `allergens`: `null` = not checked, never `?? []`.
  dietTags: string[];
  dietConflicts: DietConflictId[] | null;
  /** `toTotalTimeMinutes` of the source recipe; `null` when unknown. */
  totalTimeMinutes: number | null;
}

export interface CarouselResponse {
  cards: CarouselRecipeCard[];
}

export interface CarouselDismissRequest {
  recipeId: number;
}
