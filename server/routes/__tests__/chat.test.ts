import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { sendError } from "../../lib/api-errors";
import { requireAuth } from "../../middleware/auth";
import {
  generateCoachResponse,
  generateCoachProResponse,
} from "../../services/nutrition-coach";
import { register } from "../chat";
import {
  createMockChatConversation,
  createMockChatMessage,
  createMockCommunityRecipe,
  createMockUser,
  createMockWeightLog,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getChatConversations: vi.fn(),
    createChatConversation: vi.fn(),
    getChatConversation: vi.fn(),
    getChatMessages: vi.fn(),
    createChatMessage: vi.fn(),
    createChatMessageWithLimitCheck: vi.fn(),
    getDailyChatMessageCount: vi.fn(),
    getUser: vi.fn(),
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getWeightLogs: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    deleteChatConversation: vi.fn(),
    deleteChatMessage: vi.fn(),
    getCoachCachedResponse: vi.fn().mockResolvedValue(null),
    setCoachCachedResponse: vi.fn().mockResolvedValue(undefined),
    getCommunityRecipe: vi.fn(),
    getActiveNotebookEntries: vi.fn().mockResolvedValue([]),
    createNotebookEntries: vi.fn().mockResolvedValue([]),
    pinChatConversation: vi.fn(),
  },
}));

vi.mock("../../services/nutrition-coach", () => ({
  generateCoachResponse: vi.fn(),
  generateCoachProResponse: vi.fn(),
}));

vi.mock("../../services/coach-blocks", () => ({
  parseBlocksFromContent: vi
    .fn()
    .mockImplementation((content: string) => ({ text: content, blocks: [] })),
  BLOCKS_SYSTEM_PROMPT: "test prompt",
}));

