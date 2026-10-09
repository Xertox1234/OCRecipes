// server/services/recipe-finder/coach-turn.ts
// Coach Pro delivery for the recipe finder (R2): finder steps persist
// {blocks:[finderBlock]} with the turnKey and yield {type:"blocks"}; a
// Generate/refine persists RecipeChef's top-level recipe metadata (R5) and
// yields only conversational text — the card arrives on the post-`done`
// refetch, so the route's CoachChatEvent ternary needs no new arm.
import type { ChatMessage } from "@shared/schema";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
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
import { finderBlockFromMetadata } from "./entry";
import {
  gateRecipeGeneration,
  buildFinderGenerationMessages,
  type GenerationMessages,
} from "./generate";

export type CoachFinderTurnEntry =
  /** `offer`: RECIPE_OFFER_ENABLED; absent/false = today's behaviour exactly. */
  { kind: "finder"; input: FinderInput; offer?: boolean } | { kind: "refine" };

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
  /** Coach's pre-tool text (offer tool path); leads the saved reply. */
  leadText?: string;
  /** Blocks parsed out of that pre-tool text; they precede the finder block. */
  leadBlocks?: CoachBlock[];
}

/**
 * On a turnKey hit nothing new was saved, so a freshly minted flowId would
 * differ from the stored card's and its taps would be stale: swap in the
 * stored finder block. With no stored finder block, today's blocks stand.
 */
export function savedBlocks(
  existing: ChatMessage | undefined,
  blocks: CoachBlock[],
  fresh: CoachBlock,
): CoachBlock[] {
  const stored = existing ? finderBlockFromMetadata(existing.metadata) : null;
  return stored ? blocks.map((b) => (b === fresh ? stored : b)) : blocks;
}

/** Prepends Coach's streamed pre-tool text to a saved reply. */
export function withLead(leadText: string | undefined, text: string): string {
  return leadText ? `${leadText}\n\n${text}` : text;
}

const LIMIT_TEXT =
  "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
const PREMIUM_TEXT = "Generating recipes is a Premium feature.";

/** Saves once per turnKey; returns the already-saved row on a turnKey hit. */
async function persistAssistant(
  p: CoachFinderTurnParams,
  content: string,
  metadata: Record<string, unknown> | null,
): Promise<ChatMessage | undefined> {
  if (p.turnKey) {
    const existing = await storage.getChatMessageByTurnKey(
      p.conversationId,
      p.turnKey,
    );
    if (existing) return existing;
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
 * RecipeChef's finish-and-save policy — it finishes and persists with the
 * turnKey. The route stops iterating at a yield once the client leaves, so
 * there is NO yield between a claim (inside executeFinderStep /
 * gateRecipeGeneration) and its persist: every post-claim yield comes after
 * persistAssistant. The route's H6 settle then finds the reply and keeps the
 * user row; claims live in recipe_finder_claims, so even its refund (a row
 * delete) never hands a paid slot back (#1151 review).
 */
export async function* runCoachFinderTurn(
  p: CoachFinderTurnParams,
): AsyncGenerator<CoachChatEvent> {
  const profile = await storage.getUserProfile(p.userId);
  let generation: GenerationMessages;
  let allergenDetail: "extended" | undefined;

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
    const offer = p.entry.offer === true;
    const { latest, step } = prepareFinderTurn(p.history, p.entry.input, {
      offer,
    });
    const label = finderStatusLabel(step);
    if (label) yield { type: "status", label };
    const turn = await executeFinderStep(step, {
      userId: p.userId,
      userMessageId: p.userMessageId,
      history: p.history,
      profile,
      features: p.features,
      offer,
      latest,
    });
    if (turn.kind === "ignored") {
      await storage.deleteChatMessage(p.userMessageId, p.userId);
      return;
    }
    if (turn.kind === "message") {
      const blocks: CoachBlock[] = [...(p.leadBlocks ?? []), turn.block];
      const existing = await persistAssistant(
        p,
        withLead(p.leadText, turn.content),
        { blocks },
      );
      maybeAutoTitle(p);
      yield {
        type: "blocks",
        blocks: savedBlocks(existing, blocks, turn.block),
      };
      return;
    }
    // Offer flag only: "No problem." closes the flow with NO metadata, so it
    // is the latest assistant message with no live block. The user row stays.
    if (turn.kind === "close" || turn.kind === "plain") {
      await persistAssistant(p, turn.content, null);
      maybeAutoTitle(p);
      yield { type: "content", content: turn.content };
      return;
    }
    // A round-1 search that found nothing has fallen through to Generate and
    // already claimed it — no status yield here: the route returns the
    // generator at a yield once the client leaves, which would drop the
    // claimed recipe unpersisted.
    generation = turn.messages;
    allergenDetail = turn.allergenDetail;
  }

  let text = "";
  let recipe: RecipeChatRecipe | null = null;
  let allergenWarning: string | null = null;
  let imageUrl: string | null = null;
  // Only the adjusted (offer-flag) path asks for extended allergen detail;
  // every other call keeps today's two-argument shape.
  const events = allergenDetail
    ? generateRecipeChatResponse(generation, profile, undefined, {
        allergenDetail,
      })
    : generateRecipeChatResponse(generation, profile);
  for await (const event of events) {
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
