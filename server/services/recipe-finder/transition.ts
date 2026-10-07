// server/services/recipe-finder/transition.ts
// The flow's pure state machine (spec §3.1, §4). The server derives every
// step from the latest STORED finder block, never from action text.
import type {
  ClarifyingQuestion,
  FinderAction,
  FinderAnswer,
  FinderBlock,
  FinderButton,
  FinderFlow,
  FinderItem,
  RecipeQuery,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import type { FindOnlineResult } from "./find-online";

export type FinderInput =
  | { kind: "start"; text: string }
  | { kind: "action"; action: FinderAction }
  | {
      kind: "typed";
      text: string;
      command: "generate" | "none_of_these" | null;
    };

export interface FinderCtx {
  /** SPOONACULAR_API_KEY set — else Search Spoonacular is hidden (§6). */
  onlineConfigured: boolean;
  /** Premium `catalogSave` (§6 premium). */
  canSearchOnline: boolean;
  /** Premium `recipeGeneration` (§6 premium). */
  canGenerate: boolean;
  /** flowId for any block this step produces (injected for purity). */
  nextFlowId: string;
}

export type FinderStep =
  | {
      kind: "ignore";
      reason: "stale_flow" | "no_active_flow" | "invalid_for_stage";
    }
  | {
      kind: "search_community";
      request: string;
      round: 0 | 1;
      excludeIds: string[];
      priorShownIds: string[];
    }
  | { kind: "search_online"; flow: FinderFlow }
  | { kind: "ask_clarifying"; flow: FinderFlow }
  | { kind: "generate"; request: string; flow: FinderFlow };

export type FinderStepResult =
  | { kind: "community"; query: RecipeQuery; items: FinderItem[] }
  | { kind: "online"; result: FindOnlineResult }
  | { kind: "questions"; questions: ClarifyingQuestion[] }
  | { kind: "none" };

export type FinderOutcome =
  | { kind: "ignore" }
  | { kind: "message"; block: FinderBlock }
  | { kind: "generate"; request: string; flow: FinderFlow };

const MAX_SHOWN_IDS = 40;

export function appendToRequest(request: string, addition: string): string {
  return `${request.trim()}. ${addition.trim()}`.slice(0, 2000);
}

export function appendAnswers(
  request: string,
  answers: FinderAnswer[],
): string {
  return appendToRequest(
    request,
    answers.map((a) => `${a.question} ${a.answer}`).join("; "),
  );
}

function noneOfThese(flow: FinderFlow): FinderStep {
  // At most one clarifying round: a second "None of these" generates.
  return flow.round === 0
    ? { kind: "ask_clarifying", flow }
    : { kind: "generate", request: flow.request, flow };
}

function answered(flow: FinderFlow, request: string): FinderStep {
  return {
    kind: "search_community",
    request,
    round: 1,
    excludeIds: flow.shownIds,
    priorShownIds: flow.shownIds,
  };
}

export function planFinderStep(
  latest: FinderBlock | null,
  input: FinderInput,
): FinderStep {
  if (input.kind === "start") {
    return {
      kind: "search_community",
      request: input.text.trim(),
      round: 0,
      excludeIds: [],
      priorShownIds: [],
    };
  }
  if (!latest) return { kind: "ignore", reason: "no_active_flow" };
  const { flow } = latest;

  if (input.kind === "action") {
    const { action } = input;
    if (action.flowId !== flow.flowId) {
      return { kind: "ignore", reason: "stale_flow" };
    }
    switch (action.type) {
      case "generate":
        return { kind: "generate", request: flow.request, flow };
      case "search_online":
        return latest.type === "recipe_results" &&
          latest.actions.includes("search_online")
          ? { kind: "search_online", flow }
          : { kind: "ignore", reason: "invalid_for_stage" };
      case "none_of_these":
        return latest.type === "recipe_results"
          ? noneOfThese(flow)
          : { kind: "ignore", reason: "invalid_for_stage" };
      case "answers":
        return latest.type === "recipe_questions" && action.answers
          ? answered(flow, appendAnswers(flow.request, action.answers))
          : { kind: "ignore", reason: "invalid_for_stage" };
      default:
        // offer/adjust actions are handled in a later task
        return { kind: "ignore", reason: "invalid_for_stage" };
    }
  }

  // Typed text during an active flow (§4 "Typed input").
  if (input.command === "generate") {
    return { kind: "generate", request: flow.request, flow };
  }
  if (latest.type === "recipe_questions") {
    return answered(flow, appendToRequest(flow.request, input.text));
  }
  if (input.command === "none_of_these") return noneOfThese(flow);
  return {
    kind: "search_community",
    request: appendToRequest(flow.request, input.text),
    round: flow.round,
    excludeIds: [],
    priorShownIds: flow.shownIds,
  };
}

function mergeShown(prior: string[], items: FinderItem[]): string[] {
  const merged = [
    ...new Set([...prior, ...items.map((i) => `${i.source}:${i.id}`)]),
  ];
  return merged.slice(-MAX_SHOWN_IDS);
}

export function communityActions(ctx: FinderCtx): FinderButton[] {
  return ctx.onlineConfigured
    ? ["search_online", "generate", "none_of_these"]
    : ["generate", "none_of_these"];
}

/** Generate refused (limit or premium): keep the flow alive, minus Generate. */
export function blockedGenerateBlock(
  flow: FinderFlow,
  notice: "generate_limit" | "generate_premium",
  ctx: FinderCtx,
): RecipeResultsBlock {
  return {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ctx.onlineConfigured ? ["search_online"] : [],
    notice,
    flow: { ...flow, flowId: ctx.nextFlowId, stage: "results" },
  };
}

export function finderOutcome(
  step: FinderStep,
  result: FinderStepResult,
  ctx: FinderCtx,
): FinderOutcome {
  switch (step.kind) {
    case "ignore":
      return { kind: "ignore" };
    case "generate":
      return { kind: "generate", request: step.request, flow: step.flow };
    case "search_community": {
      if (result.kind !== "community") {
        throw new Error("search_community requires a community result");
      }
      const flow: FinderFlow = {
        flowId: ctx.nextFlowId,
        stage: "results",
        request: step.request,
        query: result.query,
        round: step.round,
        shownIds: mergeShown(step.priorShownIds, result.items),
      };
      if (result.items.length === 0 && step.round === 1) {
        return { kind: "generate", request: step.request, flow };
      }
      return {
        kind: "message",
        block: {
          type: "recipe_results",
          source: "community",
          items: result.items,
          actions: communityActions(ctx),
          notice: result.items.length === 0 ? "no_matches" : null,
          flow,
        },
      };
    }
    case "search_online": {
      if (result.kind !== "online") {
        throw new Error("search_online requires an online result");
      }
      const items = result.result.status === "ok" ? result.result.items : [];
      return {
        kind: "message",
        block: {
          type: "recipe_results",
          source: "spoonacular",
          items,
          actions: ["generate", "none_of_these"],
          notice:
            result.result.status === "unavailable"
              ? "unavailable"
              : items.length === 0
                ? "no_matches"
                : null,
          flow: {
            ...step.flow,
            flowId: ctx.nextFlowId,
            stage: "results",
            shownIds: mergeShown(step.flow.shownIds, items),
          },
        },
      };
    }
    case "ask_clarifying": {
      if (result.kind !== "questions") {
        throw new Error("ask_clarifying requires questions");
      }
      return {
        kind: "message",
        block: {
          type: "recipe_questions",
          questions: result.questions,
          flow: { ...step.flow, flowId: ctx.nextFlowId, stage: "clarifying" },
        },
      };
    }
  }
}

/** Thinking-bubble progress text (§5). */
export function finderStatusLabel(step: FinderStep): string | null {
  switch (step.kind) {
    case "search_community":
      return "Searching community recipes…";
    case "search_online":
      return "Searching Spoonacular…";
    case "ask_clarifying":
      return "Thinking of a few questions…";
    case "generate":
      return "Creating your recipe…";
    case "ignore":
      return null;
  }
}
