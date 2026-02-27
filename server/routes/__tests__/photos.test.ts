import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  analyzePhoto,
  refineAnalysis,
  needsFollowUp,
  getFollowUpQuestions,
} from "../../services/photo-analysis";
import { batchNutritionLookup } from "../../services/nutrition-lookup";
import { register, _testInternals } from "../photos";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getDailyScanCount: vi.fn(),
    createScannedItem: vi.fn(),
    createDailyLog: vi.fn(),
  },
}));

vi.mock("../../services/photo-analysis", () => ({
  analyzePhoto: vi.fn(),
  refineAnalysis: vi.fn(),
  needsFollowUp: vi.fn(),
  getFollowUpQuestions: vi.fn(),
}));

vi.mock("../../services/nutrition-lookup", () => ({
  batchNutritionLookup: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("multer", () => {
  const multerMock = () => ({
    single:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.file = {
          buffer: Buffer.from("fake-image"),
          mimetype: "image/jpeg",
          originalname: "test.jpg",
          size: 1000,
        } as Express.Multer.File;
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

describe("Photos Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/photos/analyze", () => {
    it("analyzes a photo successfully", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1 medium", confidence: 0.9 }],
        overallConfidence: 0.9,
      } as never);
      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map([
          [
            "1 medium Apple",
            { calories: 95, protein: 0.5, carbs: 25, fat: 0.3 },
          ],
        ]) as never,
      );
      vi.mocked(needsFollowUp).mockReturnValue(false);
      vi.mocked(getFollowUpQuestions).mockReturnValue([]);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.foods).toHaveLength(1);
      expect(res.body.overallConfidence).toBe(0.9);
    });

    it("returns 429 when scan limit reached", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(100 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
      } as never);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(429);
    });

    it("returns 500 when analyzePhoto throws", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockRejectedValue(new Error("Vision API down"));

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(500);
    });

    it("returns needsFollowUp and followUpQuestions in response", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple Pie", quantity: "1 slice", confidence: 0.4 }],
        overallConfidence: 0.4,
      } as never);
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map() as never);
      vi.mocked(needsFollowUp).mockReturnValue(true);
      vi.mocked(getFollowUpQuestions).mockReturnValue([
        "What type of apple pie?",
      ]);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.needsFollowUp).toBe(true);
      expect(res.body.followUpQuestions).toEqual(["What type of apple pie?"]);
      expect(res.body.overallConfidence).toBe(0.4);
    });
  });

  describe("POST /api/photos/analyze/:sessionId/followup", () => {
    it("returns 404 for expired session", async () => {
      const res = await request(app)
        .post("/api/photos/analyze/nonexistent/followup")
        .set("Authorization", "Bearer token")
        .send({ question: "What type?", answer: "Granny Smith" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for missing fields", async () => {
      const res = await request(app)
        .post("/api/photos/analyze/some-id/followup")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/photos/analyze/:sessionId/followup - error paths", () => {
    it("returns 500 on service error", async () => {
      // We need to seed a session to get past the 404 check.
      // First create a valid session via analyze, then make refineAnalysis throw.
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1", confidence: 0.5 }],
        overallConfidence: 0.5,
      } as never);
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map() as never);
      vi.mocked(needsFollowUp).mockReturnValue(true);
      vi.mocked(getFollowUpQuestions).mockReturnValue(["What type?"]);

      const analyzeRes = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      const sessionId = analyzeRes.body.sessionId;

      // Now make refineAnalysis throw
      vi.mocked(refineAnalysis).mockRejectedValue(new Error("AI error"));

      const res = await request(app)
        .post(`/api/photos/analyze/${sessionId}/followup`)
        .set("Authorization", "Bearer token")
        .send({ question: "What type?", answer: "Granny Smith" });

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/photos/confirm", () => {
    it("returns 400 for invalid body", async () => {
      const res = await request(app)
        .post("/api/photos/confirm")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("creates scanned item and daily log via transaction", async () => {
      const { db } = await import("../../db");
      const mockItem = {
        id: 42,
        userId: "1",
        productName: "Apple",
        calories: "95",
        protein: "0",
        carbs: "25",
        fat: "0",
        sourceType: "photo",
      };

      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const fakeTx = {
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([mockItem]),
            }),
          }),
        };
        return cb(fakeTx as never);
      });

      const res = await request(app)
        .post("/api/photos/confirm")
        .set("Authorization", "Bearer token")
        .send({
          sessionId: "test-session-id",
          foods: [
            {
              name: "Apple",
              quantity: "1 medium",
              calories: 95,
              protein: 0,
              carbs: 25,
              fat: 0,
            },
          ],
          mealType: "snack",
        });

      expect(res.status).toBe(201);
      expect(res.body.productName).toBe("Apple");
    });

    it("returns 500 when transaction fails", async () => {
      const { db } = await import("../../db");
      vi.mocked(db.transaction).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .post("/api/photos/confirm")
        .set("Authorization", "Bearer token")
        .send({
          sessionId: "test-session-id",
          foods: [
            {
              name: "Apple",
              quantity: "1",
              calories: 95,
              protein: 0,
              carbs: 25,
              fat: 0,
            },
          ],
        });

      expect(res.status).toBe(500);
    });
  });

  describe("Session bounds", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      _testInternals.analysisSessionStore.clear();
      _testInternals.userSessionCount.clear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns 429 when user exceeds per-user session limit", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1 medium", confidence: 0.9 }],
        overallConfidence: 0.9,
      } as never);
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map() as never);
      vi.mocked(needsFollowUp).mockReturnValue(false);
      vi.mocked(getFollowUpQuestions).mockReturnValue([]);

      // Pre-fill 3 sessions for user "1" (the max)
      for (let i = 0; i < 3; i++) {
        _testInternals.analysisSessionStore.set(`existing-session-${i}`, {
          userId: "1",
          result: { foods: [], overallConfidence: 0.9 },
          imageBase64: "abc",
          createdAt: Date.now(),
        });
      }
      _testInternals.userSessionCount.set("1", 3);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("USER_SESSION_LIMIT");
    });

    it("allows session when user is under per-user limit", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1 medium", confidence: 0.9 }],
        overallConfidence: 0.9,
      } as never);
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map() as never);
      vi.mocked(needsFollowUp).mockReturnValue(false);
      vi.mocked(getFollowUpQuestions).mockReturnValue([]);

      // Pre-fill 2 sessions for user "1" (under the limit of 3)
      for (let i = 0; i < 2; i++) {
        _testInternals.analysisSessionStore.set(`existing-session-${i}`, {
          userId: "1",
          result: { foods: [], overallConfidence: 0.9 },
          imageBase64: "abc",
          createdAt: Date.now(),
        });
      }
      _testInternals.userSessionCount.set("1", 2);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
    });

    it("returns 429 when global session limit is reached", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1 medium", confidence: 0.9 }],
        overallConfidence: 0.9,
      } as never);
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map() as never);
      vi.mocked(needsFollowUp).mockReturnValue(false);
      vi.mocked(getFollowUpQuestions).mockReturnValue([]);

      // Fill the session store to the global cap (1000 entries)
      for (let i = 0; i < 1000; i++) {
        _testInternals.analysisSessionStore.set(`global-session-${i}`, {
          userId: "other",
          result: { foods: [], overallConfidence: 0.5 },
          imageBase64: "x",
          createdAt: Date.now(),
        });
      }

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("SESSION_LIMIT_REACHED");
    });

    it("clears user session count when session is cleared via clearSession", () => {
      const sessionId = "session-to-clear";

      // Manually seed a session for user "1"
      _testInternals.analysisSessionStore.set(sessionId, {
        userId: "1",
        result: { foods: [], overallConfidence: 0.9 },
        imageBase64: "abc",
        createdAt: Date.now(),
      });
      _testInternals.userSessionCount.set("1", 1);

      // Clear the session
      _testInternals.clearSession(sessionId);

      // Verify session was removed from the store
      expect(_testInternals.analysisSessionStore.size).toBe(0);
      // Verify user session count was cleaned up (deleted when reaching 0)
      expect(_testInternals.userSessionCount.get("1")).toBeUndefined();
    });
  });
});
