// server/services/__tests__/notebook-extraction.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatCompletion } from "openai/resources/chat/completions";
import {
  extractNotebookEntries,
  shouldUpdateStrategy,
} from "../notebook-extraction";
import { openai } from "../../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../../lib/ai-safety";
import { civilDateString } from "../../lib/civil-date";

function mockCompletion(content: string): ChatCompletion {
  return {
    id: "test",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content, refusal: null },
      },
    ],
  };
}

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: { completions: { create: vi.fn() } },
  },
  MODEL_FAST: "gpt-4o-mini",
}));

vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntryCount: vi.fn().mockResolvedValue(3),
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

describe("Notebook Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts entries from a conversation", async () => {
    mockCreate.mockResolvedValue(
      mockCompletion(
        JSON.stringify({
          entries: [
            {
              type: "preference",
              content: "Prefers quick meals under 15 min",
              followUpDate: null,
            },
            {
              type: "commitment",
              content: "Try meal prepping on Sunday",
              followUpDate: "2026-04-13",
            },
          ],
        }),
      ),
    );

    const messages = [
      { role: "user" as const, content: "I need quick meal ideas" },
      { role: "assistant" as const, content: "Try meal prepping on Sunday!" },
    ];

    // Pinned `now` well before the fixture's followUpDate — this test is
    // about basic extraction mechanics (type mapping, followUpDate
    // passthrough), not the past-date filter (covered by its own tests
    // below), so it must not depend on wall-clock "today".
    const entries = await extractNotebookEntries(messages, "user-1", 1, {
      now: new Date("2026-01-01T00:00:00Z"),
      tz: "UTC",
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("preference");
    expect(entries[1].type).toBe("commitment");
    expect(entries[1].followUpDate).toBe("2026-04-13");
  });

  it("states the user's civil date and tells the model to resolve relative phrases against it (UTC-negative tz)", async () => {
    mockCreate.mockResolvedValue(
      mockCompletion(JSON.stringify({ entries: [] })),
    );

    // UTC day (Sept 5) and the user's civil day (Sept 4, evening in LA)
    // differ at this instant — the classic west-of-Greenwich case this whole
    // todo is about. If the prompt stated the wrong day here, it would state
    // the UTC day, not the user's.
    const now = new Date("2026-09-05T03:00:00Z");
    const tz = "America/Los_Angeles";

    await extractNotebookEntries(
      [{ role: "user", content: "Check in with me next week" }],
      "user-1",
      1,
      { now, tz },
    );

    const request = mockCreate.mock.calls[0][0];
    const systemPrompt = request.messages[0].content as string;
    expect(systemPrompt).toContain(
      `Current date for this user: ${civilDateString(now, tz)}`,
    );
    expect(civilDateString(now, tz)).toBe("2026-09-04");
    expect(systemPrompt.toLowerCase()).toContain("resolve relative phrases");
  });

  it("states the user's civil date and tells the model to resolve relative phrases against it (UTC-positive tz — the opposite-sign companion of the test above)", async () => {
    mockCreate.mockResolvedValue(
      mockCompletion(JSON.stringify({ entries: [] })),
    );

    // UTC day (Sept 4) and the user's civil day (Sept 5, already morning in
    // Tokyo) differ at this instant, crossing the boundary in the OPPOSITE
    // direction from the UTC-negative test above — a fix that only handles
    // one sign would pass that test while still being wrong here.
    const now = new Date("2026-09-04T20:00:00Z");
    const tz = "Asia/Tokyo";

    await extractNotebookEntries(
      [{ role: "user", content: "Check in with me next week" }],
      "user-1",
      1,
      { now, tz },
    );

    const request = mockCreate.mock.calls[0][0];
    const systemPrompt = request.messages[0].content as string;
    expect(systemPrompt).toContain(
      `Current date for this user: ${civilDateString(now, tz)}`,
    );
    expect(civilDateString(now, tz)).toBe("2026-09-05");
  });

  it("nulls a followUpDate the model resolved into the past, as defense-in-depth against the prompt instruction being ignored", async () => {
    const now = new Date("2026-09-05T03:00:00Z");
    const tz = "America/Los_Angeles"; // civil date at `now`: 2026-09-04

    mockCreate.mockResolvedValue(
      mockCompletion(
        JSON.stringify({
          entries: [
            {
              type: "commitment",
              content: "Check in Monday",
              followUpDate: "2026-09-01", // before the civil date above
            },
          ],
        }),
      ),
    );

    const entries = await extractNotebookEntries(
      [{ role: "user", content: "Check in with me Monday" }],
      "user-1",
      1,
      { now, tz },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].followUpDate).toBeNull();
  });

  it("keeps a followUpDate equal to the user's civil date TODAY — the boundary the naive instant comparison would wrongly reject", async () => {
    const now = new Date("2026-09-05T03:00:00Z");
    const tz = "America/Los_Angeles"; // civil date at `now`: 2026-09-04

    mockCreate.mockResolvedValue(
      mockCompletion(
        JSON.stringify({
          entries: [
            {
              type: "commitment",
              content: "Check in later today",
              followUpDate: "2026-09-04", // equals the civil date above
            },
          ],
        }),
      ),
    );

    const entries = await extractNotebookEntries(
      [{ role: "user", content: "Check in with me later today" }],
      "user-1",
      1,
      { now, tz },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].followUpDate).toBe("2026-09-04");
  });

  it("adds the shared system prompt boundary to the extractor prompt", async () => {
    mockCreate.mockResolvedValue(
      mockCompletion(JSON.stringify({ entries: [] })),
    );

    await extractNotebookEntries(
      [{ role: "user", content: "Remember this preference" }],
      "user-1",
      1,
      { tz: "UTC" },
    );

    const request = mockCreate.mock.calls[0][0];
    expect(request.messages[0].content).toContain(SYSTEM_PROMPT_BOUNDARY);
  });

  it("filters unsafe extracted medical advice before persistence", async () => {
    mockCreate.mockResolvedValue(
      mockCompletion(
        JSON.stringify({
          entries: [
            {
              type: "insight",
              content: "You likely have diabetes.",
              followUpDate: null,
            },
            {
              type: "preference",
              content: "Prefers quick lunches with vegetables",
              followUpDate: null,
            },
          ],
        }),
      ),
    );

    const entries = await extractNotebookEntries(
      [{ role: "user", content: "I need quick lunch ideas" }],
      "user-1",
      1,
      { tz: "UTC" },
    );

    expect(entries).toEqual([
      {
        type: "preference",
        content: "Prefers quick lunches with vegetables",
        followUpDate: null,
      },
    ]);
  });

  it("returns empty array on parse failure", async () => {
    mockCreate.mockResolvedValue(mockCompletion("not json"));

    const entries = await extractNotebookEntries(
      [{ role: "user", content: "hello" }],
      "user-1",
      1,
      { tz: "UTC" },
    );
    expect(entries).toEqual([]);
  });

  it("shouldUpdateStrategy returns true for count=0 and every multiple of 5 (M9 — 2026-04-18)", () => {
    // count=0 → new user, never extracted → must extract now
    expect(shouldUpdateStrategy(0)).toBe(true);
    expect(shouldUpdateStrategy(1)).toBe(false);
    expect(shouldUpdateStrategy(4)).toBe(false);
    expect(shouldUpdateStrategy(5)).toBe(true);
    expect(shouldUpdateStrategy(10)).toBe(true);
  });
});