vi.mock("../../services/notebook-extraction", () => ({
  extractNotebookEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/openai", () => ({
  isAiConfigured: true,
  openai: {},
  dalleClient: {},
  MODEL_FAST: "gpt-4o-mini",
  MODEL_HEAVY: "gpt-4o",
  OPENAI_TIMEOUT_MS: 30000,
  OPENAI_VISION_TIMEOUT_MS: 60000,
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Chat Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/chat/conversations", () => {
    it("returns conversations list", async () => {
      const mockConvos = [createMockChatConversation({ title: "Chat 1" })];
      vi.mocked(storage.getChatConversations).mockResolvedValue(mockConvos);
      const convos = JSON.parse(JSON.stringify(mockConvos));

      const res = await request(app)
        .get("/api/chat/conversations")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(convos);
    });
  });

  describe("POST /api/chat/conversations", () => {
    it("creates a new conversation", async () => {
      const convo = createMockChatConversation({ title: "New Chat" });
      vi.mocked(storage.createChatConversation).mockResolvedValue(convo);

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ title: "My Chat" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(1);
    });

    it("uses default title", async () => {
      const convo = createMockChatConversation({ title: "New Chat" });
      vi.mocked(storage.createChatConversation).mockResolvedValue(convo);

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(201);
      expect(storage.createChatConversation).toHaveBeenCalledWith(
        "1",
        "New Chat",
        "coach",
        null,
      );
    });

    it("creates remix conversation with sourceRecipeId and metadata", async () => {
      const sourceRecipe = createMockCommunityRecipe({
        id: 42,
        title: "Original Pasta",
        authorId: "1",
        isPublic: true,
      });
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(sourceRecipe);
      const convo = createMockChatConversation({
        type: "remix",
        title: "Remix: Original Pasta",
        metadata: {
          sourceRecipeId: 42,
          sourceRecipeTitle: "Original Pasta",
        },
      });
      vi.mocked(storage.createChatConversation).mockResolvedValue(convo);
      vi.mocked(storage.createChatMessage).mockResolvedValue(
        createMockChatMessage(),
      );

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ type: "remix", sourceRecipeId: 42 });

      expect(res.status).toBe(201);
      expect(storage.createChatConversation).toHaveBeenCalledWith(
        "1",
        "Remix: Original Pasta",
        "remix",
        { sourceRecipeId: 42, sourceRecipeTitle: "Original Pasta" },
      );
    });

    it("returns 400 for remix without sourceRecipeId", async () => {
      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ type: "remix" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("sourceRecipeId");
    });

    it("returns 404 for remix with non-existent recipe", async () => {
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ type: "remix", sourceRecipeId: 999 });

      expect(res.status).toBe(404);
    });

    it("returns 404 for remix with private recipe owned by another user", async () => {
      const privateRecipe = createMockCommunityRecipe({
        id: 10,
        authorId: "other-user",
        isPublic: false,
      });
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(privateRecipe);

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ type: "remix", sourceRecipeId: 10 });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/chat/conversations/:id/messages", () => {
    it("returns messages for a conversation", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation(),
      );
      const mockMessages = [
        createMockChatMessage({ role: "user", content: "Hello" }),
      ];
      vi.mocked(storage.getChatMessages).mockResolvedValue(mockMessages);
      const messages = JSON.parse(JSON.stringify(mockMessages));

      const res = await request(app)
        .get("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(messages);
    });

    it("returns 404 for unknown conversation", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/chat/conversations/999/messages")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/chat/conversations/abc/messages")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/chat/conversations/:id/messages", () => {
    it("returns 404 for unknown conversation", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/chat/conversations/999/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for empty content", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation(),
      );

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "" });

      expect(res.status).toBe(400);
    });

    it("returns 429 when free tier daily coach limit reached", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation(),
      );
      vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });
      vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
        null,
      );

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Daily chat message limit reached");
    });

    it("returns 429 with Coach Pro message when premium daily limit reached", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation(),
      );
      vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
        null,
      );

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Daily Coach Pro message limit reached");
    });

    function mockStreamingSetup() {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation(),
      );
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({
          dailyCalorieGoal: 2000,
          dailyProteinGoal: 100,
          dailyCarbsGoal: 250,
          dailyFatGoal: 65,
        }),
      );
      vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
        createMockChatMessage(),
      );
      vi.mocked(storage.createChatMessage).mockResolvedValue(
        createMockChatMessage(),
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 500,
        totalProtein: 20,
        totalCarbs: 60,
        totalFat: 15,
        itemCount: 3,
      });
      vi.mocked(storage.getWeightLogs).mockResolvedValue([
        createMockWeightLog({ weight: "75.0" }),
      ]);
      vi.mocked(storage.getChatMessages).mockResolvedValue([]);
      vi.mocked(storage.updateChatConversationTitle).mockResolvedValue(
        createMockChatConversation(),
      );
    }

    it("streams SSE response and saves assistant message", async () => {
      mockStreamingSetup();

      // Mock an async generator yielding chunks
      async function* fakeStream() {
        yield "Hello ";
        yield "world!";
      }
      vi.mocked(generateCoachProResponse).mockReturnValue(fakeStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Hello ");
      expect(res.text).toContain("world!");
      expect(res.text).toContain('"done":true');
      // Saved assistant message (4th arg is metadata — null when no blocks)
      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "1",
        "assistant",
        "Hello world!",
        null,
      );
      // Title updated for first exchange (history.length === 0)
      expect(storage.updateChatConversationTitle).toHaveBeenCalled();
    });

    it("handles streaming error and sends error SSE event", async () => {
      mockStreamingSetup();

      async function* errorStream() {
        yield "Partial";
        throw new Error("AI crash");
      }
      vi.mocked(generateCoachProResponse).mockReturnValue(errorStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Partial");
      expect(res.text).toContain("Failed to generate response");
    });

    it("sends error SSE event instead of done when response exceeds byte limit", async () => {
      mockStreamingSetup();

      async function* hugeStream() {
        yield "x".repeat(60 * 1024);
      }
      vi.mocked(generateCoachProResponse).mockReturnValue(hugeStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Response too large");
      expect(res.text).not.toContain('"done":true');
    });

    it("succeeds with null goals when user has no calorie goal", async () => {
      mockStreamingSetup();
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ dailyCalorieGoal: null }),
      );
      vi.mocked(storage.getWeightLogs).mockResolvedValue([]);

      async function* emptyStream() {
        yield "Ok";
      }
      vi.mocked(generateCoachProResponse).mockReturnValue(emptyStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      // Verify goals are null when user has no calorie goal
      const contextArg = vi.mocked(generateCoachProResponse).mock.calls[0][1];
      expect(contextArg.goals).toBeNull();
    });

    it("skips title update when history has more than 1 message", async () => {
      mockStreamingSetup();
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        createMockChatMessage({ role: "user", content: "first" }),
        createMockChatMessage({
          id: 2,
          role: "assistant",
          content: "reply",
        }),
      ]);

      async function* fakeStream() {
        yield "Response";
      }
      vi.mocked(generateCoachResponse).mockReturnValue(fakeStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      expect(storage.updateChatConversationTitle).not.toHaveBeenCalled();
    });
  });

  describe("Error paths", () => {
    it("GET /api/chat/conversations returns 500 on storage error", async () => {
      vi.mocked(storage.getChatConversations).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/chat/conversations")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/chat/conversations returns 500 on storage error", async () => {
      vi.mocked(storage.createChatConversation).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ title: "Test" });

      expect(res.status).toBe(500);
    });

    it("POST /api/chat/conversations returns 400 for invalid title", async () => {
      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ title: "x".repeat(201) });

      expect(res.status).toBe(400);
    });

    it("GET /api/chat/conversations/:id/messages returns 500 on storage error", async () => {
      vi.mocked(storage.getChatConversation).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/chat/conversations/:id/messages returns 400 for invalid ID", async () => {
      const res = await request(app)
        .post("/api/chat/conversations/abc/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(400);
    });

    it("POST /api/chat/conversations/:id/messages returns 401 when user not found", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation(),
      );
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(401);
    });

    it("DELETE /api/chat/conversations/:id returns 500 on storage error", async () => {
      vi.mocked(storage.deleteChatConversation).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/chat/conversations/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/chat/conversations/:id", () => {
    it("deletes a conversation", async () => {
      vi.mocked(storage.deleteChatConversation).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/chat/conversations/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when not found", async () => {
      vi.mocked(storage.deleteChatConversation).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/chat/conversations/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/chat/conversations/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/chat/messages/:id", () => {
    it("deletes a message and returns 204", async () => {
      vi.mocked(storage.deleteChatMessage).mockResolvedValue(true);
      const res = await request(app)
        .delete("/api/chat/messages/5")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(204);
      expect(storage.deleteChatMessage).toHaveBeenCalledWith(5, "1");
    });

    it("returns 404 when message not found or not owned", async () => {
      vi.mocked(storage.deleteChatMessage).mockResolvedValue(false);
      const res = await request(app)
        .delete("/api/chat/messages/999")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid message id", async () => {
      const res = await request(app)
        .delete("/api/chat/messages/abc")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(400);
    });

    it("returns 401 without auth", async () => {
      vi.mocked(requireAuth).mockImplementationOnce((_req, res, _next) => {
        sendError(res, 401, "Unauthorized");
      });
      const res = await request(app).delete("/api/chat/messages/5");
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/chat/conversations/:id/pin", () => {
    it("pins a conversation and returns the updated row", async () => {
      const updated = createMockChatConversation({
        id: 1,
        isPinned: true,
        pinnedAt: new Date(),
      });
      vi.mocked(storage.pinChatConversation).mockResolvedValue(updated);
      const res = await request(app)
        .patch("/api/chat/conversations/1/pin")
        .send({ isPinned: true })
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
      expect(res.body.isPinned).toBe(true);
    });

    it("returns 404 when conversation not owned", async () => {
      vi.mocked(storage.pinChatConversation).mockResolvedValue(undefined);
      const res = await request(app)
        .patch("/api/chat/conversations/999/pin")
        .send({ isPinned: true })
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid body", async () => {
      const res = await request(app)
        .patch("/api/chat/conversations/1/pin")
        .send({ isPinned: "yes" })
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/chat/conversations with pagination + search", () => {
    it("passes search and page params to storage", async () => {
      vi.mocked(storage.getChatConversations).mockResolvedValue([]);
      await request(app)
        .get("/api/chat/conversations?type=coach&search=breakfast&page=2")
        .set("Authorization", "Bearer valid-token");
      expect(storage.getChatConversations).toHaveBeenCalledWith(
        "1",
        expect.any(Number),
        "coach",
        expect.objectContaining({ search: "breakfast", page: 2 }),
      );
    });
  });
});
