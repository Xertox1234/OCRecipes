import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CoachChatEvent, CoachChatParams } from "../coach-pro-chat";
import type { ChatMessage } from "@shared/schema";
import {
  createMockUserProfile,
  createMockChatMessage,
} from "../../__tests__/factories";

// ── Imports (after mocks) ───────────────────────────────────

import { handleCoachChat } from "../coach-pro-chat";
import { storage } from "../../storage";
import {
  generateCoachProResponse,
  generateCoachResponse,
} from "../nutrition-coach";
import type { CoachProChunk } from "../nutrition-coach";
import { parseBlocksFromContent } from "../coach-blocks";
import { consumeWarmUp } from "../coach-warm-up";
import { findCommunity } from "../recipe-finder/find-community";
import { classifyTurn } from "../recipe-finder/classify-turn";
import { OFFER_TEXT } from "../recipe-finder/fallback-text";

// ── Mocks (model calls and storage only) ────────────────────

vi.mock("../../middleware/auth");

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getChatMessages: vi.fn(),
    getDailyLogsInRange: vi.fn(),
    getMostEatenFoods: vi.fn(),
    getActiveNotebookEntries: vi.fn(),
    getCommitmentsWithDueFollowUp: vi.fn(),
    getCoachCachedResponse: vi.fn(),
    setCoachCachedResponse: vi.fn(),
    createChatMessage: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    createNotebookEntries: vi.fn(),
    createNotebookEntry: vi.fn(),
    archiveOldEntries: vi.fn(),
    getChatMessageByTurnKey: vi.fn(),
    deleteChatMessage: vi.fn(),
    claimRecipeGeneration: vi.fn(),
    claimSpoonacularSearch: vi.fn(),
  },
}));

vi.mock("../nutrition-coach", () => ({
  generateCoachProResponse: vi.fn(),
  generateCoachResponse: vi.fn(),
  getSystemPromptTemplateVersion: vi.fn().mockReturnValue("test-version-hash"),
  SAFETY_OVERRIDE_SENTINEL: "\x00SAFETY_OVERRIDE\x00",
}));

vi.mock("../coach-blocks", () => ({
  parseBlocksFromContent: vi.fn(),
  BLOCKS_SYSTEM_PROMPT: "[BLOCKS_SYSTEM_PROMPT]",
  getBlocksSystemPrompt: vi.fn().mockReturnValue("[BLOCKS_SYSTEM_PROMPT]"),
}));

vi.mock("../recipe-chat", async () => {
  const actual =
    await vi.importActual<typeof import("../recipe-chat")>("../recipe-chat");
  return { ...actual, generateRecipeChatResponse: vi.fn() };
});
// Model-backed finder pieces; the planner, decideOfferToolCall and
// buildOfferBlock are real.
vi.mock("../recipe-finder/extract-query", () => ({
  extractQuery: vi.fn(async (t: string) => ({ q: t })),
  extractOfferDetails: vi.fn(),
}));
vi.mock("../recipe-finder/ask-follow-ups", () => ({
  askDishFollowUps: vi.fn(async () => []),
}));
vi.mock("../recipe-finder/find-community", () => ({ findCommunity: vi.fn() }));
vi.mock("../recipe-finder/find-online", () => ({ findOnline: vi.fn() }));
vi.mock("../recipe-finder/ask-clarifying", () => ({ askClarifying: vi.fn() }));
vi.mock("../recipe-finder/classify-turn", () => ({ classifyTurn: vi.fn() }));

vi.mock("../notebook-extraction", () => ({
  extractNotebookEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/ai-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ai-safety")>();
  return {
    ...actual,
    sanitizeContextField: vi.fn((text: string) => text),
    containsDangerousDietaryAdvice: vi.fn().mockReturnValue(false),
  };
});

vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: vi.fn((_label: string, promise: Promise<unknown>) => {
    promise.catch(() => {});
  }),
}));

vi.mock("../coach-warm-up", () => ({ consumeWarmUp: vi.fn() }));

vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

// ── Helpers ─────────────────────────────────────────────────

const TURN = "22222222-2222-4222-8222-222222222222";
const OWNER_MESSAGE = "Can you turn that into a recipe for me?";

const finder = {
  userMessageId: 77,
  features: {
    catalogSave: true,
    recipeGeneration: true,
    dailyRecipeGenerations: 20,
  },
};

async function* fakeProStream(chunks: string[]): AsyncGenerator<CoachProChunk> {
  for (const c of chunks) yield { type: "content", content: c };
}

