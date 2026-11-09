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
