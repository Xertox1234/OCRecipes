import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { registerCoachCommitmentsRoutes } from "../coach-commitments";
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
    it("returns 200 with { ok: true } for a valid commitment entry", async () => {
      const entry = createMockCoachNotebookEntry({ type: "commitment" });
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(entry);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/1/accept");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(vi.mocked(storage.updateNotebookEntryStatus)).toHaveBeenCalledWith(
        1,
        "1",
        "completed",
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
