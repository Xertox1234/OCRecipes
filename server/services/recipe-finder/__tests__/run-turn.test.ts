import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatMessage } from "@shared/schema";
import type { FinderFlow } from "@shared/schemas/recipe-finder";
import {
  executeFinderStep,
  prepareFinderTurn,
  type FinderTurnContext,
} from "../run-turn";
import { buildFinderGenerationMessages } from "../generate";
import { storage } from "../../../storage";
import { extractQuery } from "../extract-query";
import { findCommunity } from "../find-community";
import { findOnline } from "../find-online";
import { askClarifying } from "../ask-clarifying";

vi.mock("../../../storage", () => ({
  storage: { claimRecipeGeneration: vi.fn(), claimSpoonacularSearch: vi.fn() },
}));
vi.mock("../extract-query", () => ({ extractQuery: vi.fn() }));
vi.mock("../find-community", () => ({ findCommunity: vi.fn() }));
vi.mock("../find-online", () => ({ findOnline: vi.fn() }));
vi.mock("../ask-clarifying", () => ({ askClarifying: vi.fn() }));

const NEXT = "11111111-1111-4111-8111-111111111111";
const flow: FinderFlow = {
  flowId: "00000000-0000-4000-8000-000000000000",
  stage: "results",
  request: "Mediterranean",
  query: { q: "mediterranean" },
  round: 0,
  shownIds: [],
};
const ctx = (over: Partial<FinderTurnContext> = {}): FinderTurnContext => ({
  userId: "u1",
  userMessageId: 50,
  history: [],
  profile: null,
  features: {
    catalogSave: true,
    recipeGeneration: true,
    dailyRecipeGenerations: 20,
  },
  nextFlowId: () => NEXT,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SPOONACULAR_API_KEY", "k");
  vi.stubEnv("RECIPE_FINDER_SPOONACULAR_DAILY_CAP", "10");
});
afterEach(() => vi.unstubAllEnvs());

