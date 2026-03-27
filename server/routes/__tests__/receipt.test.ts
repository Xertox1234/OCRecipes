import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { analyzeReceiptPhotos } from "../../services/receipt-analysis";
import { register } from "../receipt";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getMonthlyReceiptScanCount: vi.fn(),
    createReceiptScan: vi.fn(),
    createPantryItems: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../lib/openai", () => ({ isAiConfigured: true }));

vi.mock("../../lib/image-mime", () => ({
  detectImageMimeType: vi.fn(() => "image/jpeg"),
}));

vi.mock("../../services/receipt-analysis", () => ({
  analyzeReceiptPhotos: vi.fn(),
}));

const { mockFiles } = vi.hoisted(() => ({
  mockFiles: {
    current: [
      {
        buffer: Buffer.from("fake-image"),
        mimetype: "image/jpeg",
        originalname: "receipt.jpg",
        size: 1000,
        fieldname: "photos",
      },
    ] as Express.Multer.File[],
  },
}));

vi.mock("multer", () => {
  const multerMock = () => ({
    array:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.files = mockFiles.current;
        next();
      },
    single:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
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

function setupPremiumMock() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium",
  } as never);
}

function setupFreeMock() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "free",
  } as never);
}

describe("Receipt Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.current = [
      {
        buffer: Buffer.from("fake-image"),
        mimetype: "image/jpeg",
        originalname: "receipt.jpg",
        size: 1000,
        fieldname: "photos",
      },
    ] as Express.Multer.File[];
    app = createApp();
  });

  describe("POST /api/receipt/scan", () => {
    it("analyzes receipt photos and returns results", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        0 as never,
      );
      vi.mocked(storage.createReceiptScan).mockResolvedValue({} as never);

      const mockResult = {
        items: [
          {
            name: "Chicken Breast",
            originalName: "CKEN BRST",
            quantity: 1,
            category: "meat",
            isFood: true,
            estimatedShelfLifeDays: 5,
            confidence: 0.9,
          },
        ],
        storeName: "Walmart",
        isPartialExtraction: false,
        overallConfidence: 0.85,
      };
      vi.mocked(analyzeReceiptPhotos).mockResolvedValue(mockResult as never);

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.storeName).toBe("Walmart");
      expect(res.body.overallConfidence).toBe(0.85);
    });

    it("returns 403 for free tier user", async () => {
      setupFreeMock();

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(403);
    });

    it("returns 400 when no photos provided", async () => {
      setupPremiumMock();
      mockFiles.current = [] as unknown as Express.Multer.File[];

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 429 when monthly scan limit reached", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        15 as never,
      );

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(429);
    });

    it("records failed scan when analysis throws", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        0 as never,
      );
      vi.mocked(storage.createReceiptScan).mockResolvedValue({} as never);
      vi.mocked(analyzeReceiptPhotos).mockRejectedValue(
        new Error("Analysis failed"),
      );

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(500);
      expect(storage.createReceiptScan).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("records partial status when isPartialExtraction is true", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        0 as never,
      );
      vi.mocked(storage.createReceiptScan).mockResolvedValue({} as never);

      vi.mocked(analyzeReceiptPhotos).mockResolvedValue({
        items: [
          {
            name: "Apple",
            originalName: "APPLE",
            quantity: 3,
            category: "produce",
            isFood: true,
            estimatedShelfLifeDays: 10,
            confidence: 0.7,
          },
        ],
        isPartialExtraction: true,
        overallConfidence: 0.6,
      } as never);

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(200);
      expect(storage.createReceiptScan).toHaveBeenCalledWith(
        expect.objectContaining({ status: "partial" }),
      );
    });

    it("records failed status when overallConfidence < 0.3", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        0 as never,
      );
      vi.mocked(storage.createReceiptScan).mockResolvedValue({} as never);

      vi.mocked(analyzeReceiptPhotos).mockResolvedValue({
        items: [],
        isPartialExtraction: false,
        overallConfidence: 0.2,
      } as never);

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(200);
      expect(storage.createReceiptScan).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("records completed status for good confidence", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        0 as never,
      );
      vi.mocked(storage.createReceiptScan).mockResolvedValue({} as never);

      vi.mocked(analyzeReceiptPhotos).mockResolvedValue({
        items: [
          {
            name: "Milk",
            originalName: "MLK",
            quantity: 1,
            category: "dairy",
            isFood: true,
            estimatedShelfLifeDays: 14,
            confidence: 0.9,
          },
        ],
        isPartialExtraction: false,
        overallConfidence: 0.9,
      } as never);

      const res = await request(app)
        .post("/api/receipt/scan")
        .set("Authorization", "Bearer token")
        .attach("photos", Buffer.from("fake"), "receipt.jpg");

      expect(res.status).toBe(200);
      expect(storage.createReceiptScan).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed" }),
      );
    });
  });

  describe("POST /api/receipt/confirm", () => {
    it("creates pantry items from confirmed receipt items", async () => {
      setupPremiumMock();

      const mockCreated = [
        { id: 1, name: "Chicken Breast", quantity: "1", category: "meat" },
        { id: 2, name: "Milk", quantity: "1", category: "dairy" },
      ];
      vi.mocked(storage.createPantryItems).mockResolvedValue(
        mockCreated as never,
      );

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({
          items: [
            {
              name: "Chicken Breast",
              quantity: 1,
              category: "meat",
              estimatedShelfLifeDays: 5,
            },
            {
              name: "Milk",
              quantity: 1,
              unit: "gal",
              category: "dairy",
              estimatedShelfLifeDays: 14,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.added).toBe(2);
      expect(res.body.items).toHaveLength(2);
    });

    it("returns 403 for free tier user", async () => {
      setupFreeMock();

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({
          items: [
            {
              name: "Apple",
              quantity: 1,
              category: "produce",
              estimatedShelfLifeDays: 7,
            },
          ],
        });

      expect(res.status).toBe(403);
    });

    it("returns 400 for invalid body (empty items)", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({ items: [] });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing items field", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid item data", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({
          items: [
            {
              name: "", // min(1) requires non-empty
              quantity: 1,
              category: "other",
              estimatedShelfLifeDays: 5,
            },
          ],
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for shelf life out of range", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({
          items: [
            {
              name: "Test Item",
              quantity: 1,
              category: "other",
              estimatedShelfLifeDays: 731, // max 730
            },
          ],
        });

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage fails", async () => {
      setupPremiumMock();
      vi.mocked(storage.createPantryItems).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/receipt/confirm")
        .set("Authorization", "Bearer token")
        .send({
          items: [
            {
              name: "Apple",
              quantity: 3,
              category: "produce",
              estimatedShelfLifeDays: 7,
            },
          ],
        });

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/receipt/scan-count", () => {
    it("returns monthly scan count and limits", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        5 as never,
      );

      const res = await request(app)
        .get("/api/receipt/scan-count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
      expect(res.body.limit).toBe(15);
      expect(res.body.remaining).toBe(10);
    });

    it("returns 0 remaining when limit reached", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        15 as never,
      );

      const res = await request(app)
        .get("/api/receipt/scan-count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.remaining).toBe(0);
    });

    it("returns 0 remaining when over limit", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockResolvedValue(
        20 as never,
      );

      const res = await request(app)
        .get("/api/receipt/scan-count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.remaining).toBe(0);
    });

    it("returns 403 for free tier user", async () => {
      setupFreeMock();

      const res = await request(app)
        .get("/api/receipt/scan-count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
    });

    it("returns 500 when storage throws", async () => {
      setupPremiumMock();
      vi.mocked(storage.getMonthlyReceiptScanCount).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/receipt/scan-count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });
});
