import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../coach-context";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUserProfile: vi.fn(),
    getDailySummary: vi.fn(),
    getActiveNotebookEntries: vi.fn(),
    getCommitmentsWithDueFollowUp: vi.fn(),
    getChatConversation: vi.fn(),
    getChatMessages: vi.fn(),
  },
}));

vi.mock("../../services/coach-warm-up", () => ({
  setWarmUp: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

/** Set up storage mocks so checkPremiumFeature returns a premium subscription. */
function setupPremiumMock() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium" as const,
    expiresAt: null,
  });
}

/** Set up storage mocks so checkPremiumFeature returns a free subscription. */
function setupFreeMock() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "free" as const,
    expiresAt: null,
  });
}

describe("Coach Context Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ─── GET /api/coach/context ────────────────────────────────────────────

  describe("GET /api/coach/context", () => {
    it("returns context with notebook, commitments, and suggestions", async () => {
      setupPremiumMock();
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        id: 1,
        userId: "1",
        dietType: "vegetarian",
        allergies: [{ name: "peanuts", severity: "severe" as const }],
        healthConditions: [],
        primaryGoal: null,
        activityLevel: null,
        householdSize: 1,
        cuisinePreferences: [],
        cookingSkillLevel: null,
        cookingTimeAvailable: null,
        glp1Mode: false,
        glp1Medication: null,
        glp1StartDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        foodDislikes: ["liver"],
      });
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 1200,
        totalProtein: 40,
        totalCarbs: 150,
        totalFat: 30,
        itemCount: 5,
      });
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([
        {
          id: 1,
          userId: "1",
          type: "observation",
          content: "User prefers morning workouts",
          status: "active",
          followUpDate: null,
          sourceConversationId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([
        {
          id: 2,
          userId: "1",
          type: "commitment",
          content: "Drink 8 glasses of water daily",
          status: "active",
          followUpDate: new Date(),
          sourceConversationId: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get("/api/coach/context")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("notebook");
      expect(res.body.notebook).toHaveLength(1);
      expect(res.body).toHaveProperty("dueCommitments");
      expect(res.body.dueCommitments).toHaveLength(1);
      expect(res.body).toHaveProperty("suggestions");
      expect(res.body.suggestions.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty("todayIntake");
      expect(res.body).toHaveProperty("dietaryProfile");
      expect(res.body.dietaryProfile).toEqual({
        dietType: "vegetarian",
        allergies: [{ name: "peanuts", severity: "severe" as const }],
        dislikes: ["liver"],
      });
    });

    it("returns 403 when user is not premium", async () => {
      setupFreeMock();

      const res = await request(app)
        .get("/api/coach/context")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns null dietaryProfile when no user profile exists", async () => {
      setupPremiumMock();
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
      vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/coach/context")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.dietaryProfile).toBeNull();
      expect(res.body.todayIntake).toEqual({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
    });

    it("generates suggestion chips based on context", async () => {
      setupPremiumMock();
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 500,
        totalProtein: 10,
        totalCarbs: 60,
        totalFat: 15,
        itemCount: 2,
      });
      vi.mocked(storage.getActiveNotebookEntries).mockResolvedValue([]);
      vi.mocked(storage.getCommitmentsWithDueFollowUp).mockResolvedValue([
        {
          id: 1,
          userId: "1",
          type: "commitment",
          content: "Eat more greens",
          status: "active",
          followUpDate: new Date(),
          sourceConversationId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get("/api/coach/context")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      // Should include a commitment follow-up suggestion
      expect(
        res.body.suggestions.some((s: string) => s.includes("Eat more greens")),
      ).toBe(true);
      // Should include protein deficit suggestion (150 - 10 = 140 > 30)
      expect(
        res.body.suggestions.some((s: string) => s.includes("protein")),
      ).toBe(true);
      // Suggestions capped at 5
      expect(res.body.suggestions.length).toBeLessThanOrEqual(5);
    });

    it("returns 500 on storage error", async () => {
      setupPremiumMock();
      vi.mocked(storage.getUserProfile).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/coach/context")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /api/coach/warm-up ──────────────────────────────────────────

  describe("POST /api/coach/warm-up", () => {
    it("returns warmUpId when valid body and conversation ownership", async () => {
      setupPremiumMock();
      vi.mocked(storage.getChatConversation).mockResolvedValue({
        id: 1,
        userId: "1",
        title: "Test",
        type: "coach",
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(storage.getChatMessages).mockResolvedValue([
        {
          id: 1,
          conversationId: 1,
          role: "user",
          content: "Hello",
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ conversationId: 1, interimTranscript: "What about protein" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("warmUpId");
      expect(typeof res.body.warmUpId).toBe("string");
    });

    it("returns 400 for missing conversationId", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ interimTranscript: "Hello" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for missing interimTranscript", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ conversationId: 1 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for empty interimTranscript", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ conversationId: 1, interimTranscript: "" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 when conversation not found", async () => {
      setupPremiumMock();
      vi.mocked(storage.getChatConversation).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ conversationId: 999, interimTranscript: "Hello" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 403 when user is not premium", async () => {
      setupFreeMock();

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ conversationId: 1, interimTranscript: "Hello" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 500 on storage error", async () => {
      setupPremiumMock();
      vi.mocked(storage.getChatConversation).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/coach/warm-up")
        .set("Authorization", "Bearer token")
        .send({ conversationId: 1, interimTranscript: "Hello" });

      expect(res.status).toBe(500);
    });
  });
});
