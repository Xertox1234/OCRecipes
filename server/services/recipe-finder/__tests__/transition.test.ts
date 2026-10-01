import { describe, it, expect } from "vitest";
import type {
  FinderBlock,
  FinderFlow,
  FinderItem,
  RecipeResultsBlock,
  RecipeQuestionsBlock,
} from "@shared/schemas/recipe-finder";
import {
  planFinderStep,
  finderOutcome,
  blockedGenerateBlock,
  communityActions,
  appendAnswers,
  finderStatusLabel,
  type FinderCtx,
  type FinderInput,
  type FinderStep,
  type FinderStepResult,
} from "../transition";

const F0 = "00000000-0000-4000-8000-000000000000";
const F_OTHER = "99999999-9999-4999-8999-999999999999";
const NEXT = "11111111-1111-4111-8111-111111111111";

const flow = (over: Partial<FinderFlow> = {}): FinderFlow => ({
  flowId: F0,
  stage: "results",
  request: "Mediterranean",
  query: { q: "mediterranean" },
  round: 0,
  shownIds: ["community:1"],
  ...over,
});
const item = (
  id: number,
  source: FinderItem["source"] = "community",
): FinderItem => ({
  id,
  source,
  title: `R${id}`,
  imageUrl: null,
  readyInMinutes: null,
  calories: 300,
});
const results = (
  over: Partial<RecipeResultsBlock> = {},
): RecipeResultsBlock => ({
  type: "recipe_results",
  source: "community",
  items: [item(1)],
  actions: ["search_online", "generate", "none_of_these"],
  notice: null,
  flow: flow(),
  ...over,
});
const questions = (
  over: Partial<RecipeQuestionsBlock> = {},
): RecipeQuestionsBlock => ({
  type: "recipe_questions",
  questions: [{ question: "Time?", options: ["20 min", "1 hour"] }],
  flow: flow({ stage: "clarifying" }),
  ...over,
});
const ctx: FinderCtx = {
  onlineConfigured: true,
  canSearchOnline: true,
  canGenerate: true,
  nextFlowId: NEXT,
};
const act = (
  type: "search_online" | "generate" | "none_of_these" | "answers",
  flowId = F0,
): FinderInput => ({
  kind: "action",
  action:
    type === "answers"
      ? { type, flowId, answers: [{ question: "Time?", answer: "20 min" }] }
      : { type, flowId },
});
const typed = (
  text: string,
  command: "generate" | "none_of_these" | null = null,
): FinderInput => ({ kind: "typed", text, command });

