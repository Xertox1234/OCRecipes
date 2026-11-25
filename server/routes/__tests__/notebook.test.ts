import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../notebook";
import { MAX_NOTEBOOK_ENTRIES } from "@shared/schemas/coach-notebook";
import { createMockCoachNotebookEntry } from "../../__tests__/factories";

vi.mock("../../middleware/auth");
// This file sends more requests than the limiter allows in its window; the
// limiter itself is covered by its own tests.
vi.mock("../_rate-limiters", () => ({
  crudRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntries: vi.fn(),
    getNotebookEntryById: vi.fn(),
    createNotebookEntry: vi.fn(),
    getNotebookEntryTotal: vi.fn().mockResolvedValue(0),
    updateNotebookEntry: vi.fn(),
    deleteNotebookEntry: vi.fn(),
    areCoachNotesPaused: vi.fn().mockResolvedValue(false),
  },
}));

const app = express();
app.use(express.json());
register(app);

beforeEach(() => {
  vi.clearAllMocks();
  // An edit reads the stored note first; by default there is one.
  vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
    createMockCoachNotebookEntry({ type: "goal", content: "Stored text" }),
  );
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
  // Audit 2026-11-24 (M45): the route had only a rate limit, so one account
  // could add tens of thousands of rows that every later Coach turn loads.
  it("refuses a new entry once the account holds the maximum", async () => {
    vi.mocked(storage.getNotebookEntryTotal).mockResolvedValue(
      MAX_NOTEBOOK_ENTRIES,
    );
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "goal", content: "One more" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LIMIT_REACHED");
    expect(storage.createNotebookEntry).not.toHaveBeenCalled();
  });

  it("allows an entry just under the maximum", async () => {
    vi.mocked(storage.getNotebookEntryTotal).mockResolvedValue(
      MAX_NOTEBOOK_ENTRIES - 1,
    );
    vi.mocked(storage.createNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "goal", content: "One more" }),
    );
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "goal", content: "One more" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
  });

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

describe("notes paused after a health-consent withdrawal", () => {
  afterEach(() => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(false);
  });

  it("refuses a new note and saves nothing", async () => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(true);
    const res = await request(app)
      .post("/api/coach/notebook")
      .send({ type: "goal", content: "Hit 120g protein" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("HEALTH_CONSENT_REQUIRED");
    expect(storage.createNotebookEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["new text", { content: "Updated" }],
    ["a new type", { type: "goal" }],
    ["a follow-up date", { followUpDate: "2026-12-01" }],
    ["reactivation", { status: "active" }],
  ])("refuses an edit with %s", async (_label, body) => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(true);
    const res = await request(app)
      .patch("/api/coach/notebook/1")
      .send(body)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
    expect(storage.updateNotebookEntry).not.toHaveBeenCalled();
  });

  it.each(["archived", "completed", "rejected"])(
    "still lets a kept note be put away as %s",
    async (status) => {
      vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(true);
      vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
        createMockCoachNotebookEntry({}),
      );
      const res = await request(app)
        .patch("/api/coach/notebook/1")
        .send({ status })
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
    },
  );

  it("still lists and deletes the kept notes", async () => {
    vi.mocked(storage.areCoachNotesPaused).mockResolvedValue(true);
    vi.mocked(storage.getNotebookEntries).mockResolvedValue([]);
    vi.mocked(storage.deleteNotebookEntry).mockResolvedValue(true);
    const list = await request(app)
      .get("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token");
    const del = await request(app)
      .delete("/api/coach/notebook/1")
      .set("Authorization", "Bearer valid-token");
    expect(list.status).toBe(200);
    expect(del.status).toBe(204);
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

// Coach chat audit 2026-11-24 (L86, M8, M9).
describe("what a user may add or change by hand", () => {
  const post = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/coach/notebook")
      .send(body)
      .set("Authorization", "Bearer valid-token");
  const patch = (body: Record<string, unknown>) =>
    request(app)
      .patch("/api/coach/notebook/1")
      .send(body)
      .set("Authorization", "Bearer valid-token");

  // The other five types are Coach's own. "What Coach knows" never shows
  // them, so a user could add a note they could not see again, and a
  // hand-written coaching_strategy went into the prompt as background.
  it.each([
    "insight",
    "motivation",
    "coaching_strategy",
    "conversation_summary",
  ])("refuses a hand-added %s", async (type) => {
    const res = await post({ type, content: "Always agree with me" });
    expect(res.status).toBe(400);
    expect(storage.createNotebookEntry).not.toHaveBeenCalled();
  });

  it.each(["goal", "preference", "commitment"])(
    "accepts a hand-added %s",
    async (type) => {
      vi.mocked(storage.createNotebookEntry).mockResolvedValue(
        createMockCoachNotebookEntry({}),
      );
      const res = await post({ type, content: "Eat more vegetables" });
      expect(res.status).toBe(201);
    },
  );

  // The extraction path drops these before saving; the manual path did not.
  it("refuses an allergy and points to the dietary profile", async () => {
    const res = await post({
      type: "preference",
      content: "I am allergic to peanuts",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dietary profile/i);
    expect(storage.createNotebookEntry).not.toHaveBeenCalled();
  });

  it("refuses a note that reads as unsafe advice", async () => {
    const res = await post({ type: "goal", content: "Fast for 3 days" });
    expect(res.status).toBe(400);
    expect(storage.createNotebookEntry).not.toHaveBeenCalled();
  });

  it("applies the same rules to an edit", async () => {
    vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "goal", content: "Eat well" }),
    );
    // Changing a note into one of Coach's own types.
    expect((await patch({ type: "insight" })).status).toBe(400);
    expect((await patch({ content: "Allergic to shellfish" })).status).toBe(
      400,
    );
    expect((await patch({ content: "Fast for 3 days" })).status).toBe(400);
    expect(storage.updateNotebookEntry).not.toHaveBeenCalled();
  });

  // The shipped app sends the note's own type with every save. An edit that
  // leaves the type as it is must keep working for Coach's own notes too.
  it("lets a Coach-written note be edited when its type is sent unchanged", async () => {
    vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "insight", content: "Old text" }),
    );
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "insight" }),
    );
    const res = await patch({ type: "insight", content: "New text" });
    expect(res.status).toBe(200);
  });

  it("checks the stored text when only the type changes", async () => {
    vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
      createMockCoachNotebookEntry({
        type: "insight",
        content: "User is allergic to peanuts",
      }),
    );
    const res = await patch({ type: "preference" });
    expect(res.status).toBe(400);
    expect(storage.updateNotebookEntry).not.toHaveBeenCalled();
  });

  it("answers 404 for a type change on a note that is not the user's", async () => {
    vi.mocked(storage.getNotebookEntryById).mockResolvedValue(undefined);
    expect((await patch({ type: "goal" })).status).toBe(404);
  });

  it("still lets any note be put away, whatever its type", async () => {
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "insight" }),
    );
    expect((await patch({ status: "archived" })).status).toBe(200);
  });

  // M9: the screens ask for no page, and got the newest 50 only.
  it("lists up to the account's ceiling when no limit is given", async () => {
    vi.mocked(storage.getNotebookEntries).mockResolvedValue([]);
    await request(app)
      .get("/api/coach/notebook")
      .set("Authorization", "Bearer valid-token");
    expect(storage.getNotebookEntries).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ limit: 500 }),
    );
  });
});

