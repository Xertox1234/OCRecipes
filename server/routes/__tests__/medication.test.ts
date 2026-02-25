import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

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

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = "1";
    next();
  },
}));

vi.mock("express-rate-limit", () => ({
  rateLimit: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  default: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

import { storage } from "../../storage";
import { analyzeGlp1Insights } from "../../services/glp1-insights";
import { register } from "../medication";

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

const mockLog = {
  id: 1,
  userId: "1",
  medicationName: "Ozempic",
  dosage: "0.5mg",
  brandName: "Novo Nordisk",
  sideEffects: ["nausea"],
  appetiteLevel: 2,
  notes: "First dose",
  createdAt: new Date(),
};

describe("Medication Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/medication/logs", () => {
    it("returns medication logs", async () => {
      mockPremium();
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([mockLog] as never);

      const res = await request(app)
        .get("/api/medication/logs")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/medication/logs")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("POST /api/medication/log", () => {
    it("creates a medication log", async () => {
      mockPremium();
      vi.mocked(storage.createMedicationLog).mockResolvedValue(mockLog as never);

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
      vi.mocked(storage.updateMedicationLog).mockResolvedValue({
        ...mockLog,
        dosage: "1.0mg",
      } as never);

      const res = await request(app)
        .put("/api/medication/log/1")
        .set("Authorization", "Bearer token")
        .send({ dosage: "1.0mg" });

      expect(res.status).toBe(200);
      expect(res.body.dosage).toBe("1.0mg");
    });

    it("returns 404 when log not found", async () => {
      mockPremium();
      vi.mocked(storage.updateMedicationLog).mockResolvedValue(null as never);

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
      vi.mocked(storage.deleteMedicationLog).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/medication/log/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 404 when not found", async () => {
      mockPremium();
      vi.mocked(storage.deleteMedicationLog).mockResolvedValue(false as never);

      const res = await request(app)
        .delete("/api/medication/log/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/medication/insights", () => {
    it("returns GLP-1 insights", async () => {
      mockPremium();
      const insights = { totalDoses: 5, averageAppetite: 2.5 };
      vi.mocked(analyzeGlp1Insights).mockResolvedValue(insights as never);

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
      vi.mocked(storage.getUser).mockResolvedValue({
        dailyProteinGoal: 120,
      } as never);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalProtein: "40",
      } as never);
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([
        { appetiteLevel: 2 },
      ] as never);

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
      vi.mocked(storage.getUser).mockResolvedValue({} as never);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalProtein: "0",
      } as never);
      vi.mocked(storage.getMedicationLogs).mockResolvedValue([] as never);

      const res = await request(app)
        .get("/api/medication/protein-suggestions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.proteinGoal).toBe(120);
    });
  });

  describe("PUT /api/user/glp1-mode", () => {
    it("enables GLP-1 mode", async () => {
      mockPremium();
      vi.mocked(storage.updateUserProfile).mockResolvedValue({
        glp1Mode: true,
      } as never);

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
      vi.mocked(storage.updateUserProfile).mockResolvedValue(null as never);

      const res = await request(app)
        .put("/api/user/glp1-mode")
        .set("Authorization", "Bearer token")
        .send({ glp1Mode: false });

      expect(res.status).toBe(404);
    });
  });
});
