import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  parsePlanDays,
  planBannerA11yLabel,
  stripCoachBlocksFence,
  stripCoachBlocksFenceIncremental,
  createFenceScanState,
  filterValidBlocks,
  describePlanSaveFailure,
  formatPlanSaveSuccess,
} from "../coach-chat-utils";

const validDays = [
  {
    label: "Monday",
    meals: [
      {
        type: "breakfast" as const,
        title: "Oatmeal",
        calories: 350,
        protein: 12,
      },
      {
        type: "lunch" as const,
        title: "Grilled Chicken Salad",
        calories: 480,
        protein: 38,
      },
      {
        type: "dinner" as const,
        title: "Salmon Bowl",
        calories: 550,
        protein: 42,
      },
    ],
    totals: { calories: 1380, protein: 92 },
  },
  {
    label: "Tuesday",
    meals: [
      {
        type: "breakfast" as const,
        title: "Smoothie",
        calories: 280,
        protein: 20,
      },
    ],
    totals: { calories: 280, protein: 20 },
  },
];

describe("parsePlanDays", () => {
  it("returns typed days from valid plan data", () => {
    const result = parsePlanDays(validDays);
    expect(result).toHaveLength(2);
    expect(result![0].label).toBe("Monday");
    expect(result![0].meals).toHaveLength(3);
    expect(result![1].meals[0].title).toBe("Smoothie");
  });

  it("returns undefined for non-array input", () => {
    expect(parsePlanDays("not an array")).toBeUndefined();
    expect(parsePlanDays(42)).toBeUndefined();
    expect(parsePlanDays(null)).toBeUndefined();
    expect(parsePlanDays(undefined)).toBeUndefined();
  });

  it("returns undefined for array with invalid shape", () => {
    expect(parsePlanDays([{ wrong: "shape" }])).toBeUndefined();
    expect(parsePlanDays([{ label: "Monday" }])).toBeUndefined();
  });

  it("returns undefined for missing required fields in meals", () => {
    const missingCalories = [
      {
        label: "Monday",
        meals: [{ type: "breakfast", title: "Oatmeal", protein: 12 }],
        totals: { calories: 350, protein: 12 },
      },
    ];
    expect(parsePlanDays(missingCalories)).toBeUndefined();
  });

  it("returns undefined for invalid meal type enum", () => {
    const badMealType = [
      {
        label: "Monday",
        meals: [{ type: "brunch", title: "Eggs", calories: 300, protein: 20 }],
        totals: { calories: 300, protein: 20 },
      },
    ];
    expect(parsePlanDays(badMealType)).toBeUndefined();
  });

  it("returns empty array for empty input array", () => {
    expect(parsePlanDays([])).toEqual([]);
  });
});

describe("planBannerA11yLabel", () => {
  it("pluralizes days and meals correctly", () => {
    expect(planBannerA11yLabel(validDays)).toBe(
      "AI meal plan with 2 days and 4 meals",
    );
  });

  it("uses singular for 1 day", () => {
    const oneDay = [validDays[1]];
    expect(planBannerA11yLabel(oneDay)).toBe(
      "AI meal plan with 1 day and 1 meal",
    );
  });

  it("handles day with no meals", () => {
    const emptyDay = [
      { label: "Rest Day", meals: [], totals: { calories: 0, protein: 0 } },
    ];
    expect(planBannerA11yLabel(emptyDay)).toBe(
      "AI meal plan with 1 day and 0 meals",
    );
  });
});

describe("stripCoachBlocksFence", () => {
  it("returns trimmed text when no fence present", () => {
    expect(stripCoachBlocksFence("  hello world  ")).toBe("hello world");
  });

  it("strips fence when only fence present (no preceding text)", () => {
    const input = '```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("");
  });

  it("preserves text before the fence and strips fence block", () => {
    const input =
      'Here is your plan.\n```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("Here is your plan.");
  });

  it("strips up to end of string when closing fence not yet arrived", () => {
    const input = 'Some text.\n```coach_blocks\n{"type":"action';
    expect(stripCoachBlocksFence(input)).toBe("Some text.");
  });

  it("handles text after closing fence", () => {
    const input = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    expect(stripCoachBlocksFence(input)).toBe("Before.\nAfter.");
  });
});

