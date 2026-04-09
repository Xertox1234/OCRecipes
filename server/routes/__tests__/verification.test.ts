import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register, _testInternals } from "../verification";

vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    storage: {
      hasUserVerified: vi.fn(),
      getVerification: vi.fn(),
      getVerificationHistory: vi.fn(),
      getUserVerificationStats: vi.fn(),
      submitVerification: vi.fn(),
      hasUserFrontLabelScanned: vi.fn(),
      confirmFrontLabelData: vi.fn(),
      getUserCompositeScore: vi.fn(),
      getReformulationFlags: vi.fn(),
      getReformulationFlagCount: vi.fn(),
      resolveReformulationFlag: vi.fn(),
      getReformulationFlag: vi.fn(),
      getLabelSession: sessions.getLabelSession,
      frontLabelSessionStore: sessions.frontLabelSessionStore,
    },
  };
});

vi.mock("../../services/reformulation-detection", () => ({
  detectReformulation: vi.fn().mockReturnValue({
    shouldFlag: false,
    divergentCount: 0,
    distinctUsers: 0,
  }),
}));

vi.mock("../../lib/openai", () => ({ isAiConfigured: true }));

vi.mock("../../services/front-label-analysis", () => ({
  analyzeFrontLabel: vi.fn().mockResolvedValue({
    brand: "TestBrand",
    productName: "TestProduct",
    netWeight: "100g",
    claims: ["Gluten Free"],
    confidence: 0.9,
  }),
}));

vi.mock("../../services/verification-comparison", () => ({
  compareWithVerifications: vi
    .fn()
    .mockReturnValue({ isMatch: true, matchCount: 1 }),
  computeConsensus: vi.fn().mockReturnValue(null),
  extractVerificationNutrition: vi.fn().mockReturnValue({
    calories: 200,
    protein: 10,
    totalCarbs: 25,
    totalFat: 8,
  }),
  CONSENSUS_THRESHOLD: 3,
}));

vi.mock("../../db", () => ({
  db: { transaction: vi.fn() },
}));

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/image-mime", () => ({
  detectImageMimeType: vi.fn().mockReturnValue("image/jpeg"),
}));

const VALID_JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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
          buffer: VALID_JPEG_HEADER,
          mimetype: "image/jpeg",
          originalname: "front.jpg",
          size: VALID_JPEG_HEADER.length,
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

