import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getChatConversations: vi.fn(),
    createChatConversation: vi.fn(),
    getChatConversation: vi.fn(),
    getChatMessages: vi.fn(),
    createChatMessage: vi.fn(),
    getDailyChatMessageCount: vi.fn(),
    getUser: vi.fn(),
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getExerciseDailySummary: vi.fn(),
    getLatestWeight: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    deleteChatConversation: vi.fn(),
  },
}));

vi.mock("../../services/nutrition-coach", () => ({
  generateCoachResponse: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = "1";
    next();
  },
}));

vi.mock("express-rate-limit", () => ({
  rateLimit: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  default: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

import { storage } from "../../storage";
import { register } from "../chat";

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
      const convos = [{ id: 1, title: "Chat 1" }];
      vi.mocked(storage.getChatConversations).mockResolvedValue(convos as never);

      const res = await request(app)
        .get("/api/chat/conversations")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(convos);
    });
  });

  describe("POST /api/chat/conversations", () => {
    it("creates a new conversation", async () => {
      const convo = { id: 1, title: "New Chat" };
      vi.mocked(storage.createChatConversation).mockResolvedValue(convo as never);

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({ title: "My Chat" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(1);
    });

    it("uses default title", async () => {
      const convo = { id: 1, title: "New Chat" };
      vi.mocked(storage.createChatConversation).mockResolvedValue(convo as never);

      const res = await request(app)
        .post("/api/chat/conversations")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(201);
      expect(storage.createChatConversation).toHaveBeenCalledWith("1", "New Chat");
    });
  });

  describe("GET /api/chat/conversations/:id/messages", () => {
    it("returns messages for a conversation", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue({ id: 1 } as never);
      const messages = [{ id: 1, role: "user", content: "Hello" }];
      vi.mocked(storage.getChatMessages).mockResolvedValue(messages as never);

      const res = await request(app)
        .get("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(messages);
    });

    it("returns 404 for unknown conversation", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(null as never);

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
      vi.mocked(storage.getChatConversation).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/chat/conversations/999/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for empty content", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue({ id: 1 } as never);

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "" });

      expect(res.status).toBe(400);
    });

    it("returns 429 when daily limit reached", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue({ id: 1 } as never);
      vi.mocked(storage.getUser).mockResolvedValue({ id: "1" } as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
      } as never);
      vi.mocked(storage.getDailyChatMessageCount).mockResolvedValue(100 as never);

      const res = await request(app)
        .post("/api/chat/conversations/1/messages")
        .set("Authorization", "Bearer token")
        .send({ content: "Hello" });

      expect(res.status).toBe(429);
    });
  });

  describe("DELETE /api/chat/conversations/:id", () => {
    it("deletes a conversation", async () => {
      vi.mocked(storage.deleteChatConversation).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/chat/conversations/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 404 when not found", async () => {
      vi.mocked(storage.deleteChatConversation).mockResolvedValue(false as never);

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
