import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoachChatEvent, CoachChatParams } from "../coach-pro-chat";
import type { CoachNotebookEntry, UserProfile } from "@shared/schema";
import {
  createMockUserProfile,
  createMockWeightLog,
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
import { parseBlocksFromContent } from "../coach-blocks";
import { consumeWarmUp } from "../coach-warm-up";
import { fireAndForget } from "../../lib/fire-and-forget";

// ── Mocks ───────────────────────────────────────────────────

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getWeightLogs: vi.fn(),
    getChatMessages: vi.fn(),
    getDailyLogsInRange: vi.fn(),
    getActiveNotebookEntries: vi.fn(),
    getCoachCachedResponse: vi.fn(),
    setCoachCachedResponse: vi.fn(),
    createChatMessage: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    createNotebookEntries: vi.fn(),
    archiveOldEntries: vi.fn(),
  },
}));

vi.mock("../nutrition-coach", () => ({
  generateCoachProResponse: vi.fn(),
  generateCoachResponse: vi.fn(),
  getSystemPromptTemplateVersion: vi.fn().mockReturnValue("test-version-hash"),
}));

vi.mock("../coach-blocks", () => ({
  parseBlocksFromContent: vi.fn().mockReturnValue({ text: "", blocks: [] }),
  BLOCKS_SYSTEM_PROMPT: "[BLOCKS_SYSTEM_PROMPT]",
}));

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
  vi.mocked(storage.getWeightLogs).mockResolvedValue([
    createMockWeightLog({ weight: "75.0" }),
  ]);
  vi.mocked(storage.getChatMessages).mockResolvedValue([]);
  vi.mocked(storage.getDailyLogsInRange).mockResolvedValue([]);
  vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
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
      fakeStream(["Hello ", "world!"]),
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
          weightTrend: { currentWeight: 75, weeklyRate: -0.5 },
          dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
        },
        morning,
      );
      const updatedHash = hashCoachCacheContext(
        {
          goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
          todayIntake: { calories: 1200, protein: 80, carbs: 130, fat: 45 },
          weightTrend: { currentWeight: 75, weeklyRate: -0.5 },
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
  });

  // ── Notebook injection into context ───────────────────────

  describe("notebook injection", () => {
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
      expect(passedContext.notebookSummary).toContain("[BLOCKS_SYSTEM_PROMPT]");
    });

    it("sets only BLOCKS_SYSTEM_PROMPT when notebook entries are empty (CoachPro)", async () => {
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      const passedContext = vi.mocked(generateCoachProResponse).mock
        .calls[0][1];
      expect(passedContext.notebookSummary).toBe("[BLOCKS_SYSTEM_PROMPT]");
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
        fakeStream(["Hello ", "world!"]),
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
      const mockBlocks: CoachBlock[] = [
        {
          type: "meal_plan",
          data: { title: "Lunch plan" },
        } as unknown as CoachBlock,
      ];
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeStream(["Here is your plan."]),
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
        fakeStream(["No blocks here."]),
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
        fakeStream(["Advice here."]),
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
      vi.mocked(generateCoachProResponse).mockReturnValue(fakeStream([]));
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
  });

  // ── Message persistence ───────────────────────────────────

  describe("message persistence", () => {
    it("persists assistant message after response", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeStream(["Test response"]),
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
      const mockBlocks: CoachBlock[] = [
        {
          type: "meal_plan",
          data: { title: "Lunch" },
        } as unknown as CoachBlock,
      ];
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeStream(["Plan here."]),
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
      vi.mocked(generateCoachProResponse).mockReturnValue(fakeStream([]));

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.createChatMessage).not.toHaveBeenCalled();
    });

    it("does not persist partial assistant message after abort", async () => {
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeStream(["Partial response"]),
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
});

// ── Pure helpers extracted from handleCoachChat (L19) ───────

describe("hashCoachCacheKey", () => {
  it("produces deterministic 32-char hex for the same input", () => {
    const a = hashCoachCacheKey("user-1", "what should I eat?", false);
    const b = hashCoachCacheKey("user-1", "what should I eat?", false);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces different keys for different users with the same content", () => {
    const a = hashCoachCacheKey("user-1", "hello", false);
    const b = hashCoachCacheKey("user-2", "hello", false);
    expect(a).not.toBe(b);
  });

  it("normalizes whitespace and case", () => {
    const a = hashCoachCacheKey("user-1", "Hello World", false);
    const b = hashCoachCacheKey("user-1", "  hello world  ", false);
    expect(a).toBe(b);
  });

  it("scopes Pro and non-Pro under separate keys (H4 — 2026-04-18)", () => {
    const pro = hashCoachCacheKey("user-1", "hello", true);
    const free = hashCoachCacheKey("user-1", "hello", false);
    expect(pro).not.toBe(free);
  });

  it("buckets by UTC day so next-day intake/goals don't hit stale cache (H5 — 2026-04-18)", () => {
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
   * `day` is a full ISO date string (YYYY-MM-DD), `hour` is 0–23 local time.
   */
  function makeLog(day: string, hour: number) {
    const d = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`);
    return { loggedAt: d };
  }

  it("returns null for empty logs", () => {
    expect(buildMealPatternSummary([])).toBeNull();
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