describe("Verification Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    _testInternals.frontLabelSessionStore.clear();
    // Set mock user "1" as admin for reformulation endpoint tests
    process.env.ADMIN_USER_IDS = "1";
    app = createApp();
  });

  describe("POST /api/verification/front-label", () => {
    it("returns 400 when barcode is missing", async () => {
      vi.mocked(storage.hasUserVerified).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/verification/front-label")
        .send();

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid barcode format");
    });

    it("returns 400 when user has not back-label verified", async () => {
      vi.mocked(storage.hasUserVerified).mockResolvedValue(false);

      const res = await request(app)
        .post("/api/verification/front-label")
        .send({ barcode: "1234567890" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("verify the nutrition label");
    });

    it("returns sessionId and extracted data on success", async () => {
      vi.mocked(storage.hasUserVerified).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/verification/front-label")
        .send({ barcode: "1234567890" });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.data.brand).toBe("TestBrand");
      expect(res.body.data.claims).toEqual(["Gluten Free"]);
    });

    it("creates a session in the store", async () => {
      vi.mocked(storage.hasUserVerified).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/verification/front-label")
        .send({ barcode: "1234567890" });

      expect(_testInternals.frontLabelSessionStore.size).toBe(1);
      const session = _testInternals.frontLabelSessionStore.get(
        res.body.sessionId,
      );
      expect(session).toBeDefined();
      expect(session!.barcode).toBe("1234567890");
    });
  });

  describe("POST /api/verification/front-label/confirm", () => {
    it("returns 404 when session does not exist", async () => {
      const res = await request(app)
        .post("/api/verification/front-label/confirm")
        .send({ barcode: "1234567890", sessionId: "nonexistent" });

      expect(res.status).toBe(404);
    });

    it("returns 400 when barcode does not match session", async () => {
      // Manually create a session
      _testInternals.frontLabelSessionStore.set("test-session", {
        userId: "1",
        data: {
          brand: "Test",
          productName: "Product",
          netWeight: "100g",
          claims: [],
          confidence: 0.9,
        },
        barcode: "1234567890",
        createdAt: Date.now(),
      });

      vi.mocked(storage.hasUserVerified).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/verification/front-label/confirm")
        .send({ barcode: "99999999999", sessionId: "test-session" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("does not match");
    });

    it("stores front-label data and marks user on success", async () => {
      _testInternals.frontLabelSessionStore.set("test-session", {
        userId: "1",
        data: {
          brand: "Kind",
          productName: "Nuts & Sea Salt",
          netWeight: "40g",
          claims: ["Gluten Free"],
          confidence: 0.9,
        },
        barcode: "1234567890",
        createdAt: Date.now(),
      });

      vi.mocked(storage.hasUserVerified).mockResolvedValue(true);
      vi.mocked(storage.confirmFrontLabelData).mockResolvedValue();

      const res = await request(app)
        .post("/api/verification/front-label/confirm")
        .send({ barcode: "1234567890", sessionId: "test-session" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.frontLabelScanned).toBe(true);
      expect(storage.confirmFrontLabelData).toHaveBeenCalledOnce();
    });

    it("cleans up session after successful confirm", async () => {
      _testInternals.frontLabelSessionStore.set("test-session", {
        userId: "1",
        data: {
          brand: "Kind",
          productName: null,
          netWeight: null,
          claims: [],
          confidence: 0.9,
        },
        barcode: "1234567890",
        createdAt: Date.now(),
      });

      vi.mocked(storage.hasUserVerified).mockResolvedValue(true);
      vi.mocked(storage.confirmFrontLabelData).mockResolvedValue();

      await request(app)
        .post("/api/verification/front-label/confirm")
        .send({ barcode: "1234567890", sessionId: "test-session" });

      expect(_testInternals.frontLabelSessionStore.size).toBe(0);
    });

    it("returns 400 when user has not back-label verified", async () => {
      _testInternals.frontLabelSessionStore.set("test-session", {
        userId: "1",
        data: {
          brand: "Test",
          productName: null,
          netWeight: null,
          claims: [],
          confidence: 0.9,
        },
        barcode: "1234567890",
        createdAt: Date.now(),
      });

      vi.mocked(storage.hasUserVerified).mockResolvedValue(false);

      const res = await request(app)
        .post("/api/verification/front-label/confirm")
        .send({ barcode: "1234567890", sessionId: "test-session" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("nutrition label first");
    });
  });

  describe("GET /api/verification/:barcode", () => {
    it("includes hasFrontLabelData when front label exists", async () => {
      vi.mocked(storage.getVerification).mockResolvedValue({
        id: 1,
        barcode: "1234567890",
        verificationLevel: "verified",
        verificationCount: 3,
        consensusNutritionData: {
          calories: 200,
          protein: 10,
          carbs: 25,
          fat: 8,
        },
        frontLabelData: { brand: "Test" },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get("/api/verification/1234567890");

      expect(res.status).toBe(200);
      expect(res.body.hasFrontLabelData).toBe(true);
    });

    it("returns hasFrontLabelData false when no front label", async () => {
      vi.mocked(storage.getVerification).mockResolvedValue({
        id: 1,
        barcode: "1234567890",
        verificationLevel: "single_verified",
        verificationCount: 1,
        consensusNutritionData: null,
        frontLabelData: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get("/api/verification/1234567890");

      expect(res.status).toBe(200);
      expect(res.body.hasFrontLabelData).toBe(false);
    });

    it("returns hasFrontLabelData false for unknown barcode", async () => {
      vi.mocked(storage.getVerification).mockResolvedValue(
        undefined as unknown as Awaited<
          ReturnType<typeof storage.getVerification>
        >,
      );

      const res = await request(app).get("/api/verification/99999999");

      expect(res.status).toBe(200);
      expect(res.body.hasFrontLabelData).toBe(false);
    });
  });

  describe("POST /api/verification/submit", () => {
    it("includes canScanFrontLabel in response", async () => {
      const { _testInternals: sessionInternals } = await import(
        "../../storage/sessions"
      );
      sessionInternals.labelSessionStore.set("label-session", {
        userId: "1",
        labelData: {
          servingSize: "1 cup",
          servingsPerContainer: 1,
          calories: 200,
          totalFat: 8,
          saturatedFat: 2,
          transFat: 0,
          cholesterol: null,
          sodium: null,
          totalCarbs: 25,
          dietaryFiber: null,
          totalSugars: null,
          addedSugars: null,
          protein: 10,
          vitaminD: null,
          calcium: null,
          iron: null,
          potassium: null,
          confidence: 0.9,
          productName: "Test Product",
        },
        barcode: "1234567890",
        createdAt: Date.now(),
      });

      vi.mocked(storage.hasUserVerified).mockResolvedValue(false);
      vi.mocked(storage.getVerificationHistory).mockResolvedValue([]);
      vi.mocked(storage.submitVerification).mockResolvedValue();
      vi.mocked(storage.hasUserFrontLabelScanned).mockResolvedValue(false);

      const res = await request(app)
        .post("/api/verification/submit")
        .send({ barcode: "1234567890", sessionId: "label-session" });

      expect(res.status).toBe(200);
      expect(res.body.canScanFrontLabel).toBe(true);
    });
  });

  describe("GET /api/verification/reformulation-flags", () => {
    it("returns list with total count", async () => {
      const mockFlags = [
        {
          id: 1,
          barcode: "111111",
          status: "flagged",
          divergentScanCount: 4,
          previousConsensus: { calories: 200, protein: 10, carbs: 25, fat: 8 },
          previousVerificationLevel: "verified",
          previousVerificationCount: 5,
          detectedAt: new Date(),
          resolvedAt: null,
        },
        {
          id: 2,
          barcode: "222222",
          status: "flagged",
          divergentScanCount: 3,
          previousConsensus: { calories: 150, protein: 8, carbs: 20, fat: 6 },
          previousVerificationLevel: "verified",
          previousVerificationCount: 3,
          detectedAt: new Date(),
          resolvedAt: null,
        },
      ];

      vi.mocked(storage.getReformulationFlags).mockResolvedValue(mockFlags);
      vi.mocked(storage.getReformulationFlagCount).mockResolvedValue(2);

      const res = await request(app).get(
        "/api/verification/reformulation-flags",
      );

      expect(res.status).toBe(200);
      expect(res.body.flags).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
      expect(storage.getReformulationFlags).toHaveBeenCalledWith(
        undefined,
        50,
        0,
      );
    });

    it("passes status filter to storage", async () => {
      vi.mocked(storage.getReformulationFlags).mockResolvedValue([]);
      vi.mocked(storage.getReformulationFlagCount).mockResolvedValue(0);

      const res = await request(app).get(
        "/api/verification/reformulation-flags?status=resolved",
      );

      expect(res.status).toBe(200);
      expect(storage.getReformulationFlags).toHaveBeenCalledWith(
        "resolved",
        50,
        0,
      );
    });

    it("respects limit and offset params", async () => {
      vi.mocked(storage.getReformulationFlags).mockResolvedValue([]);
      vi.mocked(storage.getReformulationFlagCount).mockResolvedValue(0);

      const res = await request(app).get(
        "/api/verification/reformulation-flags?limit=10&offset=20",
      );

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(10);
      expect(res.body.offset).toBe(20);
      expect(storage.getReformulationFlags).toHaveBeenCalledWith(
        undefined,
        10,
        20,
      );
    });

    it("clamps limit to 100", async () => {
      vi.mocked(storage.getReformulationFlags).mockResolvedValue([]);
      vi.mocked(storage.getReformulationFlagCount).mockResolvedValue(0);

      const res = await request(app).get(
        "/api/verification/reformulation-flags?limit=999",
      );

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
      expect(storage.getReformulationFlags).toHaveBeenCalledWith(
        undefined,
        100,
        0,
      );
    });
  });

  describe("POST /api/verification/reformulation-flags/:flagId/resolve", () => {
    it("returns success when resolving a valid flag", async () => {
      vi.mocked(storage.resolveReformulationFlag).mockResolvedValue(true);

      const res = await request(app).post(
        "/api/verification/reformulation-flags/42/resolve",
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.resolveReformulationFlag).toHaveBeenCalledWith(42);
    });

    it("returns 404 when flag does not exist", async () => {
      vi.mocked(storage.resolveReformulationFlag).mockResolvedValue(false);

      const res = await request(app).post(
        "/api/verification/reformulation-flags/999/resolve",
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("returns 400 for non-numeric flagId", async () => {
      const res = await request(app).post(
        "/api/verification/reformulation-flags/abc/resolve",
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid flag ID");
      expect(storage.resolveReformulationFlag).not.toHaveBeenCalled();
    });

    it("returns 403 for non-admin user", async () => {
      process.env.ADMIN_USER_IDS = "999";

      const res = await request(app).post(
        "/api/verification/reformulation-flags/42/resolve",
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Admin access required");
    });
  });

  describe("reformulation-flags admin auth", () => {
    it("GET returns 403 for non-admin user", async () => {
      process.env.ADMIN_USER_IDS = "999";

      const res = await request(app).get(
        "/api/verification/reformulation-flags",
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Admin access required");
    });
  });

  describe("GET /api/verification/reformulation-flags count filter", () => {
    it("passes status to count function", async () => {
      vi.mocked(storage.getReformulationFlags).mockResolvedValue([]);
      vi.mocked(storage.getReformulationFlagCount).mockResolvedValue(0);

      await request(app).get(
        "/api/verification/reformulation-flags?status=resolved",
      );

      expect(storage.getReformulationFlagCount).toHaveBeenCalledWith(
        "resolved",
      );
    });

    it("passes undefined to count when no status filter", async () => {
      vi.mocked(storage.getReformulationFlags).mockResolvedValue([]);
      vi.mocked(storage.getReformulationFlagCount).mockResolvedValue(0);

      await request(app).get("/api/verification/reformulation-flags");

      expect(storage.getReformulationFlagCount).toHaveBeenCalledWith(undefined);
    });
  });
});
