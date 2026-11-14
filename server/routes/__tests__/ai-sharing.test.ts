import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { forgetAiSharing } from "../../lib/ai-sharing-gate";
import { register } from "../ai-sharing";

vi.mock("../../storage", () => ({
  storage: {
    getAiSharingStatus: vi.fn(),
    setAiSharing: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/ai-sharing-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai-sharing-gate")>()),
  forgetAiSharing: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

// Privacy audit H3 — the app reads and records the AI-sharing answer here.
describe("AI-sharing routes", () => {
  let app: express.Express;
  beforeEach(() => {
    app = createApp();
  });

  it("GET returns the user's status", async () => {
    vi.mocked(storage.getAiSharingStatus).mockResolvedValue({
      allowed: false,
      answered: true,
    });

    const res = await request(app).get("/api/user/ai-sharing");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allowed: false, answered: true });
  });

  it("PUT records a yes", async () => {
    vi.mocked(storage.setAiSharing).mockResolvedValue({
      allowed: true,
      answered: true,
    });

    const res = await request(app)
      .put("/api/user/ai-sharing")
      .send({ allowed: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allowed: true, answered: true });
    expect(storage.setAiSharing).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("PUT records a no and drops the remembered yes at once", async () => {
    vi.mocked(storage.setAiSharing).mockResolvedValue({
      allowed: false,
      answered: true,
    });

    const res = await request(app)
      .put("/api/user/ai-sharing")
      .send({ allowed: false });

    expect(res.status).toBe(200);
    expect(storage.setAiSharing).toHaveBeenCalledWith(
      expect.any(String),
      false,
    );
    expect(forgetAiSharing).toHaveBeenCalledWith(expect.any(String));
  });

  it("PUT rejects anything but a boolean answer", async () => {
    for (const body of [{}, { allowed: "yes" }, { allowed: 1 }]) {
      const res = await request(app).put("/api/user/ai-sharing").send(body);
      expect(res.status).toBe(400);
    }
    expect(storage.setAiSharing).not.toHaveBeenCalled();
  });

  it("answers 404 when the account is gone", async () => {
    vi.mocked(storage.getAiSharingStatus).mockResolvedValue(undefined);
    vi.mocked(storage.setAiSharing).mockResolvedValue(undefined);

    expect((await request(app).get("/api/user/ai-sharing")).status).toBe(404);
    expect(
      (await request(app).put("/api/user/ai-sharing").send({ allowed: true }))
        .status,
    ).toBe(404);
  });
});
