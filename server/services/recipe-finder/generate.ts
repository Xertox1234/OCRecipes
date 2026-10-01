// server/services/recipe-finder/generate.ts
import type { ChatMessage } from "@shared/schema";
import { storage } from "../../storage";
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
    | { mode: "refine"; history: ChatMessage[] },
): GenerationMessages {
  if (input.mode === "refine") return buildRecipeContext(input.history);
  return [{ role: "user", content: `Create a recipe for: ${input.request}` }];
}
