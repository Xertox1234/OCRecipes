import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../pantry";
import { createMockPantryItem } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getPantryItems: vi.fn(),
    createPantryItem: vi.fn(),
    updatePantryItem: vi.fn(),
    deletePantryItem: vi.fn(),
    getExpiringPantryItems: vi.fn(),
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

function mockPremium() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium",
    expiresAt: null,
  });
}

const mockItem = createMockPantryItem({
  name: "Rice",
  quantity: "2",
  unit: "kg",
  category: "grains",
});

describe("Pantry Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/pantry", () => {
    it("returns pantry items", async () => {
      mockPremium();
      vi.mocked(storage.getPantryItems).mockResolvedValue([mockItem]);

      const res = await request(app)
        .get("/api/pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("POST /api/pantry", () => {
    it("creates a pantry item", async () => {
      mockPremium();
      vi.mocked(storage.createPantryItem).mockResolvedValue(mockItem);

      const res = await request(app)
        .post("/api/pantry")
        .set("Authorization", "Bearer token")
        .send({ name: "Rice", quantity: "2", unit: "kg", category: "grains" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Rice");
    });

    it("returns 400 for missing name", async () => {
      mockPremium();

      const res = await request(app)
        .post("/api/pantry")
        .set("Authorization", "Bearer token")
        .send({ quantity: "2" });

      expect(res.status).toBe(400);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/pantry")
        .set("Authorization", "Bearer token")
        .send({ name: "Rice" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("PUT /api/pantry/:id", () => {
    it("updates a pantry item", async () => {
      mockPremium();
      vi.mocked(storage.updatePantryItem).mockResolvedValue(
        createMockPantryItem({
          name: "Brown Rice",
          quantity: "2",
          unit: "kg",
          category: "grains",
        }),
      );

      const res = await request(app)
        .put("/api/pantry/1")
        .set("Authorization", "Bearer token")
        .send({ name: "Brown Rice" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Brown Rice");
    });

    it("returns 404 when item not found", async () => {
      mockPremium();
      vi.mocked(storage.updatePantryItem).mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/pantry/999")
        .set("Authorization", "Bearer token")
        .send({ name: "Updated" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      mockPremium();

      const res = await request(app)
        .put("/api/pantry/abc")
        .set("Authorization", "Bearer token")
        .send({ name: "Updated" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty body", async () => {
      mockPremium();

      const res = await request(app)
        .put("/api/pantry/1")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/pantry/:id", () => {
    it("deletes a pantry item", async () => {
      mockPremium();
      vi.mocked(storage.deletePantryItem).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/pantry/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when item not found", async () => {
      mockPremium();
      vi.mocked(storage.deletePantryItem).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/pantry/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      mockPremium();

      const res = await request(app)
        .delete("/api/pantry/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/pantry/expiring", () => {
    it("returns expiring items", async () => {
      mockPremium();
      vi.mocked(storage.getExpiringPantryItems).mockResolvedValue([mockItem]);

      const res = await request(app)
        .get("/api/pantry/expiring")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/pantry/expiring")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });
});
