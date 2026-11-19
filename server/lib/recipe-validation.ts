export interface RecipeQualityInput {
  title: string;
  instructions?: string[] | null;
  ingredients?: { name: string }[] | null;
  /**
   * How the recipe was made. A `quick_entry` is a dish name plus a nutrition
   * estimate by design, so it needs no ingredient or instruction step.
   */
  sourceType?: string | null;
}

export interface RecipeQualityResult {
  valid: boolean;
  reason?: string;
}

const MIN_TITLE_LENGTH = 3;

export function validateRecipeQuality(
  input: RecipeQualityInput,
): RecipeQualityResult {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length < MIN_TITLE_LENGTH) {
    return {
      valid: false,
      reason: `Recipe title must be at least ${MIN_TITLE_LENGTH} characters`,
    };
  }

  if (input.sourceType === "quick_entry") {
    return { valid: true };
  }

  const validInstructions = (input.instructions ?? []).filter(
    (s) => s.trim().length > 0,
  );
  const validIngredients = (input.ingredients ?? []).filter(
    (i) => i.name.trim().length > 0,
  );

  if (validInstructions.length === 0 && validIngredients.length === 0) {
    return {
      valid: false,
      reason:
        "Recipe must have at least one ingredient or one instruction step",
    };
  }

  return { valid: true };
}