async function collectEvents(
  gen: AsyncGenerator<CoachChatEvent>,
): Promise<CoachChatEvent[]> {
  const events: CoachChatEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function makeParams(overrides: Partial<CoachChatParams> = {}): CoachChatParams {
  return {
    conversationId: 1,
    userId: "user-42",
    content: OWNER_MESSAGE,
    isCoachPro: true,
    warmUpId: undefined,
    screenContext: undefined,
    user: {
      dailyCalorieGoal: 2000,
      dailyProteinGoal: 150,
      dailyCarbsGoal: 250,
      dailyFatGoal: 65,
      weight: null,
      goalWeight: null,
      measurementUnit: "metric",
    },
    isAborted: () => false,
    ...overrides,
  };
}

function setupDefaultStorage() {
  vi.mocked(storage.getUserProfile).mockResolvedValue(
    createMockUserProfile({ dietType: "balanced" }),
  );
  vi.mocked(storage.getDailySummary).mockResolvedValue({
    totalCalories: 800,
    totalProtein: 40,
    totalCarbs: 100,
    totalFat: 30,
    itemCount: 0,
  });
  vi.mocked(storage.getDailyLogsInRange).mockResolvedValue([]);
  vi.mocked(storage.getMostEatenFoods).mockResolvedValue([]);
  vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
  vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([]);
  vi.mocked(storage.getCoachCachedResponse).mockResolvedValue(null);
  vi.mocked(storage.createChatMessage).mockResolvedValue(
    createMockChatMessage(),
  );
  vi.mocked(storage.updateChatConversationTitle).mockResolvedValue(undefined);
  vi.mocked(storage.createNotebookEntries).mockResolvedValue([]);
  vi.mocked(storage.archiveOldEntries).mockResolvedValue(0);
  vi.mocked(storage.setCoachCachedResponse).mockResolvedValue(undefined);
  vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
  vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
}

const assistantWrites = () =>
  vi
    .mocked(storage.createChatMessage)
    .mock.calls.filter((c) => c[2] === "assistant");

/** The generator emits the terminal offer_recipe call (a model "ask"). */
function modelOffers(args: unknown) {
  vi.mocked(generateCoachProResponse).mockImplementation(async function* () {
    yield {
      type: "terminal_tool" as const,
      name: "offer_recipe" as const,
      args: JSON.stringify(args),
    };
  });
}

const msg = (
  id: number,
  role: "user" | "assistant",
  content: string,
  metadata?: unknown,
) =>
  createMockChatMessage({
    id,
    role,
    content,
    ...(metadata ? { metadata: metadata as ChatMessage["metadata"] } : {}),
  });

// ── Acceptance regression set ───────────────────────────────

describe("Coach recipe offer — acceptance (plumbing through handleCoachChat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultStorage();
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    vi.stubEnv("RECIPE_OFFER_ENABLED", "true");
    vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
      text: t,
      blocks: [],
    }));
    vi.mocked(generateCoachProResponse).mockReturnValue(
      fakeProStream(["coach reply"]),
    );
    vi.mocked(generateCoachResponse).mockReturnValue(
      (async function* () {
        yield "free reply";
      })(),
    );
    vi.mocked(consumeWarmUp).mockReturnValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("the owner's exact message after a suggestion saves an offer block", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      msg(1, "user", "I have chicken, spinach, garlic, lemon and rice."),
      msg(
        2,
        "assistant",
        "You could make lemon garlic chicken with spinach rice.",
      ),
      msg(77, "user", OWNER_MESSAGE),
    ]);
    modelOffers({
      dish: "Lemon garlic chicken with spinach rice",
      from_conversation: true,
    });

    const events = await collectEvents(
      handleCoachChat(makeParams({ finder, turnKey: TURN })),
    );

    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toEqual({
      offerRecipe: true,
    });
    expect(assistantWrites()).toHaveLength(1);
    expect(assistantWrites()[0][3]).toBe(OFFER_TEXT);
    expect(assistantWrites()[0][4]).toEqual({
      blocks: [
        expect.objectContaining({
          type: "recipe_offer",
          flow: expect.objectContaining({
            stage: "offer",
            dish: "Lemon garlic chicken with spinach rice",
          }),
        }),
      ],
    });
    expect(assistantWrites()[0][5]).toBe(TURN);
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ type: "recipe_offer" }],
    });
    expect(findCommunity).not.toHaveBeenCalled();
  });

  it("free Coach: the Pro generator (and so offer_recipe) is never used, and there is no finder", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      msg(1, "assistant", "You could make lemon garlic chicken."),
      msg(77, "user", OWNER_MESSAGE),
    ]);
    await collectEvents(
      handleCoachChat(makeParams({ isCoachPro: false, finder, turnKey: TURN })),
    );
    expect(generateCoachProResponse).not.toHaveBeenCalled();
    expect(generateCoachResponse).toHaveBeenCalledTimes(1);
    const args = vi.mocked(generateCoachResponse).mock.calls[0] as unknown[];
    expect(
      args.some(
        (a) => typeof a === "object" && a !== null && "offerRecipe" in a,
      ),
    ).toBe(false);
    expect(findCommunity).not.toHaveBeenCalled();
    expect(classifyTurn).not.toHaveBeenCalled();
    expect(
      assistantWrites().some((c) =>
        JSON.stringify(c[4] ?? "").includes("recipe_offer"),
      ),
    ).toBe(false);
  });

  it("safety message: no finder, no offer; the generator gets safety_refusal intent", async () => {
    const safety = "how do I do a 5 day water fast";
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      msg(77, "user", safety),
    ]);
    await collectEvents(
      handleCoachChat(makeParams({ content: safety, finder, turnKey: TURN })),
    );
    // handleCoachChat does not short-circuit safety before the generator: it
    // passes intent safety_refusal (6th arg) and offerRecipe: true; removing
    // the tool for that intent is pinned by the generator tests (Task 10).
    expect(generateCoachProResponse).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateCoachProResponse).mock.calls[0];
    expect(call[5]).toBe("safety_refusal");
    expect(call[7]).toEqual({ offerRecipe: true });
    expect(findCommunity).not.toHaveBeenCalled();
    expect(
      assistantWrites().some((c) =>
        JSON.stringify(c[4] ?? "").includes("recipe_offer"),
      ),
    ).toBe(false);
  });

  describe("negatives after a recipe card: classifier says other → tool loop, prose → no offer", () => {
    const recipe = {
      title: "Chicken Curry",
      description: "d",
      difficulty: "Easy" as const,
      timeEstimate: "30 min",
      servings: 2,
      ingredients: [],
      instructions: ["cook"],
      dietTags: [],
    };
    it.each([
      "that recipe was too salty",
      "log that recipe",
      "how many calories in that recipe",
      "add that recipe to my meal plan",
      "thanks!",
    ])("%s", async (text) => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        msg(2, "assistant", "Here's a curry", {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        }),
        msg(77, "user", text),
      ]);
      vi.mocked(classifyTurn).mockResolvedValue("other");

      await collectEvents(
        handleCoachChat(makeParams({ content: text, finder, turnKey: TURN })),
      );

      expect(classifyTurn).toHaveBeenCalledTimes(1);
      expect(generateCoachProResponse).toHaveBeenCalledTimes(1);
      expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toEqual({
        offerRecipe: true,
      });
      expect(findCommunity).not.toHaveBeenCalled();
      expect(assistantWrites()).toHaveLength(1);
      expect(assistantWrites()[0][3]).toBe("coach reply");
      expect(JSON.stringify(assistantWrites()[0][4] ?? "")).not.toContain(
        "recipe_offer",
      );
    });
  });

  it("offer flag off: the regex route is unchanged (finder start → community search)", async () => {
    vi.stubEnv("RECIPE_OFFER_ENABLED", "");
    const text = "Find me a high protein chicken recipe";
    vi.mocked(findCommunity).mockResolvedValue([
      {
        id: 12,
        source: "community" as const,
        title: "Chicken Tray Bake",
        imageUrl: null,
        readyInMinutes: null,
        calories: 480,
      },
    ]);
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      msg(77, "user", text),
    ]);

    const events = await collectEvents(
      handleCoachChat(makeParams({ content: text, finder, turnKey: TURN })),
    );

    expect(findCommunity).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ type: "recipe_results" }],
    });
    // The Pro generator is never reached, so it can't have been given offerRecipe.
    expect(generateCoachProResponse).not.toHaveBeenCalled();
  });

  it("offer flag off: a plain turn reaches the generator with offerRecipe: false", async () => {
    vi.stubEnv("RECIPE_OFFER_ENABLED", "");
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      msg(77, "user", OWNER_MESSAGE),
    ]);
    await collectEvents(handleCoachChat(makeParams({ finder, turnKey: TURN })));
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toEqual({
      offerRecipe: false,
    });
  });
});
