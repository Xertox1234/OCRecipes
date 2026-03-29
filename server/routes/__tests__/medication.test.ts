import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { analyzeGlp1Insights } from "../../services/glp1-insights";
import { register } from "../medication";
import {
  createMockMedicationLog,
  createMockUser,
  createMockUserProfile,
} from "../../__tests__/factories";
import type { Glp1Insights } from "@shared/types/medication";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getMedicationLogs: vi.fn(),
    createMedicationLog: vi.fn(),
    updateMedicationLog: vi.fn(),
    deleteMedicationLog: vi.fn(),
    getUser: vi.fn(),
    getDailySummary: vi.fn(),
    updateUserProfile: vi.fn(),
  },
}));

vi.mock("../../services/glp1-insights", () => ({
  analyzeGlp1Insights: vi.fn(),
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

const mockLog = createMockMedicationLog({
  medicationName: "Ozempic",
  dosage: "0.5mg",
  brandName: "Novo Nordisk",
  sideEffects: ["nausea"],
  appetiteLevel: 2,
  notes: "First dose",
  takenAt: new Date(),
});

describe("Medication Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/medication/logs", () => {
    it("returns medication logs", async () => {
      mockPremium();
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([mockLog]);

      const res = await request(app)
        .get("/api/medication/logs")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/medication/logs")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 500 when storage throws", async () => {
      mockPremium();
      vi.mocked(storage.getMedicationLogs).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .get("/api/medication/logs")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/medication/log", () => {
    it("creates a medication log", async () => {
      mockPremium();
      vi.mocked(storage.createMedicationLog).mockResolvedValue(mockLog);

      const res = await request(app)
        .post("/api/medication/log")
        .set("Authorization", "Bearer token")
        .send({ medicationName: "Ozempic", dosage: "0.5mg" });

      expect(res.status).toBe(201);
      expect(res.body.medicationName).toBe("Ozempic");
    });

    it("validates required fields", async () => {
      mockPremium();

      const res = await request(app)
        .post("/api/medication/log")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/medication/log/:id", () => {
    it("updates a medication log", async () => {
      mockPremium();
      vi.mocked(storage.updateMedicationLog).mockResolvedValue(
        createMockMedicationLog({
          medicationName: "Ozempic",
          dosage: "1.0mg",
          brandName: "Novo Nordisk",
          sideEffects: ["nausea"],
          appetiteLevel: 2,
          notes: "First dose",
        }),
      );

      const res = await request(app)
        .put("/api/medication/log/1")
        .set("Authorization", "Bearer token")
        .send({ dosage: "1.0mg" });

      expect(res.status).toBe(200);
      expect(res.body.dosage).toBe("1.0mg");
    });

    it("returns 404 when log not found", async () => {
      mockPremium();
      vi.mocked(storage.updateMedicationLog).mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/medication/log/999")
        .set("Authorization", "Bearer token")
        .send({ dosage: "1.0mg" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      mockPremium();

      const res = await request(app)
        .put("/api/medication/log/abc")
        .set("Authorization", "Bearer token")
        .send({ dosage: "1.0mg" });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/medication/log/:id", () => {
    it("deletes a medication log", async () => {
      mockPremium();
      vi.mocked(storage.deleteMedicationLog).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/medication/log/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when not found", async () => {
      mockPremium();
      vi.mocked(storage.deleteMedicationLog).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/medication/log/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/medication/insights", () => {
    it("returns GLP-1 insights", async () => {
      mockPremium();
      const insights: Glp1Insights = {
        totalDoses: 5,
        daysSinceStart: null,
        averageAppetiteLevel: 2.5,
        appetiteTrend: null,
        commonSideEffects: [],
        weightChangeSinceStart: null,
        lastDoseAt: null,
        nextDoseEstimate: null,
      };
      vi.mocked(analyzeGlp1Insights).mockResolvedValue(insights);

      const res = await request(app)
        .get("/api/medication/insights")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.totalDoses).toBe(5);
    });
  });

  describe("GET /api/medication/protein-suggestions", () => {
    it("returns protein suggestions based on appetite", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ dailyProteinGoal: 120 }),
      );
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 40,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([
        createMockMedicationLog({ appetiteLevel: 2 }),
      ]);

      const res = await request(app)
        .get("/api/medication/protein-suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.remainingProtein).toBe(80);
      expect(res.body.proteinGoal).toBe(120);
      expect(res.body.suggestions).toBeDefined();
    });

    it("uses default protein goal when not set", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/medication/protein-suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.proteinGoal).toBe(150);
    });

    it("returns high-appetite suggestions when appetite > 3", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ dailyProteinGoal: 120 }),
      );
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 20,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([
        createMockMedicationLog({ appetiteLevel: 4 }),
      ]);

      const res = await request(app)
        .get("/api/medication/protein-suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.suggestions.length).toBeGreaterThan(0);
      expect(res.body.remainingProtein).toBe(100);
    });

    it("returns 500 when storage throws", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockRejectedValue(new Error("db error"));

      const res = await request(app)
        .get("/api/medication/protein-suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("PUT /api/user/glp1-mode", () => {
    it("enables GLP-1 mode", async () => {
      mockPremium();
      vi.mocked(storage.updateUserProfile).mockResolvedValue(
        createMockUserProfile({ glp1Mode: true }),
      );

      const res = await request(app)
        .put("/api/user/glp1-mode")
        .set("Authorization", "Bearer token")
        .send({ glp1Mode: true, glp1Medication: "Ozempic" });

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid body", async () => {
      mockPremium();

      const res = await request(app)
        .put("/api/user/glp1-mode")
        .set("Authorization", "Bearer token")
        .send({ glp1Mode: "yes" });

      expect(res.status).toBe(400);
    });

    it("returns 404 when profile not found", async () => {
      mockPremium();
      vi.mocked(storage.updateUserProfile).mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/user/glp1-mode")
        .set("Authorization", "Bearer token")
        .send({ glp1Mode: false });

      expect(res.status).toBe(404);
    });

    it("returns 500 when storage throws", async () => {
      mockPremium();
      vi.mocked(storage.updateUserProfile).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .put("/api/user/glp1-mode")
        .set("Authorization", "Bearer token")
        .send({ glp1Mode: true });

      expect(res.status).toBe(500);
    });
  });
});
