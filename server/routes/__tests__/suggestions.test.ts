import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { openai } from "../../lib/openai";
import { register } from "../suggestions";

vi.mock("../../storage", () => ({
  storage: {
    getScannedItem: vi.fn(),
    getUserProfile: vi.fn(),
    getSuggestionCache: vi.fn(),
    incrementSuggestionCacheHit: vi.fn(),
    createSuggestionCache: vi.fn(),
    getInstructionCache: vi.fn(),
    incrementInstructionCacheHit: vi.fn(),
    createInstructionCache: vi.fn(),
  },
}));

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  isAiConfigured: true,
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockItem = {
  id: 1,
  userId: "1",
  productName: "Greek Yogurt",
  brandName: "Fage",
};

describe("Suggestions Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/items/:id/suggestions", () => {
    it("returns cached suggestions on cache hit", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue({
        id: 10,
        suggestions: [{ type: "recipe", title: "Yogurt Bowl" }],
      } as never);
      vi.mocked(storage.incrementSuggestionCacheHit).mockResolvedValue(
        {} as never,
      );

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.cacheId).toBe(10);
    });

    it("generates suggestions on cache miss", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestions: [{ type: "recipe", title: "Yogurt Bowl" }],
              }),
            },
          },
        ],
      } as never);
      vi.mocked(storage.createSuggestionCache).mockResolvedValue({
        id: 11,
      } as never);

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.cacheId).toBe(11);
    });

    it("returns 404 for item not owned by user", async () => {
      // Storage layer now filters by userId, so mismatched user returns undefined
      vi.mocked(storage.getScannedItem).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent item", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/items/999/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .post("/api/items/abc/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/items/:itemId/suggestions/:suggestionIndex/instructions", () => {
    it("returns cached instructions on cache hit", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getInstructionCache).mockResolvedValue({
        id: 5,
        instructions: "Step 1: Mix yogurt...",
      } as never);
      vi.mocked(storage.incrementInstructionCacheHit).mockResolvedValue(
        {} as never,
      );

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
          cacheId: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.instructions).toContain("Mix yogurt");
    });

    it("generates instructions on cache miss", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(null as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockResolvedValue({
        choices: [{ message: { content: "Step 1: Mix..." } }],
      } as never);
      vi.mocked(storage.createInstructionCache).mockResolvedValue({} as never);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
          cacheId: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.instructions).toBeDefined();
    });

    it("returns 404 for item not owned by user", async () => {
      // Storage layer now filters by userId, so mismatched user returns undefined
      vi.mocked(storage.getScannedItem).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
        });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid input", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid suggestion index", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);

      const res = await request(app)
        .post("/api/items/1/suggestions/-1/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid item ID", async () => {
      const res = await request(app)
        .post("/api/items/abc/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
        });

      expect(res.status).toBe(400);
    });

    it("generates craft instructions", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(null as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockResolvedValue({
        choices: [{ message: { content: "Step 1: Gather materials..." } }],
      } as never);
      vi.mocked(storage.createInstructionCache).mockResolvedValue({} as never);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Art",
          suggestionType: "craft",
          cacheId: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.instructions).toBeDefined();
    });

    it("generates pairing instructions", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(null as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockResolvedValue({
        choices: [{ message: { content: "These pair well because..." } }],
      } as never);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt and Granola",
          suggestionType: "pairing",
        });

      expect(res.status).toBe(200);
      expect(res.body.instructions).toBeDefined();
    });

    it("skips caching when no cacheId provided", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockResolvedValue({
        choices: [{ message: { content: "Step 1: Mix..." } }],
      } as never);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
        });

      expect(res.status).toBe(200);
      expect(storage.getInstructionCache).not.toHaveBeenCalled();
      expect(storage.createInstructionCache).not.toHaveBeenCalled();
    });

    it("returns 500 on OpenAI error", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockRejectedValue(
        new Error("API error"),
      );

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({
          suggestionTitle: "Yogurt Bowl",
          suggestionType: "recipe",
        });

      expect(res.status).toBe(500);
    });
  });

  describe("Suggestions with user profile", () => {
    it("includes dietary context from user profile", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        allergies: [{ name: "peanuts" }],
        dietType: "vegetarian",
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "30 min",
      } as never);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestions: [{ type: "recipe", title: "Veggie Bowl" }],
              }),
            },
          },
        ],
      } as never);
      vi.mocked(storage.createSuggestionCache).mockResolvedValue({
        id: 12,
      } as never);

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(openai.chat.completions.create).toHaveBeenCalled();
    });

    it("returns 500 on OpenAI error for suggestions", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(null as never);
      vi.mocked(openai.chat.completions.create).mockRejectedValue(
        new Error("API error"),
      );

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });
});
