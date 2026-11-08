import { describe, it, expect } from "vitest";
import {
  OPENING_BRIEF_METADATA,
  isOpeningBriefMessage,
  greetingFor,
  renderOpeningBrief,
  type BriefInput,
} from "../opening-brief";

const base: BriefInput = {
  localHour: 14,
  name: "Will",
  consumedCalories: 820,
  calorieGoal: 1949,
  consumedProtein: 42,
  proteinGoal: 120,
  tonightPlan: null,
  expiringPantry: [],
  topTip: null,
  suggestions: [],
  reminder: null,
};

const full = (over: Partial<BriefInput> = {}) =>
  renderOpeningBrief({ ...base, ...over }, "full");

describe("greetingFor", () => {
  it("uses the time of day and the name", () => {
    expect(greetingFor(9, "Will")).toBe("Good morning, Will.");
    expect(greetingFor(14, null)).toBe("Good afternoon.");
    expect(greetingFor(19, "Will")).toBe("Good evening, Will.");
  });

  it("switches at 12 and 17", () => {
    expect(greetingFor(11, null)).toBe("Good morning.");
    expect(greetingFor(12, null)).toBe("Good afternoon.");
    expect(greetingFor(17, null)).toBe("Good evening.");
  });
});

describe("recap", () => {
  it("states calories against the goal and protein when behind", () => {
    expect(full().recap).toBe(
      "You're at 820 of 1,949 calories. Protein is behind at 42 of 120 g.",
    );
  });

  it("leaves protein out when it is on track", () => {
    expect(full({ consumedProtein: 120 }).recap).toBe(
      "You're at 820 of 1,949 calories.",
    );
  });

  it("has no 'of' without a calorie goal", () => {
    expect(full({ calorieGoal: null }).recap).toBe(
      "You've logged 820 calories so far.",
    );
  });

  it("says nothing is logged when nothing is", () => {
    expect(full({ consumedCalories: 0, consumedProtein: 0 }).recap).toBe(
      "Nothing logged yet today.",
    );
  });

  it("rounds to whole numbers", () => {
    expect(full({ consumedCalories: 820.6, consumedProtein: 41.6 }).recap).toBe(
      "You're at 821 of 1,949 calories. Protein is behind at 42 of 120 g.",
    );
  });
});

describe("stats", () => {
  it("shows remaining, protein to go and tonight's plan", () => {
    expect(full({ tonightPlan: "Lentil stew" }).stats).toEqual([
      { value: "1,129", label: "Remaining" },
      { value: "78 g", label: "Protein to go" },
      { value: "Lentil stew", label: "Tonight" },
    ]);
  });

  it("shows Over past the goal", () => {
    expect(full({ consumedCalories: 2100 }).stats[0]).toEqual({
      value: "151",
      label: "Over",
    });
  });

  it("is empty without goals", () => {
    expect(full({ calorieGoal: null, proteinGoal: null }).stats).toEqual([]);
  });

  it("cuts a long plan name to 18 characters", () => {
    const tile = full({ tonightPlan: "Slow-cooked chickpea and spinach curry" })
      .stats[2];
    expect(tile.value).toBe("Slow-cooked chick…");
    expect(tile.value).toHaveLength(18);
  });
});

describe("pointer", () => {
  it("pairs expiring pantry with tonight's plan", () => {
    expect(
      full({ expiringPantry: ["spinach"], tonightPlan: "Lentil stew" }).pointer,
    ).toBe("Your spinach expires soon. It could go in tonight's Lentil stew.");
  });

  it("names expiring pantry alone", () => {
    expect(full({ expiringPantry: ["spinach"] }).pointer).toBe(
      "Your spinach expires soon.",
    );
  });

  it("falls back to tonight's plan", () => {
    expect(full({ tonightPlan: "Lentil stew" }).pointer).toBe(
      "Tonight's plan is Lentil stew.",
    );
  });

  it("then the notebook tip, verbatim", () => {
    expect(full({ topTip: "Protein at breakfast helps you." }).pointer).toBe(
      "Protein at breakfast helps you.",
    );
  });

  it("then the protein gap", () => {
    expect(full().pointer).toBe("78 g protein left today.");
  });

  it("is null when there is nothing to point at", () => {
    expect(full({ consumedProtein: 120 }).pointer).toBeNull();
  });
});

