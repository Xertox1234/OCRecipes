import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../notebook";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";
import { requireAuth } from "../../middleware/auth";
import { sendError } from "../../lib/api-errors";

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../storage", () => ({
  storage: {
    getUnseenNotebookSaves: vi.fn(),
    markNotebookEntriesShown: vi.fn(),
    confirmNotebookEntries: vi.fn(),
    rejectNotebookEntries: vi.fn(),
    clearNotebook: vi.fn(),
    createNotebookEntry: vi.fn(),
  },
}));

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe("visible memory routes", () => {
  it("lists unseen saves in the second person with their labels", async () => {
    vi.mocked(storage.getUnseenNotebookSaves).mockResolvedValue([
      createMockCoachNotebookEntry({
        id: 4,
        type: "preference",
        content: "The user avoids dairy",
      }),
      createMockCoachNotebookEntry({
        id: 5,
        type: "commitment",
        content: "The user agreed to add pumpkin seeds",
        label: "pumpkin seeds on your salad",
      }),
    ]);
    const res = await request(app()).get("/api/coach/notebook/unseen");
    expect(res.status).toBe(200);
    expect(storage.getUnseenNotebookSaves).toHaveBeenCalledWith("1");
    expect(res.body).toEqual({
      entries: [
        { id: 4, type: "preference", content: "You avoid dairy", label: null },
        {
          id: 5,
          type: "commitment",
          content: "You agreed to add pumpkin seeds",
          label: "pumpkin seeds on your salad",
        },
      ],
    });
  });

  it.each([
    ["shown", "markNotebookEntriesShown", 204],
    ["confirm", "confirmNotebookEntries", 200],
    ["reject", "rejectNotebookEntries", 200],
  ] as const)("POST %s acts on the caller's ids", async (path, fn, status) => {
    vi.mocked(
      storage[fn] as (...a: unknown[]) => Promise<unknown>,
    ).mockResolvedValue(fn === "markNotebookEntriesShown" ? undefined : 2);
    const res = await request(app())
      .post(`/api/coach/notebook/${path}`)
      .send({ ids: [4, 5, 4] });
    expect(res.status).toBe(status);
    expect(storage[fn]).toHaveBeenCalledWith("1", [4, 5, 4]);
  });

  it("returns the counts from confirm and reject", async () => {
    vi.mocked(storage.confirmNotebookEntries).mockResolvedValue(0);
    const res = await request(app())
      .post("/api/coach/notebook/confirm")
      .send({ ids: [9] });
    expect(res.body).toEqual({ confirmed: 0 });
  });

  it.each([
    [[]],
    [[-1]],
    [[1.5]],
    [Array.from({ length: 21 }, (_, i) => i + 1)],
    ["x"],
  ])("rejects a bad ids body %#", async (ids) => {
    const res = await request(app())
      .post("/api/coach/notebook/confirm")
      .send({ ids });
    expect(res.status).toBe(400);
    expect(storage.confirmNotebookEntries).not.toHaveBeenCalled();
  });

  it("DELETE clears everything for the caller", async () => {
    vi.mocked(storage.clearNotebook).mockResolvedValue(undefined);
    const res = await request(app()).delete("/api/coach/notebook");
    expect(res.status).toBe(204);
    expect(storage.clearNotebook).toHaveBeenCalledWith("1");
  });

  it("requires auth", async () => {
    vi.mocked(requireAuth).mockImplementationOnce(async (_req, res) => {
      sendError(res, 401, "Unauthorized");
    });
    const res = await request(app()).get("/api/coach/notebook/unseen");
    expect(res.status).toBe(401);
  });

  it("a manually added entry starts confirmed and shown; a commitment is labelled", async () => {
    vi.mocked(storage.createNotebookEntry).mockImplementation(async (e) =>
      createMockCoachNotebookEntry(e),
    );
    await request(app())
      .post("/api/coach/notebook")
      .send({ type: "commitment", content: "walk after lunch" });
    const arg = vi.mocked(storage.createNotebookEntry).mock.calls[0][0];
    expect(arg.confirmedAt).toBeInstanceOf(Date);
    expect(arg.shownAt).toBeInstanceOf(Date);
    expect(arg.label).toBe("walk after lunch");
  });
});