// AC #2 of
// todos/P3-2026-09-23-perf-minor-recipe-browser-windowing-and-stream-rescan.md
// (2026-09-23 front-end audit finding L10): `stripCoachBlocksFence` re-scans
// the FULL accumulated text from index 0 on every SSE event, which is O(n^2)
// over a long streamed response. `stripCoachBlocksFenceIncremental` tracks
// scan offsets in a `FenceScanState` across repeated calls on a growing
// string so each call only re-scans the unsearched suffix (plus a small
// constant overlap to catch a marker split across two chunks) instead of
// starting over from position 0 every time.
//
// The contract under test: for ANY sequence of chunks appended to build up
// `accumulated`, calling stripCoachBlocksFenceIncremental(accumulated, state)
// after each chunk must return EXACTLY what the whole-text
// stripCoachBlocksFence(accumulated) would return at that same point — the
// incremental version must be a drop-in, cheaper-to-compute replacement, not
// a behavior change.
describe("stripCoachBlocksFenceIncremental", () => {
  /** Feed `full` in the given chunk sizes and assert equivalence with the
   *  whole-text stripCoachBlocksFence after every chunk. */
  function assertEquivalentAcrossChunks(full: string, chunkSizes: number[]) {
    const state = createFenceScanState();
    let acc = "";
    let pos = 0;
    for (const size of chunkSizes) {
      acc += full.slice(pos, pos + size);
      pos += size;
      expect(stripCoachBlocksFenceIncremental(acc, state)).toBe(
        stripCoachBlocksFence(acc),
      );
    }
    expect(pos).toBe(full.length); // sanity: chunk sizes covered the whole string
  }

  it("matches the whole-text version for a single-chunk call with no fence", () => {
    const state = createFenceScanState();
    expect(stripCoachBlocksFenceIncremental("  hello world  ", state)).toBe(
      stripCoachBlocksFence("  hello world  "),
    );
  });

  it("matches the whole-text version for a single-chunk call with a complete fence", () => {
    const state = createFenceScanState();
    const input =
      'Here is your plan.\n```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFenceIncremental(input, state)).toBe(
      stripCoachBlocksFence(input),
    );
  });

  it("stays equivalent when the open marker is split across chunks (split at 3, 8, 15 chars in)", () => {
    const full = 'Before text.\n```coach_blocks\n{"a":1}\n```\nAfter.';
    const markerStart = full.indexOf("```coach_blocks\n");
    for (const splitAt of [3, 8, 15]) {
      const firstChunkLen = markerStart + splitAt;
      assertEquivalentAcrossChunks(full, [
        firstChunkLen,
        full.length - firstChunkLen,
      ]);
    }
  });

  it("stays equivalent when the close marker is split across chunks", () => {
    const full = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    const closeStart = full.lastIndexOf("```");
    for (const splitAt of [1, 2]) {
      const firstChunkLen = closeStart + splitAt;
      assertEquivalentAcrossChunks(full, [
        firstChunkLen,
        full.length - firstChunkLen,
      ]);
    }
  });

  it("stays equivalent when the newline right after the close fence arrives in the next chunk", () => {
    const full = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    const closeEnd =
      full.indexOf("```", full.indexOf("```coach_blocks\n") + 16) + 3;
    assertEquivalentAcrossChunks(full, [closeEnd, full.length - closeEnd]);
  });

  it("does not confuse a near-miss triple-backtick fence (e.g. ```json) with the coach_blocks marker", () => {
    const state = createFenceScanState();
    const input = 'Here\'s some code:\n```json\n{"a":1}\n```\nDone.';
    expect(stripCoachBlocksFenceIncremental(input, state)).toBe(
      stripCoachBlocksFence(input),
    );
  });

  it("stays equivalent when the fence never closes (stream still mid-block)", () => {
    const full = 'Before.\n```coach_blocks\n{"partial":"jso';
    assertEquivalentAcrossChunks(
      full,
      Array.from({ length: full.length }, () => 1),
    );
  });

  it("stays equivalent across every possible 1-character chunk boundary for a fenced response", () => {
    const full =
      'Here is your meal plan for today.\n```coach_blocks\n{"type":"action_card","title":"Log Lunch"}\n```\nLet me know if you want changes.';
    assertEquivalentAcrossChunks(
      full,
      Array.from({ length: full.length }, () => 1),
    );
  });

  it("stays equivalent across every possible 1-character chunk boundary for a response with no fence", () => {
    const full =
      "Just a plain streamed answer with no coach_blocks fence at all.";
    assertEquivalentAcrossChunks(
      full,
      Array.from({ length: full.length }, () => 1),
    );
  });
});

