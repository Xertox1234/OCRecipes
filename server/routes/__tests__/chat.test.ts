import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { generateCoachResponse } from "../../services/nutrition-coach";
import { register } from "../chat";
import {
  createMockChatConversation,
  createMockChatMessage,
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
    getLatestWeight: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    deleteChatConversation: vi.fn(),
    getCoachCachedResponse: vi.fn().mockResolvedValue(null),
    setCoachCachedResponse: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/nutrition-coach", () => ({
  generateCoachResponse: vi.fn(),
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
    });

    it("returns 429 when daily limit reached", async () => {
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
      vi.mocked(storage.getLatestWeight).mockResolvedValue(
        createMockWeightLog({ weight: "75.0" }),
      );
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
      vi.mocked(generateCoachResponse).mockReturnValue(fakeStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Hello ");
      expect(res.text).toContain("world!");
      expect(res.text).toContain('"done":true');
      // Saved assistant message
      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "assistant",
        "Hello world!",
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
      vi.mocked(generateCoachResponse).mockReturnValue(errorStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Partial");
      expect(res.text).toContain("Failed to generate response");
    });

    it("succeeds with null goals when user has no calorie goal", async () => {
      mockStreamingSetup();
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ dailyCalorieGoal: null }),
      );
      vi.mocked(storage.getLatestWeight).mockResolvedValue(undefined);

      async function* emptyStream() {
        yield "Ok";
      }
      vi.mocked(generateCoachResponse).mockReturnValue(emptyStream());

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(200);
      // Verify goals are null when user has no calorie goal
      const contextArg = vi.mocked(generateCoachResponse).mock.calls[0][1];
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
});
