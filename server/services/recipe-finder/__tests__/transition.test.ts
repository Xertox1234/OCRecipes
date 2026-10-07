import { describe, it, expect } from "vitest";
import type {
  FinderAction,
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

// ── Offer / adjust transitions (Coach recipe offer, Task 4) ────────────────
const ON = { offer: true };
const offerBlock = (over = {}) => ({
  type: "recipe_offer" as const,
  flow: flow({
    stage: "offer",
    dish: "Spaghetti and meatballs",
    details: { servings: 8, ingredients: [], fromConversation: false },
  }),
  ...over,
});
const adjustBlock = () => ({
  type: "recipe_adjust" as const,
  prefill: { servings: 8, spice: "mild" as const, time: "moderate" as const },
  avoiding: [],
  noted: { dislikes: [] },
  followUps: [
    { question: "Beef, pork, or a mix?", options: ["Beef", "Mix", "Pork"] },
  ],
  flow: flow({ stage: "adjust", dish: "Spaghetti and meatballs" }),
});
const actOn = (type: string, extra = {}) => ({
  kind: "action" as const,
  action: { type, flowId: F0, ...extra } as FinderAction,
});
const INVALID = { kind: "ignore", reason: "invalid_for_stage" };

describe("planFinderStep — offer on (H1: every direct-generate path → build_adjust)", () => {
  it("generate action on a results list → build_adjust", () => {
    expect(planFinderStep(results(), actOn("generate"), ON).kind).toBe(
      "build_adjust",
    );
  });
  it("generate action on an adjust/offer block → invalid_for_stage", () => {
    for (const b of [adjustBlock(), offerBlock()]) {
      expect(planFinderStep(b as FinderBlock, actOn("generate"), ON)).toEqual(
        INVALID,
      );
    }
  });
  it("second None of these → build_adjust", () => {
    expect(
      planFinderStep(
        results({ flow: flow({ round: 1 }) }),
        actOn("none_of_these"),
        ON,
      ).kind,
    ).toBe("build_adjust");
  });
  it("typed generate → build_adjust on results, questions and offer; generate_with_settings on adjust", () => {
    const typed = {
      kind: "typed" as const,
      text: "generate",
      command: "generate" as const,
    };
    expect(planFinderStep(results(), typed, ON).kind).toBe("build_adjust");
    expect(planFinderStep(questions(), typed, ON).kind).toBe("build_adjust");
    expect(planFinderStep(offerBlock() as FinderBlock, typed, ON).kind).toBe(
      "build_adjust",
    );
    expect(
      planFinderStep(adjustBlock() as FinderBlock, typed, ON),
    ).toMatchObject({
      kind: "generate_with_settings",
      settings: { servings: 8, spice: "mild", time: "moderate" },
      answers: [],
    });
  });
  it("generate ACTION on questions → build_adjust (old clients / fallback)", () => {
    expect(planFinderStep(questions(), actOn("generate"), ON).kind).toBe(
      "build_adjust",
    );
  });
  it("typed yes/search/no on an offer", () => {
    const t = (command: "yes" | "no" | "search") => ({
      kind: "typed" as const,
      text: command,
      command,
    });
    expect(planFinderStep(offerBlock() as FinderBlock, t("yes"), ON).kind).toBe(
      "build_adjust",
    );
    expect(
      planFinderStep(offerBlock() as FinderBlock, t("search"), ON),
    ).toMatchObject({
      kind: "search_community",
      dish: "Spaghetti and meatballs",
    });
    expect(planFinderStep(offerBlock() as FinderBlock, t("no"), ON)).toEqual({
      kind: "close",
    });
  });
  it("typed other on offer/adjust → offer_from_text; on results → refinement search", () => {
    const typed = {
      kind: "typed" as const,
      text: "make it spicier",
      command: null,
    };
    const expected = { kind: "offer_from_text", text: "make it spicier" };
    expect(planFinderStep(offerBlock() as FinderBlock, typed, ON)).toEqual(
      expected,
    );
    expect(planFinderStep(adjustBlock() as FinderBlock, typed, ON)).toEqual(
      expected,
    );
    expect(planFinderStep(results(), typed, ON).kind).toBe("search_community");
  });
  it("offer_search carries dish + details into the results flow", () => {
    const step = planFinderStep(
      offerBlock() as FinderBlock,
      actOn("offer_search"),
      ON,
    );
    const out = finderOutcome(
      step,
      {
        kind: "community",
        query: { q: "spaghetti meatballs" },
        items: [item(3)],
      },
      ctx,
      ON,
    );
    expect(out.kind === "message" && out.block.flow).toMatchObject({
      dish: "Spaghetti and meatballs",
      details: { servings: 8 },
    });
  });
  it("round-1 zero results → build_adjust outcome, not generate", () => {
    const step = {
      kind: "search_community",
      request: "x",
      round: 1,
      excludeIds: [],
      priorShownIds: [],
    } as FinderStep;
    const out = finderOutcome(
      step,
      { kind: "community", query: { q: "x" }, items: [] },
      ctx,
      ON,
    );
    expect(out.kind).toBe("build_adjust");
  });
});

describe("offer/adjust actions", () => {
  it("offer_yes → build_adjust; offer_search → round-0 community search; offer_no → close", () => {
    expect(
      planFinderStep(offerBlock() as FinderBlock, actOn("offer_yes"), ON).kind,
    ).toBe("build_adjust");
    expect(
      planFinderStep(offerBlock() as FinderBlock, actOn("offer_search"), ON),
    ).toMatchObject({
      kind: "search_community",
      round: 0,
      dish: "Spaghetti and meatballs",
    });
    expect(
      planFinderStep(offerBlock() as FinderBlock, actOn("offer_no"), ON),
    ).toEqual({ kind: "close" });
  });
  it("adjust_generate carries settings + answers; adjust_cancel closes", () => {
    const settings = {
      servings: 6,
      spice: "hot" as const,
      time: "quick" as const,
    };
    const answers = [{ question: "Beef, pork, or a mix?", answer: "Mix" }];
    expect(
      planFinderStep(
        adjustBlock() as FinderBlock,
        actOn("adjust_generate", { settings, answers }),
        ON,
      ),
    ).toMatchObject({ kind: "generate_with_settings", settings, answers });
    expect(
      planFinderStep(adjustBlock() as FinderBlock, actOn("adjust_cancel"), ON),
    ).toEqual({ kind: "close" });
  });
  it("offer actions on the wrong stage are invalid", () => {
    expect(planFinderStep(results(), actOn("offer_yes"), ON)).toEqual(INVALID);
    expect(
      planFinderStep(
        offerBlock() as FinderBlock,
        actOn("adjust_generate", {
          settings: { servings: 2, spice: "mild", time: "quick" },
        }),
        ON,
      ),
    ).toEqual(INVALID);
  });
  it("stale offer (other flowId) → stale_flow", () => {
    const b = offerBlock({ flow: flow({ flowId: F_OTHER, stage: "offer" }) });
    expect(planFinderStep(b as FinderBlock, actOn("offer_yes"), ON)).toEqual({
      kind: "ignore",
      reason: "stale_flow",
    });
  });
  it("no live block (closing message is latest) → no_active_flow", () => {
    expect(planFinderStep(null, actOn("offer_yes"), ON)).toEqual({
      kind: "ignore",
      reason: "no_active_flow",
    });
  });
  it("start → offer_from_text; offer input → offer", () => {
    expect(
      planFinderStep(null, { kind: "start", text: "spaghetti for 8" }, ON),
    ).toEqual({ kind: "offer_from_text", text: "spaghetti for 8" });
    const details = { ingredients: [], fromConversation: true };
    expect(
      planFinderStep(
        null,
        { kind: "offer", dish: "Lemon chicken", details },
        ON,
      ),
    ).toEqual({ kind: "offer", dish: "Lemon chicken", details });
  });
  it("status labels for the new steps", () => {
    expect(finderStatusLabel({ kind: "build_adjust", flow: flow() })).toBe(
      "Setting up your recipe…",
    );
    expect(
      finderStatusLabel({
        kind: "generate_with_settings",
        flow: flow(),
        settings: { servings: 2, spice: "mild", time: "quick" },
        answers: [],
      }),
    ).toBe("Creating your recipe…");
    expect(finderStatusLabel({ kind: "close" })).toBeNull();
    expect(
      finderStatusLabel({ kind: "offer_from_text", text: "x" }),
    ).toBeNull();
  });
});

describe("flag off is unchanged", () => {
  it("generate action still generates directly", () => {
    expect(planFinderStep(results(), actOn("generate")).kind).toBe("generate");
  });
  it("new action types with the flag off → invalid_for_stage, never undefined", () => {
    for (const type of [
      "offer_yes",
      "offer_search",
      "offer_no",
      "adjust_cancel",
    ]) {
      expect(planFinderStep(offerBlock() as FinderBlock, actOn(type))).toEqual(
        INVALID,
      );
    }
    expect(
      planFinderStep(
        adjustBlock() as FinderBlock,
        actOn("adjust_generate", {
          settings: { servings: 2, spice: "mild", time: "quick" },
        }),
      ),
    ).toEqual(INVALID);
  });
  it("new typed commands with the flag off → invalid_for_stage", () => {
    for (const command of ["yes", "no", "search"] as const) {
      expect(
        planFinderStep(results(), { kind: "typed", text: command, command }),
      ).toEqual(INVALID);
    }
  });
});
