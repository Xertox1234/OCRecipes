import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../taste-picks";

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

vi.mock("../../storage", () => ({
  storage: {
    getTastePicks: vi.fn(),
    setTastePicks: vi.fn(),
    getTastePickCandidates: vi.fn(),
    getUserProfile: vi.fn(),
    invalidateSuggestionCacheForUser: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: vi.fn((_label: string, promise: Promise<unknown>) => promise),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockCandidate = {
  id: 1,
  title: "Greek Salad",
  imageUrl: "https://example.com/greek.jpg",
  cuisineOrigin: "Mediterranean",
};

const mockPick = {
  recipeId: 1,
  title: "Greek Salad",
  imageUrl: "https://example.com/greek.jpg",
  cuisineOrigin: "Mediterranean",
};

describe("Taste Picks Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/taste-picks/candidates", () => {
    it("returns paginated candidates", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getTastePickCandidates).mockResolvedValue({
        candidates: [mockCandidate],
        total: 1,
        page: 1,
      });

      const res = await request(app).get("/api/taste-picks/candidates");

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].title).toBe("Greek Salad");
      expect(res.body.total).toBe(1);
    });

    it("passes dietType from query param when present", async () => {
      vi.mocked(storage.getTastePickCandidates).mockResolvedValue({
        candidates: [],
        total: 0,
        page: 1,
      });

      await request(app).get("/api/taste-picks/candidates?dietType=vegan");

      expect(vi.mocked(storage.getTastePickCandidates)).toHaveBeenCalledWith(
        expect.objectContaining({ dietType: "vegan" }),
      );
    });

    it("falls back to stored profile dietType when no query param", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        dietType: "vegetarian",
        cuisinePreferences: [],
        allergies: [],
      } as any);
      vi.mocked(storage.getTastePickCandidates).mockResolvedValue({
        candidates: [],
        total: 0,
        page: 1,
      });

      await request(app).get("/api/taste-picks/candidates");

      expect(vi.mocked(storage.getTastePickCandidates)).toHaveBeenCalledWith(
        expect.objectContaining({ dietType: "vegetarian" }),
      );
    });
  });

  describe("GET /api/taste-picks", () => {
    it("returns current picks", async () => {
      vi.mocked(storage.getTastePicks).mockResolvedValue([mockPick]);

      const res = await request(app).get("/api/taste-picks");

      expect(res.status).toBe(200);
      expect(res.body.picks).toHaveLength(1);
      expect(res.body.picks[0].recipeId).toBe(1);
    });
  });

  describe("PUT /api/taste-picks", () => {
    it("saves picks and returns updated preferences", async () => {
      vi.mocked(storage.setTastePicks).mockResolvedValue({
        picks: [mockPick],
        cuisinePreferences: ["Mediterranean"],
      });

      const res = await request(app)
        .put("/api/taste-picks")
        .send({ recipeIds: [1] });

      expect(res.status).toBe(200);
      expect(res.body.picks).toHaveLength(1);
      expect(res.body.cuisinePreferences).toContain("Mediterranean");
    });

    it("fires cache invalidation after save", async () => {
      vi.mocked(storage.setTastePicks).mockResolvedValue({
        picks: [],
        cuisinePreferences: ["Italian"],
      });

      await request(app).put("/api/taste-picks").send({ recipeIds: [] });

      expect(
        vi.mocked(storage.invalidateSuggestionCacheForUser),
      ).toHaveBeenCalled();
    });

    it("returns 400 when recipeIds is missing", async () => {
      const res = await request(app).put("/api/taste-picks").send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when recipeIds is not an array", async () => {
      const res = await request(app)
        .put("/api/taste-picks")
        .send({ recipeIds: "bad" });
      expect(res.status).toBe(400);
    });

    it("accepts empty recipeIds array", async () => {
      vi.mocked(storage.setTastePicks).mockResolvedValue({
        picks: [],
        cuisinePreferences: [],
      });

      const res = await request(app)
        .put("/api/taste-picks")
        .send({ recipeIds: [] });
      expect(res.status).toBe(200);
    });
  });
});
