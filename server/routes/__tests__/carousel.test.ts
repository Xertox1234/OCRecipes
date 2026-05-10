import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../carousel";
import { buildCarousel } from "../../services/carousel-builder";

vi.mock("../../middleware/auth");

vi.mock("../../services/carousel-builder", () => ({
  buildCarousel: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    dismissRecipe: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockCards = [
  {
    id: 1,
    title: "Pasta Primavera",
    imageUrl: "https://example.com/pasta.jpg",
    prepTimeMinutes: 25,
    recommendationReason: "Recently added recipe",
  },
  {
    id: 2,
    title: "Grilled Salmon",
    imageUrl: null,
    prepTimeMinutes: 30,
    recommendationReason: "Matches your keto diet",
  },
];

describe("Carousel Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/carousel", () => {
    it("returns carousel cards", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app).get("/api/carousel");

      expect(res.status).toBe(200);
      expect(res.body.cards).toHaveLength(2);
      expect(res.body.cards[0].title).toBe("Pasta Primavera");
      expect(buildCarousel).toHaveBeenCalledWith("1", null, undefined);
    });

    it("returns empty cards array when no recipes available", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue([]);

      const res = await request(app).get("/api/carousel");

      expect(res.status).toBe(200);
      expect(res.body.cards).toEqual([]);
    });

    it("passes parsed X-User-Hour header to buildCarousel", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app)
        .get("/api/carousel")
        .set("X-User-Hour", "19");

      expect(res.status).toBe(200);
      expect(buildCarousel).toHaveBeenCalledWith("1", null, 19);
    });

    it("falls back to server time when X-User-Hour header is absent (no header)", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app).get("/api/carousel");

      expect(res.status).toBe(200);
      expect(buildCarousel).toHaveBeenCalledWith("1", null, undefined);
    });

    it("falls back to server time when X-User-Hour is not a valid integer string", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app)
        .get("/api/carousel")
        .set("X-User-Hour", "foo");

      expect(res.status).toBe(200);
      expect(buildCarousel).toHaveBeenCalledWith("1", null, undefined);
    });

    it("falls back to server time when X-User-Hour is out of range (e.g. 24)", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app)
        .get("/api/carousel")
        .set("X-User-Hour", "24");

      expect(res.status).toBe(200);
      expect(buildCarousel).toHaveBeenCalledWith("1", null, undefined);
    });

    it("falls back to server time when X-User-Hour is a float string (e.g. 7.5)", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app)
        .get("/api/carousel")
        .set("X-User-Hour", "7.5");

      expect(res.status).toBe(200);
      expect(buildCarousel).toHaveBeenCalledWith("1", null, undefined);
    });

    it("falls back to server time when X-User-Hour is negative (e.g. -1)", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(buildCarousel).mockResolvedValue(mockCards);

      const res = await request(app)
        .get("/api/carousel")
        .set("X-User-Hour", "-1");

      expect(res.status).toBe(200);
      expect(buildCarousel).toHaveBeenCalledWith("1", null, undefined);
    });
  });

  describe("POST /api/carousel/dismiss", () => {
    it("dismisses a recipe", async () => {
      vi.mocked(storage.dismissRecipe).mockResolvedValue(undefined);

      const res = await request(app).post("/api/carousel/dismiss").send({
        recipeId: 1,
      });

      expect(res.status).toBe(204);
      expect(storage.dismissRecipe).toHaveBeenCalledWith("1", 1);
    });

    it("returns 400 for non-numeric recipeId", async () => {
      const res = await request(app).post("/api/carousel/dismiss").send({
        recipeId: "community:1",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing recipeId", async () => {
      const res = await request(app).post("/api/carousel/dismiss").send({});

      expect(res.status).toBe(400);
    });
  });
});