describe("executeFinderStep", () => {
  it("community: extract → search → list with the plain-text fallback", async () => {
    vi.mocked(extractQuery).mockResolvedValue({ q: "mediterranean" });
    vi.mocked(findCommunity).mockResolvedValue([
      {
        id: 12,
        source: "community",
        title: "Quinoa Salad",
        imageUrl: null,
        readyInMinutes: null,
        calories: 350,
      },
    ]);
    const out = await executeFinderStep(
      {
        kind: "search_community",
        request: "Mediterranean",
        round: 0,
        excludeIds: [],
        priorShownIds: [],
      },
      ctx(),
    );
    expect(out.kind).toBe("message");
    if (out.kind !== "message") return;
    expect(out.block.type).toBe("recipe_results");
    expect(out.block.flow.flowId).toBe(NEXT);
    expect(out.content).toMatch(/^Here are 1 community recipe:/);
    expect(findCommunity).toHaveBeenCalledWith(
      { q: "mediterranean" },
      "u1",
      [],
    );
  });

  it("online: claims a cap slot before calling Spoonacular", async () => {
    vi.mocked(storage.claimSpoonacularSearch).mockResolvedValue(true);
    vi.mocked(findOnline).mockResolvedValue({ status: "ok", items: [] });
    await executeFinderStep({ kind: "search_online", flow }, ctx());
    expect(storage.claimSpoonacularSearch).toHaveBeenCalledWith("u1", 50, 10);
    expect(findOnline).toHaveBeenCalledWith({ q: "mediterranean" }, undefined);
  });

  it("online at the per-user cap → 'unavailable', Spoonacular never called", async () => {
    vi.mocked(storage.claimSpoonacularSearch).mockResolvedValue(false);
    const out = await executeFinderStep({ kind: "search_online", flow }, ctx());
    expect(findOnline).not.toHaveBeenCalled();
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("unavailable");
  });

  it("online without catalogSave (premium deny) → 'unavailable' with no claim", async () => {
    const out = await executeFinderStep(
      { kind: "search_online", flow },
      ctx({
        features: {
          catalogSave: false,
          recipeGeneration: true,
          dailyRecipeGenerations: 20,
        },
      }),
    );
    expect(storage.claimSpoonacularSearch).not.toHaveBeenCalled();
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("unavailable");
  });

  it("clarifying: returns a questions block", async () => {
    vi.mocked(askClarifying).mockResolvedValue([
      { question: "Time?", options: ["a", "b"] },
    ]);
    const out = await executeFinderStep(
      { kind: "ask_clarifying", flow },
      ctx(),
    );
    expect(out.kind === "message" && out.block.type).toBe("recipe_questions");
  });

  it("generate allowed → fresh generation messages; the claim is on this turn's user row", async () => {
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    const out = await executeFinderStep(
      { kind: "generate", request: "Mediterranean", flow },
      ctx(),
    );
    expect(storage.claimRecipeGeneration).toHaveBeenCalledWith("u1", 50, 20);
    expect(out).toEqual({
      kind: "generate",
      request: "Mediterranean",
      messages: [
        { role: "user", content: "Create a recipe for: Mediterranean" },
      ],
    });
  });

  it("generate at the daily limit → blocked block (generate_limit), no generation", async () => {
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(false);
    const out = await executeFinderStep(
      { kind: "generate", request: "Mediterranean", flow },
      ctx(),
    );
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("generate_limit");
    expect(out.block.actions).toEqual(["search_online"]);
  });

  it("generate without recipeGeneration (premium deny) → generate_premium, no claim", async () => {
    const out = await executeFinderStep(
      { kind: "generate", request: "x", flow },
      ctx({
        features: {
          catalogSave: true,
          recipeGeneration: false,
          dailyRecipeGenerations: 0,
        },
      }),
    );
    expect(storage.claimRecipeGeneration).not.toHaveBeenCalled();
    if (out.kind !== "message" || out.block.type !== "recipe_results") {
      throw new Error("expected results");
    }
    expect(out.block.notice).toBe("generate_premium");
  });

  it("round 1 with no community matches generates (and claims)", async () => {
    vi.mocked(extractQuery).mockResolvedValue({ q: "x" });
    vi.mocked(findCommunity).mockResolvedValue([]);
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    const out = await executeFinderStep(
      {
        kind: "search_community",
        request: "x. Time? 20 min",
        round: 1,
        excludeIds: [],
        priorShownIds: [],
      },
      ctx(),
    );
    expect(out.kind).toBe("generate");
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
  });

  it("ignore → ignored, with no AI or DB work", async () => {
    await expect(
      executeFinderStep({ kind: "ignore", reason: "stale_flow" }, ctx()),
    ).resolves.toEqual({ kind: "ignored" });
    expect(extractQuery).not.toHaveBeenCalled();
  });
});

describe("prepareFinderTurn", () => {
  it("plans from the latest stored block", () => {
    const history = [
      {
        id: 1,
        conversationId: 1,
        role: "assistant",
        content: "c",
        metadata: {
          metadataVersion: 1,
          finder: {
            type: "recipe_results",
            source: "community",
            items: [],
            actions: ["generate"],
            notice: "no_matches",
            flow,
          },
        },
        turnKey: null,
        createdAt: new Date(),
      },
    ] as ChatMessage[];
    expect(
      prepareFinderTurn(history, {
        kind: "action",
        action: { type: "generate", flowId: flow.flowId },
      }).step,
    ).toEqual({ kind: "generate", request: "Mediterranean", flow });
  });
});

describe("buildFinderGenerationMessages", () => {
  it("refine mode reuses RecipeChef's context builder (latest recipe JSON included)", () => {
    const recipe = {
      title: "Curry",
      description: "d",
      difficulty: "Easy",
      timeEstimate: "30 min",
      servings: 2,
      ingredients: [],
      instructions: ["x"],
      dietTags: [],
    };
    const history = [
      {
        id: 1,
        conversationId: 1,
        role: "assistant",
        content: "Here!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
        turnKey: null,
        createdAt: new Date(),
      },
      {
        id: 2,
        conversationId: 1,
        role: "user",
        content: "make it spicier",
        metadata: null,
        turnKey: null,
        createdAt: new Date(),
      },
    ] as ChatMessage[];
    const msgs = buildFinderGenerationMessages({ mode: "refine", history });
    expect(msgs[0].content).toContain('[Recipe: {"title":"Curry"');
    expect(msgs[1]).toEqual({ role: "user", content: "make it spicier" });
  });
});
