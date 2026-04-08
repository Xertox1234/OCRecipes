import {
  detectAllergens,
  ALLERGEN_INGREDIENT_MAP,
  type AllergenId,
  type AllergySeverity,
} from "@shared/constants/allergens";

export interface RemixChip {
  label: string;
  prompt: string;
}

interface RecipeData {
  ingredients: { name: string }[];
  dietTags?: string[];
}

interface UserProfileData {
  allergies?: readonly { name: string; severity: AllergySeverity }[];
  dietType?: string | null;
}

const MAX_CHIPS = 6;

/** Allergen labels for human-readable chip text */
const ALLERGEN_LABELS: Record<AllergenId, string> = {
  peanuts: "peanuts",
  tree_nuts: "tree nuts",
  milk: "dairy",
  eggs: "eggs",
  wheat: "gluten",
  soy: "soy",
  fish: "fish",
  shellfish: "shellfish",
  sesame: "sesame",
};

/**
 * Generate contextual remix chips based on recipe ingredients and user profile.
 *
 * Priority order (highest first):
 * 1. Allergen swaps — only when recipe contains user's allergens
 * 2. Dietary upgrades — e.g., "Make vegan" if user is vegan but recipe isn't
 * 3. Macro adjustments — always available generic options
 *
 * Capped at MAX_CHIPS (6). Skips irrelevant chips (e.g., "Make dairy-free"
 * when recipe is already dairy-free).
 */
export function generateRemixChips(
  recipe: RecipeData,
  userProfile: UserProfileData | null | undefined,
): RemixChip[] {
  const chips: RemixChip[] = [];
  const tags = new Set((recipe.dietTags ?? []).map((t) => t.toLowerCase()));
  const ingredientNames = recipe.ingredients.map((i) => i.name);

  // 1. Allergen-based chips
  if (userProfile?.allergies && userProfile.allergies.length > 0) {
    const matches = detectAllergens(ingredientNames, userProfile.allergies);
    const uniqueAllergens = [...new Set(matches.map((m) => m.allergenId))];

    for (const allergenId of uniqueAllergens) {
      const label = ALLERGEN_LABELS[allergenId] ?? allergenId;
      chips.push({
        label: `Remove ${label}`,
        prompt: `Remove all ${label} ingredients from this recipe and suggest ${label}-free substitutes that maintain the dish's flavor and texture.`,
      });
    }
  }

  // 2. Dietary upgrade chips
  const dietType = userProfile?.dietType?.toLowerCase();
  if (dietType) {
    // "Make vegan" — if user is vegan and recipe isn't tagged vegan
    if (dietType === "vegan" && !tags.has("vegan")) {
      chips.push({
        label: "Make vegan",
        prompt:
          "Make this recipe fully vegan by replacing all animal products with plant-based alternatives.",
      });
    }
    // "Make vegetarian" — if user is vegetarian and recipe isn't tagged vegetarian or vegan
    else if (
      dietType === "vegetarian" &&
      !tags.has("vegetarian") &&
      !tags.has("vegan")
    ) {
      chips.push({
        label: "Make vegetarian",
        prompt:
          "Make this recipe vegetarian by replacing all meat and fish with plant-based alternatives.",
      });
    }
  }

  // "Make gluten-free" — if recipe has wheat/gluten ingredients but isn't tagged gluten-free
  if (!tags.has("gluten-free")) {
    const hasGluten = ingredientNames.some((name) => {
      const lower = name.toLowerCase();
      return ALLERGEN_INGREDIENT_MAP.wheat.directIngredients.some((kw) =>
        lower.includes(kw),
      );
    });
    if (hasGluten) {
      // Skip if we already have a "Remove gluten" chip from allergen section
      const alreadyHasGluten = chips.some((c) => c.label === "Remove gluten");
      if (!alreadyHasGluten) {
        chips.push({
          label: "Make gluten-free",
          prompt:
            "Replace all wheat and gluten-containing ingredients with gluten-free alternatives.",
        });
      }
    }
  }

  // 3. Macro adjustment chips — always available
  chips.push({
    label: "Lower calorie",
    prompt:
      "Modify this recipe to reduce calories while keeping it satisfying. Use lighter cooking methods and lower-calorie ingredient swaps.",
  });

  chips.push({
    label: "Boost protein",
    prompt:
      "Modify this recipe to increase protein content. Add or swap in high-protein ingredients.",
  });

  return chips.slice(0, MAX_CHIPS);
}
