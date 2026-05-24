import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { analyzeImageForRecipe } from "../../services/recipe-chat";
import { inferMealTypes } from "../../services/meal-type-inference";
import { register } from "../recipe-chat";
import {
  createMockChatConversation,
  createMockChatMessage,
  createMockCommunityRecipe,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getChatConversation: vi.fn(),
    getChatMessageById: vi.fn().mockResolvedValue(undefined),
    saveRecipeFromChat: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    createChatMessage: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

// The route imports both analyzeImageForRecipe and RECIPE_SUGGESTION_CHIPS from
// this service module — mock both so the suggestions + upload-image paths run
// against doubles, never the real Vision client.
vi.mock("../../services/recipe-chat", () => ({
  analyzeImageForRecipe: vi.fn(),
  RECIPE_SUGGESTION_CHIPS: [{ label: "Quick & Easy", prompt: "..." }],
}));

vi.mock("../../services/meal-type-inference", () => ({
  inferMealTypes: vi.fn().mockReturnValue([]),
}));

// AI-configured gate for the upload-image endpoint.
vi.mock("../../lib/openai", () => ({
  isAiConfigured: true,
}));

// Multer mock — injects a configurable file buffer (valid JPEG magic bytes by
// default). Mirrors the photos.test.ts pattern.
const VALID_JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const { mockFile } = vi.hoisted(() => ({
  mockFile: {
    current: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) as
      | Buffer
      | undefined,
  },
}));

