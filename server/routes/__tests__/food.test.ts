import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
  },
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

vi.mock("../../services/food-nlp", () => ({
  parseNaturalLanguageFood: vi.fn(),
}));

vi.mock("../../services/voice-transcription", () => ({
  transcribeAudio: vi.fn(),
}));

import { register } from "../food";
import { parseNaturalLanguageFood } from "../../services/food-nlp";
import { transcribeAudio } from "../../services/voice-transcription";
import { storage } from "../../storage";

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockParsedItems = [
  { name: "chicken breast", quantity: "200g", calories: 330, protein: 62, carbs: 0, fat: 7 },
  { name: "brown rice", quantity: "1 cup", calories: 216, protein: 5, carbs: 45, fat: 2 },
];

describe("Food Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("POST /api/food/parse-text", () => {
    it("parses natural language food text", async () => {
      vi.mocked(parseNaturalLanguageFood).mockResolvedValue(mockParsedItems as never);

      const res = await request(app)
        .post("/api/food/parse-text")
        .set("Authorization", "Bearer token")
        .send({ text: "I had chicken breast with brown rice" });

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].name).toBe("chicken breast");
    });

    it("returns 400 for empty text", async () => {
      const res = await request(app)
        .post("/api/food/parse-text")
        .set("Authorization", "Bearer token")
        .send({ text: "" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing text", async () => {
      const res = await request(app)
        .post("/api/food/parse-text")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 for text exceeding max length", async () => {
      const res = await request(app)
        .post("/api/food/parse-text")
        .set("Authorization", "Bearer token")
        .send({ text: "x".repeat(1001) });

      expect(res.status).toBe(400);
    });

    it("returns 500 when service fails", async () => {
      vi.mocked(parseNaturalLanguageFood).mockRejectedValue(new Error("API error"));

      const res = await request(app)
        .post("/api/food/parse-text")
        .set("Authorization", "Bearer token")
        .send({ text: "chicken breast" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to parse food text");
    });
  });

  describe("POST /api/food/transcribe", () => {
    it("returns 403 for non-premium users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/food/transcribe")
        .set("Authorization", "Bearer token")
        .attach("audio", Buffer.from("fake-audio"), {
          filename: "test.m4a",
          contentType: "audio/m4a",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 400 when no audio file provided", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);

      const res = await request(app)
        .post("/api/food/transcribe")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No audio file provided");
    });

    it("transcribes and parses audio for premium users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(transcribeAudio).mockResolvedValue("chicken breast and rice");
      vi.mocked(parseNaturalLanguageFood).mockResolvedValue(mockParsedItems as never);

      const res = await request(app)
        .post("/api/food/transcribe")
        .set("Authorization", "Bearer token")
        .attach("audio", Buffer.from("fake-audio-data"), {
          filename: "test.m4a",
          contentType: "audio/m4a",
        });

      expect(res.status).toBe(200);
      expect(res.body.transcription).toBe("chicken breast and rice");
      expect(res.body.items).toHaveLength(2);
    });

    it("returns 400 for empty transcription", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(transcribeAudio).mockResolvedValue("   ");

      const res = await request(app)
        .post("/api/food/transcribe")
        .set("Authorization", "Bearer token")
        .attach("audio", Buffer.from("silence"), {
          filename: "test.m4a",
          contentType: "audio/m4a",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Could not transcribe audio");
    });
  });
});
