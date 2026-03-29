import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  analyzePhoto,
  analyzeRecipePhoto,
  refineAnalysis,
  needsFollowUp,
  getFollowUpQuestions,
} from "../../services/photo-analysis";
import { batchNutritionLookup } from "../../services/nutrition-lookup";
import { register } from "../photos";
import { createMockScannedItem } from "../../__tests__/factories";
import {
  _testInternals,
  clearAnalysisSession,
  MAX_SESSIONS_PER_USER,
  MAX_SESSIONS_GLOBAL,
  MAX_IMAGE_SIZE_BYTES,
} from "../../storage/sessions";

vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    storage: {
      getSubscriptionStatus: vi.fn(),
      getDailyScanCount: vi.fn(),
      createScannedItem: vi.fn(),
      createDailyLog: vi.fn(),
      createScannedItemWithLog: vi.fn(),
      // Session functions use real in-memory implementation (no DB)
      canCreateAnalysisSession: sessions.canCreateAnalysisSession,
      createAnalysisSession: sessions.createAnalysisSession,
      getAnalysisSession: sessions.getAnalysisSession,
      updateAnalysisSession: sessions.updateAnalysisSession,
      clearAnalysisSession: sessions.clearAnalysisSession,
      canCreateLabelSession: sessions.canCreateLabelSession,
      createLabelSession: sessions.createLabelSession,
      getLabelSession: sessions.getLabelSession,
      clearLabelSession: sessions.clearLabelSession,
    },
  };
});

vi.mock("../../services/photo-analysis", () => ({
  analyzePhoto: vi.fn(),
  analyzeRecipePhoto: vi.fn(),
  refineAnalysis: vi.fn(),
  needsFollowUp: vi.fn(),
  getFollowUpQuestions: vi.fn(),
}));

