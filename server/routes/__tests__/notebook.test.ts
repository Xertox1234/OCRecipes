import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../notebook";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";

vi.mock("../../middleware/auth");
vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntries: vi.fn(),
    createNotebookEntry: vi.fn(),
    updateNotebookEntry: vi.fn(),
    deleteNotebookEntry: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
register(app);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/coach/notebook", () => {
  it("returns entries for the authenticated user", async () => {
    const entries = [createMockCoachNotebookEntry({ type: "insight" })];
    vi.mocked(storage.getNotebookEntries).mockResolvedValue(entries);
    const res = await request(app)
      .get("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(storage.getNotebookEntries).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({}),
    );
  });
});

describe("POST /api/coach/notebook", () => {
  it("creates a user-authored entry", async () => {
    const entry = createMockCoachNotebookEntry({
      type: "goal",
      content: "Hit 120g protein",
    });
    vi.mocked(storage.createNotebookEntry).mockResolvedValue(entry);
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "goal", content: "Hit 120g protein" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(storage.createNotebookEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "1",
        type: "goal",
        content: "Hit 120g protein",
      }),
    );
  });

  it("returns 400 for invalid type", async () => {
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "invalid_type", content: "Test" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/coach/notebook/:id", () => {
  it("updates entry content", async () => {
    const updated = createMockCoachNotebookEntry({ content: "Updated" });
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(updated);
    const res = await request(app)
      .patch("/api/coach/notebook/1")
      .send({ content: "Updated" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });

  it("returns 404 when not owned", async () => {
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(undefined);
    const res = await request(app)
      .patch("/api/coach/notebook/999")
      .send({ content: "Updated" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/coach/notebook/:id", () => {
  it("deletes an entry", async () => {
    vi.mocked(storage.deleteNotebookEntry).mockResolvedValue(true);
    const res = await request(app)
      .delete("/api/coach/notebook/1")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(204);
  });

  it("returns 404 when not owned", async () => {
    vi.mocked(storage.deleteNotebookEntry).mockResolvedValue(false);
    const res = await request(app)
      .delete("/api/coach/notebook/999")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

// A follow-up date is a CALENDAR DAY, and the reminder reads
// `lte(followUpDate, now)`, so the stored instant must be local midnight in
// the user's zone, the same basis the chat-extraction writer uses. Expected
// instants are literals, not `civilDateToInstant(...)`: comparing the helper
// to itself cannot fail. 2026-09-05 is PDT (UTC-7) in Los Angeles and JST
// (UTC+9) in Tokyo.
describe("notebook followUpDate anchoring", () => {
  it("POST anchors at local midnight for a UTC-negative zone", async () => {
    vi.mocked(storage.createNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry(),
    );
    const res = await request(app)
      .post("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token")
      .set("X-Timezone", "America/Los_Angeles")
      .send({
        type: "commitment",
        content: "Check in",
        followUpDate: "2026-09-05",
      });
    expect(res.status).toBe(201);
    expect(
      vi.mocked(storage.createNotebookEntry).mock.calls[0][0].followUpDate,
    ).toEqual(new Date("2026-09-05T07:00:00.000Z"));
  });

  it("POST anchors at local midnight for a UTC-positive zone", async () => {
    vi.mocked(storage.createNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry(),
    );
    const res = await request(app)
      .post("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token")
      .set("X-Timezone", "Asia/Tokyo")
      .send({
        type: "commitment",
        content: "Check in",
        followUpDate: "2026-09-05",
      });
    expect(res.status).toBe(201);
    expect(
      vi.mocked(storage.createNotebookEntry).mock.calls[0][0].followUpDate,
    ).toEqual(new Date("2026-09-04T15:00:00.000Z"));
  });

  it("POST falls back to UTC midnight when X-Timezone is absent", async () => {
    vi.mocked(storage.createNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry(),
    );
    await request(app)
      .post("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token")
      .send({
        type: "commitment",
        content: "Check in",
        followUpDate: "2026-09-05",
      });
    expect(
      vi.mocked(storage.createNotebookEntry).mock.calls[0][0].followUpDate,
    ).toEqual(new Date("2026-09-05T00:00:00.000Z"));
  });

  it("PATCH anchors at local midnight for a UTC-negative zone", async () => {
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry(),
    );
    const res = await request(app)
      .patch("/api/coach/notebook/1")
      .set("Authorization", "Bearer valid-token")
      .set("X-Timezone", "America/Los_Angeles")
      .send({ followUpDate: "2026-09-05" });
    expect(res.status).toBe(200);
    expect(
      vi.mocked(storage.updateNotebookEntry).mock.calls[0][2].followUpDate,
    ).toEqual(new Date("2026-09-05T07:00:00.000Z"));
  });

  it("PATCH anchors at local midnight for a UTC-positive zone", async () => {
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry(),
    );
    const res = await request(app)
      .patch("/api/coach/notebook/1")
      .set("Authorization", "Bearer valid-token")
      .set("X-Timezone", "Asia/Tokyo")
      .send({ followUpDate: "2026-09-05" });
    expect(res.status).toBe(200);
    expect(
      vi.mocked(storage.updateNotebookEntry).mock.calls[0][2].followUpDate,
    ).toEqual(new Date("2026-09-04T15:00:00.000Z"));
  });

  it("PATCH with followUpDate null still clears it", async () => {
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry(),
    );
    await request(app)
      .patch("/api/coach/notebook/1")
      .set("Authorization", "Bearer valid-token")
      .set("X-Timezone", "Asia/Tokyo")
      .send({ followUpDate: null });
    expect(
      vi.mocked(storage.updateNotebookEntry).mock.calls[0][2].followUpDate,
    ).toBeNull();
  });
});
