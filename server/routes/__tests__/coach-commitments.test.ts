import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register as registerCoachCommitmentsRoutes } from "../coach-commitments";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntryById: vi.fn(),
    confirmNotebookEntries: vi.fn(),
    acceptCommitment: vi.fn(),
    areCoachNotesPaused: vi.fn(),
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
    vi.mocked(storage.confirmNotebookEntries).mockResolvedValue(1);
    vi.mocked(storage.acceptCommitment).mockResolvedValue("saved");
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);
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

      const res = await request(createApp()).post(
        "/api/chat/commitments/1/accept",
      );

      expect(res.status).toBe(409);
      expect(res.body.ok).toBeUndefined();
    });

    it("returns 200 with { ok: true } for a valid commitment entry", async () => {
      const entry = createMockCoachNotebookEntry({ type: "commitment" });
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(entry);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/1/accept");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      // L64: accepting starts a commitment; it used to complete it.
      expect(storage.confirmNotebookEntries).toHaveBeenCalledWith("1", [1]);
    });

    it("returns 404 when entry is not found", async () => {
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(undefined);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/99/accept");

      expect(res.status).toBe(404);
      expect(vi.mocked(storage.confirmNotebookEntries)).not.toHaveBeenCalled();
    });

    it("returns 400 when entry exists but is not a commitment", async () => {
      const entry = createMockCoachNotebookEntry({ type: "insight" });
      vi.mocked(storage.getNotebookEntryById).mockResolvedValue(entry);

      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/1/accept");

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.confirmNotebookEntries)).not.toHaveBeenCalled();
    });

    it("returns 400 when notebookEntryId is not a valid number", async () => {
      const app = createApp();
      const res = await request(app).post("/api/chat/commitments/abc/accept");

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.getNotebookEntryById)).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/chat/commitments", () => {
    const accept = (body: unknown) =>
      request(createApp())
        .post("/api/chat/commitments")
        .set("X-Timezone", "America/New_York")
        .send(body as object);

    it("saves the card, its date at local midnight", async () => {
      const res = await accept({
        title: "Walk daily",
        followUpDate: "2099-01-04",
      });
      expect(res.status).toBe(200);
      expect(storage.acceptCommitment).toHaveBeenCalledWith("1", {
        title: "Walk daily",
        followUpDate: new Date("2099-01-04T05:00:00Z"),
      });
    });

    it.each(["2099-02-31", "2020-01-01", "soon"])(
      "saves without a date when the card's is %s",
      async (followUpDate) => {
        const res = await accept({ title: "Walk daily", followUpDate });
        expect(res.status).toBe(200);
        expect(storage.acceptCommitment).toHaveBeenCalledWith("1", {
          title: "Walk daily",
          followUpDate: null,
        });
      },
    );

    it("reads the day of a date that carries a time", async () => {
      await accept({ title: "Walk", followUpDate: "2099-01-04T10:00" });
      expect(storage.acceptCommitment).toHaveBeenCalledWith("1", {
        title: "Walk",
        followUpDate: new Date("2099-01-04T05:00:00Z"),
      });
    });

    // The card's own schema bounds neither, so a refusal could never be fixed.
    it("shortens a long title and takes a long date", async () => {
      const res = await accept({
        title: "w".repeat(200),
        followUpDate: `2099-01-04T10:00${" ".repeat(60)}`,
      });
      expect(res.status).toBe(200);
      expect(storage.acceptCommitment).toHaveBeenCalledWith("1", {
        title: "w".repeat(120),
        followUpDate: new Date("2099-01-04T05:00:00Z"),
      });
    });

    it.each([{}, { title: "", followUpDate: "2099-01-04" }])(
      "refuses a body with no title: %j",
      async (body) => {
        expect((await accept(body)).status).toBe(400);
        expect(storage.acceptCommitment).not.toHaveBeenCalled();
      },
    );

    it("refuses what a hand-written note is refused for", async () => {
      const res = await accept({
        title: "Take my metformin",
        followUpDate: "2099-01-04",
      });
      expect(res.status).toBe(400);
      expect(storage.acceptCommitment).not.toHaveBeenCalled();
    });

    it("refuses while Coach's notes are paused", async () => {
      vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(true);
      const res = await accept({ title: "Walk", followUpDate: "2099-01-04" });
      expect(res.status).toBe(403);
      expect(storage.acceptCommitment).not.toHaveBeenCalled();
    });

    it("answers 409 when the notebook is full", async () => {
      vi.mocked(storage.acceptCommitment).mockResolvedValue("full");
      const res = await accept({ title: "Walk", followUpDate: "2099-01-04" });
      expect(res.status).toBe(409);
    });
  });
});
