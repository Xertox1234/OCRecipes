import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  generateSuggestions,
  generateInstructions,
} from "../../services/suggestion-generation";
import { register } from "../suggestions";
import {
  createMockScannedItem,
  createMockUserProfile,
  createMockSuggestionCache,
  createMockInstructionCache,
} from "../../__tests__/factories";

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
  isAiConfigured: true,
}));

vi.mock("../../services/suggestion-generation", () => ({
  generateSuggestions: vi.fn(),
  generateInstructions: vi.fn(),
  SuggestionParseError: class SuggestionParseError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SuggestionParseError";
    }
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockItem = createMockScannedItem({
  productName: "Greek Yogurt",
  brandName: "Fage",
});

describe("Suggestions Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/items/:id/suggestions", () => {
    it("returns cached suggestions on cache hit", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(
        createMockSuggestionCache({
          id: 10,
          suggestions: [
            {
              type: "recipe",
              title: "Yogurt Bowl",
              description: "A healthy yogurt bowl",
            },
          ],
        }),
      );
      vi.mocked(storage.incrementSuggestionCacheHit).mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.cacheId).toBe(10);
    });

    it("generates suggestions on cache miss", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(undefined);
      vi.mocked(generateSuggestions).mockResolvedValue([
        { type: "recipe", title: "Yogurt Bowl", description: "" },
      ]);
      vi.mocked(storage.createSuggestionCache).mockResolvedValue(
        createMockSuggestionCache({ id: 11 }),
      );

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(undefined);

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(
        createMockInstructionCache({
          id: 5,
          instructions: "Step 1: Mix yogurt...",
        }),
      );
      vi.mocked(storage.incrementInstructionCacheHit).mockResolvedValue(
        undefined,
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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(undefined);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateInstructions).mockResolvedValue("Step 1: Mix...");
      vi.mocked(storage.createInstructionCache).mockResolvedValue(undefined);

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);

      const res = await request(app)
        .post("/api/items/1/suggestions/0/instructions")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid suggestion index", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(undefined);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateInstructions).mockResolvedValue(
        "Step 1: Gather materials...",
      );
      vi.mocked(storage.createInstructionCache).mockResolvedValue(undefined);

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getInstructionCache).mockResolvedValue(undefined);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateInstructions).mockResolvedValue(
        "These pair well because...",
      );

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateInstructions).mockResolvedValue("Step 1: Mix...");

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateInstructions).mockRejectedValue(new Error("API error"));

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
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          allergies: [{ name: "peanuts", severity: "severe" as const }],
          dietType: "vegetarian",
          cookingSkillLevel: "beginner",
          cookingTimeAvailable: "30 min",
        }),
      );
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(undefined);
      vi.mocked(generateSuggestions).mockResolvedValue([
        { type: "recipe", title: "Veggie Bowl", description: "" },
      ]);
      vi.mocked(storage.createSuggestionCache).mockResolvedValue(
        createMockSuggestionCache({ id: 12 }),
      );

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(generateSuggestions).toHaveBeenCalled();
    });

    it("returns 500 on OpenAI error for suggestions", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(undefined);
      vi.mocked(generateSuggestions).mockRejectedValue(new Error("API error"));

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("returns 502 on SuggestionParseError", async () => {
      // Import the mocked SuggestionParseError class from the mock
      const { SuggestionParseError } = await import(
        "../../services/suggestion-generation"
      );

      vi.mocked(storage.getScannedItem).mockResolvedValue(mockItem);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getSuggestionCache).mockResolvedValue(undefined);
      vi.mocked(generateSuggestions).mockRejectedValue(
        new SuggestionParseError("AI returned invalid JSON"),
      );

      const res = await request(app)
        .post("/api/items/1/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(502);
      expect(res.body.error).toContain("AI returned invalid JSON");
    });
  });
});
