import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../push-tokens";

vi.mock("../../storage", () => ({
  storage: {
    upsertPushToken: vi.fn(),
    deletePushToken: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Push Token Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/push-tokens", () => {
    it("registers a token and returns its id", async () => {
      vi.mocked(storage.upsertPushToken).mockResolvedValue({
        id: 42,
        userId: "1",
        token: "ExponentPushToken[abc123]",
        platform: "ios",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({ token: "ExponentPushToken[abc123]", platform: "ios" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 42 });
      expect(storage.upsertPushToken).toHaveBeenCalledWith(
        "1",
        "ExponentPushToken[abc123]",
        "ios",
      );
    });

    it("accepts android platform", async () => {
      vi.mocked(storage.upsertPushToken).mockResolvedValue({
        id: 7,
        userId: "1",
        token: "ExponentPushToken[xyz789]",
        platform: "android",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({ token: "ExponentPushToken[xyz789]", platform: "android" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(7);
    });

    it("returns 400 for missing token", async () => {
      const res = await request(app)
        .post("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({ platform: "ios" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid platform value", async () => {
      const res = await request(app)
        .post("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({ token: "ExponentPushToken[abc]", platform: "web" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for empty token string", async () => {
      const res = await request(app)
        .post("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({ token: "", platform: "ios" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("DELETE /api/push-tokens", () => {
    it("deletes a token and returns success", async () => {
      vi.mocked(storage.deletePushToken).mockResolvedValue();

      const res = await request(app)
        .delete("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({ token: "ExponentPushToken[abc123]" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(storage.deletePushToken).toHaveBeenCalledWith(
        "1",
        "ExponentPushToken[abc123]",
      );
    });

    it("returns 400 for missing token", async () => {
      const res = await request(app)
        .delete("/api/push-tokens")
        .set("Authorization", "Bearer valid-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });
});
