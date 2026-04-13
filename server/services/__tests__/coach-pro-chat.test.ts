import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoachChatEvent, CoachChatParams } from "../coach-pro-chat";

// ── Imports (after mocks) ───────────────────────────────────

import { handleCoachChat } from "../coach-pro-chat";
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
}));

vi.mock("../coach-blocks", () => ({
  parseBlocksFromContent: vi.fn().mockReturnValue({ text: "", blocks: [] }),
  BLOCKS_SYSTEM_PROMPT: "[BLOCKS_SYSTEM_PROMPT]",
}));

vi.mock("../notebook-extraction", () => ({
  extractNotebookEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeContextField: vi.fn((text: string) => text),
}));

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

/** Set up default storage mock return values. */
function setupDefaultStorage() {
  vi.mocked(storage.getUserProfile).mockResolvedValue({
    dietType: "balanced",
    allergies: [{ name: "peanuts" }],
    foodDislikes: ["olives"],
  } as any);
  vi.mocked(storage.getDailySummary).mockResolvedValue({
    totalCalories: "800",
    totalProtein: "40",
    totalCarbs: "100",
    totalFat: "30",
  } as any);
  vi.mocked(storage.getWeightLogs).mockResolvedValue([
    { weight: "75.0", loggedAt: new Date() },
  ] as any);
  vi.mocked(storage.getChatMessages).mockResolvedValue([]);
  vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
  vi.mocked(storage.getCoachCachedResponse).mockResolvedValue(null);
  vi.mocked(storage.createChatMessage).mockResolvedValue(undefined as any);
  vi.mocked(storage.updateChatConversationTitle).mockResolvedValue(
    undefined as any,
  );
  vi.mocked(storage.createNotebookEntries).mockResolvedValue(undefined as any);
  vi.mocked(storage.archiveOldEntries).mockResolvedValue(undefined as any);
  vi.mocked(storage.setCoachCachedResponse).mockResolvedValue(undefined as any);
}

// ── Tests ───────────────────────────────────────────────────

describe("handleCoachChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  // ── Cache key includes userId (regression for aa6dcc2) ────

  describe("cache key regression (userId in hash)", () => {
    it("includes userId in the cache hash for cacheable questions", async () => {
      // Cacheable: no screenContext, history.length <= 1
      vi.mocked(storage.getChatMessages).mockResolvedValue([]);
      vi.mocked(storage.getCoachCachedResponse).mockResolvedValue(null);

      const params = makeParams({
        userId: "user-42",
        content: "Hello",
        screenContext: undefined,
      });

      await collectEvents(handleCoachChat(params));

      // The cache lookup should have been called with a hash that encodes userId
      expect(storage.getCoachCachedResponse).toHaveBeenCalledTimes(1);
      const hash = vi.mocked(storage.getCoachCachedResponse).mock.calls[0][0];

      // Now run with a DIFFERENT userId but same content — hash must differ
      vi.clearAllMocks();
      setupDefaultStorage();
      vi.mocked(generateCoachProResponse).mockReturnValue(fakeStream(["Hi"]));
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Hi",
        blocks: [],
      });

      const params2 = makeParams({
        userId: "user-99",
        content: "Hello",
        screenContext: undefined,
      });

      await collectEvents(handleCoachChat(params2));

      expect(storage.getCoachCachedResponse).toHaveBeenCalledTimes(1);
      const hash2 = vi.mocked(storage.getCoachCachedResponse).mock.calls[0][0];

      expect(hash).not.toBe(hash2);
    });

    it("does not cache when screenContext is provided", async () => {
      const params = makeParams({
        screenContext: "Viewing home screen",
      });

      await collectEvents(handleCoachChat(params));

      expect(storage.getCoachCachedResponse).not.toHaveBeenCalled();
    });

    it("does not cache when history has more than 1 message", async () => {
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        { role: "user", content: "First" },
        { role: "assistant", content: "Reply" },
      ] as any);

      const params = makeParams({ screenContext: undefined });

      await collectEvents(handleCoachChat(params));

      expect(storage.getCoachCachedResponse).not.toHaveBeenCalled();
    });
  });

  // ── Warm-up consumption ───────────────────────────────────

  describe("warm-up consumption", () => {
    it("consumes warm-up when warmUpId is provided and isCoachPro", async () => {
      const warmedMessages = [
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

      expect(consumeWarmUp).toHaveBeenCalledWith("user-42", "warm-123");
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
        { role: "user", content: "Old message" },
      ] as any);

      const params = makeParams({
        warmUpId: "expired-warm",
        isCoachPro: true,
      });

      await collectEvents(handleCoachChat(params));

      expect(consumeWarmUp).toHaveBeenCalledWith("user-42", "expired-warm");
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
        { type: "preference", content: "User likes salads" },
        { type: "goal", content: "Lose 5kg by summer" },
      ] as any);

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
      const mockBlocks = [{ type: "meal_plan", data: { title: "Lunch plan" } }];
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeStream(["Here is your plan."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Here is your plan.",
        blocks: mockBlocks as any,
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
        isCoachPro: true,
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
        { role: "user", content: "First" },
        { role: "assistant", content: "Reply" },
      ] as any);

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
        "assistant",
        "Test response",
        null,
      );
    });

    it("persists blocks metadata when blocks are present", async () => {
      const mockBlocks = [{ type: "meal_plan", data: { title: "Lunch" } }];
      vi.mocked(generateCoachProResponse).mockReturnValue(
        fakeStream(["Plan here."]),
      );
      vi.mocked(parseBlocksFromContent).mockReturnValue({
        text: "Plan here.",
        blocks: mockBlocks as any,
      });

      const params = makeParams({ isCoachPro: true });

      await collectEvents(handleCoachChat(params));

      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
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
  });
});