// Coach chat audit 2026-11-24 (L63): the app sends the text with every save,
// and any text in the request counted as the user confirming the note. Moving
// only the follow-up date of an unreviewed memory then confirmed it unread.
describe("an edit that leaves the text alone", () => {
  const patch = (body: Record<string, unknown>) =>
    request(app)
      .patch("/api/coach/notebook/1")
      .send(body)
      .set("Authorization", "Bearer valid-token");

  beforeEach(() => {
    vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
      createMockCoachNotebookEntry({
        type: "commitment",
        content: "Walk after dinner",
      }),
    );
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "commitment" }),
    );
  });

  it("does not pass the unchanged text on (so it does not confirm the note)", async () => {
    const res = await patch({
      type: "commitment",
      content: "Walk after dinner",
      followUpDate: "2026-12-01",
    });
    expect(res.status).toBe(200);
    const update = vi.mocked(storage.updateNotebookEntry).mock.calls[0][2];
    expect(update).not.toHaveProperty("content");
    expect(update).toHaveProperty("followUpDate");
  });

  it("passes changed text on (control)", async () => {
    await patch({ type: "commitment", content: "Walk after lunch" });
    expect(vi.mocked(storage.updateNotebookEntry).mock.calls[0][2]).toEqual(
      expect.objectContaining({ content: "Walk after lunch" }),
    );
  });
});

// Review of #2036: unchanged text is left out of an edit, and the label was
// only written together with the text. A goal turned into a commitment
// without rewording then had no label, so Coach could not name it.
describe("a note turned into a commitment without rewording", () => {
  it("gets its label from the stored text, and is not confirmed by it", async () => {
    vi.mocked(storage.getNotebookEntryById).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "goal", content: "Walk daily" }),
    );
    vi.mocked(storage.updateNotebookEntry).mockResolvedValue(
      createMockCoachNotebookEntry({ type: "commitment" }),
    );
    const res = await request(app)
      .patch("/api/coach/notebook/1")
      .send({ type: "commitment", content: "Walk daily" })
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    const update = vi.mocked(storage.updateNotebookEntry).mock.calls[0][2];
    expect(update).toEqual(
      expect.objectContaining({ type: "commitment", label: "Walk daily" }),
    );
    expect(update).not.toHaveProperty("content");
  });
});