vi.mock("multer", () => {
  const multerMock = () => ({
    single:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        if (mockFile.current) {
          req.file = {
            buffer: mockFile.current,
            mimetype: "image/jpeg",
            originalname: "ingredients.jpg",
            size: mockFile.current.length,
          } as Express.Multer.File;
        }
        next();
      },
  });
  multerMock.memoryStorage = () => ({});
  return { default: multerMock };
});

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Recipe Chat Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFile.current = VALID_JPEG_HEADER;
    vi.mocked(inferMealTypes).mockReturnValue([]);
    // Default: premium user so the upload-image gate passes unless overridden.
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "premium",
      expiresAt: null,
    });
    app = createApp();
  });

  describe("GET /api/chat/suggestions", () => {
    it("returns recipe suggestion chips for type=recipe", async () => {
      const res = await request(app)
        .get("/api/chat/suggestions?type=recipe")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ label: "Quick & Easy", prompt: "..." }]);
    });

    it("returns an empty array for a non-recipe type", async () => {
      const res = await request(app)
        .get("/api/chat/suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/chat/conversations/:id/save-recipe", () => {
    it("returns 400 for an invalid conversation id", async () => {
      const res = await request(app)
        .post("/api/chat/conversations/abc/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(400);
    });

    it("returns 400 when the body fails validation", async () => {
      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: "not-a-number" });

      expect(res.status).toBe(400);
    });

    it("returns 404 when the conversation is not found", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(404);
    });

    it("returns 404 when the recipe is not found in the message", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation({ id: 5, type: "coach" }),
      );
      vi.mocked(storage.saveRecipeFromChat).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(404);
    });

    it("saves a recipe from a standard (non-remix) conversation", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation({ id: 5, type: "coach" }),
      );
      const saved = createMockCommunityRecipe({ id: 100, title: "Soup" });
      vi.mocked(storage.saveRecipeFromChat).mockResolvedValue(saved);

      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(100);
      expect(storage.saveRecipeFromChat).toHaveBeenCalledWith(
        10,
        5,
        "1",
        undefined, // lineage — undefined for non-remix conversations
        undefined, // mealTypes — undefined when message has no parseable metadata
      );
    });

    it("includes lineage in saved recipe for remix conversations", async () => {
      const remixConvo = createMockChatConversation({
        id: 5,
        type: "remix",
        metadata: {
          sourceRecipeId: 42,
          sourceRecipeTitle: "Original Pasta",
        },
      });
      vi.mocked(storage.getChatConversation).mockResolvedValue(remixConvo);

      const savedRecipe = createMockCommunityRecipe({
        id: 100,
        title: "Spicy Pasta",
        remixedFromId: 42,
        remixedFromTitle: "Original Pasta",
      });
      vi.mocked(storage.saveRecipeFromChat).mockResolvedValue(savedRecipe);

      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(201);
      expect(res.body.remixedFromId).toBe(42);
      expect(res.body.remixedFromTitle).toBe("Original Pasta");
      expect(storage.saveRecipeFromChat).toHaveBeenCalledWith(
        10,
        5,
        "1",
        {
          remixedFromId: 42,
          remixedFromTitle: "Original Pasta",
        },
        undefined, // mealTypes — undefined when message has no parseable recipe metadata
      );
    });

    it("computes mealTypes from parseable recipe message metadata", async () => {
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation({ id: 5, type: "coach" }),
      );
      vi.mocked(storage.getChatMessageById).mockResolvedValue(
        createMockChatMessage({
          id: 10,
          metadata: {
            metadataVersion: 1,
            recipe: {
              title: "Breakfast Bowl",
              description: "A hearty bowl",
              difficulty: "easy",
              timeEstimate: "10 min",
              servings: 1,
              ingredients: [
                { name: "oats", quantity: "1", unit: "cup" },
                { name: "banana", quantity: "1", unit: "whole" },
              ],
              instructions: ["Combine and serve"],
              dietTags: [],
            },
            allergenWarning: null,
            imageUrl: null,
          } as unknown as ReturnType<typeof createMockChatMessage>["metadata"],
        }),
      );
      vi.mocked(inferMealTypes).mockReturnValue(["breakfast"]);
      vi.mocked(storage.saveRecipeFromChat).mockResolvedValue(
        createMockCommunityRecipe({ id: 100 }),
      );

      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(201);
      expect(inferMealTypes).toHaveBeenCalledWith("Breakfast Bowl", [
        "oats",
        "banana",
      ]);
      expect(storage.saveRecipeFromChat).toHaveBeenCalledWith(
        10,
        5,
        "1",
        undefined,
        ["breakfast"],
      );
    });

    it("returns 500 when the storage layer throws", async () => {
      vi.mocked(storage.getChatConversation).mockRejectedValue(
        new Error("db down"),
      );

      const res = await request(app)
        .post("/api/chat/conversations/5/save-recipe")
        .set("Authorization", "Bearer token")
        .send({ messageId: 10 });

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/chat/conversations/:id/upload-image", () => {
    it("returns 400 for an invalid conversation id", async () => {
      const res = await request(app)
        .post("/api/chat/conversations/abc/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", VALID_JPEG_HEADER, "ingredients.jpg");

      expect(res.status).toBe(400);
    });

    it("returns 400 when no image is provided", async () => {
      mockFile.current = undefined;

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid image content (bad magic bytes)", async () => {
      mockFile.current = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("x"), "ingredients.jpg");

      expect(res.status).toBe(400);
    });

    it("returns 400 when the image buffer is too small", async () => {
      // Valid JPEG magic bytes but under the 100-byte minimum.
      mockFile.current = VALID_JPEG_HEADER;

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", VALID_JPEG_HEADER, "ingredients.jpg");

      expect(res.status).toBe(400);
    });

    it("returns 404 when the conversation is not found", async () => {
      mockFile.current = Buffer.concat([VALID_JPEG_HEADER, Buffer.alloc(200)]);
      vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.alloc(200), "ingredients.jpg");

      expect(res.status).toBe(404);
    });

    it("returns 403 when the user lacks the recipe-generation feature", async () => {
      mockFile.current = Buffer.concat([VALID_JPEG_HEADER, Buffer.alloc(200)]);
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation({ id: 5 }),
      );
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.alloc(200), "ingredients.jpg");

      expect(res.status).toBe(403);
    });

    it("analyzes the image and creates a user message on success", async () => {
      mockFile.current = Buffer.concat([VALID_JPEG_HEADER, Buffer.alloc(200)]);
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation({ id: 5 }),
      );
      vi.mocked(analyzeImageForRecipe).mockResolvedValue(
        "tomatoes\nbasil\nmozzarella",
      );
      const created = createMockChatMessage({ id: 77, role: "user" });
      vi.mocked(storage.createChatMessage).mockResolvedValue(created);

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.alloc(200), "ingredients.jpg");

      expect(res.status).toBe(201);
      expect(res.body.ingredientAnalysis).toBe("tomatoes\nbasil\nmozzarella");
      expect(analyzeImageForRecipe).toHaveBeenCalled();
      expect(storage.createChatMessage).toHaveBeenCalled();
    });

    it("returns 500 when image analysis throws", async () => {
      mockFile.current = Buffer.concat([VALID_JPEG_HEADER, Buffer.alloc(200)]);
      vi.mocked(storage.getChatConversation).mockResolvedValue(
        createMockChatConversation({ id: 5 }),
      );
      vi.mocked(analyzeImageForRecipe).mockRejectedValue(
        new Error("vision failed"),
      );

      const res = await request(app)
        .post("/api/chat/conversations/5/upload-image")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.alloc(200), "ingredients.jpg");

      expect(res.status).toBe(500);
    });
  });
});
