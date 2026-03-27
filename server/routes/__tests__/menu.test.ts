import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { analyzeMenuPhoto } from "../../services/menu-analysis";
import { register } from "../menu";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    createMenuScan: vi.fn(),
    getMenuScans: vi.fn(),
    deleteMenuScan: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/menu-analysis", () => ({
  analyzeMenuPhoto: vi.fn(),
}));

vi.mock("../../lib/image-mime", () => ({
  detectImageMimeType: vi.fn(() => "image/jpeg"),
}));

// Module-level flag to control whether multer mock attaches a file
let simulateNoFile = false;

// Mock multer to simulate file uploads without actual multipart parsing
vi.mock("multer", () => {
  const multerMock = () => ({
    single:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        // Simulate file being present unless simulateNoFile is set
        if (!simulateNoFile) {
          req.file = {
            buffer: Buffer.from("fake-image-data"),
            mimetype: "image/jpeg",
            originalname: "menu.jpg",
            size: 1000,
          } as Express.Multer.File;
        }
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

function mockPremium() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium",
  } as never);
}

describe("Menu Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    simulateNoFile = false;
    app = createApp();
  });

  describe("POST /api/menu/scan", () => {
    it("analyzes menu photo and returns result", async () => {
      mockPremium();
      const mockResult = {
        restaurantName: "Test Cafe",
        cuisine: "Italian",
        menuItems: [{ name: "Pasta", price: 12.99 }],
      };
      vi.mocked(analyzeMenuPhoto).mockResolvedValue(mockResult as never);
      vi.mocked(storage.createMenuScan).mockResolvedValue({
        id: 1,
        ...mockResult,
      } as never);

      const res = await request(app)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.restaurantName).toBe("Test Cafe");
      expect(res.body.id).toBe(1);
    });

    it("returns 403 for free tier users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 500 on analysis error", async () => {
      mockPremium();
      vi.mocked(analyzeMenuPhoto).mockRejectedValue(new Error("API error"));

      const res = await request(app)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("returns 400 when no photo is provided", async () => {
      mockPremium();
      simulateNoFile = true;

      const res = await request(app)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/menu/history", () => {
    it("returns menu scan history", async () => {
      mockPremium();
      const scans = [
        { id: 1, restaurantName: "Cafe A" },
        { id: 2, restaurantName: "Cafe B" },
      ];
      vi.mocked(storage.getMenuScans).mockResolvedValue(scans as never);

      const res = await request(app)
        .get("/api/menu/history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("returns 403 for free tier users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/menu/history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 500 on storage error", async () => {
      mockPremium();
      vi.mocked(storage.getMenuScans).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .get("/api/menu/history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("DELETE /api/menu/scans/:id", () => {
    it("deletes a menu scan", async () => {
      vi.mocked(storage.deleteMenuScan).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/menu/scans/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when scan not found", async () => {
      vi.mocked(storage.deleteMenuScan).mockResolvedValue(false as never);

      const res = await request(app)
        .delete("/api/menu/scans/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/menu/scans/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.deleteMenuScan).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/menu/scans/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});
