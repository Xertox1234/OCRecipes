// server/services/recipe-finder/run-turn.ts
import { randomUUID } from "node:crypto";
import type { ChatMessage, UserProfile } from "@shared/schema";
import type { FinderBlock, FinderFlow } from "@shared/schemas/recipe-finder";
import type { PremiumFeatures } from "@shared/types/premium";
import { storage } from "../../storage";
import { extractQuery, extractOfferDetails } from "./extract-query";
import { askDishFollowUps } from "./ask-follow-ups";
import { buildAdjustBlock, validateAdjustAnswers } from "./adjust";
import { buildOfferBlock } from "./offer";
import { findCommunity } from "./find-community";
import { findOnline } from "./find-online";
import { askClarifying } from "./ask-clarifying";
import { getSpoonacularDailyCap, isOnlineCatalogConfigured } from "./config";
import { getLatestFinderBlock } from "./entry";
import { finderFallbackText } from "./fallback-text";
import {
  gateRecipeGeneration,
  buildFinderGenerationMessages,
  type GenerationMessages,
} from "./generate";
import {
  planFinderStep,
  type PlanOptions,
  finderOutcome,
  blockedGenerateBlock,
  type FinderCtx,
  type FinderInput,
  type FinderStep,
  type FinderStepResult,
} from "./transition";

export type FinderFeatures = Pick<
  PremiumFeatures,
  "catalogSave" | "recipeGeneration" | "dailyRecipeGenerations"
>;

export interface FinderTurnContext {
  userId: string;
  /** This turn's user row — the Generate / Spoonacular claims mark it. */
  userMessageId: number;
  history: ChatMessage[];
  profile: UserProfile | null | undefined;
  features: FinderFeatures;
  nextFlowId?: () => string;
  /** RECIPE_OFFER_ENABLED; absent/false = today's behaviour exactly. */
  offer?: boolean;
  /** Latest stored finder block (from prepareFinderTurn); the adjust-answer check needs it. */
  latest?: FinderBlock | null;
}

export type FinderTurnResult =
  | { kind: "ignored" }
  | { kind: "message"; content: string; block: FinderBlock }
  | { kind: "close"; content: "No problem." }
  | { kind: "plain"; content: string }
  | {
      kind: "generate";
      request: string;
      messages: GenerationMessages;
      allergenDetail?: "extended";
    };

export function prepareFinderTurn(
  history: ChatMessage[],
  input: FinderInput,
  opts?: PlanOptions,
): { latest: FinderBlock | null; step: FinderStep } {
  const latest = getLatestFinderBlock(history);
  return { latest, step: planFinderStep(latest, input, opts) };
}

