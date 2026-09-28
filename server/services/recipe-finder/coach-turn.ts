// server/services/recipe-finder/coach-turn.ts
// Coach Pro delivery for the recipe finder (R2): finder steps persist
// {blocks:[finderBlock]} with the turnKey and yield {type:"blocks"}; a
// Generate/refine persists RecipeChef's top-level recipe metadata (R5) and
// yields only conversational text — the card arrives on the post-`done`
// refetch, so the route's CoachChatEvent ternary needs no new arm.
import type { ChatMessage } from "@shared/schema";
import type { CoachChatEvent } from "../coach-pro-chat";
import { storage } from "../../storage";
import { fireAndForget } from "../../lib/fire-and-forget";
import {
  generateRecipeChatResponse,
  type RecipeChatRecipe,
} from "../recipe-chat";
import {
  prepareFinderTurn,
  executeFinderStep,
  type FinderFeatures,
} from "./run-turn";
import { finderStatusLabel, type FinderInput } from "./transition";
import {
  gateRecipeGeneration,
  buildFinderGenerationMessages,
  type GenerationMessages,
} from "./generate";

export type CoachFinderTurnEntry =
  | { kind: "finder"; input: FinderInput }
  | { kind: "refine" };

export interface CoachFinderTurnParams {
  conversationId: number;
  userId: string;
  content: string;
  turnKey?: string;
  /** Includes this turn's user row (Coach inserts it before the service). */
  history: ChatMessage[];
  userMessageId: number;
  entry: CoachFinderTurnEntry;
  features: FinderFeatures;
}

const LIMIT_TEXT =
  "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
const PREMIUM_TEXT = "Generating recipes is a Premium feature.";

async function persistAssistant(
  p: CoachFinderTurnParams,
  content: string,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  if (p.turnKey) {
    const existing = await storage.getChatMessageByTurnKey(
      p.conversationId,
      p.turnKey,
    );
    if (existing) return;
  }
  await storage.createChatMessage(
    p.conversationId,
    p.userId,
    "assistant",
    content,
    metadata,
    p.turnKey,
  );
}

function maybeAutoTitle(p: CoachFinderTurnParams): void {
  if (p.history.length > 1) return;
  const title = p.content.slice(0, 50) + (p.content.length > 50 ? "..." : "");
  fireAndForget(
    "coach-chat-auto-title",
    storage.updateChatConversationTitle(p.conversationId, p.userId, title),
  );
}

/**
 * Deliberately never checks for a client disconnect: every step here spends a
 * paid claim (Spoonacular point or a generation) or AI tokens, so — like
 * RecipeChef's finish-and-save policy — it always finishes and persists with
 * the turnKey. The route's H6 settle then finds the reply and keeps the user
 * row; if the route stops iterating first, its guarded refund still refuses
 * to delete a claimed row (#1151 review).
 */
export async function* runCoachFinderTurn(
  p: CoachFinderTurnParams,
): AsyncGenerator<CoachChatEvent> {
  const profile = await storage.getUserProfile(p.userId);
  let generation: GenerationMessages;

  if (p.entry.kind === "refine") {
    yield { type: "status", label: "Updating your recipe…" };
    const gate = await gateRecipeGeneration({
      userId: p.userId,
      userMessageId: p.userMessageId,
      canGenerate: p.features.recipeGeneration,
      dailyLimit: p.features.dailyRecipeGenerations,
    });
    if (gate.status !== "allowed") {
      const text = gate.status === "limit_reached" ? LIMIT_TEXT : PREMIUM_TEXT;
      await persistAssistant(p, text, null);
      yield { type: "content", content: text };
      return;
    }
    generation = buildFinderGenerationMessages({
      mode: "refine",
      history: p.history,
    });
  } else {
    const { step } = prepareFinderTurn(p.history, p.entry.input);
    const label = finderStatusLabel(step);
    if (label) yield { type: "status", label };
    const turn = await executeFinderStep(step, {
      userId: p.userId,
      userMessageId: p.userMessageId,
      history: p.history,
      profile,
      features: p.features,
    });
    if (turn.kind === "ignored") {
      await storage.deleteChatMessage(p.userMessageId, p.userId);
      return;
    }
    if (turn.kind === "message") {
      await persistAssistant(p, turn.content, { blocks: [turn.block] });
      maybeAutoTitle(p);
      yield { type: "blocks", blocks: [turn.block] };
      return;
    }
    generation = turn.messages;
    // A round-1 search that found nothing falls through to Generate.
    if (step.kind !== "generate") {
      yield { type: "status", label: "Creating your recipe…" };
    }
  }

  let text = "";
  let recipe: RecipeChatRecipe | null = null;
  let allergenWarning: string | null = null;
  let imageUrl: string | null = null;
  for await (const event of generateRecipeChatResponse(generation, profile)) {
    if ("recipe" in event && event.recipe) {
      recipe = event.recipe;
      allergenWarning = event.allergenWarning;
    } else if ("imageUrl" in event && event.imageUrl) {
      imageUrl = event.imageUrl;
    } else if ("content" in event && event.content) {
      text += event.content;
    }
  }
  const conversational =
    text.replace(/\n*```json[\s\S]*?```\s*/g, "").trim() ||
    (recipe
      ? "Here's a recipe for you!"
      : "Sorry, I couldn't create a recipe right now. Please try again.");
  await persistAssistant(
    p,
    conversational,
    recipe ? { metadataVersion: 1, recipe, allergenWarning, imageUrl } : null,
  );
  maybeAutoTitle(p);
  yield { type: "content", content: conversational };
}
