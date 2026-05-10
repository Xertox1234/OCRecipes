import type { EvalTestCase, AssertionResult } from "./types";

/**
 * Safely compile a regex pattern. Returns `null` on invalid regex (catches
 * ReDoS / syntax errors at compile time). Callers fail the assertion — not
 * the whole eval run — when compilation fails so one malformed test case
 * can't take down the suite.
 */
function safeCompile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `    ⚠ Invalid assertion regex "${pattern}": ${message}; failing assertion`,
    );
    return null;
  }
}

/**
 * Extract ingredient list lines from a serialised recipe response.
 * Returns null when no "Ingredients:" section marker is found (non-recipe
 * output), signalling callers to fall back to full-text matching.
 */
function extractIngredientLines(response: string): string | null {
  const lines = response.split("\n");
  const ingredientsIdx = lines.findIndex((l) =>
    /^Ingredients:?\s*$/i.test(l.trim()),
  );
  if (ingredientsIdx === -1) return null;

  const instructionsIdx = lines.findIndex(
    (l, i) => i > ingredientsIdx && /^Instructions:?\s*$/i.test(l.trim()),
  );
  const endIdx = instructionsIdx !== -1 ? instructionsIdx : lines.length;

  return lines
    .slice(ingredientsIdx + 1, endIdx)
    .filter((l) => l.trim().startsWith("-"))
    .join("\n");
}

/**
 * Run hard pass/fail assertions against a coach response.
 * mustNotRecommendBelow is intentionally NOT checked here —
 * it requires semantic understanding and is evaluated by the LLM judge.
 *
 * For recipe responses (those containing an "Ingredients:" section),
 * mustNotContain patterns are checked against ingredient lines only.
 * This avoids false positives when the model explicitly declares allergen
 * exclusions in the title or description (e.g. "This recipe is egg-free").
 */
export function runAssertions(
  response: string,
  assertions: EvalTestCase["assertions"],
): AssertionResult {
  if (!assertions) return { passed: true, failures: [] };

  const failures: string[] = [];

  if (assertions.mustNotContain) {
    const ingredientLines = extractIngredientLines(response);
    const mustNotContainTarget = ingredientLines ?? response;

    for (const pattern of assertions.mustNotContain) {
      const regex = safeCompile(pattern);
      if (!regex) {
        failures.push(`Invalid mustNotContain regex: "${pattern}"`);
        continue;
      }
      if (regex.test(mustNotContainTarget)) {
        failures.push(`Response contains forbidden pattern: "${pattern}"`);
      }
    }
  }

  if (assertions.mustContain) {
    for (const pattern of assertions.mustContain) {
      const regex = safeCompile(pattern);
      if (!regex) {
        failures.push(`Invalid mustContain regex: "${pattern}"`);
        continue;
      }
      if (!regex.test(response)) {
        failures.push(`Response missing required pattern: "${pattern}"`);
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Run structural (non-text) assertions against raw service output.
 * Uses duck typing on `structuredData` — each assertion checks for the
 * expected shape and fails clearly if the shape is wrong.
 *
 * mustNotRecommendBelow is intentionally NOT checked here — it requires
 * semantic understanding and is evaluated by the LLM judge (coach only).
 */
export function runStructuralAssertions(
  structuredData: unknown,
  assertions: EvalTestCase["assertions"],
): AssertionResult {
  if (!assertions) return { passed: true, failures: [] };

  const failures: string[] = [];

  if (assertions.suggestionCount != null) {
    const d = structuredData as { suggestions?: unknown[] };
    if (!Array.isArray(d?.suggestions)) {
      failures.push(
        `suggestionCount assertion requires { suggestions: unknown[] }, got ${typeof structuredData}`,
      );
    } else if (d.suggestions.length !== assertions.suggestionCount) {
      failures.push(
        `Expected ${assertions.suggestionCount} suggestions, got ${d.suggestions.length}`,
      );
    }
  }

  if (assertions.macrosBudgetRespected) {
    const d = structuredData as {
      suggestions?: { calories?: unknown }[];
      remainingCalories?: unknown;
    };
    if (
      !Array.isArray(d?.suggestions) ||
      typeof d?.remainingCalories !== "number"
    ) {
      failures.push(
        "macrosBudgetRespected assertion requires { suggestions: { calories }[], remainingCalories: number }",
      );
    } else {
      const budget = d.remainingCalories;
      const tolerance = budget * 1.1;
      d.suggestions.forEach((s, i) => {
        const cal = typeof s.calories === "number" ? s.calories : NaN;
        if (isNaN(cal) || cal > tolerance) {
          failures.push(
            `Suggestion ${i + 1} (${cal} cal) exceeds remaining calorie budget of ${budget} cal (110% tolerance = ${Math.round(tolerance)} cal)`,
          );
        }
      });
    }
  }

  if (assertions.mustHaveMinIngredients != null) {
    const d = structuredData as { ingredients?: unknown[] };
    if (!Array.isArray(d?.ingredients)) {
      failures.push(
        "mustHaveMinIngredients requires { ingredients: unknown[] }",
      );
    } else if (d.ingredients.length < assertions.mustHaveMinIngredients) {
      failures.push(
        `Expected at least ${assertions.mustHaveMinIngredients} ingredients, got ${d.ingredients.length}`,
      );
    }
  }

  if (assertions.mustHaveMinInstructions != null) {
    const d = structuredData as { instructions?: unknown[] };
    if (!Array.isArray(d?.instructions)) {
      failures.push(
        "mustHaveMinInstructions requires { instructions: unknown[] }",
      );
    } else if (d.instructions.length < assertions.mustHaveMinInstructions) {
      failures.push(
        `Expected at least ${assertions.mustHaveMinInstructions} instructions, got ${d.instructions.length}`,
      );
    }
  }

  if (assertions.foodsMinLength != null) {
    const d = structuredData as { foods?: unknown[] };
    if (!Array.isArray(d?.foods)) {
      failures.push("foodsMinLength assertion requires { foods: unknown[] }");
    } else if (d.foods.length < assertions.foodsMinLength) {
      failures.push(
        `Expected at least ${assertions.foodsMinLength} food item(s), got ${d.foods.length}`,
      );
    }
  }

  if (assertions.overallConfidenceMin != null) {
    const d = structuredData as { overallConfidence?: unknown };
    if (
      typeof d?.overallConfidence !== "number" ||
      !Number.isFinite(d.overallConfidence)
    ) {
      failures.push(
        "overallConfidenceMin assertion requires { overallConfidence: number }",
      );
    } else if (d.overallConfidence < assertions.overallConfidenceMin) {
      failures.push(
        `overallConfidence ${d.overallConfidence.toFixed(2)} is below minimum ${assertions.overallConfidenceMin}`,
      );
    }
  }

  if (assertions.overallConfidenceMax != null) {
    const d = structuredData as { overallConfidence?: unknown };
    if (
      typeof d?.overallConfidence !== "number" ||
      !Number.isFinite(d.overallConfidence)
    ) {
      failures.push(
        "overallConfidenceMax assertion requires { overallConfidence: number }",
      );
    } else if (d.overallConfidence > assertions.overallConfidenceMax) {
      failures.push(
        `overallConfidence ${d.overallConfidence.toFixed(2)} exceeds maximum ${assertions.overallConfidenceMax}`,
      );
    }
  }

  return { passed: failures.length === 0, failures };
}
