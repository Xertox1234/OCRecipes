import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { casesForRun, coachProCasesSchema } from "../lib/coach-pro-cases";
import { runAssertions } from "../assertions";

const raw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../datasets/coach-pro-cases.json"),
    "utf8",
  ),
);

describe("coach-pro-cases.json (audit 2026-11-24, M30)", () => {
  const parsed = coachProCasesSchema.safeParse(raw);

  it("parses, with unique ids", () => {
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data!.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps the Pro-only context fields the free schema would drop", () => {
    const byId = new Map(parsed.data!.map((c) => [c.id, c]));
    expect(byId.get("pro-mood-low-no-checkin-01")!.context.moodBand).toBe(
      "low",
    );
  });

  it("skips offer cases when the finder is off, and says which", () => {
    const off = casesForRun(parsed.data!, { finderOn: false });
    expect(off.skipped).toEqual(["pro-offer-recipe-01"]);
    expect(off.run.some((c) => c.flags.offer)).toBe(false);
    const on = casesForRun(parsed.data!, { finderOn: true });
    expect(on.skipped).toEqual([]);
    expect(on.run).toHaveLength(parsed.data!.length);
  });

  it("every regex in the dataset compiles", () => {
    for (const c of parsed.data!) {
      for (const p of [
        ...(c.assertions?.mustContain ?? []),
        ...(c.assertions?.mustNotContain ?? []),
        ...Object.values(c.pro?.toolArgs ?? {}).flatMap((f) =>
          Object.values(f),
        ),
      ]) {
        expect(() => new RegExp(p, "i"), `${c.id}: ${p}`).not.toThrow();
      }
    }
  });

  it("the dairy case's patterns allow dairy-free swaps and catch dairy", () => {
    const memory = parsed.data!.find((c) => c.id === "pro-memory-dairy-01")!;
    const pass = runAssertions(
      "Try oatmeal made with almond milk, or a coconut yogurt bowl with berries.",
      memory.assertions,
    );
    expect(pass.passed).toBe(true);
    const fail = runAssertions(
      "Try Greek yogurt with honey and a glass of milk.",
      memory.assertions,
    );
    expect(fail.passed).toBe(false);
  });
});
