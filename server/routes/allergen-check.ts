import type { Express, Request, Response } from "express";
import { allergenCheckRateLimit, formatZodError } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { detectAllergens } from "@shared/constants/allergens";
import type { AllergySeverity } from "@shared/constants/allergens";
import { allergenCheckRequestSchema } from "@shared/types/allergen-check";
import type {
  AllergenCheckResult,
  AllergenSubstitutionSuggestion,
} from "@shared/types/allergen-check";
import { getSubstitutions } from "../services/ingredient-substitution";
import type { CookingSessionIngredient } from "@shared/types/cook-session";
import { allergySchema } from "@shared/schema";

/** Runtime-safe extraction of allergies from JSONB column. */
function parseAllergies(
  raw: unknown,
): { name: string; severity: AllergySeverity }[] {
  if (!Array.isArray(raw)) return [];
  const result: { name: string; severity: AllergySeverity }[] = [];
  for (const item of raw) {
    const parsed = allergySchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

export function register(app: Express): void {
  /**
   * POST /api/allergen-check
   *
   * Accepts a list of ingredient names and returns:
   * - allergen matches against the authenticated user's declared allergies
   * - safe substitution suggestions for each matched ingredient
   */
  app.post(
    "/api/allergen-check",
    requireAuth,
    allergenCheckRateLimit,
    async (req: Request, res: Response) => {
      try {
        const parsed = allergenCheckRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const { ingredients } = parsed.data;

        // Fetch user profile to get allergy declarations
        const profile = await storage.getUserProfile(req.userId!);
        const userAllergies = parseAllergies(profile?.allergies);

        if (userAllergies.length === 0) {
          const result: AllergenCheckResult = {
            matches: [],
            substitutions: [],
          };
          return res.json(result);
        }

        // Detect allergens in the ingredient list
        const matches = detectAllergens(ingredients, userAllergies);

        // Build substitution suggestions for matched ingredients
        let substitutions: AllergenSubstitutionSuggestion[] = [];

        if (matches.length > 0) {
          // Build a lookup: ingredient name → first allergen match
          const matchMap = new Map(matches.map((m) => [m.ingredientName, m]));
          const uniqueIngredients = [...matchMap.keys()];

          // Map ingredient index → id so we can reverse-lookup after substitution
          const idToName = new Map<string, string>();
          const sessionIngredients: CookingSessionIngredient[] =
            uniqueIngredients.map((name, i) => {
              const id = `allergen-check-${i}`;
              idToName.set(id, name);
              return {
                id,
                name,
                quantity: 1,
                unit: "serving",
                confidence: 1,
                category: "other" as const,
                photoId: "",
                userEdited: false,
              };
            });

          const subResult = await getSubstitutions(sessionIngredients, profile);

          // Enrich substitutions with allergen context; skip any unresolvable
          for (const s of subResult.suggestions) {
            const ingredientName = idToName.get(s.originalIngredientId);
            const match = ingredientName
              ? matchMap.get(ingredientName)
              : undefined;
            if (!match) continue; // Don't fabricate allergen data
            substitutions.push({
              ...s,
              allergenId: match.allergenId,
              severity: match.severity,
            });
          }
        }

        const result: AllergenCheckResult = { matches, substitutions };
        res.json(result);
      } catch (error) {
        console.error("Allergen check error:", error);
        sendError(
          res,
          500,
          "Failed to check allergens",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
