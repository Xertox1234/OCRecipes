import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hashCoachCacheContext,
  hashCoachCacheKey,
  hashNotebookDedupeKey,
} from "../coach-cache-keys";
import type { CoachContext } from "../nutrition-coach";

vi.mock("../../storage", () => ({ storage: {} }));

vi.mock("../nutrition-coach", () => ({
  getSystemPromptTemplateVersion: vi.fn().mockReturnValue("test-version-hash"),
}));

// Golden values: a changed hash silently invalidates or cross-serves cached
// coach replies, so these pin the exact digests for fixed inputs.
describe("coach cache keys — pinned digests", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const context: CoachContext = {
    goals: { calories: 2000, protein: 150, carbs: 200, fat: 70 },
    todayIntake: { calories: 800, protein: 50, carbs: 90, fat: 20 },
    dietaryProfile: {
      dietType: "vegetarian",
      allergies: [{ name: "peanut", severity: "severe" }],
      dislikes: ["cilantro"],
    },
    aboutUser: { primaryGoal: "lose weight" },
    frequentFoodsSummary: "oats (3×)",
  };

  it("hashCoachCacheKey", () => {
    expect(
      hashCoachCacheKey(
        "user-1",
        "  How much PROTEIN today? ",
        false,
        "2026-10-28",
        "ctx-hash",
        "personalized_advice",
      ),
    ).toMatchInlineSnapshot(`"26410bb7ae2fc1ab260ef23bd5035b29"`);
    expect(
      hashCoachCacheKey("user-1", "hi", true, "2026-10-28"),
    ).toMatchInlineSnapshot(`"b7d17f7629b597f1a431345c28a8e54a"`);
  });

  it("hashCoachCacheContext", () => {
    expect(
      hashCoachCacheContext(
        context,
        new Date("2026-10-28T15:00:00Z"),
        "America/Los_Angeles",
      ),
    ).toMatchInlineSnapshot(`"8cd297e75011d58c"`);
  });

  it("hashNotebookDedupeKey (per-turn and weekly strategy)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const base = {
      userId: "user-1",
      conversationId: 7,
      entryContent: "prefers oat milk",
      lastUserMessage: "I switched to oat milk",
      lastAssistantMessage: "Noted!",
    };
    expect(
      hashNotebookDedupeKey({ ...base, entryType: "preference" }),
    ).toMatchInlineSnapshot(
      `"1450ea3aaf1fc22b589deb13715207c28d82425a1307102820cee8ba7c302b0e"`,
    );
    expect(
      hashNotebookDedupeKey({ ...base, entryType: "coaching_strategy" }),
    ).toMatchInlineSnapshot(
      `"858c0d8225f9ef1dc6d8cf01bfab3469161bacbee413f6edf4cabb39dd561cac"`,
    );
  });
});
