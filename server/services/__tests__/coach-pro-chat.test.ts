import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CoachChatEvent, CoachChatParams } from "../coach-pro-chat";
import type { CoachNotebookEntry, UserProfile } from "@shared/schema";
import {
  createMockUserProfile,
  createMockChatMessage,
  createMockCoachNotebookEntry,
} from "../../__tests__/factories";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

// ── Imports (after mocks) ───────────────────────────────────

import {
  handleCoachChat,
  hashCoachCacheContext,
  hashCoachCacheKey,
  hashNotebookDedupeKey,
  buildMealPatternSummary,
  _testInternals as coachProInternals,
} from "../coach-pro-chat";
import { storage } from "../../storage";
import {
  generateCoachProResponse,
  generateCoachResponse,
} from "../nutrition-coach";
import type { CoachContext, CoachProChunk } from "../nutrition-coach";
import { parseBlocksFromContent } from "../coach-blocks";
import { consumeWarmUp } from "../coach-warm-up";
import { fireAndForget } from "../../lib/fire-and-forget";
import { sanitizeContextField } from "../../lib/ai-safety";
import { extractNotebookEntries } from "../notebook-extraction";
import { civilDateToInstant } from "../../lib/civil-date";
import express from "express";
import request from "supertest";
import { register as registerNotebookRoutes } from "../../routes/notebook";
import { generateRecipeChatResponse } from "../recipe-chat";
import { findCommunity } from "../recipe-finder/find-community";
import { classifyTurn } from "../recipe-finder/classify-turn";
import type {
  FinderBlock,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import { runCoachFinderTurn } from "../recipe-finder/coach-turn";
import { OFFER_TEXT } from "../recipe-finder/fallback-text";

// ── Mocks ───────────────────────────────────────────────────

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
  parseBlocksFromContent: vi.fn().mockReturnValue({ text: "", blocks: [] }),
  BLOCKS_SYSTEM_PROMPT: "[BLOCKS_SYSTEM_PROMPT]",
  getBlocksSystemPrompt: vi.fn().mockReturnValue("[BLOCKS_SYSTEM_PROMPT]"),
}));

vi.mock("../recipe-chat", async () => {
  const actual =
    await vi.importActual<typeof import("../recipe-chat")>("../recipe-chat");
  return { ...actual, generateRecipeChatResponse: vi.fn() };
});
vi.mock("../recipe-finder/extract-query", () => ({
  extractQuery: vi.fn(async (t: string) => ({ q: t })),
  extractOfferDetails: vi.fn(),
}));
vi.mock("../recipe-finder/ask-follow-ups", () => ({
  askDishFollowUps: vi.fn(async () => []),
}));
// Real implementation, wrapped so tests can see how Coach delegates to it.
vi.mock("../recipe-finder/coach-turn", async () => {
  const actual = await vi.importActual<
    typeof import("../recipe-finder/coach-turn")
  >("../recipe-finder/coach-turn");
  return {
    ...actual,
    runCoachFinderTurn: vi.fn(actual.runCoachFinderTurn),
  };
});
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
    // Execute the promise so side-effects can be observed in tests
    promise.catch(() => {});
  }),
}));

