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

// Words that, earlier in the same clause, mean the allergen is being named
// to steer the user away from it ("without peanuts", "avoid almonds").
const AVOID_LEAD =
  /\b(?:without(?! (?:a|any) doubt)|avoid(?:ing|s)?|skip(?:ping)?|steer clear of|no|never (?:eat|have|use)|free of|excluding|omit(?:ting)?|allergic to|allergy to|watch out for|beware of|check (?:the )?labels? for|don't (?:eat|have|use))\b/i;
// Words that flip the clause back to a suggestion ("avoid sugar, but try X").
const SUGGEST_WORD =
  /\b(?:but|instead|try|eat|have|enjoy|choose|opt for|use|snack on|swap in|add)\b/i;
// What may follow the allergen when it is named only as a warning.
// A negation right before an avoid word turns it into a suggestion
// ("don't skip X", "never avoid X").
const NEGATION_BEFORE =
  /\b(?:don['’]?t|do not|doesn['’]?t|does not|shouldn['’]?t|should not|never|not|no need to)\s+$/i;
const AVOID_TAIL =
  /^\w*[\s-]+(?:free\b|cross[- ]?contamination|cross[- ]?contact)/i;

function isAvoidanceMention(
  text: string,
  start: number,
  end: number,
  forbidden: RegExp[],
): boolean {
  if (AVOID_TAIL.test(text.slice(end))) return true;
  const clauseStart =
    Math.max(
      text.lastIndexOf(".", start),
      text.lastIndexOf("!", start),
      text.lastIndexOf("?", start),
      text.lastIndexOf("\n", start),
      text.lastIndexOf(";", start),
    ) + 1;
  const lead = text.slice(clauseStart, start);
  const avoid = AVOID_LEAD.exec(lead);
  if (!avoid) return false;
  if (NEGATION_BEFORE.test(lead.slice(0, avoid.index))) return false;
  const between = lead.slice(avoid.index + avoid[0].length);
  // A bare "no" is often an interjection ("No problem, X is great"): it only
  // does not count when a comma sits between it and the allergen.
  // A list of forbidden items is the exception ("no peanuts, almonds"): every
  // comma-separated part before the allergen must itself be a forbidden item.
  if (/^no$/i.test(avoid[0]) && between.includes(",")) {
    const parts = between
      .split(",")
      .map((part) => part.replace(/^\s*(?:or|and)\b/i, "").trim())
      .filter(Boolean);
    if (!parts.every((part) => forbidden.some((re) => re.test(part)))) {
      return false;
    }
  }
  // The allergen must follow the avoid word closely: at most two plain words
  // (commas and parentheses allowed), so "no better snack than X" or
  // "avoid chips - X works well" still count as suggestions.
  if (!/^[a-z,()'\s]*$/i.test(between)) return false;
  if (between.split(/[\s,()]+/).filter(Boolean).length > 2) return false;
  return !SUGGEST_WORD.test(between);
}

/** True when `regex` matches `text` somewhere other than an avoidance mention. */
function hasNonAvoidanceMatch(
  regex: RegExp,
  text: string,
  forbidden: RegExp[],
): boolean {
  const global = new RegExp(regex.source, "gi");
  for (const m of text.matchAll(global)) {
    if (!isAvoidanceMention(text, m.index, m.index + m[0].length, forbidden)) {
      return true;
    }
  }
  return false;
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
 *
 * A mustNotContain match that only names the item to steer away from
 * ("without peanuts", "avoid almonds", "peanut-free", "peanut
 * cross-contamination") is a safe mention and does not fail; a suggestion does.
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

    // Compiled once: the list also tells the avoidance check which words are
    // forbidden items ("no peanuts, almonds").
    const compiled = assertions.mustNotContain.map((pattern) => ({
      pattern,
      regex: safeCompile(pattern),
    }));
    const forbidden = compiled
      .map((c) => c.regex)
      .filter((re): re is RegExp => re !== null);
    for (const { pattern, regex } of compiled) {
      if (!regex) {
        failures.push(`Invalid mustNotContain regex: "${pattern}"`);
        continue;
      }
      if (hasNonAvoidanceMatch(regex, mustNotContainTarget, forbidden)) {
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

  if (assertions.maxWords !== undefined) {
    const words = response.trim().split(/\s+/).filter(Boolean).length;
    if (words > assertions.maxWords) {
      failures.push(
        `Response has ${words} words, more than ${assertions.maxWords}`,
      );
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
