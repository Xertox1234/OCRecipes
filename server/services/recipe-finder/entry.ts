// server/services/recipe-finder/entry.ts
// When does a message enter the finder? (spec §3.3, §4 "Typed input")
import type { ChatMessage } from "@shared/schema";
import {
  finderBlockSchema,
  type FinderAction,
  type FinderBlock,
} from "@shared/schemas/recipe-finder";
import { recipeChatMetadataSchema } from "@shared/schemas/recipe-chat";
import type { CoachIntent } from "../coach-intent-classifier";
import type { FinderInput, TypedFinderCommand } from "./transition";

export function finderBlockFromMetadata(metadata: unknown): FinderBlock | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const direct = finderBlockSchema.safeParse(m.finder);
  if (direct.success) return direct.data;
  if (Array.isArray(m.blocks)) {
    for (const b of m.blocks) {
      const parsed = finderBlockSchema.safeParse(b);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

function latestAssistant(history: ChatMessage[]): ChatMessage | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i];
  }
  return undefined;
}

/** Only the most recent assistant message's flow is live (§4). */
export function getLatestFinderBlock(
  history: ChatMessage[],
): FinderBlock | null {
  const last = latestAssistant(history);
  return last ? finderBlockFromMetadata(last.metadata) : null;
}

export function isActionCurrent(
  latest: FinderBlock | null,
  action: FinderAction,
): boolean {
  return latest !== null && latest.flow.flowId === action.flowId;
}

export function getLatestRecipe(
  history: ChatMessage[],
  opts: { latestOnly: boolean },
): { title: string; messageId: number } | null {
  const candidates = opts.latestOnly
    ? [latestAssistant(history)].filter((m): m is ChatMessage => !!m)
    : [...history].reverse().filter((m) => m.role === "assistant");
  for (const m of candidates) {
    const parsed = recipeChatMetadataSchema.safeParse(m.metadata);
    if (parsed.success) {
      return { title: parsed.data.recipe.title, messageId: m.id };
    }
  }
  return null;
}

const GENERATE_PHRASES = new Set([
  "generate",
  "generate one",
  "generate it",
  "generate recipe",
  "generate a recipe",
]);
const NONE_PHRASES = new Set([
  "none of these",
  "none of those",
  "none of them",
]);

const YES_PHRASES = new Set([
  "yes",
  "yes please",
  "sure",
  "go ahead",
  "do it",
  "ok",
  "okay",
  "yep",
]);
const NO_PHRASES = new Set([
  "no",
  "no thanks",
  "no thank you",
  "nope",
  "not now",
]);
const SEARCH_PHRASES = new Set([
  "search",
  "search ocrecipes",
  "search for one",
]);

export function normalizeCommand(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’.!?,]+$/, "")
    .trim();
}

/**
 * §9 item 7 old-client guard: exact short phrases act as the button. "none
 * of these" only in the results stage — in the clarifying stage free text is
 * an answer, and "none" is a legitimate one.
 */
export function matchTypedFinderCommand(
  text: string,
  stage: FinderBlock["type"],
  offer = false,
): TypedFinderCommand | null {
  const t = normalizeCommand(text);
  if (GENERATE_PHRASES.has(t)) return "generate";
  // Offer-flow phrases need the flag AND the stage: offer/adjust blocks can
  // outlive a flag flip-off, so the stage alone is not enough.
  if (offer && (stage === "recipe_offer" || stage === "recipe_adjust")) {
    if (YES_PHRASES.has(t)) return "yes";
    if (NO_PHRASES.has(t)) return "no";
    if (stage === "recipe_offer" && SEARCH_PHRASES.has(t)) return "search";
  }
  if (stage === "recipe_results" && NONE_PHRASES.has(t)) {
    return "none_of_these";
  }
  return null;
}

export type RecipeChefEntry =
  | { kind: "finder"; input: FinderInput }
  | { kind: "classify"; recipeTitle: string }
  | { kind: "legacy" };

/** `history` is the conversation BEFORE this turn's user row is inserted. */
export function decideRecipeChefEntry(
  history: ChatMessage[],
  text: string,
  opts?: { offer?: boolean },
): RecipeChefEntry {
  const latest = getLatestFinderBlock(history);
  if (latest) {
    return {
      kind: "finder",
      input: {
        kind: "typed",
        text,
        command: matchTypedFinderCommand(
          text,
          latest.type,
          opts?.offer === true,
        ),
      },
    };
  }
  // Offer on: refine is only for a card ON SCREEN (the latest message);
  // an older card with a text reply since gets an offer instead.
  const card = getLatestRecipe(history, { latestOnly: opts?.offer === true });
  if (card) return { kind: "classify", recipeTitle: card.title };
  if (!history.some((m) => m.role === "user")) {
    return { kind: "finder", input: { kind: "start", text } };
  }
  // Offer on: legacy generation is replaced by the offer (H3).
  if (opts?.offer) return { kind: "finder", input: { kind: "start", text } };
  return { kind: "legacy" };
}

export type CoachFinderEntry =
  | { kind: "finder"; input: FinderInput }
  | { kind: "classify"; recipeTitle: string }
  | { kind: "none" };

/**
 * `history` INCLUDES this turn's user row (Coach inserts it first). Coach runs
 * classifyTurn only while the generated card is the LATEST assistant message:
 * a Coach conversation moves on to other topics, and classifyTurn's
 * new_request fallback must never turn "how am I doing?" into a recipe list.
 */
export function decideCoachFinderEntry(
  history: ChatMessage[],
  text: string,
  intent: CoachIntent,
  action?: FinderAction,
  opts?: { offer?: boolean },
): CoachFinderEntry {
  const offer = opts?.offer === true;
  if (action) return { kind: "finder", input: { kind: "action", action } };
  if (intent === "safety_refusal") return { kind: "none" };
  const latest = getLatestFinderBlock(history);
  if (latest) {
    const command = matchTypedFinderCommand(text, latest.type, offer);
    // Offer on (H2): on a live offer/card only an exact command stays in the
    // finder; any other text goes to the tool loop, which may re-offer.
    if (
      offer &&
      command === null &&
      (latest.type === "recipe_offer" || latest.type === "recipe_adjust")
    ) {
      return { kind: "none" };
    }
    return { kind: "finder", input: { kind: "typed", text, command } };
  }
  const card = getLatestRecipe(history, { latestOnly: true });
  if (card) return { kind: "classify", recipeTitle: card.title };
  // Offer on: the model (offer_recipe tool) is the single decider of new asks.
  if (intent === "recipe_request" && !offer) {
    return { kind: "finder", input: { kind: "start", text } };
  }
  return { kind: "none" };
}
