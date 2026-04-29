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
