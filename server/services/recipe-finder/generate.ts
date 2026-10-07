// server/services/recipe-finder/generate.ts
import type { ChatMessage } from "@shared/schema";
import { storage } from "../../storage";
import type {
  AdjustSettings,
  FinderAnswer,
  RecipeDetails,
} from "@shared/schemas/recipe-finder";
import { COOKING_TIMES } from "@shared/constants/cooking-times";
import { sanitizeContextField } from "../../lib/ai-safety";
import { buildRecipeContext } from "../recipe-chat";

export type GenerateGate =
  | { status: "allowed" }
  | { status: "premium_required" }
  | { status: "limit_reached" };

/**
 * §3.1: the Generate step applies the recipeGeneration premium check and the
 * 20/day limit ITSELF — today they live only in the recipe/remix route, so
 * the Coach path would otherwise bypass both.
 */
export async function gateRecipeGeneration(args: {
  userId: string;
  userMessageId: number;
  canGenerate: boolean;
  dailyLimit: number;
}): Promise<GenerateGate> {
  if (!args.canGenerate) return { status: "premium_required" };
  const claimed = await storage.claimRecipeGeneration(
    args.userId,
    args.userMessageId,
    args.dailyLimit,
  );
  return claimed ? { status: "allowed" } : { status: "limit_reached" };
}

export type GenerationMessages = {
  role: "user" | "assistant" | "system";
  content: string;
}[];

export function buildFinderGenerationMessages(
  input:
    | { mode: "fresh"; request: string }
    | { mode: "refine"; history: ChatMessage[] }
    | {
        mode: "adjusted";
        dish: string;
        details: RecipeDetails;
        settings: AdjustSettings;
        answers: FinderAnswer[];
        history: ChatMessage[];
      },
): GenerationMessages {
  if (input.mode === "refine") return buildRecipeContext(input.history);
  if (input.mode === "adjusted") {
    const { dish, details, settings, answers, history } = input;
    const time =
      COOKING_TIMES.find((t) => t.id === settings.time)?.description ??
      settings.time;
    const lines = [
      `Create a recipe for: ${sanitizeContextField(dish, 80)}`,
      `Servings: ${settings.servings}`,
      `Spice level: ${settings.spice}`,
      `Time available: ${time}`,
    ];
    if (details.ingredients.length > 0) {
      lines.push(
        `Use these ingredients: ${details.ingredients
          .map((i) => sanitizeContextField(i, 60))
          .join(", ")}`,
      );
    }
    for (const a of answers) {
      lines.push(
        `${sanitizeContextField(a.question, 160)} ${sanitizeContextField(a.answer, 200)}`,
      );
    }
    return [
      ...(details.fromConversation ? buildRecipeContext(history) : []),
      { role: "user", content: lines.join("\n") },
    ];
  }
  return [{ role: "user", content: `Create a recipe for: ${input.request}` }];
}
