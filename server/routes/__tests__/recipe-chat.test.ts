import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../recipe-chat";
import {
  createMockChatConversation,
  createMockCommunityRecipe,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getChatConversation: vi.fn(),
    getChatMessageById: vi.fn().mockResolvedValue(undefined),
    saveRecipeFromChat: vi.fn(),
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

describe("Recipe Chat Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/chat/conversations/:id/save-recipe", () => {
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
  });
});
