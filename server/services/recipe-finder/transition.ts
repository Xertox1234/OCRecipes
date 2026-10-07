// server/services/recipe-finder/transition.ts
// The flow's pure state machine (spec §3.1, §4). The server derives every
// step from the latest STORED finder block, never from action text.
import type {
  AdjustSettings,
  ClarifyingQuestion,
  FinderAction,
  FinderAnswer,
  FinderBlock,
  FinderButton,
  FinderFlow,
  FinderItem,
  RecipeDetails,
  RecipeQuery,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import type { FindOnlineResult } from "./find-online";

export interface PlanOptions {
  /** RECIPE_OFFER_ENABLED: offer/adjust stages replace direct generation. */
  offer: boolean;
}

export type TypedFinderCommand =
  | "generate"
  | "none_of_these"
  | "yes"
  | "no"
  | "search";

export type FinderInput =
  | { kind: "start"; text: string }
  /** Coach tool path: the model already extracted the dish + details. */
  | { kind: "offer"; dish: string; details: RecipeDetails }
  | { kind: "action"; action: FinderAction }
  | {
      kind: "typed";
      text: string;
      command: TypedFinderCommand | null;
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
      /** Offer context, carried into the results flow (offer_search). */
      dish?: string;
      details?: RecipeDetails;
    }
  | { kind: "search_online"; flow: FinderFlow }
  | { kind: "ask_clarifying"; flow: FinderFlow }
  | { kind: "generate"; request: string; flow: FinderFlow }
  | { kind: "offer_from_text"; text: string }
  | { kind: "offer"; dish: string; details: RecipeDetails }
  | { kind: "build_adjust"; flow: FinderFlow }
  | { kind: "close" }
  | {
      kind: "generate_with_settings";
      flow: FinderFlow;
      settings: AdjustSettings;
      answers: FinderAnswer[];
    };

export type FinderStepResult =
  | { kind: "community"; query: RecipeQuery; items: FinderItem[] }
  | { kind: "online"; result: FindOnlineResult }
  | { kind: "questions"; questions: ClarifyingQuestion[] }
  | { kind: "none" };

export type FinderOutcome =
  | { kind: "ignore" }
  | { kind: "message"; block: FinderBlock }
  | { kind: "build_adjust"; flow: FinderFlow }
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

const INVALID: FinderStep = { kind: "ignore", reason: "invalid_for_stage" };

function noneOfTheseOffer(flow: FinderFlow): FinderStep {
  return flow.round === 0
    ? { kind: "ask_clarifying", flow }
    : { kind: "build_adjust", flow };
}

function offerSearch(flow: FinderFlow): FinderStep {
  return {
    kind: "search_community",
    request: flow.request,
    round: 0,
    excludeIds: [],
    priorShownIds: [],
    ...(flow.dish !== undefined ? { dish: flow.dish } : {}),
    ...(flow.details !== undefined ? { details: flow.details } : {}),
  };
}

/**
 * Offer-on transitions (the single table). Returns null when the old logic
 * should handle it (typed other on results / questions).
 */
function planOfferOn(
  latest: FinderBlock | null,
  input: FinderInput,
): FinderStep | null {
  if (input.kind === "start") {
    return { kind: "offer_from_text", text: input.text };
  }
  if (input.kind === "offer") {
    return { kind: "offer", dish: input.dish, details: input.details };
  }
  if (!latest) return { kind: "ignore", reason: "no_active_flow" };
  const { flow } = latest;

  if (input.kind === "action") {
    const { action } = input;
    if (action.flowId !== flow.flowId) {
      return { kind: "ignore", reason: "stale_flow" };
    }
    switch (latest.type) {
      case "recipe_offer":
        switch (action.type) {
          case "offer_yes":
            return { kind: "build_adjust", flow };
          case "offer_search":
            return offerSearch(flow);
          case "offer_no":
            return { kind: "close" };
          default:
            return INVALID;
        }
      case "recipe_adjust":
        switch (action.type) {
          case "adjust_generate":
            return action.settings
              ? {
                  kind: "generate_with_settings",
                  flow,
                  settings: action.settings,
                  answers: action.answers ?? [],
                }
              : INVALID;
          case "adjust_cancel":
            return { kind: "close" };
          default:
            return INVALID;
        }
      case "recipe_results":
        switch (action.type) {
          case "generate":
            return { kind: "build_adjust", flow };
          case "search_online":
            return latest.actions.includes("search_online")
              ? { kind: "search_online", flow }
              : INVALID;
          case "none_of_these":
            return noneOfTheseOffer(flow);
          default:
            return INVALID;
        }
      case "recipe_questions":
        switch (action.type) {
          case "answers":
            return action.answers
              ? answered(flow, appendAnswers(flow.request, action.answers))
              : INVALID;
          case "generate":
            return { kind: "build_adjust", flow };
          default:
            return INVALID;
        }
    }
  }

  // Typed text during an active flow.
  switch (latest.type) {
    case "recipe_offer":
      switch (input.command) {
        case "yes":
        case "generate":
          return { kind: "build_adjust", flow };
        case "search":
          return offerSearch(flow);
        case "no":
          return { kind: "close" };
        default:
          return { kind: "offer_from_text", text: input.text };
      }
    case "recipe_adjust":
      switch (input.command) {
        case "generate":
        case "yes":
          return {
            kind: "generate_with_settings",
            flow,
            settings: latest.prefill,
            answers: [],
          };
        case "no":
          return { kind: "close" };
        default:
          return { kind: "offer_from_text", text: input.text };
      }
    case "recipe_results":
      if (input.command === "generate") return { kind: "build_adjust", flow };
      if (input.command === "none_of_these") return noneOfTheseOffer(flow);
      return null; // typed other → today's refinement search
    case "recipe_questions":
      if (input.command === "generate") return { kind: "build_adjust", flow };
      return null; // typed other → answers, as today
  }
}

export function planFinderStep(
  latest: FinderBlock | null,
  input: FinderInput,
  opts: PlanOptions = { offer: false },
): FinderStep {
  if (opts.offer) {
    const planned = planOfferOn(latest, input);
    if (planned) return planned;
  }
  if (input.kind === "offer") return INVALID; // no offer stage with the flag off
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
        // offer/adjust actions with the flag off (e.g. offer blocks left in
        // history after a flip-off): never undefined, never a throw.
        return { kind: "ignore", reason: "invalid_for_stage" };
    }
  }

  // Flag off: the offer-flow typed commands have no meaning.
  if (
    input.command === "yes" ||
    input.command === "no" ||
    input.command === "search"
  ) {
    return INVALID;
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
  opts: PlanOptions = { offer: false },
): FinderOutcome {
  switch (step.kind) {
    case "ignore":
    case "close":
      return { kind: "ignore" };
    case "build_adjust":
      return { kind: "build_adjust", flow: step.flow };
    case "offer_from_text":
    case "offer":
    case "generate_with_settings":
      throw new Error(
        `${step.kind} is handled by the caller, not finderOutcome`,
      );
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
        ...(step.dish !== undefined ? { dish: step.dish } : {}),
        ...(step.details !== undefined ? { details: step.details } : {}),
      };
      if (result.items.length === 0 && step.round === 1) {
        if (opts.offer) return { kind: "build_adjust", flow };
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
    case "build_adjust":
      return "Setting up your recipe…";
    case "generate_with_settings":
      return "Creating your recipe…";
    case "ignore":
    case "offer_from_text":
    case "offer":
    case "close":
      return null;
  }
}