describe("filterValidBlocks", () => {
  it("returns only items matching coachBlockSchema", () => {
    const valid = {
      type: "action_card" as const,
      title: "Log Lunch",
      subtitle: "Quick meal entry",
      actionLabel: "Log it",
      action: {
        type: "log_food" as const,
        description: "Chicken salad",
        calories: 350,
        protein: 35,
        fat: 12,
        carbs: 25,
      },
    };
    const invalid = { type: "unknown_block", garbage: true };
    const result = filterValidBlocks([valid, invalid, null, 42]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "action_card" });
  });

  it("returns empty array when nothing passes validation", () => {
    expect(filterValidBlocks([null, undefined, {}, { type: "bad" }])).toEqual(
      [],
    );
  });
});

describe("describePlanSaveFailure", () => {
  it("treats a 402 (catalog quota exceeded) as terminal with its own message", () => {
    const result = describePlanSaveFailure(
      new ApiError("402: quota", "CATALOG_QUOTA_EXCEEDED", 402),
    );
    expect(result.terminal).toBe(true);
    expect(result.message).not.toBe(
      "Couldn't add the recipe to your plan. Please try again.",
    );
  });

  it("treats a 422 (recipe missing content) as terminal with its own message", () => {
    const result = describePlanSaveFailure(
      new ApiError("422: no instructions", "VALIDATION_ERROR", 422),
    );
    expect(result.terminal).toBe(true);
    expect(result.message).not.toBe(
      "Couldn't add the recipe to your plan. Please try again.",
    );
  });

  it("treats a 404 (catalog miss) as terminal with its own message", () => {
    const result = describePlanSaveFailure(
      new ApiError("404: not found", "NOT_FOUND", 404),
    );
    expect(result.terminal).toBe(true);
    expect(result.message).not.toBe(
      "Couldn't add the recipe to your plan. Please try again.",
    );
  });

  it("keeps the three terminal messages distinct from each other", () => {
    const quota = describePlanSaveFailure(
      new ApiError("402", "CATALOG_QUOTA_EXCEEDED", 402),
    );
    const unusable = describePlanSaveFailure(
      new ApiError("422", "VALIDATION_ERROR", 422),
    );
    const missing = describePlanSaveFailure(
      new ApiError("404", "NOT_FOUND", 404),
    );
    expect(
      new Set([quota.message, unusable.message, missing.message]).size,
    ).toBe(3);
  });

  it("falls back to the generic retryable message for a non-terminal status (e.g. 500)", () => {
    const result = describePlanSaveFailure(
      new ApiError("500: server error", undefined, 500),
    );
    expect(result.terminal).toBe(false);
    expect(result.message).toBe(
      "Couldn't add the recipe to your plan. Please try again.",
    );
  });

  it("falls back to the generic retryable message for a non-ApiError (e.g. network failure)", () => {
    const result = describePlanSaveFailure(new Error("network down"));
    expect(result.terminal).toBe(false);
    expect(result.message).toBe(
      "Couldn't add the recipe to your plan. Please try again.",
    );
  });
});

describe("formatPlanSaveSuccess", () => {
  it("names the chosen day and meal, not a generic message", () => {
    expect(formatPlanSaveSuccess("Wednesday", "dinner")).toBe(
      "Added to Wednesday Dinner",
    );
  });

  it("uses MEAL_LABELS' display name for each meal type", () => {
    expect(formatPlanSaveSuccess("Wednesday", "breakfast")).toBe(
      "Added to Wednesday Breakfast",
    );
    expect(formatPlanSaveSuccess("Wednesday", "snack")).toBe(
      "Added to Wednesday Snack",
    );
  });

  // Deliberately takes a plain `dayLabel` string, NOT the `plannedDate` ISO
  // string — plannedDate is a UTC-string conversion of a local-midnight
  // instant (see PlanSlotDay.iso's doc-comment in plan-slot-picker-utils.ts),
  // so re-parsing it back into a weekday would disagree with the chip the
  // user actually tapped for any UTC-positive offset. This function must
  // stay a pure string join with no date parsing of its own — pin that here
  // so a future "helpful" refactor back to `(plannedDate, mealType)` fails
  // this test rather than silently reintroducing that bug.
  it("does no date parsing of its own — passes an arbitrary label through verbatim", () => {
    expect(formatPlanSaveSuccess("2026-09-02", "lunch")).toBe(
      "Added to 2026-09-02 Lunch",
    );
  });
});
