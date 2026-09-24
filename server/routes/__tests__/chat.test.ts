import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { sendError } from "../../lib/api-errors";
import { requireAuth } from "../../middleware/auth";
import {
  generateCoachResponse,
  generateCoachProResponse,
} from "../../services/nutrition-coach";
import { generateRecipeChatResponse } from "../../services/recipe-chat";
import { STANDARD_SAFETY_MESSAGE } from "../../services/coach-pro-chat";
import { register } from "../chat";
import {
  createMockChatConversation,
  createMockChatMessage,
  createMockCommunityRecipe,
  createMockUser,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getEffectiveTierForUser: vi.fn(),
    getChatConversations: vi.fn(),
    createChatConversation: vi.fn(),
    getChatConversation: vi.fn(),
    getChatMessages: vi.fn(),
    createChatMessage: vi.fn(),
    createChatMessageWithLimitCheck: vi.fn(),
    getChatMessageByTurnKey: vi.fn(),
    getDailyChatMessageCount: vi.fn(),
    getChatMessageCount: vi.fn(),
    getUser: vi.fn(),
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    updateChatConversationTitle: vi.fn(),
    deleteChatConversation: vi.fn(),
    deleteChatMessage: vi.fn(),
    getCoachCachedResponse: vi.fn().mockResolvedValue(null),
    setCoachCachedResponse: vi.fn().mockResolvedValue(undefined),
    getCommunityRecipe: vi.fn(),
    getActiveNotebookEntries: vi.fn().mockResolvedValue([]),
    getDailyLogsInRange: vi.fn().mockResolvedValue([]),
    getCommitmentsWithDueFollowUp: vi.fn().mockResolvedValue([]),
    getMostEatenFoods: vi.fn().mockResolvedValue([]),
    createNotebookEntries: vi.fn().mockResolvedValue([]),
    archiveOldEntries: vi.fn().mockResolvedValue(0),
    pinChatConversation: vi.fn(),
  },
}));

