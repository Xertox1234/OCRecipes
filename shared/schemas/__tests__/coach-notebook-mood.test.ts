import { describe, it, expect } from "vitest";
import { extractionResultSchema } from "../coach-notebook";

const entry = { type: "goal", content: "User aims for 120 g protein a day" };

describe("extractionResultSchema moodDelta", () => {
  it("keeps an allowed step", () => {
    const r = extractionResultSchema.parse({ entries: [], moodDelta: -0.5 });
    expect(r.moodDelta).toBe(-0.5);
  });

  it.each([null, 0.25, "0", 3, undefined])(
    "a stray mood value %s becomes 0 and never costs the entries",
    (moodDelta) => {
      const r = extractionResultSchema.safeParse({
        entries: [entry],
        moodDelta,
      });
      expect(r.success).toBe(true);
      expect(r.data?.moodDelta).toBe(0);
      expect(r.data?.entries).toHaveLength(1);
    },
  );
});

// Coach chat audit 2026-11-24 (M27): one malformed entry used to fail the
// whole parse, losing every valid entry and the mood update of that turn.
describe("extractionResultSchema entries", () => {
  const good = { type: "goal", content: "Hit 120g protein" };

  it("keeps the valid entries and the mood when one entry is malformed", () => {
    const r = extractionResultSchema.safeParse({
      entries: [
        good,
        { type: "habit", content: "Unknown type" },
        {
          type: "commitment",
          content: "Walk",
          followUpDate: "2026-04-17T10:00",
        },
        { type: "preference", content: "Likes oats", label: "" },
        { type: "preference", content: "Likes rye" },
      ],
      moodDelta: 0.5,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.entries.map((e) => e.content)).toEqual([
      "Hit 120g protein",
      "Likes rye",
    ]);
    expect(r.data.moodDelta).toBe(0.5);
  });

  it("keeps at most ten entries", () => {
    const r = extractionResultSchema.parse({
      entries: Array.from({ length: 14 }, (_, i) => ({
        type: "goal",
        content: `Goal ${i}`,
      })),
    });
    expect(r.entries).toHaveLength(10);
    expect(r.entries[0].content).toBe("Goal 0");
  });

  it("still fails when entries is not a list at all", () => {
    expect(extractionResultSchema.safeParse({ entries: "none" }).success).toBe(
      false,
    );
    expect(extractionResultSchema.safeParse({}).success).toBe(false);
  });
});
