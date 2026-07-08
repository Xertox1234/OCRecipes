import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import type { MenuAnalysisResult } from "../../services/menu-analysis";
import { analyzeMenuPhoto } from "../../services/menu-analysis";
import { createMockMenuScan } from "../../__tests__/factories";
import { register } from "../menu";
import { installContractSnapshotMiddleware } from "../../lib/contract-snapshot";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getEffectiveTierForUser: vi.fn(),
    createMenuScan: vi.fn(),
    getMenuScans: vi.fn(),
    deleteMenuScan: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../lib/openai", () => ({ isAiConfigured: true }));

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
    tier: "premium" as const,
    expiresAt: null,
  });
  vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
}

describe("Menu Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    simulateNoFile = false;
    app = createApp();
  });

  describe("POST /api/menu/scan", () => {
    it("analyzes menu photo and returns result", async () => {
      mockPremium();
      const mockResult: MenuAnalysisResult = {
        restaurantName: "Test Cafe",
        cuisine: "Italian",
        menuItems: [
          {
            name: "Pasta",
            estimatedCalories: 500,
            estimatedProtein: 20,
            estimatedCarbs: 60,
            estimatedFat: 15,
            tags: [],
          },
        ],
      };
      vi.mocked(analyzeMenuPhoto).mockResolvedValue(mockResult);
      vi.mocked(storage.createMenuScan).mockResolvedValue(
        createMockMenuScan({
          id: 1,
          restaurantName: "Test Cafe",
          cuisine: "Italian",
          menuItems: [
            {
              name: "Pasta",
              calories: 500,
              protein: 20,
              carbs: 60,
              fat: 15,
            },
          ],
        }),
      );

      const res = await request(app)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.restaurantName).toBe("Test Cafe");
      expect(res.body.id).toBe(1);
    });

    it("marks allergenFlags as dynamically-keyed for the contract-snapshot tool even at a single flagged entry (pins the real menu.ts -> markDynamicKeyFields linkage, see server/lib/dynamic-key-fields.ts)", async () => {
      mockPremium();
      const mockResult: MenuAnalysisResult = {
        restaurantName: "Test Cafe",
        cuisine: "Italian",
        menuItems: [
          {
            name: "Shrimp Pasta",
            estimatedCalories: 500,
            estimatedProtein: 20,
            estimatedCarbs: 60,
            estimatedFat: 15,
            tags: [],
          },
        ],
        allergenFlags: {
          "Shrimp Pasta": {
            allergenId: "shellfish",
            severity: "high",
            ingredientName: "shrimp",
            matchedKeyword: "shrimp",
            isDerived: false,
          },
        },
      };
      vi.mocked(analyzeMenuPhoto).mockResolvedValue(mockResult);
      vi.mocked(storage.createMenuScan).mockResolvedValue(
        createMockMenuScan({ id: 1, restaurantName: "Test Cafe" }),
      );

      // A separate app instance with the (normally dev-only, opt-in) contract-
      // snapshot middleware installed BEFORE register(app) -- register() itself
      // is untouched by this test, so this exercises the real menu.ts handler.
      const queryFn = vi.fn().mockResolvedValue(undefined);
      const getQuery = vi.fn().mockReturnValue(queryFn);
      const snapshotApp = express();
      snapshotApp.use(express.json());
      installContractSnapshotMiddleware(snapshotApp, {
        env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
        getBranch: () => "feature-branch",
        getQuery,
      });
      register(snapshotApp);

      const res = await request(snapshotApp)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      // The marker call must never change what's actually sent to the client.
      expect(res.status).toBe(200);
      expect(res.body.allergenFlags["Shrimp Pasta"].allergenId).toBe(
        "shellfish",
      );

      expect(queryFn).toHaveBeenCalledTimes(1);
      const [, params] = queryFn.mock.calls[0] as [string, unknown[]];
      const shapeJson = params[4] as string;
      // Exactly one flagged allergen -- the todo's stated COMMON case. Without
      // menu.ts calling markDynamicKeyFields, this item name would survive
      // redaction (see contract-shape.test.ts's forcedDynamicKeys negative test).
      expect(shapeJson).not.toContain("Shrimp Pasta");
      expect(shapeJson).toContain("<dynamic>");
    });

    it("returns 403 for free tier users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");

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

    it("rejects non-image files via magic-byte validation", async () => {
      mockPremium();
      const { detectImageMimeType } = await import("../../lib/image-mime");
      vi.mocked(detectImageMimeType).mockReturnValueOnce(null);

      const res = await request(app)
        .post("/api/menu/scan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid image content");
    });
  });

  describe("GET /api/menu/history", () => {
    it("returns menu scan history", async () => {
      mockPremium();
      const scans = [
        createMockMenuScan({ id: 1, restaurantName: "Cafe A" }),
        createMockMenuScan({ id: 2, restaurantName: "Cafe B" }),
      ];
      vi.mocked(storage.getMenuScans).mockResolvedValue(scans);

      const res = await request(app)
        .get("/api/menu/history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("returns 403 for free tier users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");

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
      vi.mocked(storage.deleteMenuScan).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/menu/scans/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when scan not found", async () => {
      vi.mocked(storage.deleteMenuScan).mockResolvedValue(false);

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
