// Chat reads and writes are throttled by separate limiters. With one shared
// 20/min budget, a burst of sends and refetches (a finder flow: send, refetch,
// Search Spoonacular, refetch, Generate, refetch …) could 429 the refetch that
// follows a finished reply — the reply was stored but the chat kept its stale
// copy (found by the recipe finder's Maestro run, 2026-09-29). This file runs
// the REAL express-rate-limit (chat.test.ts mocks it) against register(app).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { createMockChatConversation } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getChatConversations: vi.fn(),
    getChatConversation: vi.fn(),
    getChatMessages: vi.fn(),
    getChatMessageCount: vi.fn(),
    pinChatConversation: vi.fn(),
    archiveOldEntries: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../../lib/openai", () => ({
  isAiConfigured: true,
  openai: {},
  dalleClient: {},
  OPENAI_TIMEOUT_MS: 30000,
  OPENAI_VISION_TIMEOUT_MS: 60000,
}));

vi.mock("../../middleware/auth");

// Fresh limiter stores per test: re-import the route module each time.
async function createApp() {
  vi.resetModules();
  const { register: freshRegister } = await import("../chat");
  const app = express();
  app.use(express.json());
  freshRegister(app);
  return app;
}

const conversation = createMockChatConversation({ id: 7, userId: "1" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getChatConversation).mockResolvedValue(conversation);
  vi.mocked(storage.getChatMessages).mockResolvedValue([]);
  vi.mocked(storage.getChatConversations).mockResolvedValue([]);
  vi.mocked(storage.getChatMessageCount).mockResolvedValue(0);
  vi.mocked(storage.pinChatConversation).mockResolvedValue(conversation);
});

describe("chat rate limits — reads and writes are budgeted separately", () => {
  it("a burst of 20 writes does not throttle loading the messages", async () => {
    const app = await createApp();
    for (let i = 0; i < 20; i++) {
      const pin = await request(app)
        .patch("/api/chat/conversations/7/pin")
        .send({ isPinned: i % 2 === 0 });
      expect(pin.status).toBe(200);
    }

    const messages = await request(app).get(
      "/api/chat/conversations/7/messages",
    );
    expect(messages.status).toBe(200);
    const list = await request(app).get("/api/chat/conversations");
    expect(list.status).toBe(200);
    const one = await request(app).get("/api/chat/conversations/7");
    expect(one.status).toBe(200);
  });

  it("writes keep their 20/min ceiling", async () => {
    const app = await createApp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const pin = await request(app)
        .patch("/api/chat/conversations/7/pin")
        .send({ isPinned: true });
      statuses.push(pin.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("reads have their own, higher ceiling: the 61st read in a minute is throttled", async () => {
    const app = await createApp();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await request(app).get("/api/chat/conversations/7/messages");
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
