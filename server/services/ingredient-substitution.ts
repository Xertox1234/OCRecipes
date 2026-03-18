/**
 * AI-powered ingredient substitution suggestions.
 *
 * Checks a static lookup table for common substitutions first (no API cost),
 * then falls back to GPT-4o for uncommon ingredients.
 */

import { z } from "zod";
import type { UserProfile } from "@shared/schema";
import {
  substitutionSuggestionSchema,
  type CookingSessionIngredient,
  type SubstitutionSuggestion,
  type SubstitutionResult,
} from "@shared/types/cook-session";
import {
  detectAllergens,
  type AllergySeverity,
} from "@shared/constants/allergens";
import { openai, OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";

// ============================================================================
// STATIC SUBSTITUTION LOOKUP (avoids API call for common ingredients)
// ============================================================================

interface StaticSubstitution {
  name: string;
  ratio: string;
  tags: string[];
  macroDelta: { calories: number; protein: number; carbs: number; fat: number };
}

const COMMON_SUBSTITUTIONS: Record<string, StaticSubstitution[]> = {
  butter: [
    {
      name: "coconut oil",
      ratio: "1:1",
      tags: ["dairy-free", "vegan"],
      macroDelta: { calories: 5, protein: 0, carbs: 0, fat: 1 },
    },
    {
      name: "olive oil",
      ratio: "3/4 cup per 1 cup",
      tags: ["dairy-free", "heart-healthy"],
      macroDelta: { calories: -20, protein: 0, carbs: 0, fat: -3 },
    },
    {
      name: "applesauce",
      ratio: "1/2 cup per 1 cup",
      tags: ["low-fat"],
      macroDelta: { calories: -80, protein: 0, carbs: 15, fat: -11 },
    },
  ],
  "all-purpose flour": [
    {
      name: "almond flour",
      ratio: "1:1 (add 1 egg per cup)",
      tags: ["gluten-free", "low-carb"],
      macroDelta: { calories: 120, protein: 6, carbs: -18, fat: 14 },
    },
    {
      name: "oat flour",
      ratio: "1:1",
      tags: ["whole-grain"],
      macroDelta: { calories: -5, protein: 2, carbs: -3, fat: 1 },
    },
  ],
  "white sugar": [
    {
      name: "honey",
      ratio: "3/4 cup per 1 cup (reduce liquid by 2 tbsp)",
      tags: ["natural"],
      macroDelta: { calories: -60, protein: 0, carbs: -15, fat: 0 },
    },
    {
      name: "maple syrup",
      ratio: "3/4 cup per 1 cup",
      tags: ["natural", "vegan"],
      macroDelta: { calories: -50, protein: 0, carbs: -12, fat: 0 },
    },
  ],
  "whole milk": [
    {
      name: "oat milk",
      ratio: "1:1",
      tags: ["dairy-free", "vegan"],
      macroDelta: { calories: -30, protein: -5, carbs: 3, fat: -4 },
    },
    {
      name: "almond milk",
      ratio: "1:1",
      tags: ["dairy-free", "low-calorie"],
      macroDelta: { calories: -110, protein: -7, carbs: -11, fat: -6 },
    },
  ],
  egg: [
    {
      name: "flax egg (1 tbsp ground flax + 3 tbsp water)",
      ratio: "1 flax egg per 1 egg",
      tags: ["vegan", "egg-free"],
      macroDelta: { calories: -45, protein: -5, carbs: 1, fat: -3 },
    },
  ],
  "sour cream": [
    {
      name: "Greek yogurt",
      ratio: "1:1",
      tags: ["high-protein", "lower-fat"],
      macroDelta: { calories: -80, protein: 8, carbs: 2, fat: -15 },
    },
  ],
  "heavy cream": [
    {
      name: "coconut cream",
      ratio: "1:1",
      tags: ["dairy-free", "vegan"],
      macroDelta: { calories: -20, protein: -2, carbs: 2, fat: -3 },
    },
  ],
  rice: [
    {
      name: "cauliflower rice",
      ratio: "1:1",
      tags: ["low-carb", "keto"],
      macroDelta: { calories: -190, protein: -3, carbs: -42, fat: 0 },
    },
  ],
  pasta: [
    {
      name: "zucchini noodles",
      ratio: "1:1",
      tags: ["low-carb", "gluten-free"],
      macroDelta: { calories: -180, protein: -5, carbs: -38, fat: -1 },
    },
  ],
};

function findStaticSubstitutions(
  ingredientName: string,
  dietaryTags: string[],
): StaticSubstitution[] {
  const key = ingredientName.toLowerCase().trim();
  const subs = COMMON_SUBSTITUTIONS[key];
  if (!subs) return [];

  // If user has dietary tags, prioritize matching substitutions
  if (dietaryTags.length > 0) {
    const matching = subs.filter((s) =>
      s.tags.some((t) => dietaryTags.includes(t)),
    );
    if (matching.length > 0) return matching;
  }

  return subs;
}

// ============================================================================
// DIETARY PROFILE HELPERS
// ============================================================================

function buildDietaryProfileSummary(
  profile: UserProfile | null | undefined,
): string {
  if (!profile) return "No dietary profile set";

  const parts: string[] = [];
  if (profile.dietType) parts.push(`Diet: ${profile.dietType}`);
  if (profile.allergies && Array.isArray(profile.allergies)) {
    const allergyNames = (profile.allergies as { name: string }[]).map(
      (a) => a.name,
    );
    if (allergyNames.length > 0)
      parts.push(`Allergies: ${allergyNames.join(", ")}`);
  }
  if (profile.foodDislikes && Array.isArray(profile.foodDislikes)) {
    if (profile.foodDislikes.length > 0)
      parts.push(`Dislikes: ${(profile.foodDislikes as string[]).join(", ")}`);
  }
  if (profile.primaryGoal) parts.push(`Goal: ${profile.primaryGoal}`);

  return parts.length > 0 ? parts.join("; ") : "No dietary profile set";
}

function extractDietaryTags(profile: UserProfile | null | undefined): string[] {
  if (!profile) return [];
  const tags: string[] = [];

  if (profile.dietType) {
    const diet = profile.dietType.toLowerCase();
    if (diet.includes("vegan")) tags.push("vegan", "dairy-free", "egg-free");
    if (diet.includes("vegetarian")) tags.push("vegetarian");
    if (diet.includes("keto") || diet.includes("low-carb"))
      tags.push("low-carb", "keto");
    if (diet.includes("gluten")) tags.push("gluten-free");
  }

  if (profile.allergies && Array.isArray(profile.allergies)) {
    const allergenToTag: Record<string, string[]> = {
      peanuts: ["peanut-free"],
      peanut: ["peanut-free"],
      tree_nuts: ["nut-free"],
      "tree nuts": ["nut-free"],
      nut: ["nut-free"],
      milk: ["dairy-free"],
      dairy: ["dairy-free"],
      "dairy/milk": ["dairy-free"],
      lactose: ["dairy-free"],
      eggs: ["egg-free"],
      egg: ["egg-free"],
      wheat: ["gluten-free"],
      "wheat/gluten": ["gluten-free"],
      gluten: ["gluten-free"],
      soy: ["soy-free"],
      soybean: ["soy-free"],
      fish: ["fish-free"],
      shellfish: ["shellfish-free"],
      sesame: ["sesame-free"],
    };

    for (const allergy of profile.allergies as { name: string }[]) {
      const name = allergy.name.toLowerCase().trim();
      const mapped = allergenToTag[name];
      if (mapped) {
        tags.push(...mapped);
      }
    }
  }

  return [...new Set(tags)];
}

// ============================================================================
// AI-POWERED SUBSTITUTION (fallback for uncommon ingredients)
// ============================================================================

const substitutionResponseSchema = z.object({
  suggestions: z.array(substitutionSuggestionSchema),
});

async function getAiSubstitutions(
  ingredients: CookingSessionIngredient[],
  profileSummary: string,
): Promise<SubstitutionSuggestion[]> {
  const ingredientList = ingredients
    .map((i) => `- ${i.name} (${i.quantity} ${i.unit}, id: ${i.id})`)
    .join("\n");

  const sanitizedProfile = sanitizeUserInput(profileSummary);

  const prompt = `Suggest healthy substitutions for these cooking ingredients:

${ingredientList}

User dietary profile: ${sanitizedProfile}

For each ingredient, provide 1-2 substitutions that:
1. Match the dietary profile (if any restrictions/preferences)
2. Work well in cooking (similar texture/function)
3. Include estimated macro differences per serving

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only:
{
  "suggestions": [
    {
      "originalIngredientId": "the ingredient id",
      "substitute": "substitute name",
      "reason": "why this works",
      "ratio": "1:1 or specific ratio",
      "macroDelta": { "calories": -20, "protein": 2, "carbs": -5, "fat": -3 },
      "confidence": 0.85
    }
  ]
}`;

  const response = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition and cooking expert. Suggest practical ingredient substitutions. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500,
    },
    { timeout: OPENAI_TIMEOUT_HEAVY_MS },
  );

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return [];
  }

  const validated = substitutionResponseSchema.safeParse(parsed);
  if (!validated.success) {
    console.error(
      "Substitution response validation failed:",
      validated.error.format(),
    );
    return [];
  }

  return validated.data.suggestions;
}

