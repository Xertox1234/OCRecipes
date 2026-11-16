import { describe, it, expect } from "vitest";
import { AI_SHARED_DATA, AI_SHARING_VERSION } from "../ai-sharing";

describe("AI-sharing disclosure", () => {
  it("names the weekly report's week of food totals and recipe titles", () => {
    const text = AI_SHARED_DATA.join(" ");
    expect(text).toMatch(/weekly report/i);
    expect(text).toMatch(/recipe titles/i);
    expect(text).not.toMatch(/what you ate today/);
  });

  it("names the pantry and grocery lists Coach can look at", () => {
    const text = AI_SHARED_DATA.join(" ");
    expect(text).toMatch(/pantry items and grocery lists/i);
    expect(AI_SHARING_VERSION).not.toBe("2026-11-10.2");
  });

  it("is versioned after the weekly report changed what is sent", () => {
    expect(AI_SHARING_VERSION).not.toBe("2026-11-10");
  });
});