function recentTranscript(history: ChatMessage[]) {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

async function adjustMessage(
  flow: FinderFlow,
  ctx: FinderTurnContext,
  nextFlowId: string,
): Promise<FinderTurnResult> {
  const followUps = await askDishFollowUps(
    flow.dish ?? flow.query.q,
    flow.details ?? { ingredients: [], fromConversation: false },
    recentTranscript(ctx.history),
  );
  const block = buildAdjustBlock({
    flow,
    profile: ctx.profile,
    followUps,
    nextFlowId,
  });
  return { kind: "message", block, content: finderFallbackText(block) };
}

export async function executeFinderStep(
  step: FinderStep,
  ctx: FinderTurnContext,
): Promise<FinderTurnResult> {
  if (step.kind === "ignore") return { kind: "ignored" };
  const finderCtx: FinderCtx = {
    onlineConfigured: isOnlineCatalogConfigured(),
    canSearchOnline: ctx.features.catalogSave,
    canGenerate: ctx.features.recipeGeneration,
    nextFlowId: (ctx.nextFlowId ?? randomUUID)(),
  };

  switch (step.kind) {
    case "close":
      return { kind: "close", content: "No problem." };
    case "offer_from_text": {
      const { dish, details } = await extractOfferDetails(
        step.text,
        ctx.history,
      );
      if (!dish) {
        return { kind: "plain", content: "Which dish did you have in mind?" };
      }
      const block = buildOfferBlock(dish, details, finderCtx.nextFlowId);
      return { kind: "message", block, content: finderFallbackText(block) };
    }
    case "offer": {
      const block = buildOfferBlock(
        step.dish,
        step.details,
        finderCtx.nextFlowId,
      );
      return { kind: "message", block, content: finderFallbackText(block) };
    }
    case "build_adjust":
      return adjustMessage(step.flow, ctx, finderCtx.nextFlowId);
    case "generate_with_settings": {
      // Validate BEFORE claiming: a rejected answer must cost nothing.
      if (
        ctx.latest?.type !== "recipe_adjust" ||
        !validateAdjustAnswers(ctx.latest, step.answers)
      ) {
        return { kind: "ignored" };
      }
      const gate = await gateRecipeGeneration({
        userId: ctx.userId,
        userMessageId: ctx.userMessageId,
        canGenerate: finderCtx.canGenerate,
        dailyLimit: ctx.features.dailyRecipeGenerations,
      });
      if (gate.status !== "allowed") {
        const block = blockedGenerateBlock(
          step.flow,
          gate.status === "limit_reached"
            ? "generate_limit"
            : "generate_premium",
          finderCtx,
        );
        return { kind: "message", block, content: finderFallbackText(block) };
      }
      return {
        kind: "generate",
        request: step.flow.request,
        allergenDetail: "extended",
        messages: buildFinderGenerationMessages({
          mode: "adjusted",
          dish: step.flow.dish ?? step.flow.query.q,
          details: step.flow.details ?? {
            ingredients: [],
            fromConversation: false,
          },
          settings: step.settings,
          answers: step.answers,
          history: ctx.history,
        }),
      };
    }
    default:
      break;
  }

  let result: FinderStepResult = { kind: "none" };
  switch (step.kind) {
    case "search_community": {
      const query = await extractQuery(step.request, {
        dietType: ctx.profile?.dietType ?? null,
      });
      const items = await findCommunity(query, ctx.userId, step.excludeIds);
      result = { kind: "community", query, items };
      break;
    }
    case "search_online": {
      // Premium, configuration and the DB-backed cap all resolve to the same
      // "not available right now" (§6) — never "no results".
      const allowed =
        finderCtx.onlineConfigured &&
        finderCtx.canSearchOnline &&
        (await storage.claimSpoonacularSearch(
          ctx.userId,
          ctx.userMessageId,
          getSpoonacularDailyCap(),
        ));
      result = {
        kind: "online",
        result: allowed
          ? await findOnline(step.flow.query, ctx.profile?.allergies)
          : { status: "unavailable" },
      };
      break;
    }
    case "ask_clarifying":
      result = {
        kind: "questions",
        questions: await askClarifying(
          step.flow.request,
          recentTranscript(ctx.history),
        ),
      };
      break;
    case "generate":
      break;
  }

  const outcome = finderOutcome(step, result, finderCtx, {
    offer: ctx.offer === true,
  });
  if (outcome.kind === "ignore") return { kind: "ignored" };
  if (outcome.kind === "build_adjust") {
    return adjustMessage(outcome.flow, ctx, finderCtx.nextFlowId);
  }
  if (outcome.kind === "message") {
    return {
      kind: "message",
      block: outcome.block,
      content: finderFallbackText(outcome.block),
    };
  }
  const gate = await gateRecipeGeneration({
    userId: ctx.userId,
    userMessageId: ctx.userMessageId,
    canGenerate: finderCtx.canGenerate,
    dailyLimit: ctx.features.dailyRecipeGenerations,
  });
  if (gate.status !== "allowed") {
    const block = blockedGenerateBlock(
      outcome.flow,
      gate.status === "limit_reached" ? "generate_limit" : "generate_premium",
      finderCtx,
    );
    return { kind: "message", block, content: finderFallbackText(block) };
  }
  return {
    kind: "generate",
    request: outcome.request,
    messages: buildFinderGenerationMessages({
      mode: "fresh",
      request: outcome.request,
    }),
  };
}