describe("planFinderStep — stage × input", () => {
  const rows: {
    name: string;
    latest: FinderBlock | null;
    input: FinderInput;
    expected: FinderStep;
  }[] = [
    {
      name: "start → community search, round 0",
      latest: null,
      input: { kind: "start", text: " Mediterranean " },
      expected: {
        kind: "search_community",
        request: "Mediterranean",
        round: 0,
        excludeIds: [],
        priorShownIds: [],
      },
    },
    {
      name: "action with no active flow → ignore",
      latest: null,
      input: act("generate"),
      expected: { kind: "ignore", reason: "no_active_flow" },
    },
    {
      name: "stale flowId → ignore",
      latest: results(),
      input: act("generate", F_OTHER),
      expected: { kind: "ignore", reason: "stale_flow" },
    },
    {
      name: "results + Search Spoonacular → online",
      latest: results(),
      input: act("search_online"),
      expected: { kind: "search_online", flow: flow() },
    },
    {
      name: "Search Spoonacular on a Spoonacular list (button absent) → ignore",
      latest: results({
        source: "spoonacular",
        actions: ["generate", "none_of_these"],
      }),
      input: act("search_online"),
      expected: { kind: "ignore", reason: "invalid_for_stage" },
    },
    {
      name: "results + Generate → generate",
      latest: results(),
      input: act("generate"),
      expected: { kind: "generate", request: "Mediterranean", flow: flow() },
    },
    {
      name: "round 0 + None of these → clarifying",
      latest: results(),
      input: act("none_of_these"),
      expected: { kind: "ask_clarifying", flow: flow() },
    },
    {
      name: "round 1 + None of these → generate (round cap)",
      latest: results({ flow: flow({ round: 1 }) }),
      input: act("none_of_these"),
      expected: {
        kind: "generate",
        request: "Mediterranean",
        flow: flow({ round: 1 }),
      },
    },
    {
      name: "answers on a results block → ignore",
      latest: results(),
      input: act("answers"),
      expected: { kind: "ignore", reason: "invalid_for_stage" },
    },
    {
      name: "clarifying + answers → community search round 1 excluding shown",
      latest: questions(),
      input: act("answers"),
      expected: {
        kind: "search_community",
        request: "Mediterranean. Time? 20 min",
        round: 1,
        excludeIds: ["community:1"],
        priorShownIds: ["community:1"],
      },
    },
    {
      name: "None of these on a questions block → ignore",
      latest: questions(),
      input: act("none_of_these"),
      expected: { kind: "ignore", reason: "invalid_for_stage" },
    },
    {
      name: "typed text in results stage refines (same round, no exclusion)",
      latest: results(),
      input: typed("with chickpeas"),
      expected: {
        kind: "search_community",
        request: "Mediterranean. with chickpeas",
        round: 0,
        excludeIds: [],
        priorShownIds: ["community:1"],
      },
    },
    {
      name: "typed 'generate' command → generate (old-client guard)",
      latest: results(),
      input: typed("generate", "generate"),
      expected: { kind: "generate", request: "Mediterranean", flow: flow() },
    },
    {
      name: "typed 'none of these' command → clarifying (old-client guard)",
      latest: results(),
      input: typed("none of these", "none_of_these"),
      expected: { kind: "ask_clarifying", flow: flow() },
    },
    {
      name: "typed text in clarifying stage counts as answers",
      latest: questions(),
      input: typed("under 20 min, vegan"),
      expected: {
        kind: "search_community",
        request: "Mediterranean. under 20 min, vegan",
        round: 1,
        excludeIds: ["community:1"],
        priorShownIds: ["community:1"],
      },
    },
    {
      name: "typed 'generate' in clarifying stage → generate",
      latest: questions(),
      input: typed("generate", "generate"),
      expected: {
        kind: "generate",
        request: "Mediterranean",
        flow: flow({ stage: "clarifying" }),
      },
    },
  ];
  it.each(rows)("$name", ({ latest, input, expected }) => {
    expect(planFinderStep(latest, input)).toEqual(expected);
  });
});