vi.mock("../coach-warm-up", () => ({
  consumeWarmUp: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

// ── Helpers ─────────────────────────────────────────────────

/** Creates an async generator that yields the given chunks. */
async function* fakeStream(chunks: string[]): AsyncGenerator<string> {
  for (const c of chunks) {
    yield c;
  }
}

/**
 * Creates a fake generateCoachProResponse stream that yields plain content
 * chunks (no tool_calls chunks) — for tests that don't exercise tool status.
 */
async function* fakeProStream(chunks: string[]): AsyncGenerator<CoachProChunk> {
  for (const c of chunks) {
    yield { type: "content", content: c };
  }
}

/** Collect all events from the handleCoachChat generator. */
async function collectEvents(
  gen: AsyncGenerator<CoachChatEvent>,
): Promise<CoachChatEvent[]> {
  const events: CoachChatEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Default params for tests — override per-test as needed. */
function makeParams(overrides: Partial<CoachChatParams> = {}): CoachChatParams {
  return {
    conversationId: 1,
    userId: "user-42",
    content: "What should I eat today?",
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

/** UserProfile fixture for handler tests. */
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return createMockUserProfile({
    dietType: "balanced",
    allergies: [{ name: "peanuts", severity: "mild" }],
    foodDislikes: ["olives"],
    ...overrides,
  });
}

/** CoachNotebookEntry fixture for notebook injection tests. */
function makeNotebookEntry(
  overrides: Partial<CoachNotebookEntry> &
    Pick<CoachNotebookEntry, "type" | "content">,
): CoachNotebookEntry {
  return createMockCoachNotebookEntry(overrides);
}

/** Set up default storage mock return values. */
function setupDefaultStorage() {
  vi.mocked(storage.getUserProfile).mockResolvedValue(makeProfile());
  vi.mocked(storage.getDailySummary).mockResolvedValue({
    totalCalories: 800,
    totalProtein: 40,
    totalCarbs: 100,
    totalFat: 30,
    itemCount: 0,
  });
  vi.mocked(storage.getChatMessages).mockResolvedValue([]);
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
}

// ── Tests ───────────────────────────────────────────────────

describe("handleCoachChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachProInternals.lastArchivedAt.clear();
    setupDefaultStorage();
    vi.mocked(generateCoachProResponse).mockReturnValue(
      fakeProStream(["Hello ", "world!"]),
    );
    vi.mocked(generateCoachResponse).mockReturnValue(
      fakeStream(["Standard ", "response."]),
    );
    vi.mocked(parseBlocksFromContent).mockReturnValue({
      text: "Hello world!",
      blocks: [],
    });
    vi.mocked(consumeWarmUp).mockReturnValue(null);
  });

  // ── Cache behaviour ───────────────────────────────────────

  describe("cache key regression (userId in hash)", () => {
    it("does not cache when screenContext is provided", async () => {
      const params = makeParams({
        screenContext: "Viewing home screen",
      });

      await collectEvents(handleCoachChat(params));

      expect(storage.getCoachCachedResponse).not.toHaveBeenCalled();
    });

    it("does not cache when history has more than 1 message", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        createMockChatMessage({ role: "user", content: "First" }),
        createMockChatMessage({ role: "assistant", content: "Reply" }),
      ]);

      const params = makeParams({ screenContext: undefined });

      await collectEvents(handleCoachChat(params));

      expect(storage.getCoachCachedResponse).not.toHaveBeenCalled();
    });

    it("includes same-day coach context fingerprint in cache key", () => {
      const morning = new Date("2026-04-29T09:15:00Z");
      const baseHash = hashCoachCacheContext(
        {
          goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
          todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
          dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
        },
        morning,
      );
      const updatedHash = hashCoachCacheContext(
        {
          goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
          todayIntake: { calories: 1200, protein: 80, carbs: 130, fat: 45 },
          dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
        },
        morning,
      );

      expect(baseHash).not.toBe(updatedHash);
      expect(
        hashCoachCacheKey(
          "user-42",
          "How am I doing?",
          false,
          "2026-04-29",
          baseHash,
        ),
      ).not.toBe(
        hashCoachCacheKey(
          "user-42",
          "How am I doing?",
          false,
          "2026-04-29",
          updatedHash,
        ),
      );
    });

    it("buckets the context-hash hour in the user's timezone, matching the tz-aware day bucket", () => {
      const context = {
        goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
        todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
        dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
      };
      // 09:15 UTC = 02:15 in Los Angeles — different local hours, same instant.
      const instant = new Date("2026-04-29T09:15:00Z");

      expect(hashCoachCacheContext(context, instant, "UTC")).not.toBe(
        hashCoachCacheContext(context, instant, "America/Los_Angeles"),
      );
      // Same tz twice — deterministic.
      expect(
        hashCoachCacheContext(context, instant, "America/Los_Angeles"),
      ).toBe(hashCoachCacheContext(context, instant, "America/Los_Angeles"));
      // Omitted tz behaves as UTC (backward compatible).
      expect(hashCoachCacheContext(context, instant)).toBe(
        hashCoachCacheContext(context, instant, "UTC"),
      );
    });

    it("includes aboutUser in the context hash so profile edits invalidate same-day cache", () => {
      const base = {
        goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
        todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
        dietaryProfile: {
          dietType: "balanced",
          allergies: [],
          dislikes: [],
        },
      };
      const instant = new Date("2026-04-29T09:15:00Z");

      expect(hashCoachCacheContext(base, instant)).not.toBe(
        hashCoachCacheContext(
          { ...base, aboutUser: { primaryGoal: "lose_weight" } },
          instant,
        ),
      );
    });
  });

  // ── Warm-up consumption ───────────────────────────────────

  describe("warm-up consumption", () => {
    it("consumes warm-up when warmUpId is provided and isCoachPro", async () => {
      const warmedMessages: {
        role: "user" | "assistant" | "system";
        content: string;
      }[] = [
        { role: "system", content: "sys" },
        { role: "user", content: "interim transcript" },
      ];
      vi.mocked(consumeWarmUp).mockReturnValue(warmedMessages);

      const params = makeParams({
        warmUpId: "warm-123",
        isCoachPro: true,
        content: "final transcript",
      });

      await collectEvents(handleCoachChat(params));

      // Signature is now (userId, conversationId, warmUpId) so the composite
      // cache key is per-conversation, not per-user.
      expect(consumeWarmUp).toHaveBeenCalledWith("user-42", 1, "warm-123");
      // The last message in warmedMessages should be replaced with final content
      // generateCoachProResponse is called with the replaced history
      expect(generateCoachProResponse).toHaveBeenCalled();
      const passedHistory = vi.mocked(generateCoachProResponse).mock
        .calls[0][0];
      const lastMsg = passedHistory[passedHistory.length - 1];
      expect(lastMsg.content).toBe("final transcript");
      expect(lastMsg.role).toBe("user");
    });

    it("does not consume warm-up when warmUpId is not provided", async () => {
      const params = makeParams({
        warmUpId: undefined,
        isCoachPro: true,
      });

      await collectEvents(handleCoachChat(params));

      expect(consumeWarmUp).not.toHaveBeenCalled();
    });

    it("falls back to DB history when warm-up returns null", async () => {
      vi.mocked(consumeWarmUp).mockReturnValue(null);
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        createMockChatMessage({ role: "user", content: "Old message" }),
      ]);

      const params = makeParams({
        warmUpId: "expired-warm",
        isCoachPro: true,
      });

      await collectEvents(handleCoachChat(params));

      expect(consumeWarmUp).toHaveBeenCalledWith("user-42", 1, "expired-warm");
      // Should use DB history since warm-up returned null
      const passedHistory = vi.mocked(generateCoachProResponse).mock
        .calls[0][0];
      expect(passedHistory).toEqual([{ role: "user", content: "Old message" }]);
    });

    it("does not consume warm-up when isCoachPro is false", async () => {
      const params = makeParams({
        warmUpId: "warm-123",
        isCoachPro: false,
      });

      await collectEvents(handleCoachChat(params));

      expect(consumeWarmUp).not.toHaveBeenCalled();
    });
  });

  // ── DB history window reliance (AC4) ───────────────────────
  // On the non-warm-up path, `messageHistory` is built straight from
  // `storage.getChatMessages(conversationId, 20, userId)` (coach-pro-chat.ts
  // ~line 684) with no separate append of `content` — the current turn's
  // text. `createChatMessageWithLimitCheck` (server/routes/chat.ts) persists
  // that turn BEFORE this generator runs, so once a conversation exceeds 20
  // messages, the model only sees the user's actual question if storage's
  // newest-20 window ends with the row it just inserted. This pins that
  // contract so a future change to the limit, or a caller that stops
  // trusting storage to include the current turn, breaks visibly here.
  describe("DB history window reliance (>20 message conversations)", () => {
    it("passes the current turn through unmodified when it is the newest row", async () => {
      const content = "What should I eat today?";
      const history = Array.from({ length: 19 }, (_, i) =>
        createMockChatMessage({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Older message ${i}`,
        }),
      ).concat(createMockChatMessage({ role: "user", content }));
      expect(history).toHaveLength(20);

      vi.mocked(storage.getChatMessages).mockResolvedValue(history);

      const params = makeParams({ content, isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.getChatMessages).toHaveBeenCalledWith(1, 20, "user-42");

      const passedHistory = vi.mocked(generateCoachProResponse).mock
        .calls[0][0];
      // No manual append happened — the length is exactly what storage
      // returned, and the last entry is the current turn (not duplicated,
      // not dropped).
      expect(passedHistory).toHaveLength(20);
      expect(passedHistory.at(-1)).toEqual({ role: "user", content });
    });
  });

  // ── Coach Pro vs standard coach branching ─────────────────

  describe("Coach Pro vs standard coach branching", () => {
    it("calls generateCoachProResponse when isCoachPro is true", async () => {
      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(generateCoachProResponse).toHaveBeenCalled();
      expect(generateCoachResponse).not.toHaveBeenCalled();
    });

    it("calls generateCoachResponse when isCoachPro is false", async () => {
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Standard response.",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: false });

      await collectEvents(handleCoachChat(params));

      expect(generateCoachResponse).toHaveBeenCalled();
      expect(generateCoachProResponse).not.toHaveBeenCalled();
    });

    it("yields safety_override event when generateCoachResponse emits the sentinel", async () => {
      const SENTINEL = "\x00SAFETY_OVERRIDE\x00";
      vi.mocked(generateCoachResponse).mockReturnValue(
        (async function* () {
          yield "Some unsafe content";
          yield SENTINEL;
        })(),
      );

      const params = makeParams({ isCoachPro: false });
      const events = await collectEvents(handleCoachChat(params));

      const overrideEvents = events.filter((e) => e.type === "safety_override");
      expect(overrideEvents).toHaveLength(1);
      expect(
        (overrideEvents[0] as { type: "safety_override"; message: string })
          .message,
      ).toContain("careful");
    });
  });

  // ── ABOUT THIS USER context boundary ───────────────────────

  describe("ABOUT THIS USER context boundary", () => {
    /** Context object handed to the (stubbed) Pro generator. */
    function capturedProContext(): CoachContext {
      return vi.mocked(generateCoachProResponse).mock.calls[0][1];
    }

    it("maps profile personalization fields and user weight into context.aboutUser", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        makeProfile({
          primaryGoal: "lose_weight",
          activityLevel: "lightly_active",
          cookingSkillLevel: "beginner",
          cookingTimeAvailable: "under_30_min",
          cuisinePreferences: ["Mexican", "Thai"],
          householdSize: 3,
        }),
      );
      const params = makeParams({
        user: {
          dailyCalorieGoal: 2000,
          dailyProteinGoal: 150,
          dailyCarbsGoal: 250,
          dailyFatGoal: 65,
          weight: "82.50",
          goalWeight: "75.00",
          measurementUnit: "metric",
        },
      });

      await collectEvents(handleCoachChat(params));

      expect(capturedProContext().aboutUser).toEqual({
        primaryGoal: "lose_weight",
        activityLevel: "lightly_active",
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "under_30_min",
        cuisinePreferences: ["Mexican", "Thai"],
        householdSize: 3,
        weightKg: 82.5,
        goalWeightKg: 75,
        measurementUnit: "metric",
      });
      // User-authored strings pass the M40 sanitize-at-context-boundary gate.
      expect(sanitizeContextField).toHaveBeenCalledWith("lose_weight", 100);
      expect(sanitizeContextField).toHaveBeenCalledWith("Mexican", 100);
    });

    it("omits aboutUser entirely when the profile has no personalization signal", async () => {
      // Factory defaults: all personalization fields null, householdSize 1
      // (the column default — carries no signal), cuisinePreferences [].
      vi.mocked(storage.getUserProfile).mockResolvedValue(makeProfile());

      await collectEvents(handleCoachChat(makeParams()));

      expect(capturedProContext().aboutUser).toBeUndefined();
    });

    it("drops unparseable weight strings instead of rendering NaN", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        makeProfile({ primaryGoal: "maintain" }),
      );
      const params = makeParams({
        user: {
          dailyCalorieGoal: 2000,
          dailyProteinGoal: 150,
          dailyCarbsGoal: 250,
          dailyFatGoal: 65,
          weight: "abc",
          goalWeight: null,
          measurementUnit: "metric",
        },
      });

      await collectEvents(handleCoachChat(params));

      // No weight → no weightKg and no measurementUnit (only used for weights).
      expect(capturedProContext().aboutUser).toEqual({
        primaryGoal: "maintain",
      });
    });

    it("maps allergy severity through the context boundary, dropping invalid values", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        makeProfile({
          // jsonb defense-in-depth: rows may carry a bogus or missing severity.
          allergies: [
            { name: "peanuts", severity: "severe" },
            { name: "dairy", severity: "spicy" },
            { name: "soy" },
          ] as UserProfile["allergies"],
        }),
      );

      await collectEvents(handleCoachChat(makeParams()));

      expect(capturedProContext().dietaryProfile.allergies).toEqual([
        { name: "peanuts", severity: "severe" },
        { name: "dairy" },
        { name: "soy" },
      ]);
    });

    it("ships aboutUser to the free tier too (both-tiers decision)", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        makeProfile({ primaryGoal: "gain_muscle" }),
      );

      await collectEvents(handleCoachChat(makeParams({ isCoachPro: false })));

      const context = vi.mocked(generateCoachResponse).mock.calls[0][1];
      expect(context.aboutUser).toEqual({ primaryGoal: "gain_muscle" });
    });
  });

  // ── Frequent-foods injection into context ──────────────────

  describe("frequent-foods injection", () => {
    it("injects a sanitized frequent-foods summary for Pro", async () => {
      vi.mocked(storage.getMostEatenFoods).mockResolvedValue([
        { name: "Greek yogurt", timesLogged: 12 },
        { name: "chicken breast", timesLogged: 8 },
      ]);

      await collectEvents(handleCoachChat(makeParams({ isCoachPro: true })));

      const context = vi.mocked(generateCoachProResponse).mock.calls[0][1];
      expect(context.frequentFoodsSummary).toBe(
        "Greek yogurt (12×), chicken breast (8×)",
      );
      // productName/title are user-authored — must pass the M40 gate.
      expect(sanitizeContextField).toHaveBeenCalledWith("Greek yogurt", 100);
    });

    it("omits the summary when there are no frequent foods", async () => {
      await collectEvents(handleCoachChat(makeParams({ isCoachPro: true })));

      const context = vi.mocked(generateCoachProResponse).mock.calls[0][1];
      expect(context.frequentFoodsSummary).toBeUndefined();
    });

    it("does not fetch frequent foods for the free tier", async () => {
      await collectEvents(handleCoachChat(makeParams({ isCoachPro: false })));

      expect(storage.getMostEatenFoods).not.toHaveBeenCalled();
    });
  });

  // ── Due-commitments injection into context ─────────────────

  describe("due-commitments injection", () => {
    it("injects sanitized, fenced due commitments into context for Pro", async () => {
      vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([
        makeNotebookEntry({
          type: "commitment",
          content: "Try meal prepping on Sunday",
          followUpDate: new Date("2026-07-10"),
        }),
      ]);

      await collectEvents(handleCoachChat(makeParams({ isCoachPro: true })));

      const context = vi.mocked(generateCoachProResponse).mock.calls[0][1];
      expect(context.dueCommitmentsSummary).toContain(
        "<notebook_entry>Try meal prepping on Sunday</notebook_entry>",
      );
      expect(sanitizeContextField).toHaveBeenCalledWith(
        "Try meal prepping on Sunday",
        500,
      );
    });

    it("caps the injected commitments at three", async () => {
      vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue(
        ["one", "two", "three", "four"].map((content) =>
          makeNotebookEntry({ type: "commitment", content }),
        ),
      );

      await collectEvents(handleCoachChat(makeParams({ isCoachPro: true })));

      const context = vi.mocked(generateCoachProResponse).mock.calls[0][1];
      const lineCount = (context.dueCommitmentsSummary ?? "").split(
        "\n",
      ).length;
      expect(lineCount).toBe(3);
      expect(context.dueCommitmentsSummary).not.toContain("four");
    });

    it("does not fetch due commitments for the free tier", async () => {
      await collectEvents(handleCoachChat(makeParams({ isCoachPro: false })));

      expect(storage.getCommitmentsWithDueFollowUp).not.toHaveBeenCalled();
      const context = vi.mocked(generateCoachResponse).mock.calls[0][1];
      expect(context.dueCommitmentsSummary).toBeUndefined();
    });
  });

  // ── Notebook injection into context ───────────────────────

  describe("notebook injection", () => {
    it("orders durable preference entries before recent insights in the summary", async () => {
      // Storage returns updatedAt-desc (insight first); the budget layer must
      // re-order so durable personalization renders first.
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([
        makeNotebookEntry({
          type: "insight",
          content: "ate late twice this week",
          updatedAt: new Date("2026-07-10"),
        }),
        makeNotebookEntry({
          type: "preference",
          content: "vegetarian",
          updatedAt: new Date("2026-05-01"),
        }),
      ]);

      await collectEvents(handleCoachChat(makeParams({ isCoachPro: true })));

      const context = vi.mocked(generateCoachProResponse).mock.calls[0][1];
      const lines = (context.notebookSummary ?? "").split("\n");
      expect(lines[0]).toContain("vegetarian");
      expect(lines[1]).toContain("ate late twice");
    });

    it("injects notebook entries into context when entries exist (CoachPro)", async () => {
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([
        makeNotebookEntry({
          type: "preference",
          content: "User likes salads",
        }),
        makeNotebookEntry({
          type: "goal",
          content: "Lose 5kg by summer",
        }),
      ]);

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.getActiveNotebookEntries).toHaveBeenCalledWith("user-42");

      const passedContext = vi.mocked(generateCoachProResponse).mock
        .calls[0][1];
      expect(passedContext.notebookSummary).toContain("User likes salads");
      expect(passedContext.notebookSummary).toContain("Lose 5kg by summer");
      // BLOCKS_SYSTEM_PROMPT is now in blocksPrompt, not notebookSummary
      expect(passedContext.blocksPrompt).toContain("[BLOCKS_SYSTEM_PROMPT]");
    });

    it("sets only BLOCKS_SYSTEM_PROMPT when notebook entries are empty (CoachPro)", async () => {
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      const passedContext = vi.mocked(generateCoachProResponse).mock
        .calls[0][1];
      // When no entries exist, notebookSummary is undefined and BLOCKS_SYSTEM_PROMPT is in blocksPrompt
      expect(passedContext.notebookSummary).toBeUndefined();
      expect(passedContext.blocksPrompt).toContain("[BLOCKS_SYSTEM_PROMPT]");
    });

    it("does not inject notebook context when isCoachPro is false", async () => {
      const params = makeParams({ isCoachPro: false });

      await collectEvents(handleCoachChat(params));

      expect(storage.getActiveNotebookEntries).not.toHaveBeenCalled();
      const passedContext = vi.mocked(generateCoachResponse).mock.calls[0][1];
      expect(passedContext.notebookSummary).toBeUndefined();
    });
  });

  // ── SSE event yielding ────────────────────────────────────

  describe("SSE event yielding", () => {
    it("yields content events from the generator stream", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Hello ", "world!"]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Hello world!",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: true });
      const events = await collectEvents(handleCoachChat(params));

      const contentEvents = events.filter((e) => e.type === "content");
      expect(contentEvents).toEqual([
        { type: "content", content: "Hello " },
        { type: "content", content: "world!" },
      ]);
    });

    it("yields blocks event when Coach Pro response contains blocks", async () => {
      // Cast: `CoachBlock` is a discriminated union whose `meal_plan` variant
      // requires more fields than this test exercises — the code under test
      // only forwards the block opaquely, so a minimal partial is sufficient.
      const mockBlocks: CoachBlock[] = [
        {
          type: "meal_plan",
          data: { title: "Lunch plan" },
        } as unknown as CoachBlock,
      ];
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Here is your plan."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Here is your plan.",
        blocks: mockBlocks,
      });

      const params = makeParams({ isCoachPro: true });
      const events = await collectEvents(handleCoachChat(params));

      const blockEvents = events.filter((e) => e.type === "blocks");
      expect(blockEvents).toHaveLength(1);
      expect(blockEvents[0]).toEqual({
        type: "blocks",
        blocks: mockBlocks,
      });
    });

    it("does not yield blocks event when blocks are empty", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["No blocks here."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "No blocks here.",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: true });
      const events = await collectEvents(handleCoachChat(params));

      const blockEvents = events.filter((e) => e.type === "blocks");
      expect(blockEvents).toHaveLength(0);
    });

    it("yields cached response in chunks when cache hit", async () => {
      vi.mocked(storage.getCoachCachedResponse).mockResolvedValue(
        "Cached answer for you.",
      );
      vi.mocked(storage.getChatMessages).mockResolvedValue([]);
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Cached answer for you.",
        blocks: [],
      });

      const params = makeParams({
        // Cache is only consulted for non-Pro (H4 — 2026-04-18).
        isCoachPro: false,
        screenContext: undefined,
      });
      const events = await collectEvents(handleCoachChat(params));

      const contentEvents = events.filter((e) => e.type === "content");
      // Cached response is split into 3 chunks
      expect(contentEvents.length).toBe(3);
      const joined = contentEvents
        .map((e) => (e as { type: "content"; content: string }).content)
        .join("");
      expect(joined).toBe("Cached answer for you.");

      // Should NOT call the generators when cached
      expect(generateCoachProResponse).not.toHaveBeenCalled();
      expect(generateCoachResponse).not.toHaveBeenCalled();
    });
  });

  // ── Auto-titling on first exchange ────────────────────────

  describe("auto-titling", () => {
    it("fires auto-title on first exchange (history.length <= 1)", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([]);

      const params = makeParams({ content: "My first question" });

      await collectEvents(handleCoachChat(params));

      expect(fireAndForget).toHaveBeenCalledWith(
        "coach-chat-auto-title",
        expect.anything(),
      );
      expect(storage.updateChatConversationTitle).toHaveBeenCalledWith(
        1,
        "user-42",
        "My first question",
      );
    });

    it("truncates long messages to 50 chars with ellipsis in title", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([]);

      const longContent =
        "This is a very long question that should be truncated for the title";
      const params = makeParams({ content: longContent });

      await collectEvents(handleCoachChat(params));

      expect(storage.updateChatConversationTitle).toHaveBeenCalledWith(
        1,
        "user-42",
        longContent.slice(0, 50) + "...",
      );
    });

    it("does not auto-title when history has more than 1 message", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        createMockChatMessage({ role: "user", content: "First" }),
        createMockChatMessage({ role: "assistant", content: "Reply" }),
      ]);

      const params = makeParams({});

      await collectEvents(handleCoachChat(params));

      expect(storage.updateChatConversationTitle).not.toHaveBeenCalled();
    });
  });

  // ── Notebook extraction after response ────────────────────

  describe("notebook extraction", () => {
    it("triggers notebook extraction for Coach Pro after response", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Advice here."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Advice here.",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(fireAndForget).toHaveBeenCalledWith(
        "coach-notebook-extraction",
        expect.anything(),
      );
    });

    it("does not trigger notebook extraction for standard coach", async () => {
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Standard response.",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: false });

      await collectEvents(handleCoachChat(params));

      // fireAndForget may be called for caching or auto-title, but not for extraction
      const extractionCalls = vi
        .mocked(fireAndForget)
        .mock.calls.filter(([label]) => label === "coach-notebook-extraction");
      expect(extractionCalls).toHaveLength(0);
    });

    it("does not trigger notebook extraction when response is empty", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(fakeProStream([]));
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      const extractionCalls = vi
        .mocked(fireAndForget)
        .mock.calls.filter(([label]) => label === "coach-notebook-extraction");
      expect(extractionCalls).toHaveLength(0);
    });

    /**
     * Flush the fire-and-forget "coach-notebook-extraction" closure. The
     * `fireAndForget` mock attaches `.catch(() => {})` but does not await the
     * promise, so `collectEvents` can return before the closure's own
     * `await`s (extractNotebookEntries, storage.createNotebookEntries) land.
     */
    async function flushNotebookExtraction(): Promise<void> {
      const call = vi
        .mocked(fireAndForget)
        .mock.calls.find(([label]) => label === "coach-notebook-extraction");
      await call?.[1];
    }

    it("anchors followUpDate with civilDateToInstant using the request tz, not new Date() (UTC-negative tz)", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Let's check in."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Let's check in.",
        blocks: [],
      });
      vi.mocked(extractNotebookEntries).mockResolvedValue([
        {
          type: "commitment",
          content: "Check in about meal prepping",
          followUpDate: "2026-09-05",
        },
      ]);

      const params = makeParams({
        isCoachPro: true,
        tz: "America/Los_Angeles",
      });

      await collectEvents(handleCoachChat(params));
      await flushNotebookExtraction();

      const expectedAnchor = civilDateToInstant(
        "2026-09-05",
        "America/Los_Angeles",
      );
      expect(storage.createNotebookEntries).toHaveBeenCalledWith([
        expect.objectContaining({ followUpDate: expectedAnchor }),
      ]);

      // Names the property the bug actually broke, not a snapshot literal:
      // `new Date("2026-09-05")` (the old, buggy anchor) is UTC midnight — a
      // DIFFERENT, EARLIER instant than LA midnight for this UTC-negative
      // zone. Assert the buggy value was not what got written.
      const naiveUtcMidnight = new Date("2026-09-05");
      expect(expectedAnchor.getTime()).toBeGreaterThan(
        naiveUtcMidnight.getTime(),
      );
      expect(
        vi.mocked(storage.createNotebookEntries).mock.calls[0][0][0]
          .followUpDate,
      ).not.toEqual(naiveUtcMidnight);
    });

    it("threads the request's tz (and a captured `now`) into extractNotebookEntries — pins the wiring across the mock boundary", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Let's check in."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Let's check in.",
        blocks: [],
      });

      const params = makeParams({
        isCoachPro: true,
        tz: "America/Los_Angeles",
      });

      await collectEvents(handleCoachChat(params));
      await flushNotebookExtraction();

      // extractNotebookEntries is mocked wholesale in this file, so only its
      // RETURN value is otherwise exercised. Without this assertion, a call
      // site regression (e.g. hardcoding `{ now: new Date(), tz: "UTC" }`
      // instead of forwarding the request's tz) would leave every test in
      // this file AND in notebook-extraction.test.ts green, even though
      // threading `tz` through this exact call is the entire point of the
      // fix.
      expect(extractNotebookEntries).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.any(Number),
        { now: expect.any(Date), tz: "America/Los_Angeles" },
      );
    });

    it("anchors followUpDate with civilDateToInstant using the request tz, not new Date() (UTC-positive tz — the opposite-sign companion of the test above)", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Let's check in."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Let's check in.",
        blocks: [],
      });
      vi.mocked(extractNotebookEntries).mockResolvedValue([
        {
          type: "commitment",
          content: "Check in about meal prepping",
          followUpDate: "2026-09-05",
        },
      ]);

      const params = makeParams({
        isCoachPro: true,
        tz: "Asia/Tokyo",
      });

      await collectEvents(handleCoachChat(params));
      await flushNotebookExtraction();

      const expectedAnchor = civilDateToInstant("2026-09-05", "Asia/Tokyo");
      expect(storage.createNotebookEntries).toHaveBeenCalledWith([
        expect.objectContaining({ followUpDate: expectedAnchor }),
      ]);

      // For a UTC-POSITIVE zone the relationship inverts: local midnight in
      // Tokyo is BEFORE UTC midnight, so the correct anchor is EARLIER than
      // the old naive `new Date("2026-09-05")` anchor — the opposite
      // direction from the UTC-negative (LA) test above. A fix hand-tuned to
      // only the west-of-Greenwich case (e.g. an inverted offset sign) would
      // pass that test while failing this one.
      const naiveUtcMidnight = new Date("2026-09-05");
      expect(expectedAnchor.getTime()).toBeLessThan(naiveUtcMidnight.getTime());
      expect(
        vi.mocked(storage.createNotebookEntries).mock.calls[0][0][0]
          .followUpDate,
      ).not.toEqual(naiveUtcMidnight);
    });

    it("does not anchor a commitment as due before the user's local midnight (UTC-negative tz) — Postgres-independent mirror of the storage-layer 'not due early' test", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Let's check in."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Let's check in.",
        blocks: [],
      });
      const dateStr = "2026-09-05";
      const tz = "America/Los_Angeles";
      vi.mocked(extractNotebookEntries).mockResolvedValue([
        {
          type: "commitment",
          content: "Check in next week",
          followUpDate: dateStr,
        },
      ]);

      const params = makeParams({ isCoachPro: true, tz });

      await collectEvents(handleCoachChat(params));
      await flushNotebookExtraction();

      const writtenFollowUpDate = vi.mocked(storage.createNotebookEntries).mock
        .calls[0][0][0].followUpDate as Date;

      // What `getDueCommitmentsAllUsers` / `getCommitmentsWithDueFollowUp`
      // (coach-notebook.ts) actually evaluate is `lte(followUpDate, now)`.
      // Pick a `now` strictly between the old buggy UTC-midnight anchor and
      // the correct LA-midnight anchor: the bug would mark the commitment
      // due there; the fix must not.
      const naiveUtcMidnight = new Date(dateStr);
      const oneHourAfterNaiveAnchor = new Date(
        naiveUtcMidnight.getTime() + 60 * 60 * 1000,
      );

      // Old (buggy) anchor: already due at that instant.
      expect(
        naiveUtcMidnight.getTime() <= oneHourAfterNaiveAnchor.getTime(),
      ).toBe(true);
      // Fixed anchor: NOT yet due at that same instant — i.e. does not come
      // due early.
      expect(
        writtenFollowUpDate.getTime() > oneHourAfterNaiveAnchor.getTime(),
      ).toBe(true);
    });

    // Two writers of `coachNotebook.followUpDate`: this extraction path and
    // the manual add-entry route. Each has its own anchoring test, but only
    // this one fails if they drift onto different bases. Both are driven
    // through their entry points: the route receives the zone as a real
    // request header, and extraction receives the same zone the chat route
    // would parse from that header.
    it("a chat-extracted commitment and a manually added one for the same calendar day land on the same instant", async () => {
      const tz = "America/Los_Angeles";
      const dateStr = "2026-09-05";

      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Let's check in."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Let's check in.",
        blocks: [],
      });
      vi.mocked(extractNotebookEntries).mockResolvedValue([
        { type: "commitment", content: "Check in", followUpDate: dateStr },
      ]);
      await collectEvents(
        handleCoachChat(makeParams({ isCoachPro: true, tz })),
      );
      await flushNotebookExtraction();
      const viaChat = vi.mocked(storage.createNotebookEntries).mock
        .calls[0][0][0].followUpDate;

      vi.mocked(storage.createNotebookEntry).mockResolvedValue(
        createMockCoachNotebookEntry(),
      );
      const app = express();
      app.use(express.json());
      registerNotebookRoutes(app);
      const res = await request(app)
        .post("/api/coach/notebook")
        .set("Authorization", "Bearer valid-token")
        .set("X-Timezone", tz)
        .send({
          type: "commitment",
          content: "Check in",
          followUpDate: dateStr,
        });
      expect(res.status).toBe(201);
      const viaRoute = vi.mocked(storage.createNotebookEntry).mock.calls[0][0]
        .followUpDate;

      expect(viaRoute).toEqual(viaChat);
      expect(viaRoute).toEqual(new Date("2026-09-05T07:00:00.000Z"));
    });
  });

  // ── Message persistence ───────────────────────────────────

  describe("message persistence", () => {
    it("persists assistant message after response", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Test response"]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Test response",
        blocks: [],
      });

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "user-42",
        "assistant",
        "Test response",
        null,
      );
    });

    it("persists blocks metadata when blocks are present", async () => {
      // Cast: see above — minimal partial `CoachBlock` for opaque forwarding.
      const mockBlocks: CoachBlock[] = [
        {
          type: "meal_plan",
          data: { title: "Lunch" },
        } as unknown as CoachBlock,
      ];
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Plan here."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Plan here.",
        blocks: mockBlocks,
      });

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "user-42",
        "assistant",
        "Plan here.",
        { blocks: mockBlocks },
      );
    });

    it("does not persist message when response is empty", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(fakeProStream([]));

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.createChatMessage).not.toHaveBeenCalled();
    });

    it("does not persist partial assistant message after abort", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeProStream(["Partial response"]),
      );
      let abortChecks = 0;
      const params = makeParams({
        isCoachPro: true,
        isAborted: () => abortChecks++ > 0,
      });

      const events = await collectEvents(handleCoachChat(params));

      expect(events).toEqual([
        { type: "content", content: "Partial response" },
      ]);
      expect(storage.createChatMessage).not.toHaveBeenCalled();
    });
  });

  // ── History truncation (M16) ──────────────────────────────

  describe("history truncation", () => {
    it("truncates history to fit within the 8000-token budget before passing to generateCoachProResponse", async () => {
      // 20 messages, each with 2000 chars of content.
      // At 4 chars/token that's 500 tokens each → 10,000 tokens total,
      // which exceeds the 8,000-token budget by 2,000 tokens (5 assistant messages).
      const longContent = "x".repeat(2000);
      const messages = Array.from({ length: 20 }, (_, i) =>
        createMockChatMessage({
          role: i % 2 === 0 ? "user" : "assistant",
          content: longContent,
        }),
      );
      vi.mocked(storage.getChatMessages).mockResolvedValue(messages);

      const params = makeParams({ isCoachPro: true });
      await collectEvents(handleCoachChat(params));

      expect(generateCoachProResponse).toHaveBeenCalled();
      const passedHistory = vi.mocked(generateCoachProResponse).mock
        .calls[0][0];
      // The full 20-message history (10,000 tokens) exceeds 8,000 tokens,
      // so truncation must have reduced it.
      expect(passedHistory.length).toBeLessThan(20);
      // The most-recent user message (index 18) must always be preserved by the
      // truncation logic — verify at least one "user" message is present.
      const userMessages = passedHistory.filter((m) => m.role === "user");
      expect(userMessages.length).toBeGreaterThan(0);
    });
  });

  // ── Status events ─────────────────────────────────────────

  describe("status events", () => {
    it("yields a status event immediately when tool calls are detected, before the next content event", async () => {
      vi.mocked(generateCoachProResponse).mockImplementation(
        async function* (): AsyncGenerator<CoachProChunk> {
          yield { type: "content", content: "First chunk" };
          yield { type: "tool_calls", toolNames: ["search_recipes"] };
          yield { type: "content", content: "After tool" };
        },
      );

      const params = makeParams({ isCoachPro: true });
      const events = await collectEvents(handleCoachChat(params));

      const statusEvents = events.filter((e) => e.type === "status");
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0]).toEqual({
        type: "status",
        label: "Searching recipes…",
      });

      // The status event sits between the two content chunks — it is not
      // deferred until (or past) the content chunk that follows the tool
      // round.
      const types = events.map((e) => e.type);
      const firstContentIdx = types.indexOf("content");
      const statusIdx = types.indexOf("status");
      const secondContentIdx = types.indexOf("content", firstContentIdx + 1);
      expect(statusIdx).toBeGreaterThan(firstContentIdx);
      expect(statusIdx).toBeLessThan(secondContentIdx);
    });

    it("falls back to 'Working on it…' for unknown tool names", async () => {
      vi.mocked(generateCoachProResponse).mockImplementation(
        async function* (): AsyncGenerator<CoachProChunk> {
          yield { type: "tool_calls", toolNames: ["some_future_tool"] };
          yield { type: "content", content: "Done" };
        },
      );

      const events = await collectEvents(
        handleCoachChat(makeParams({ isCoachPro: true })),
      );
      const statusEvent = events.find((e) => e.type === "status");
      expect(statusEvent).toEqual({ type: "status", label: "Working on it…" });
    });
  });
});

// ── Pure helpers extracted from handleCoachChat (L19) ───────

// The day bucket is now a required argument: it is timezone-dependent, and a
// default that answers in UTC is a different day from the user's for part of
// every day. These cases are bucket-independent, so a fixed value states that.
const DAY_BUCKET = "2026-07-10";

describe("hashCoachCacheKey", () => {
  it("produces deterministic 32-char hex for the same input", () => {
    const a = hashCoachCacheKey(
      "user-1",
      "what should I eat?",
      false,
      DAY_BUCKET,
    );
    const b = hashCoachCacheKey(
      "user-1",
      "what should I eat?",
      false,
      DAY_BUCKET,
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces different keys for different users with the same content", () => {
    const a = hashCoachCacheKey("user-1", "hello", false, DAY_BUCKET);
    const b = hashCoachCacheKey("user-2", "hello", false, DAY_BUCKET);
    expect(a).not.toBe(b);
  });

  it("normalizes whitespace and case", () => {
    const a = hashCoachCacheKey("user-1", "Hello World", false, DAY_BUCKET);
    const b = hashCoachCacheKey("user-1", "  hello world  ", false, DAY_BUCKET);
    expect(a).toBe(b);
  });

  it("scopes Pro and non-Pro under separate keys (H4 — 2026-04-18)", () => {
    const pro = hashCoachCacheKey("user-1", "hello", true, DAY_BUCKET);
    const free = hashCoachCacheKey("user-1", "hello", false, DAY_BUCKET);
    expect(pro).not.toBe(free);
  });

  it("buckets by the caller-supplied civil day so next-day intake/goals don't hit stale cache (H5 — 2026-04-18)", () => {
    const today = hashCoachCacheKey("user-1", "hello", false, "2026-04-18");
    const tomorrow = hashCoachCacheKey("user-1", "hello", false, "2026-04-19");
    expect(today).not.toBe(tomorrow);
  });
});

describe("hashNotebookDedupeKey", () => {
  const base = {
    userId: "user-1",
    conversationId: 42,
    entryType: "preference",
    entryContent: "likes salads",
    lastUserMessage: "I like salads",
    lastAssistantMessage: "Noted!",
  };

  it("produces the same key for the same conversation turn", () => {
    expect(hashNotebookDedupeKey(base)).toBe(hashNotebookDedupeKey(base));
  });

  it("produces different keys when any component differs", () => {
    const other = hashNotebookDedupeKey({
      ...base,
      entryContent: "dislikes olives",
    });
    expect(other).not.toBe(hashNotebookDedupeKey(base));
  });

  it("coaching_strategy is bucketed by ISO week, not turn content", () => {
    const a = hashNotebookDedupeKey({
      ...base,
      entryType: "coaching_strategy",
      entryContent: "be blunt",
      lastUserMessage: "turn A",
      lastAssistantMessage: "reply A",
    });
    const b = hashNotebookDedupeKey({
      ...base,
      entryType: "coaching_strategy",
      entryContent: "be gentle",
      lastUserMessage: "turn B",
      lastAssistantMessage: "reply B",
    });
    // Same user + same week = same key regardless of content/turn.
    expect(a).toBe(b);
  });

  it("coaching_strategy produces different keys for dates in adjacent ISO weeks (M17)", () => {
    // ISO week 2026-W18 starts Monday 2026-04-27.
    // ISO week 2026-W19 starts Monday 2026-05-04.
    // Using vi.setSystemTime to control which week new Date() falls in.
    const strategyParams = {
      ...base,
      entryType: "coaching_strategy",
      entryContent: "be consistent",
      lastUserMessage: "turn X",
      lastAssistantMessage: "reply X",
    };

    vi.useFakeTimers();
    try {
      // Week 18: Monday 2026-04-27
      vi.setSystemTime(new Date("2026-04-27T12:00:00Z"));
      const keyWeek18 = hashNotebookDedupeKey(strategyParams);

      // Week 19: Monday 2026-05-04
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
      const keyWeek19 = hashNotebookDedupeKey(strategyParams);

      expect(keyWeek18).not.toBe(keyWeek19);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shouldRunArchive (time-gated archiveOldEntries)", () => {
  beforeEach(() => {
    coachProInternals.lastArchivedAt.clear();
  });

  it("returns true on first call and false within the throttle window", () => {
    const now = Date.now();
    expect(coachProInternals.shouldRunArchive("user-x", now)).toBe(true);
    // Second call inside the 24-hour window is blocked.
    expect(coachProInternals.shouldRunArchive("user-x", now + 1000)).toBe(
      false,
    );
  });

  it("returns true again once the throttle window has elapsed", () => {
    const now = Date.now();
    expect(coachProInternals.shouldRunArchive("user-x", now)).toBe(true);
    const later = now + coachProInternals.ARCHIVE_THROTTLE_MS + 1000;
    expect(coachProInternals.shouldRunArchive("user-x", later)).toBe(true);
  });

  it("tracks each user independently", () => {
    const now = Date.now();
    expect(coachProInternals.shouldRunArchive("user-a", now)).toBe(true);
    expect(coachProInternals.shouldRunArchive("user-b", now)).toBe(true);
    expect(coachProInternals.shouldRunArchive("user-a", now)).toBe(false);
    expect(coachProInternals.shouldRunArchive("user-b", now)).toBe(false);
  });
});

describe("tryArchiveNotebook", () => {
  it("calls archiveOldEntries when throttle allows", async () => {
    const { tryArchiveNotebook } = await import("../coach-pro-chat");
    // Clear the in-memory throttle state — tryArchiveNotebook uses "open:" prefix
    coachProInternals.lastArchivedAt.delete("open:user-archive-test");

    await tryArchiveNotebook("user-archive-test");

    expect(storage.archiveOldEntries).toHaveBeenCalledWith(
      "user-archive-test",
      30,
    );
  });

  it("does not call archiveOldEntries when throttle blocks", async () => {
    const { tryArchiveNotebook } = await import("../coach-pro-chat");
    // Set last archived to now so throttle blocks — tryArchiveNotebook uses "open:" prefix
    coachProInternals.lastArchivedAt.set("open:user-throttled", Date.now());

    vi.mocked(storage.archiveOldEntries).mockClear();
    await tryArchiveNotebook("user-throttled");

    expect(storage.archiveOldEntries).not.toHaveBeenCalled();
  });
});

describe("buildMealPatternSummary", () => {
  /**
   * Helper to create a DailyLog-like object with a specific hour in a given day.
   * `day` is a full ISO date string (YYYY-MM-DD), `hour` is 0–23 UTC — the
   * summary defaults to tz "UTC", keeping these tests machine-TZ independent.
   */
  function makeLog(day: string, hour: number) {
    const d = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
    return { loggedAt: d };
  }

  it("returns null for empty logs", () => {
    expect(buildMealPatternSummary([])).toBeNull();
  });

  it("derives meal windows in the user's timezone, not server-local", () => {
    // 15:00 UTC = 08:00 in Los Angeles (PDT). Three active days.
    const logs = [
      makeLog("2026-04-25", 15),
      makeLog("2026-04-26", 15),
      makeLog("2026-04-27", 15),
    ];
    // On a UTC clock 15:00 is the dinner window — breakfast reads as skipped.
    expect(buildMealPatternSummary(logs, "UTC")).toContain("breakfast skipped");
    // On the user's LA clock the same instants are 8 AM breakfasts.
    expect(buildMealPatternSummary(logs, "America/Los_Angeles")).not.toContain(
      "breakfast skipped",
    );
  });

  it("returns null when fewer than 3 active-logging days", () => {
    const logs = [
      makeLog("2026-04-27", 8), // day 1
      makeLog("2026-04-28", 12), // day 2
    ];
    expect(buildMealPatternSummary(logs)).toBeNull();
  });

  it("returns null when no notable patterns detected", () => {
    // 4 days, all three meals logged each day
    const logs = [
      makeLog("2026-04-25", 8),
      makeLog("2026-04-25", 12),
      makeLog("2026-04-25", 18),
      makeLog("2026-04-26", 8),
      makeLog("2026-04-26", 13),
      makeLog("2026-04-26", 19),
      makeLog("2026-04-27", 9),
      makeLog("2026-04-27", 12),
      makeLog("2026-04-27", 17),
      makeLog("2026-04-28", 8),
      makeLog("2026-04-28", 11),
      makeLog("2026-04-28", 20),
    ];
    expect(buildMealPatternSummary(logs)).toBeNull();
  });

  it("surfaces a consistent-logging streak as a positive pattern", () => {
    // 7 of 7 window days with all meal windows hit — previously null; the
    // summary only ever scolded. Reinforcement is free signal.
    const days = [
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
    ];
    const logs = days.flatMap((day) => [
      makeLog(day, 8),
      makeLog(day, 12),
      makeLog(day, 18),
    ]);

    const summary = buildMealPatternSummary(logs);
    expect(summary).toContain("logged food on 7/7 days");
    expect(summary).not.toContain("skipped");
  });

  it("combines the logging streak with skip negatives", () => {
    // 6 active days, breakfast only — streak positive (6 >= 7-2) plus skips.
    const days = [
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
    ];
    const logs = days.map((day) => makeLog(day, 8));

    const summary = buildMealPatternSummary(logs);
    expect(summary).toContain("logged food on 6/7 days");
    expect(summary).toContain("lunch skipped 6/6 days");
  });

  it("clamps the streak numerator to the window (a rolling instant window spans 8 calendar days)", () => {
    // The caller fetches [now-7d, now) — raw instants, which cover parts of
    // EIGHT calendar dates in any timezone unless "now" is exactly midnight.
    // A consistent logger hits all 8, and the prompt must never read
    // "logged food on 8/7 days" (review finding).
    const days = [
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
      "2026-04-29",
    ];
    const logs = days.flatMap((day) => [
      makeLog(day, 8),
      makeLog(day, 12),
      makeLog(day, 18),
    ]);

    const summary = buildMealPatternSummary(logs);
    expect(summary).toContain("logged food on 7/7 days");
    expect(summary).not.toContain("8/7");
  });

  it("does not emit the streak below windowDays - 2 active days", () => {
    // 4 full days (< 5): no streak, and full-window days mean no skips → null.
    const days = ["2026-04-25", "2026-04-26", "2026-04-27", "2026-04-28"];
    const logs = days.flatMap((day) => [
      makeLog(day, 8),
      makeLog(day, 12),
      makeLog(day, 18),
    ]);

    expect(buildMealPatternSummary(logs)).toBeNull();
  });

  it("detects breakfast skipped on majority of days", () => {
    // 4 days — breakfast (5-10) logged only on day 1
    const logs = [
      makeLog("2026-04-25", 8), // breakfast
      makeLog("2026-04-25", 18),
      makeLog("2026-04-26", 12), // no breakfast
      makeLog("2026-04-26", 18),
      makeLog("2026-04-27", 13), // no breakfast
      makeLog("2026-04-27", 19),
      makeLog("2026-04-28", 12), // no breakfast
      makeLog("2026-04-28", 20),
    ];
    const result = buildMealPatternSummary(logs);
    expect(result).toContain("breakfast skipped 3/4 days");
  });

  it("detects late-night eating on majority of days", () => {
    // 3 days, late-night logs on all 3
    const logs = [
      makeLog("2026-04-26", 12),
      makeLog("2026-04-26", 22), // late night
      makeLog("2026-04-27", 13),
      makeLog("2026-04-27", 23), // late night
      makeLog("2026-04-28", 11),
      makeLog("2026-04-28", 21), // late night
    ];
    const result = buildMealPatternSummary(logs);
    expect(result).toContain("late-night eating on 3/3 days");
  });

  it("combines multiple detected patterns", () => {
    // 4 days: breakfast skipped + late-night on majority
    const logs = [
      makeLog("2026-04-25", 12),
      makeLog("2026-04-25", 22),
      makeLog("2026-04-26", 13),
      makeLog("2026-04-26", 23),
      makeLog("2026-04-27", 14),
      makeLog("2026-04-27", 21),
      makeLog("2026-04-28", 8), // breakfast only day
      makeLog("2026-04-28", 18),
    ];
    const result = buildMealPatternSummary(logs);
    expect(result).toContain("breakfast skipped");
    expect(result).toContain("late-night eating");
  });

  it("does not count lunch as skipped when it is logged in the window", () => {
    // 4 days, lunch always logged at 11am
    const logs = [
      makeLog("2026-04-25", 11),
      makeLog("2026-04-26", 11),
      makeLog("2026-04-27", 11),
      makeLog("2026-04-28", 11),
    ];
    const result = buildMealPatternSummary(logs);
    // Lunch is NOT skipped — breakfast and dinner might be
    expect(result).not.toContain("lunch skipped");
  });
});

describe("getSystemPromptTemplateVersion (real implementation)", () => {
  it("returns a stable 16-char hex string", async () => {
    // Use the real module, not the mocked one
    const { getSystemPromptTemplateVersion } =
      await vi.importActual<typeof import("../nutrition-coach")>(
        "../nutrition-coach",
      );
    const v1 = getSystemPromptTemplateVersion();
    const v2 = getSystemPromptTemplateVersion();
    expect(v1).toMatch(/^[0-9a-f]{16}$/);
    expect(v1).toBe(v2);
  });
});

describe("handleCoachChat — recipe finder (Coach Pro, flag on)", () => {
  const FLOW = "11111111-1111-4111-8111-111111111111";
  const finder = {
    userMessageId: 77,
    features: {
      catalogSave: true,
      recipeGeneration: true,
      dailyRecipeGenerations: 20,
    },
  };
  const item = {
    id: 12,
    source: "community" as const,
    title: "Chicken Tray Bake",
    imageUrl: null,
    readyInMinutes: null,
    calories: 480,
  };
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
  const listBlock: RecipeResultsBlock = {
    type: "recipe_results",
    source: "community",
    items: [item],
    actions: ["search_online", "generate", "none_of_these"],
    notice: null,
    flow: {
      flowId: FLOW,
      stage: "results",
      request: "chicken",
      query: { q: "chicken" },
      round: 0,
      shownIds: ["community:12"],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultStorage();
    vi.stubEnv("SPOONACULAR_API_KEY", "k");
    vi.mocked(findCommunity).mockResolvedValue([item]);
    vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    vi.mocked(generateRecipeChatResponse).mockImplementation(
      async function* () {
        yield { content: "Here's a curry!\n```json\n{}\n```" };
        yield { content: "", recipe, allergenWarning: null };
        yield { content: "", imageUrl: "https://img/curry.png" };
        yield { done: true };
      },
    );
    vi.mocked(generateCoachProResponse).mockReturnValue(
      fakeProStream(["coach reply"]),
    );
    vi.mocked(parseBlocksFromContent).mockReturnValue({
      text: "coach reply",
      blocks: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("routes a recipe_request to the finder and persists a recipe_results block", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "user",
        content: "Find me a chicken recipe",
      }),
    ]);
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Find me a chicken recipe",
          finder,
          turnKey: "11111111-2222-4333-8444-555555555555",
        }),
      ),
    );
    expect(events[0]).toEqual({
      type: "status",
      label: "Searching community recipes…",
    });
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ type: "recipe_results" }],
    });
    expect(events.some((e) => e.type === "content")).toBe(false);
    expect(generateCoachProResponse).not.toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      expect.stringMatching(/^Here are 1 community recipe:/),
      { blocks: [expect.objectContaining({ type: "recipe_results" })] },
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("flag off (no finder param): a recipe_request keeps its legacy prompt intent", async () => {
    await collectEvents(handleCoachChat(makeParams({ content: "meal ideas" })));
    // 6th arg of generateCoachProResponse is the intent.
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][5]).toBe(
      "vague_request",
    );
  });

  it("free Coach never enters the finder (D7)", async () => {
    vi.mocked(generateCoachResponse).mockReturnValue(
      fakeStream(["free reply"]),
    );
    await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Find me a chicken recipe",
          isCoachPro: false,
          finder,
        }),
      ),
    );
    expect(findCommunity).not.toHaveBeenCalled();
    expect(generateCoachResponse).toHaveBeenCalled();
  });

  it("safety_refusal never enters the finder, even mid-flow", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({
        role: "user",
        content: "I have diabetes, what should I eat?",
      }),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({ content: "I have diabetes, what should I eat?", finder }),
      ),
    );
    expect(findCommunity).not.toHaveBeenCalled();
    expect(generateCoachProResponse).toHaveBeenCalled();
  });

  it("Generate action generates a card with TOP-LEVEL recipe metadata (save-recipe works — R5)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({ id: 77, role: "user", content: "Generate" }),
    ]);
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Generate",
          finder: { ...finder, action: { type: "generate", flowId: FLOW } },
        }),
      ),
    );
    expect(storage.claimRecipeGeneration).toHaveBeenCalledWith(
      "user-42",
      77,
      20,
    );
    expect(vi.mocked(generateRecipeChatResponse).mock.calls[0][0]).toEqual([
      { role: "user", content: "Create a recipe for: chicken" },
    ]);
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      "Here's a curry!",
      {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: "https://img/curry.png",
      },
      undefined,
    );
    expect(events.at(-1)).toEqual({
      type: "content",
      content: "Here's a curry!",
    });
  });

  it("a claimed Generate finishes and persists even after the client left (#1151 — no paid work lost, no refund)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({ id: 77, role: "user", content: "Generate" }),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Generate",
          turnKey: "11111111-2222-4333-8444-555555555555",
          isAborted: () => true,
          finder: { ...finder, action: { type: "generate", flowId: FLOW } },
        }),
      ),
    );
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      "Here's a curry!",
      expect.objectContaining({ recipe }),
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("a round-1 fall-through Generate is never abandoned between its claim and its persist", async () => {
    const questionsBlock = {
      type: "recipe_questions" as const,
      questions: [{ question: "Spicy?", options: ["yes", "no"] }],
      flow: { ...listBlock.flow, stage: "clarifying" as const },
    };
    vi.mocked(findCommunity).mockResolvedValue([]);
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [questionsBlock] },
      }),
      createMockChatMessage({ id: 77, role: "user", content: "Spicy? yes" }),
    ]);
    const gen = handleCoachChat(
      makeParams({
        content: "Spicy? yes",
        finder: {
          ...finder,
          action: {
            type: "answers",
            flowId: FLOW,
            answers: [{ question: "Spicy?", answer: "yes" }],
          },
        },
      }),
    );
    // The route stops iterating (generator.return()) at the first yield after
    // the client leaves; model the worst case — it leaves right after the claim.
    for (let r = await gen.next(); !r.done; r = await gen.next()) {
      if (vi.mocked(storage.claimRecipeGeneration).mock.calls.length > 0) {
        await gen.return(undefined);
        break;
      }
    }
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      "Here's a curry!",
      expect.objectContaining({ recipe }),
      undefined,
    );
  });

  it("a finder list step persists its block even after the client left", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "user",
        content: "Find me a chicken recipe",
      }),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Find me a chicken recipe",
          turnKey: "11111111-2222-4333-8444-555555555555",
          isAborted: () => true,
          finder,
        }),
      ),
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      expect.stringMatching(/^Here are 1 community recipe:/),
      { blocks: [expect.objectContaining({ type: "recipe_results" })] },
      "11111111-2222-4333-8444-555555555555",
    );
  });

  it("the daily generation limit is enforced in Coach too", async () => {
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(false);
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: { blocks: [listBlock] },
      }),
      createMockChatMessage({ id: 77, role: "user", content: "Generate" }),
    ]);
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Generate",
          finder: { ...finder, action: { type: "generate", flowId: FLOW } },
        }),
      ),
    );
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ notice: "generate_limit" }],
    });
  });

  it("after a generated card, refine_current regenerates the card (and claims a generation)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        content: "Here!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
      createMockChatMessage({
        id: 77,
        role: "user",
        content: "make it spicier",
      }),
    ]);
    vi.mocked(classifyTurn).mockResolvedValue("refine_current");
    const events = await collectEvents(
      handleCoachChat(makeParams({ content: "make it spicier", finder })),
    );
    expect(events[0]).toEqual({
      type: "status",
      label: "Updating your recipe…",
    });
    expect(storage.claimRecipeGeneration).toHaveBeenCalled();
    expect(
      vi.mocked(generateRecipeChatResponse).mock.calls[0][0].at(-1),
    ).toEqual({ role: "user", content: "make it spicier" });
  });

  it("after a generated card, 'other' gets a normal coach reply", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({
        role: "assistant",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
      createMockChatMessage({ role: "user", content: "thanks!" }),
    ]);
    vi.mocked(classifyTurn).mockResolvedValue("other");
    await collectEvents(
      handleCoachChat(makeParams({ content: "thanks!", finder })),
    );
    expect(generateCoachProResponse).toHaveBeenCalled();
    expect(generateRecipeChatResponse).not.toHaveBeenCalled();
  });
});

describe("handleCoachChat — recipe offer (Coach Pro, RECIPE_OFFER_ENABLED on)", () => {
  const TURN = "22222222-2222-4222-8222-222222222222";
  const OFFER_FLOW = "33333333-3333-4333-8333-333333333333";
  const finder = {
    userMessageId: 77,
    features: {
      catalogSave: true,
      recipeGeneration: true,
      dailyRecipeGenerations: 20,
    },
  };
  const offerFlow = {
    flowId: OFFER_FLOW,
    stage: "offer" as const,
    request: "Chili",
    query: { q: "Chili" },
    round: 0 as const,
    shownIds: [],
    dish: "Chili",
    details: { ingredients: [], fromConversation: false },
  };
  const offerBlock: FinderBlock = { type: "recipe_offer", flow: offerFlow };
  const adjustBlock: FinderBlock = {
    type: "recipe_adjust",
    prefill: { servings: 4, spice: "medium", time: "moderate" },
    avoiding: [],
    noted: { dislikes: [] },
    followUps: [],
    flow: { ...offerFlow, stage: "adjust" },
  };
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
  const userRow = (content: string) =>
    createMockChatMessage({ id: 77, role: "user", content });
  const assistantWith = (block: FinderBlock) =>
    createMockChatMessage({
      id: 2,
      role: "assistant",
      content: "Want a recipe?",
      metadata: { blocks: [block] },
    });
  /** The generator makes ONLY the terminal offer_recipe call. */
  function toolOnly(args: unknown, lead?: string) {
    vi.mocked(generateCoachProResponse).mockImplementation(async function* () {
      if (lead) yield { type: "content" as const, content: lead };
      yield {
        type: "terminal_tool" as const,
        name: "offer_recipe" as const,
        args: JSON.stringify(args),
      };
    });
  }
  const assistantWrites = () =>
    vi
      .mocked(storage.createChatMessage)
      .mock.calls.filter((c) => c[2] === "assistant");

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultStorage();
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    vi.stubEnv("RECIPE_OFFER_ENABLED", "true");
    vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
    vi.mocked(storage.claimRecipeGeneration).mockResolvedValue(true);
    vi.mocked(parseBlocksFromContent).mockImplementation((t: string) => ({
      text: t,
      blocks: [],
    }));
    vi.mocked(generateCoachProResponse).mockReturnValue(
      fakeProStream(["coach reply"]),
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("passes offerRecipe: true to the generator", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([userRow("hi")]);
    await collectEvents(
      handleCoachChat(makeParams({ content: "hi", finder, turnKey: TURN })),
    );
    // 8th arg (index 7) of generateCoachProResponse is the options bag.
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toEqual({
      offerRecipe: true,
    });
  });

  it("free Coach with both flags on: no Pro generator, and the free generator gets no offerRecipe", async () => {
    vi.mocked(generateCoachResponse).mockReturnValue(
      fakeStream(["free reply"]),
    );
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      userRow("chili recipe please"),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({
          content: "chili recipe please",
          isCoachPro: false,
          finder,
          turnKey: TURN,
        }),
      ),
    );
    expect(generateCoachProResponse).not.toHaveBeenCalled();
    expect(generateCoachResponse).toHaveBeenCalledTimes(1);
    const args = vi.mocked(generateCoachResponse).mock.calls[0] as unknown[];
    expect(
      args.some(
        (a) => typeof a === "object" && a !== null && "offerRecipe" in a,
      ),
    ).toBe(false);
    expect(runCoachFinderTurn).not.toHaveBeenCalled();
  });

  it("flag off: passes offerRecipe: false", async () => {
    vi.stubEnv("RECIPE_OFFER_ENABLED", "");
    vi.mocked(storage.getChatMessages).mockResolvedValue([userRow("hi")]);
    await collectEvents(
      handleCoachChat(makeParams({ content: "hi", finder, turnKey: TURN })),
    );
    expect(vi.mocked(generateCoachProResponse).mock.calls[0][7]).toEqual({
      offerRecipe: false,
    });
  });

  it("saves the offer (with the turnKey) BEFORE yielding the blocks event", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      userRow("chili recipe please"),
    ]);
    toolOnly({ dish: "Chili", from_conversation: false });
    const order: string[] = [];
    vi.mocked(storage.createChatMessage).mockImplementation(async () => {
      order.push("save");
      return createMockChatMessage();
    });
    const events: CoachChatEvent[] = [];
    for await (const e of handleCoachChat(
      makeParams({ content: "chili recipe please", finder, turnKey: TURN }),
    )) {
      order.push(`yield:${e.type}`);
      events.push(e);
    }
    expect(order).toEqual(["save", "yield:blocks"]);
    expect(storage.getChatMessageByTurnKey).toHaveBeenCalledWith(1, TURN);
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      OFFER_TEXT,
      {
        blocks: [
          expect.objectContaining({
            type: "recipe_offer",
            flow: expect.objectContaining({ dish: "Chili", stage: "offer" }),
          }),
        ],
      },
      TURN,
    );
    expect(events).toEqual([
      {
        type: "blocks",
        blocks: [expect.objectContaining({ type: "recipe_offer" })],
      },
    ]);
    // First message of the conversation → auto-titled like any reply.
    expect(storage.updateChatConversationTitle).toHaveBeenCalled();
  });

  it("keeps streamed pre-tool text as the offer message's lead line", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([userRow("chili?")]);
    toolOnly({ dish: "Chili", from_conversation: true }, "Good choice!");
    await collectEvents(
      handleCoachChat(makeParams({ content: "chili?", finder, turnKey: TURN })),
    );
    expect(assistantWrites()).toHaveLength(1);
    expect(assistantWrites()[0][3]).toBe(`Good choice!\n\n${OFFER_TEXT}`);
  });

  it("does not double-write when the turnKey row already exists", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([userRow("chili")]);
    vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(
      createMockChatMessage({ role: "assistant", turnKey: TURN }),
    );
    toolOnly({ dish: "Chili", from_conversation: false });
    await collectEvents(
      handleCoachChat(makeParams({ content: "chili", finder, turnKey: TURN })),
    );
    expect(assistantWrites()).toHaveLength(0);
  });

  it("repeat = yes: same dish while the offer is open → runCoachFinderTurn with offer_yes for that flow (adjust card)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({ id: 1, role: "user", content: "chili" }),
      assistantWith(offerBlock),
      userRow("sounds good, let's do the chili"),
    ]);
    toolOnly({ dish: "chili", from_conversation: true });
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "sounds good, let's do the chili",
          finder,
          turnKey: TURN,
        }),
      ),
    );
    expect(runCoachFinderTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessageId: 77,
        turnKey: TURN,
        entry: {
          kind: "finder",
          input: {
            kind: "action",
            action: { type: "offer_yes", flowId: OFFER_FLOW },
          },
          offer: true,
        },
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ type: "recipe_adjust" }],
    });
    expect(storage.claimRecipeGeneration).not.toHaveBeenCalled();
    expect(storage.deleteChatMessage).not.toHaveBeenCalled();
  });

  it("after No (closed offer), the same dish gets a fresh offer, not the card", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({ id: 1, role: "user", content: "chili" }),
      assistantWith(offerBlock),
      createMockChatMessage({ id: 3, role: "user", content: "No" }),
      createMockChatMessage({
        id: 4,
        role: "assistant",
        content: "No problem.",
        metadata: null,
      }),
      userRow("actually, chili after all"),
    ]);
    toolOnly({ dish: "Chili", from_conversation: true });
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "actually, chili after all",
          finder,
          turnKey: TURN,
        }),
      ),
    );
    expect(runCoachFinderTurn).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "blocks",
      blocks: [{ type: "recipe_offer" }],
    });
    const saved = assistantWrites()[0][4] as { blocks: FinderBlock[] };
    expect(saved.blocks[0].flow.flowId).not.toBe(OFFER_FLOW);
  });

  it("same dish while the card is live → re-posts the card under a new flowId (save first)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      createMockChatMessage({ id: 1, role: "user", content: "chili" }),
      assistantWith(adjustBlock),
      userRow("so the chili then"),
    ]);
    toolOnly({ dish: "Chili", from_conversation: true });
    const order: string[] = [];
    vi.mocked(storage.createChatMessage).mockImplementation(async () => {
      order.push("save");
      return createMockChatMessage();
    });
    const events: CoachChatEvent[] = [];
    for await (const e of handleCoachChat(
      makeParams({ content: "so the chili then", finder, turnKey: TURN }),
    )) {
      order.push(`yield:${e.type}`);
      events.push(e);
    }
    expect(order).toEqual(["save", "yield:blocks"]);
    const saved = vi.mocked(storage.createChatMessage).mock.calls[0];
    const block = (saved[4] as { blocks: FinderBlock[] }).blocks[0];
    expect(block.type).toBe("recipe_adjust");
    expect(block.flow.flowId).not.toBe(OFFER_FLOW);
    expect(block).toMatchObject({ prefill: adjustBlock.prefill });
    expect(saved[5]).toBe(TURN);
    expect(runCoachFinderTurn).not.toHaveBeenCalled();
  });

  it("invalid tool args and no text → saves and yields 'Which dish did you have in mind?'", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      userRow("turn that into a recipe"),
    ]);
    toolOnly({ dish: "", from_conversation: true });
    const events = await collectEvents(
      handleCoachChat(
        makeParams({
          content: "turn that into a recipe",
          finder,
          turnKey: TURN,
        }),
      ),
    );
    expect(storage.createChatMessage).toHaveBeenCalledWith(
      1,
      "user-42",
      "assistant",
      "Which dish did you have in mind?",
      null,
      TURN,
    );
    expect(events).toEqual([
      { type: "content", content: "Which dish did you have in mind?" },
    ]);
  });

  it("invalid tool args after streamed text → the streamed text stands (normal save)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([userRow("that")]);
    toolOnly("not json at all", "Which recipe did you mean?");
    await collectEvents(
      handleCoachChat(makeParams({ content: "that", finder, turnKey: TURN })),
    );
    expect(assistantWrites()).toHaveLength(1);
    expect(assistantWrites()[0][3]).toBe("Which recipe did you mean?");
    expect(assistantWrites()[0][4]).toBeNull();
  });

  it("typed free text on a live offer goes to the tool loop (H2)", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      assistantWith(offerBlock),
      userRow("make it for 6 instead"),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({ content: "make it for 6 instead", finder, turnKey: TURN }),
      ),
    );
    expect(generateCoachProResponse).toHaveBeenCalled();
    expect(runCoachFinderTurn).not.toHaveBeenCalled();
  });

  it("a recipe_request with no live block goes to the tool loop, not the regex route", async () => {
    vi.mocked(storage.getChatMessages).mockResolvedValue([
      userRow("Find me a chicken recipe"),
    ]);
    await collectEvents(
      handleCoachChat(
        makeParams({
          content: "Find me a chicken recipe",
          finder,
          turnKey: TURN,
        }),
      ),
    );
    expect(generateCoachProResponse).toHaveBeenCalled();
    expect(runCoachFinderTurn).not.toHaveBeenCalled();
  });

  describe("a recipe card is the latest message", () => {
    const cardHistory = () => [
      createMockChatMessage({
        role: "assistant",
        content: "Here!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
      userRow("now a dessert"),
    ];
    it("classifyTurn new_request → tool loop (the model decides)", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue(cardHistory());
      vi.mocked(classifyTurn).mockResolvedValue("new_request");
      await collectEvents(
        handleCoachChat(makeParams({ content: "now a dessert", finder })),
      );
      expect(generateCoachProResponse).toHaveBeenCalled();
      expect(runCoachFinderTurn).not.toHaveBeenCalled();
    });
    it("classifyTurn refine_current → runCoachFinderTurn with refine", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue(cardHistory());
      vi.mocked(classifyTurn).mockResolvedValue("refine_current");
      vi.mocked(generateRecipeChatResponse).mockImplementation(
        async function* () {
          yield { content: "Spicier!" };
          yield { done: true };
        },
      );
      await collectEvents(
        handleCoachChat(makeParams({ content: "spicier", finder })),
      );
      expect(runCoachFinderTurn).toHaveBeenCalledWith(
        expect.objectContaining({ entry: { kind: "refine" } }),
      );
      expect(generateCoachProResponse).not.toHaveBeenCalled();
    });
  });

  describe("finder taps thread the offer option", () => {
    it("an offer_yes tap reaches build_adjust (not invalid_for_stage)", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        assistantWith(offerBlock),
        userRow("Yes"),
      ]);
      const events = await collectEvents(
        handleCoachChat(
          makeParams({
            content: "Yes",
            turnKey: TURN,
            finder: {
              ...finder,
              action: { type: "offer_yes", flowId: OFFER_FLOW },
            },
          }),
        ),
      );
      expect(events.at(-1)).toMatchObject({
        type: "blocks",
        blocks: [{ type: "recipe_adjust" }],
      });
      expect(storage.deleteChatMessage).not.toHaveBeenCalled();
      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "user-42",
        "assistant",
        expect.any(String),
        { blocks: [expect.objectContaining({ type: "recipe_adjust" })] },
        TURN,
      );
    });

    it('an offer_no tap persists "No problem." with no metadata and keeps the user row', async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        assistantWith(offerBlock),
        userRow("No"),
      ]);
      const events = await collectEvents(
        handleCoachChat(
          makeParams({
            content: "No",
            turnKey: TURN,
            finder: {
              ...finder,
              action: { type: "offer_no", flowId: OFFER_FLOW },
            },
          }),
        ),
      );
      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "user-42",
        "assistant",
        "No problem.",
        null,
        TURN,
      );
      expect(events).toEqual([{ type: "content", content: "No problem." }]);
      expect(storage.deleteChatMessage).not.toHaveBeenCalled();
    });

    it("an adjust_generate tap generates with extended allergen detail", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        assistantWith(adjustBlock),
        userRow("Generate"),
      ]);
      vi.mocked(generateRecipeChatResponse).mockImplementation(
        async function* () {
          yield { content: "Here you go" };
          yield { content: "", recipe, allergenWarning: null };
          yield { done: true };
        },
      );
      await collectEvents(
        handleCoachChat(
          makeParams({
            content: "Generate",
            turnKey: TURN,
            finder: {
              ...finder,
              action: {
                type: "adjust_generate",
                flowId: OFFER_FLOW,
                settings: adjustBlock.prefill,
              },
            },
          }),
        ),
      );
      expect(storage.claimRecipeGeneration).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(generateRecipeChatResponse).mock.calls[0][3],
      ).toMatchObject({ allergenDetail: "extended" });
    });

    it("typed 'yes please' on a live offer stays in the finder → adjust card", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        assistantWith(offerBlock),
        userRow("yes please"),
      ]);
      const events = await collectEvents(
        handleCoachChat(
          makeParams({ content: "yes please", finder, turnKey: TURN }),
        ),
      );
      expect(generateCoachProResponse).not.toHaveBeenCalled();
      expect(events.at(-1)).toMatchObject({
        type: "blocks",
        blocks: [{ type: "recipe_adjust" }],
      });
    });
  });
});
