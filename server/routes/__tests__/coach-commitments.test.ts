import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register as registerCoachCommitmentsRoutes } from "../coach-commitments";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntryById: vi.fn(),
    updateNotebookEntryStatus: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

function createApp() {
  const app = express();
  app.use(express.json());
  registerCoachCommitmentsRoutes(app);
  return app;
}

describe("Coach Commitments Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);
  });

  describe("POST /api/chat/commitments/:notebookEntryId/accept", () => {
    // Coach chat audit 2026-11-24 (L109): the write applies only to an
    // active commitment, and the answer must say when nothing was written.
    it("answers 409 when the commitment is no longer active", async () => {
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
        createMockCoachNotebookEntry({
          type: "commitment",
          status: "rejected",
        }),
      );
      vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(undefined);

      const res = await request(createApp()).post(
        "/api/chat/commitments/1/accept",
      );

      expect(res.status).toBe(409);
      expect(res.body.ok).toBeUndefined();
    });

    it("returns 200 with { ok: true } for a valid commitment entry", async () => {
      const entry = createMockCoachNotebookEntry({ type: "commitment" });
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(entry);
      vi.mocked(storage.updateNotebookEntryStatus).mockResolvedValue(entry);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/1/accept");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(vi.mocked(storage.updateNotebookEntryStatus)).toHaveBeenCalledWith(
        1,
        "1",
        "completed",
        "active",
      );
    });

    it("returns 404 when entry is not found", async () => {
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(undefined);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/99/accept");

      expect(res.status).toBe(404);
      expect(
        vi.mocked(storage.updateNotebookEntryStatus),
      ).not.toHaveBeenCalled();
    });

    it("returns 400 when entry exists but is not a commitment", async () => {
      const entry = createMockCoachNotebookEntry({ type: "insight" });
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(entry);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/1/accept");

      expect(res.status).toBe(400);
      expect(
        vi.mocked(storage.updateNotebookEntryStatus),
      ).not.toHaveBeenCalled();
    });

    it("returns 400 when notebookEntryId is not a valid number", async () => {
      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/abc/accept");

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.getNotebookEntryById)).not.toHaveBeenCalled();
    });
  });
});
