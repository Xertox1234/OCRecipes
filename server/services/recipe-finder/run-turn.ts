// server/services/recipe-finder/run-turn.ts
import { randomUUID } from "node:crypto";
import type { ChatMessage, UserProfile } from "@shared/schema";
import type { FinderBlock } from "@shared/schemas/recipe-finder";
import type { PremiumFeatures } from "@shared/types/premium";
import { storage } from "../../storage";
import { extractQuery } from "./extract-query";
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
}

export type FinderTurnResult =
  | { kind: "ignored" }
  | { kind: "message"; content: string; block: FinderBlock }
  | { kind: "generate"; request: string; messages: GenerationMessages };

export function prepareFinderTurn(
  history: ChatMessage[],
  input: FinderInput,
): { latest: FinderBlock | null; step: FinderStep } {
  const latest = getLatestFinderBlock(history);
  return { latest, step: planFinderStep(latest, input) };
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

  const outcome = finderOutcome(step, result, finderCtx);
  // build_adjust is only produced with the offer flag on (wired in a later task).
  if (outcome.kind === "ignore" || outcome.kind === "build_adjust") {
    return { kind: "ignored" };
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