vi.mock("../../services/nutrition-lookup", () => ({
  batchNutritionLookup: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

// Valid JPEG magic bytes (FF D8 FF) + minimal padding for magic-byte validation
const VALID_JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const { mockFileBuffer } = vi.hoisted(() => ({
  mockFileBuffer: {
    current: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
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
        req.file = {
          buffer: mockFileBuffer.current,
          mimetype: "image/jpeg",
          originalname: "test.jpg",
          size: mockFileBuffer.current.length,
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
    // Reset to valid JPEG buffer for magic-byte validation
    mockFileBuffer.current = VALID_JPEG_HEADER;
    // Clear pending timeouts before clearing maps to prevent leaks
    for (const [, timeout] of _testInternals.sessionTimeouts) {
      clearTimeout(timeout);
    }
    for (const [, timeout] of _testInternals.labelSessionTimeouts) {
      clearTimeout(timeout);
    }
    // Clear in-memory session state between tests
    _testInternals.analysisSessionStore.clear();
    _testInternals.sessionTimeouts.clear();
    _testInternals.userSessionCount.clear();
    _testInternals.labelSessionStore.clear();
    _testInternals.labelSessionTimeouts.clear();
    _testInternals.userLabelSessionCount.clear();
    app = createApp();
  });

  describe("POST /api/photos/analyze", () => {
    it("analyzes a photo successfully", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1 medium", confidence: 0.9 }],
        overallConfidence: 0.9,
      });
      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map([
          [
            "1 medium Apple",
            { calories: 95, protein: 0.5, carbs: 25, fat: 0.3 },
          ],
        ]),
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
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(100);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(429);
    });

    it("returns 500 when analyzePhoto throws", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(analyzePhoto).mockRejectedValue(new Error("Vision API down"));

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(500);
    });

    it("returns needsFollowUp and followUpQuestions in response", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple Pie", quantity: "1 slice", confidence: 0.4 }],
        overallConfidence: 0.4,
      });
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());
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
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1", confidence: 0.5 }],
        overallConfidence: 0.5,
      });
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());
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

    it("creates scanned item and daily log via storage", async () => {
      const mockItem = createMockScannedItem({
        id: 42,
        userId: "1",
        productName: "Apple",
        calories: "95",
        protein: "0",
        carbs: "25",
        fat: "0",
        sourceType: "photo",
      });

      vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(mockItem);

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
      expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "1",
          productName: "Apple",
          sourceType: "photo",
        }),
        expect.objectContaining({ mealType: "snack" }),
      );
    });

    it("returns 500 when storage call fails", async () => {
      vi.mocked(storage.createScannedItemWithLog).mockRejectedValue(
        new Error("DB error"),
      );

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
    const dummySession = {
      userId: "1",
      result: { foods: [], overallConfidence: 0.9, followUpQuestions: [] },
      createdAt: Date.now(),
    };

    function setupAnalyzeMocks() {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(0);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as Awaited<ReturnType<typeof storage.getSubscriptionStatus>>);
      vi.mocked(analyzePhoto).mockResolvedValue({
        foods: [{ name: "Apple", quantity: "1 medium", confidence: 0.9 }],
        overallConfidence: 0.9,
      } as Awaited<ReturnType<typeof analyzePhoto>>);
      vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());
      vi.mocked(needsFollowUp).mockReturnValue(false);
      vi.mocked(getFollowUpQuestions).mockReturnValue([]);
    }

    beforeEach(() => {
      vi.useFakeTimers();
      _testInternals.analysisSessionStore.clear();
      _testInternals.userSessionCount.clear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns 429 when user exceeds per-user session limit", async () => {
      setupAnalyzeMocks();

      for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
        _testInternals.analysisSessionStore.set(`existing-${i}`, {
          ...dummySession,
        });
      }
      _testInternals.userSessionCount.set("1", MAX_SESSIONS_PER_USER);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("USER_SESSION_LIMIT");
      // Verify analyzePhoto was NOT called (early rejection saves API credits)
      expect(analyzePhoto).not.toHaveBeenCalled();
    });

    it("allows session when user is under per-user limit", async () => {
      setupAnalyzeMocks();

      const underLimit = MAX_SESSIONS_PER_USER - 1;
      for (let i = 0; i < underLimit; i++) {
        _testInternals.analysisSessionStore.set(`existing-${i}`, {
          ...dummySession,
        });
      }
      _testInternals.userSessionCount.set("1", underLimit);

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
    });

    it("returns 429 when global session limit is reached", async () => {
      setupAnalyzeMocks();

      // Fill to global cap using the exported constant
      for (let i = 0; i < MAX_SESSIONS_GLOBAL; i++) {
        _testInternals.analysisSessionStore.set(`global-${i}`, {
          ...dummySession,
          userId: "other",
        });
      }

      const res = await request(app)
        .post("/api/photos/analyze")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("SESSION_LIMIT_REACHED");
      expect(analyzePhoto).not.toHaveBeenCalled();
    });

    it("returns 413 when image exceeds size limit", async () => {
      setupAnalyzeMocks();

      const originalBuffer = mockFileBuffer.current;
      // Create oversized buffer with valid JPEG magic bytes
      const oversized = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1);
      oversized[0] = 0xff;
      oversized[1] = 0xd8;
      oversized[2] = 0xff;
      mockFileBuffer.current = oversized;

      try {
        const res = await request(app)
          .post("/api/photos/analyze")
          .set("Authorization", "Bearer token")
          .attach("photo", Buffer.from("fake"), "test.jpg");

        expect(res.status).toBe(413);
        expect(res.body.code).toBe("IMAGE_TOO_LARGE");
        expect(analyzePhoto).not.toHaveBeenCalled();
      } finally {
        mockFileBuffer.current = originalBuffer;
      }
    });

    it("clears user session count when session is cleared via clearSession", () => {
      const sessionId = "session-to-clear";

      _testInternals.analysisSessionStore.set(sessionId, {
        ...dummySession,
      });
      _testInternals.userSessionCount.set("1", 1);

      clearAnalysisSession(sessionId);

      expect(_testInternals.analysisSessionStore.size).toBe(0);
      expect(_testInternals.userSessionCount.get("1")).toBeUndefined();
    });
  });

  describe("POST /api/photos/analyze-recipe", () => {
    it("returns 403 when user is free tier (premium gate)", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/photos/analyze-recipe")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(403);
    });

    it("returns 200 with recipe data for premium user", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(analyzeRecipePhoto).mockResolvedValue({
        title: "Pancakes",
        description: "Fluffy pancakes",
        ingredients: [{ name: "flour", quantity: "2", unit: "cups" }],
        instructions: "1. Mix\n2. Cook",
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 15,
        cuisine: "American",
        dietTags: [],
        caloriesPerServing: 250,
        proteinPerServing: 6,
        carbsPerServing: 40,
        fatPerServing: 8,
        confidence: 0.9,
      });

      const res = await request(app)
        .post("/api/photos/analyze-recipe")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Pancakes");
      expect(res.body.confidence).toBe(0.9);
      expect(res.body.ingredients).toHaveLength(1);
    });

    it("returns 500 when analyzeRecipePhoto throws", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(analyzeRecipePhoto).mockRejectedValue(
        new Error("Vision API down"),
      );

      const res = await request(app)
        .post("/api/photos/analyze-recipe")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(500);
    });
  });
});