// ============================================================================
// CROSS-ALLERGY SAFETY FILTER
// ============================================================================

/**
 * Removes substitution suggestions that themselves contain one of the user's
 * allergens. Without this, a tree-nut-allergic user could be told to use
 * "almond flour" as a wheat substitute — a dangerous recommendation.
 */
function filterSafeSubstitutions(
  suggestions: SubstitutionSuggestion[],
  userAllergies: { name: string; severity: AllergySeverity }[],
): SubstitutionSuggestion[] {
  if (userAllergies.length === 0) return suggestions;

  return suggestions.filter((s) => {
    const matches = detectAllergens([s.substitute], userAllergies);
    return matches.length === 0;
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function getSubstitutions(
  ingredients: CookingSessionIngredient[],
  userProfile: UserProfile | null | undefined,
): Promise<SubstitutionResult> {
  const dietaryTags = extractDietaryTags(userProfile);
  const profileSummary = buildDietaryProfileSummary(userProfile);

  const staticResults: SubstitutionSuggestion[] = [];
  const needsAi: CookingSessionIngredient[] = [];

  for (const ingredient of ingredients) {
    const staticSubs = findStaticSubstitutions(ingredient.name, dietaryTags);
    if (staticSubs.length > 0) {
      for (const sub of staticSubs) {
        staticResults.push({
          originalIngredientId: ingredient.id,
          substitute: sub.name,
          reason: `Common substitution (${sub.tags.join(", ")})`,
          ratio: sub.ratio,
          macroDelta: sub.macroDelta,
          confidence: 0.9,
        });
      }
    } else {
      needsAi.push(ingredient);
    }
  }

  let aiResults: SubstitutionSuggestion[] = [];
  if (needsAi.length > 0) {
    try {
      aiResults = await getAiSubstitutions(needsAi, profileSummary);
    } catch (error) {
      console.error("AI substitution error:", error);
      // Static results still returned even if AI fails
    }
  }

  const allSuggestions = [...staticResults, ...aiResults];

  // Safety: remove any suggestions that contain the user's own allergens
  const userAllergies = (
    (userProfile?.allergies as {
      name: string;
      severity: AllergySeverity;
    }[]) ?? []
  ).filter((a) => a.name && a.severity);

  const safeSuggestions = filterSafeSubstitutions(
    allSuggestions,
    userAllergies,
  );

  return {
    suggestions: safeSuggestions,
    dietaryProfileSummary: profileSummary,
  };
}

export const _testInternals = {
  COMMON_SUBSTITUTIONS,
  findStaticSubstitutions,
  buildDietaryProfileSummary,
  extractDietaryTags,
  filterSafeSubstitutions,
};