describe("short form", () => {
  it("keeps only the greeting and recap", () => {
    const b = renderOpeningBrief(
      { ...base, tonightPlan: "Lentil stew", suggestions: ["a"] },
      "short",
    );
    expect(b.stats).toEqual([]);
    expect(b.pointer).toBeNull();
    expect(b.suggestions).toEqual([]);
    expect(b.text).toBe(
      "Good afternoon, Will.\n\nYou're at 820 of 1,949 calories. Protein is behind at 42 of 120 g.",
    );
  });

  it("equals the full reminder form when a reminder is pending", () => {
    const input: BriefInput = { ...base, reminder: { type: "daily-checkin" } };
    expect(renderOpeningBrief(input, "short")).toEqual(
      renderOpeningBrief(input, "full"),
    );
  });
});

describe("reminder form", () => {
  it("leads a commitment with three answers", () => {
    const b = full({
      reminder: {
        type: "commitment",
        notebookEntryId: 7,
        content: "prep overnight oats",
      },
      tonightPlan: "Lentil stew",
    });
    expect(b.reminder).toEqual({
      type: "commitment",
      lead: "Earlier you said you'd prep overnight oats. How did it go?",
      actions: [
        { label: "Went well", kind: "send", message: "It went well" },
        { label: "Partly", kind: "send", message: "It went partly" },
        { label: "Didn't happen", kind: "send", message: "It didn't happen" },
      ],
    });
    expect(b.stats).toEqual([]);
    expect(b.pointer).toBeNull();
  });

  it("offers the meal for the time of day on a missed log", () => {
    const at = (localHour: number) =>
      full({ localHour, reminder: { type: "meal-log" } }).reminder;
    expect(at(13)).toEqual({
      type: "meal-log",
      lead: "Nothing logged yet today.",
      actions: [{ label: "Log lunch", kind: "quick-log" }],
    });
    expect(at(8)?.actions[0].label).toBe("Log breakfast");
    expect(at(18)?.actions[0].label).toBe("Log dinner");
    expect(at(22)?.actions[0].label).toBe("Log snack");
  });

  it("asks for the check-in", () => {
    expect(full({ reminder: { type: "daily-checkin" } }).reminder).toEqual({
      type: "daily-checkin",
      lead: "Time for your check-in.",
      actions: [
        { label: "How was my day?", kind: "send", message: "How was my day?" },
      ],
    });
  });

  it("orders the plain text greeting, lead, recap", () => {
    expect(full({ reminder: { type: "daily-checkin" } }).text).toBe(
      "Good afternoon, Will.\n\nTime for your check-in.\n\nYou're at 820 of 1,949 calories. Protein is behind at 42 of 120 g.",
    );
  });
});

describe("full text and chips", () => {
  it("joins greeting, recap and pointer with blank lines", () => {
    expect(full().text).toBe(
      "Good afternoon, Will.\n\nYou're at 820 of 1,949 calories. Protein is behind at 42 of 120 g.\n\n78 g protein left today.",
    );
  });

  it("caps chips at three", () => {
    expect(full({ suggestions: ["a", "b", "c", "d"] }).suggestions).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("isOpeningBriefMessage", () => {
  it("recognises only the saved brief's metadata", () => {
    expect(isOpeningBriefMessage({ metadata: OPENING_BRIEF_METADATA })).toBe(
      true,
    );
    expect(isOpeningBriefMessage({ metadata: { kind: "other" } })).toBe(false);
    expect(isOpeningBriefMessage({ metadata: null })).toBe(false);
    expect(isOpeningBriefMessage({ metadata: "opening_brief" })).toBe(false);
  });
});
