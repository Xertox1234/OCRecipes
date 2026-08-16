/**
 * Pure helpers for `migrate-recipe-ingredients.ts` — zero-dependency leaf so
 * the parsers are unit-testable (the script connects to Postgres and runs
 * `main()` at module load).
 */

// ---------------------------------------------------------------------------
// Ingredient parsing
// ---------------------------------------------------------------------------

export function parseIngredientLine(raw: string): {
  name: string;
  quantity: string;
  unit: string;
} {
  // Match: "200g rice noodles", "3 tbsp fish sauce", "1/2 cup flour"
  const match = raw.match(
    /^(\d+(?:[/.]\d+)?)\s*(g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|tablespoons?|teaspoons?|ounces?|pounds?|bunch|head|clove|cloves|stalk|stalks|piece|pieces|slice|slices|can|cans|handful|pinch)?\s+(.+)$/i,
  );
  if (match) {
    return { quantity: match[1], unit: match[2] ?? "", name: match[3].trim() };
  }
  // "1 cucumber, thinly sliced" — quantity + name, no unit
  const simpleMatch = raw.match(/^(\d+(?:[/.]\d+)?)\s+(.+)$/);
  if (simpleMatch) {
    return {
      quantity: simpleMatch[1],
      unit: "",
      name: simpleMatch[2].trim(),
    };
  }
  // No quantity — "Fresh herbs (mint, cilantro, Thai basil)"
  return { quantity: "", unit: "", name: raw };
}

// ---------------------------------------------------------------------------
// Instruction/ingredient splitting
// ---------------------------------------------------------------------------

export interface SplitResult {
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
}

/**
 * Cleans a raw ingredient line by stripping markdown/bullet prefixes.
 * Handles:
 *   - "- ingredient"  / "* ingredient"  / "• ingredient"
 *   - "1. ingredient" (numbered list)
 *   - "**bold**" markdown
 *   - Leading/trailing whitespace
 */
export function cleanIngredientLine(raw: string): string {
  return raw
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1")
    .trim();
}

/**
 * Cleans a raw instruction step line by stripping markdown bold labels,
 * numbered prefixes, and bullet markers.
 * Handles:
 *   - "**Step Label:** actual text"  → "actual text"
 *   - "1. text"                      → "text"
 *   - "- text"                       → "text"
 */
export function cleanInstructionLine(raw: string): string {
  return (
    raw
      .replace(/^\s*[-*•]\s*/, "")
      .replace(/^\d+\.\s*/, "")
      // Strip bold step labels like "**Prep Tofu:**" or "*Prep Tofu:**"
      .replace(/^\*{1,2}[^*]+\*{1,2}:?\s*/, "")
      .trim()
  );
}

/**
 * Extracts ingredients and instruction steps from a recipe's instructions array.
 *
 * Handles all known storage patterns:
 *   Pattern A — ingredients + steps in the first element separated by \n
 *   Pattern B — markdown "### Ingredients:" header with \n separation
 *   Pattern C — bold "**Ingredients**:" label embedded in a numbered element
 *   Pattern D — separate array elements with plain "Ingredients:" / "Instructions:" labels
 */
export function splitInstructionsArray(lines: string[]): SplitResult | null {
  // Join everything into one blob so multi-line strings are handled uniformly
  const blob = lines.join("\n");

  // Locate the ingredients section header (flexible: plain, ###, **bold**, numbered)
  const ingredientMatch = blob.match(
    /(?:#{1,3}\s*)?(?:\*{1,2})?ingredients(?:\*{1,2})?(?:\s*\*{1,2})?:?\s*\n/i,
  );
  if (!ingredientMatch) return null;

  const afterIngredients = blob.slice(
    ingredientMatch.index! + ingredientMatch[0].length,
  );

  // Locate the instructions/steps/preparation/cooking/directions section header
  const stepsMatch = afterIngredients.match(
    /(?:#{1,3}\s*)?(?:\*{1,2})?(?:instructions|steps|preparation|cooking|directions)(?:\*{1,2})?:?\s*\n/i,
  );

  if (!stepsMatch) {
    // No steps marker found — cannot safely split
    return null;
  }

  const ingredientBlob = afterIngredients.slice(0, stepsMatch.index!);
  const stepsBlob = afterIngredients.slice(
    stepsMatch.index! + stepsMatch[0].length,
  );

  // Parse ingredient lines
  const ingredientLines = ingredientBlob
    .split("\n")
    .map(cleanIngredientLine)
    .filter((line) => line.length > 0 && !/^ingredients/i.test(line));

  if (ingredientLines.length === 0) return null;

  const ingredients = ingredientLines.map(parseIngredientLine);

  // Parse instruction steps
  const instructionLines = stepsBlob
    .split("\n")
    .map(cleanInstructionLine)
    .filter(
      (line) =>
        line.length > 0 &&
        !/^(?:instructions|steps|preparation|cooking|directions)/i.test(line),
    );

  return { ingredients, instructions: instructionLines };
}