describe("finderOutcome — step × result", () => {
  const community = (items: FinderItem[]): FinderStepResult => ({
    kind: "community",
    query: { q: "mediterranean" },
    items,
  });
  const search = (round: 0 | 1): FinderStep => ({
    kind: "search_community",
    request: "Mediterranean",
    round,
    excludeIds: [],
    priorShownIds: ["community:1"],
  });

  it("community matches → results list with the three buttons and merged shownIds", () => {
    expect(
      finderOutcome(search(0), community([item(2), item(3)]), ctx),
    ).toEqual({
      kind: "message",
      block: {
        type: "recipe_results",
        source: "community",
        items: [item(2), item(3)],
        actions: ["search_online", "generate", "none_of_these"],
        notice: null,
        flow: {
          flowId: NEXT,
          stage: "results",
          request: "Mediterranean",
          query: { q: "mediterranean" },
          round: 0,
          shownIds: ["community:1", "community:2", "community:3"],
        },
      },
    });
  });

  it("round 0 with no matches → 'no community recipes' + same three buttons", () => {
    const out = finderOutcome(search(0), community([]), ctx);
    expect(out.kind).toBe("message");
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("no_matches");
    expect(out.block.actions).toEqual([
      "search_online",
      "generate",
      "none_of_these",
    ]);
  });

  it("round 1 with no matches → generate (clarified and still nothing)", () => {
    const out = finderOutcome(search(1), community([]), ctx);
    expect(out).toEqual({
      kind: "generate",
      request: "Mediterranean",
      flow: {
        flowId: NEXT,
        stage: "results",
        request: "Mediterranean",
        query: { q: "mediterranean" },
        round: 1,
        shownIds: ["community:1"],
      },
    });
  });

  it("Search Spoonacular hidden when the catalog is not configured (§6)", () => {
    expect(communityActions({ ...ctx, onlineConfigured: false })).toEqual([
      "generate",
      "none_of_these",
    ]);
  });

  const online: FinderStep = { kind: "search_online", flow: flow() };
  it("Spoonacular results → list with Generate + None of these", () => {
    const out = finderOutcome(
      online,
      {
        kind: "online",
        result: { status: "ok", items: [item(715538, "spoonacular")] },
      },
      ctx,
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.source).toBe("spoonacular");
    expect(out.block.actions).toEqual(["generate", "none_of_these"]);
    expect(out.block.notice).toBeNull();
    expect(out.block.flow.shownIds).toEqual([
      "community:1",
      "spoonacular:715538",
    ]);
  });

  it("Spoonacular unavailable (402/error/cap) → 'unavailable', never 'no matches'", () => {
    const out = finderOutcome(
      online,
      { kind: "online", result: { status: "unavailable" } },
      ctx,
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("unavailable");
    expect(out.block.actions).toEqual(["generate", "none_of_these"]);
  });

  it("Spoonacular genuinely empty → 'no matches'", () => {
    const out = finderOutcome(
      online,
      { kind: "online", result: { status: "ok", items: [] } },
      ctx,
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("no_matches");
  });

  it("clarifying → questions block, new flowId, round unchanged", () => {
    const qs = [{ question: "Time?", options: ["a", "b"] }];
    expect(
      finderOutcome(
        { kind: "ask_clarifying", flow: flow() },
        { kind: "questions", questions: qs },
        ctx,
      ),
    ).toEqual({
      kind: "message",
      block: {
        type: "recipe_questions",
        questions: qs,
        flow: flow({ flowId: NEXT, stage: "clarifying" }),
      },
    });
  });

  it("ignore passes through", () => {
    expect(
      finderOutcome(
        { kind: "ignore", reason: "stale_flow" },
        { kind: "none" },
        ctx,
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("a blocked Generate keeps the flow alive with a notice and no Generate button", () => {
    const block = blockedGenerateBlock(
      flow({ round: 1 }),
      "generate_limit",
      ctx,
    );
    expect(block).toEqual({
      type: "recipe_results",
      source: "community",
      items: [],
      actions: ["search_online"],
      notice: "generate_limit",
      flow: flow({ round: 1, flowId: NEXT, stage: "results" }),
    });
  });
});

describe("helpers", () => {
  it("appendAnswers folds answers into the request", () => {
    expect(
      appendAnswers("Mediterranean", [
        { question: "Time?", answer: "20 min" },
        { question: "Diet?", answer: "Vegan" },
      ]),
    ).toBe("Mediterranean. Time? 20 min; Diet? Vegan");
  });

  it.each([
    [
      {
        kind: "search_community",
        request: "x",
        round: 0,
        excludeIds: [],
        priorShownIds: [],
      },
      "Searching community recipes…",
    ],
    [{ kind: "search_online", flow: flow() }, "Searching Spoonacular…"],
    [{ kind: "ask_clarifying", flow: flow() }, "Thinking of a few questions…"],
    [{ kind: "generate", request: "x", flow: flow() }, "Creating your recipe…"],
    [{ kind: "ignore", reason: "stale_flow" }, null],
  ] as [FinderStep, string | null][])("status label for %j", (step, label) => {
    expect(finderStatusLabel(step)).toBe(label);
  });
});