vi.mock("../../services/nutrition-coach", () => ({
  generateCoachResponse: vi.fn(),
  generateCoachProResponse: vi.fn(),
  // The free-tier path hashes a response-cache key that includes this.
  getSystemPromptTemplateVersion: vi.fn().mockReturnValue("test"),
  SAFETY_OVERRIDE_SENTINEL: "\x00SAFETY_OVERRIDE\x00",
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

// Keep the real `handleCoachChat` (the streaming tests `for await` over its
// async generator) but stub `tryArchiveNotebook` — GET /messages fires it via
// `fireAndForget`, so the real service would run its storage import graph on the
// microtask queue after each test resolves and mutate shared mocks for the next
// test (cross-file flakiness). See docs/rules/testing.md (fire-and-forget rule)
// + the vi-mock-mix solution. Async factory because vi.mock is hoisted.
vi.mock("../../services/coach-pro-chat", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/coach-pro-chat")
  >("../../services/coach-pro-chat");
  return {
    ...actual,
    tryArchiveNotebook: vi.fn().mockResolvedValue(undefined),
  };
});

// Stub ONLY the streaming generator — buildRecipeContext/buildRemixSystemPrompt
// from the same module must stay real (the recipe branch calls them before
// streaming). Async factory because vi.mock is hoisted.
vi.mock("../../services/recipe-chat", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/recipe-chat")
  >("../../services/recipe-chat");
  return {
    ...actual,
    generateRecipeChatResponse: vi.fn(),
  };
});

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
    // clearAllMocks clears calls but NOT implementations — reset the recipe
    // stream stub fully so a later recipe-path test can never silently
    // inherit another test's mockImplementation (per the clearallmocks
    // once-queue solution doc).
    vi.mocked(generateRecipeChatResponse).mockReset();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
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

  describe("GET /api/chat/conversations/:id", () => {
    it("returns conversation with messageCount and nearLimit: false when under 500", async () => {
      const convo = createMockChatConversation({ id: 1 });
      vi.mocked(storage.getChatConversation).mockResolvedValue(convo);
      vi.mocked(storage.getChatMessageCount).mockResolvedValue(42);

      const res = await request(app)
        .get("/api/chat/conversations/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.messageCount).toBe(42);
      expect(res.body.nearLimit).toBe(false);
    });

    it("returns nearLimit: true when messageCount > 500", async () => {
      const convo = createMockChatConversation({ id: 1 });
      vi.mocked(storage.getChatConversation).mockResolvedValue(convo);
      vi.mocked(storage.getChatMessageCount).mockResolvedValue(501);

      const res = await request(app)
        .get("/api/chat/conversations/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.messageCount).toBe(501);
      expect(res.body.nearLimit).toBe(true);
    });

    it("returns 404 when conversation is not found", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/chat/conversations/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
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

    describe("premium gate — recipe/remix conversations", () => {
      // Free tier has aiCoach: true (throttled 3/day → the 429 tests below);
      // only recipe/remix message sends are premium-gated (recipeGeneration).
      it("returns 403 PREMIUM_REQUIRED for free tier on a recipe conversation and never starts work", async () => {
        vi.mocked(storage.getChatConversation).mockResolvedValue(
          createMockChatConversation({ type: "recipe" }),
        );
        vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
          tier: "free",
          expiresAt: null,
        });
        vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");

        const res = await request(app)
          .post("/api/chat/conversations/1/messages")
          .set("Authorization", "Bearer token")
          .send({ content: "Make me a pasta recipe" });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("PREMIUM_REQUIRED");
        expect(res.body.error).toContain("Recipe Generation");
        // The denial happened BEFORE any work: no message row, no AI call.
        expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
        expect(generateRecipeChatResponse).not.toHaveBeenCalled();
      });

      it("returns 403 PREMIUM_REQUIRED for free tier on a remix conversation", async () => {
        vi.mocked(storage.getChatConversation).mockResolvedValue(
          createMockChatConversation({ type: "remix" }),
        );
        vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");

        const res = await request(app)
          .post("/api/chat/conversations/1/messages")
          .set("Authorization", "Bearer token")
          .send({ content: "Remix this with tofu" });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("PREMIUM_REQUIRED");
        expect(res.body.error).toContain("Recipe Remix");
        expect(storage.createChatMessageWithLimitCheck).not.toHaveBeenCalled();
        expect(generateRecipeChatResponse).not.toHaveBeenCalled();
      });

      it("premium tier passes the gate on a recipe conversation and streams (non-vacuity control)", async () => {
        mockStreamingSetup();
        vi.mocked(storage.getChatConversation).mockResolvedValue(
          createMockChatConversation({ type: "recipe" }),
        );
        vi.mocked(generateRecipeChatResponse).mockImplementation(
          async function* () {
            yield { content: "Sure! Here's a pasta idea." };
          },
        );

        const res = await request(app)
          .post("/api/chat/conversations/1/messages")
          .set("Authorization", "Bearer token")
          .send({ content: "Make me a pasta recipe" });

        expect(res.status).toBe(200);
        expect(res.text).toContain('"done":true');
        // Load-bearing gate-passage proof: the limit check ran with the
        // PREMIUM recipe allocation (dailyRecipeGenerations: 20) on the
        // recipe path — i.e. checkPremiumFeature returned the features object.
        expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
          1,
          "1",
          expect.any(String),
          20,
          "recipe",
        );
      });

      it("free coach conversation passes the premium gate — throttled (429), never 403", async () => {
        // Two-sided control for the featureKey dispatch: a coach conversation
        // on the free tier reaches the daily-limit check (aiCoach is free,
        // dailyCoachMessages: 3), so a regression gating ALL chat as premium
        // turns this 429 into a 403.
        vi.mocked(storage.getChatConversation).mockResolvedValue(
          createMockChatConversation(),
        );
        vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
        vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
          null,
        );

        const res = await request(app)
          .post("/api/chat/conversations/1/messages")
          .set("Authorization", "Bearer token")
          .send({ content: "Hello" });

        expect(res.status).toBe(429);
        expect(storage.createChatMessageWithLimitCheck).toHaveBeenCalledWith(
          1,
          "1",
          expect.any(String),
          3,
          "coach",
        );
      });
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
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
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
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
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
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
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
      // Saved assistant message (4th arg is metadata — null when no blocks;
      // 5th is the route-minted per-turn key the H6 disconnect settle uses)
      expect(storage.createChatMessage).toHaveBeenCalledWith(
        1,
        "1",
        "assistant",
        "Hello world!",
        null,
        expect.any(String),
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

    // H6 — closing Ask Coach mid-answer used to leave a quota-counted user
    // message with no reply. Hybrid policy: disconnect before any content →
    // refund (delete the user row; quota is a count of user rows); disconnect
    // after content → persist the partial reply. supertest cannot drop a
    // connection mid-stream, so these drive a real socket.
    describe("client disconnect mid-stream (H6)", () => {
      const USER_MSG_ID = 42;

      /** Resolves when `signal` aborts (the route wires req close → abort). */
      function untilAborted(signal: AbortSignal): Promise<void> {
        return new Promise((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }

      /**
       * POSTs a coach message over a real socket and destroys the client
       * side once `disconnectWhen(body)` is true. Resolves when the route
       * handler calls `res.end()` — the H6 decision runs before that, so
       * negative assertions after this resolves are meaningful.
       */
      async function postAndDisconnect(
        disconnectWhen: (bodySoFar: string) => boolean,
      ): Promise<void> {
        const testApp = express();
        let signalEnd!: () => void;
        const ended = new Promise<void>((r) => (signalEnd = r));
        testApp.use((_req, res, next) => {
          const origEnd = res.end.bind(res);
          res.end = ((...args: Parameters<typeof res.end>) => {
            signalEnd();
            return origEnd(...args);
          }) as typeof res.end;
          next();
        });
        testApp.use(express.json());
        register(testApp);
        const server = testApp.listen(0);
        await new Promise<void>((r) => server.once("listening", r));
        const { port } = server.address() as AddressInfo;
        try {
          await new Promise<void>((resolve) => {
            const payload = JSON.stringify({ content: "Hello" });
            const clientReq = http.request(
              {
                port,
                method: "POST",
                path: "/api/chat/conversations/1/messages",
                headers: {
                  Authorization: "Bearer token",
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                },
              },
              (res) => {
                let body = "";
                const check = () => {
                  if (disconnectWhen(body)) {
                    clientReq.destroy();
                    resolve();
                  }
                };
                res.on("data", (chunk: Buffer) => {
                  body += chunk.toString();
                  check();
                });
                check();
              },
            );
            clientReq.on("error", () => {}); // destroy() surfaces ECONNRESET
            clientReq.on("close", () => resolve());
            clientReq.end(payload);
          });
          await ended;
        } finally {
          server.closeAllConnections();
          await new Promise((r) => server.close(r));
        }
      }

      function setupDisconnect() {
        mockStreamingSetup();
        vi.mocked(storage.createChatMessageWithLimitCheck).mockResolvedValue(
          createMockChatMessage({ id: USER_MSG_ID, role: "user" }),
        );
        vi.mocked(storage.getChatMessageByTurnKey).mockResolvedValue(undefined);
        vi.mocked(storage.deleteChatMessage).mockResolvedValue(true);
      }

      const assistantWrites = () =>
        vi
          .mocked(storage.createChatMessage)
          .mock.calls.filter((c) => c[2] === "assistant");

      it("refunds the user message when the client leaves before any content", async () => {
        setupDisconnect();
        vi.mocked(generateCoachProResponse).mockImplementation(
          async function* (_h, _c, _u, signal) {
            await untilAborted(signal!);
            throw Object.assign(new Error("Request was aborted."), {
              name: "AbortError",
            });
          },
        );

        await postAndDisconnect(() => true);

        expect(storage.deleteChatMessage).toHaveBeenCalledWith(
          USER_MSG_ID,
          "1",
        );
        expect(assistantWrites()).toHaveLength(0);
      });

      it("refunds on a free-tier (non-Pro) coach turn too", async () => {
        setupDisconnect();
        vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
          tier: "free",
          expiresAt: null,
        });
        vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
        vi.mocked(generateCoachResponse).mockImplementation(
          async function* (_h, _c, signal) {
            await untilAborted(signal!);
          },
        );

        await postAndDisconnect(() => true);

        expect(storage.deleteChatMessage).toHaveBeenCalledWith(
          USER_MSG_ID,
          "1",
        );
        expect(assistantWrites()).toHaveLength(0);
      });

      it("persists the partial reply when the client leaves after content", async () => {
        setupDisconnect();
        vi.mocked(generateCoachProResponse).mockImplementation(
          async function* (_h, _c, _u, signal) {
            yield "Eat more ";
            yield "protein.";
            await untilAborted(signal!);
            throw Object.assign(new Error("Request was aborted."), {
              name: "AbortError",
            });
          },
        );

        await postAndDisconnect((body) => body.includes("protein."));

        expect(storage.deleteChatMessage).not.toHaveBeenCalled();
        expect(assistantWrites()).toHaveLength(1);
        expect(assistantWrites()[0][3]).toBe("Eat more protein.");
        // A partial must never be served to other users as a cached answer.
        expect(storage.setCoachCachedResponse).not.toHaveBeenCalled();
      });

      it("strips half-formed block markup from a Coach Pro partial", async () => {
        setupDisconnect();
        vi.mocked(generateCoachProResponse).mockImplementation(
          async function* (_h, _c, _u, signal) {
            yield 'Try this:\n```coach_blocks\n[{"type":';
            await untilAborted(signal!);
          },
        );

        await postAndDisconnect((body) => body.includes("Try this"));

        expect(assistantWrites()).toHaveLength(1);
        expect(assistantWrites()[0][3]).toBe("Try this:");
      });

      it("refunds when the only thing streamed was an unterminated block fence", async () => {
        setupDisconnect();
        vi.mocked(generateCoachProResponse).mockImplementation(
          async function* (_h, _c, _u, signal) {
            yield '```coach_blocks\n[{"type":';
            await untilAborted(signal!);
          },
        );

        await postAndDisconnect((body) => body.includes("coach_blocks"));

        expect(storage.deleteChatMessage).toHaveBeenCalledWith(
          USER_MSG_ID,
          "1",
        );
        expect(assistantWrites()).toHaveLength(0);
      });

      // Free-tier generateCoachResponse streams each delta BEFORE its
      // containsUnsafeCoachAdvice check runs on the full text — a partial
      // cut mid-stream has never been vetted, so the settle must vet it.
      it("never persists an unvetted unsafe free-tier partial", async () => {
        setupDisconnect();
        vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
          tier: "free",
          expiresAt: null,
        });
        vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
        vi.mocked(generateCoachResponse).mockImplementation(
          async function* (_h, _c, signal) {
            yield "You likely have diabetes.";
            await untilAborted(signal!);
          },
        );

        await postAndDisconnect((body) => body.includes("diabetes"));

        expect(storage.deleteChatMessage).not.toHaveBeenCalled();
        expect(assistantWrites()).toHaveLength(1);
        expect(assistantWrites()[0][3]).not.toContain("diabetes");
        expect(assistantWrites()[0][3]).toBe(STANDARD_SAFETY_MESSAGE);
      });

      it("does not double-write when the service already persisted the reply", async () => {
        setupDisconnect();
        let capturedSignal: AbortSignal | undefined;
        vi.mocked(generateCoachProResponse).mockImplementation(
          async function* (_h, _c, _u, signal) {
            capturedSignal = signal;
            yield "Full answer.";
          },
        );
        // The service's own write lands, and only then does the close
        // arrive — the route must see the persisted turn and stand down.
        let persisted: ReturnType<typeof createMockChatMessage> | undefined;
        vi.mocked(storage.createChatMessage).mockImplementation(
          async (...args) => {
            await untilAborted(capturedSignal!);
            persisted = createMockChatMessage({
              id: 43,
              role: "assistant",
              content: args[3],
              turnKey: args[5] ?? null,
            });
            return persisted;
          },
        );
        vi.mocked(storage.getChatMessageByTurnKey).mockImplementation(
          async () => persisted,
        );

        await postAndDisconnect((body) => body.includes("Full answer."));

        expect(assistantWrites()).toHaveLength(1);
        expect(storage.deleteChatMessage).not.toHaveBeenCalled();
      });

      it("control: a completed stream neither refunds nor adds a second write", async () => {
        setupDisconnect();
        vi.mocked(generateCoachProResponse).mockImplementation(
          async function* () {
            yield "All done.";
          },
        );

        await postAndDisconnect((body) => body.includes('"done":true'));

        expect(storage.deleteChatMessage).not.toHaveBeenCalled();
        expect(assistantWrites()).toHaveLength(1);
        expect(assistantWrites()[0][3]).toBe("All done.");
      });
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
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
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
      vi.mocked(requireAuth).mockImplementationOnce(
        async (_req, res, _next) => {
          sendError(res, 401, "Unauthorized");
        },
      );
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
