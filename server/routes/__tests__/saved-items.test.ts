import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getSavedItems: vi.fn(),
    getSavedItemCount: vi.fn(),
    createSavedItem: vi.fn(),
    deleteSavedItem: vi.fn(),
  },
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
import { register } from "../saved-items";

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockSavedItem = {
  id: 1,
  userId: "1",
  productName: "Greek Yogurt",
  brandName: "Fage",
  calories: 120,
  protein: 18,
  carbs: 6,
  fat: 2,
  servingSize: "170g",
  barcode: null,
  createdAt: new Date("2024-01-15T12:00:00"),
};

describe("Saved Items Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/saved-items", () => {
    it("returns saved items list", async () => {
      vi.mocked(storage.getSavedItems).mockResolvedValue([mockSavedItem] as never);

      const res = await request(app)
        .get("/api/saved-items")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].productName).toBe("Greek Yogurt");
    });

    it("respects limit parameter", async () => {
      vi.mocked(storage.getSavedItems).mockResolvedValue([] as never);

      await request(app)
        .get("/api/saved-items?limit=10")
        .set("Authorization", "Bearer token");

      expect(storage.getSavedItems).toHaveBeenCalledWith("1", 10);
    });
  });

  describe("GET /api/saved-items/count", () => {
    it("returns count of saved items", async () => {
      vi.mocked(storage.getSavedItemCount).mockResolvedValue(5 as never);

      const res = await request(app)
        .get("/api/saved-items/count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
    });
  });

  describe("POST /api/saved-items", () => {
    it("creates a saved item", async () => {
      vi.mocked(storage.createSavedItem).mockResolvedValue(mockSavedItem as never);

      const res = await request(app)
        .post("/api/saved-items")
        .set("Authorization", "Bearer token")
        .send({
          type: "recipe",
          title: "Greek Yogurt Bowl",
          description: "Healthy breakfast option",
        });

      expect(res.status).toBe(201);
      expect(res.body.productName).toBe("Greek Yogurt");
    });

    it("returns 403 when limit reached", async () => {
      vi.mocked(storage.createSavedItem).mockResolvedValue(null as never);

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
  });

  describe("DELETE /api/saved-items/:id", () => {
    it("deletes a saved item", async () => {
      vi.mocked(storage.deleteSavedItem).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/saved-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for non-existent item", async () => {
      vi.mocked(storage.deleteSavedItem).mockResolvedValue(false as never);

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
  });
});
