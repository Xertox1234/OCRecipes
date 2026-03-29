import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../saved-items";
import { createMockSavedItem } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSavedItems: vi.fn(),
    getSavedItemCount: vi.fn(),
    createSavedItem: vi.fn(),
    deleteSavedItem: vi.fn(),
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

const mockSavedItem = createMockSavedItem({
  id: 1,
  userId: "1",
  title: "Greek Yogurt",
  createdAt: new Date("2024-01-15T12:00:00"),
});

describe("Saved Items Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/saved-items", () => {
    it("returns saved items list", async () => {
      vi.mocked(storage.getSavedItems).mockResolvedValue([mockSavedItem]);

      const res = await request(app)
        .get("/api/saved-items")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("Greek Yogurt");
    });

    it("respects limit parameter", async () => {
      vi.mocked(storage.getSavedItems).mockResolvedValue([]);

      await request(app)
        .get("/api/saved-items?limit=10")
        .set("Authorization", "Bearer token");

      expect(storage.getSavedItems).toHaveBeenCalledWith("1", 10);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getSavedItems).mockRejectedValue(new Error("db error"));

      const res = await request(app)
        .get("/api/saved-items")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("GET /api/saved-items/count", () => {
    it("returns count of saved items", async () => {
      vi.mocked(storage.getSavedItemCount).mockResolvedValue(5);

      const res = await request(app)
        .get("/api/saved-items/count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getSavedItemCount).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .get("/api/saved-items/count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("POST /api/saved-items", () => {
    it("creates a saved item", async () => {
      vi.mocked(storage.createSavedItem).mockResolvedValue(mockSavedItem);

      const res = await request(app)
        .post("/api/saved-items")
        .set("Authorization", "Bearer token")
        .send({
          type: "recipe",
          title: "Greek Yogurt Bowl",
          description: "Healthy breakfast option",
        });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Greek Yogurt");
    });

    it("returns 403 when limit reached", async () => {
      vi.mocked(storage.createSavedItem).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/saved-items")
        .set("Authorization", "Bearer token")
        .send({
          type: "recipe",
          title: "Another Recipe",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("LIMIT_REACHED");
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/api/saved-items")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.createSavedItem).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .post("/api/saved-items")
        .set("Authorization", "Bearer token")
        .send({
          type: "recipe",
          title: "Test Recipe",
        });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("DELETE /api/saved-items/:id", () => {
    it("deletes a saved item", async () => {
      vi.mocked(storage.deleteSavedItem).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/saved-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for non-existent item", async () => {
      vi.mocked(storage.deleteSavedItem).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/saved-items/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/saved-items/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.deleteSavedItem).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .delete("/api/saved-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});
