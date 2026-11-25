import { describe, it, expect } from "vitest";
import {
  stepTimers,
  formatCountdown,
  remainingSeconds,
  cookCards,
  stepSpeech,
} from "../cook-mode-utils";

const seconds = (text: string) => stepTimers(text).map((t) => t.seconds);
const labels = (text: string) => stepTimers(text).map((t) => t.label);

describe("stepTimers", () => {
  it.each([
    ["Simmer for 10 minutes.", [600], ["10 min"]],
    ["Bake 25 mins until golden", [1500], ["25 min"]],
    ["Rest for 1 hour", [3600], ["1 hr"]],
    ["Blanch for 30 seconds", [30], ["30 sec"]],
    ["Roast for 1.5 hours", [5400], ["1 hr 30 min"]],
    ["Cook 2 hrs", [7200], ["2 hr"]],
    ["Stir for 45 secs", [45], ["45 sec"]],
  ])("reads a plain duration: %s", (text, secs, labs) => {
    expect(seconds(text)).toEqual(secs);
    expect(labels(text)).toEqual(labs);
  });

  it("joins hours and minutes written together into one timer", () => {
    expect(seconds("Braise for 1 hour 30 minutes.")).toEqual([5400]);
    expect(seconds("Braise for 1 hour and 15 minutes.")).toEqual([4500]);
    expect(labels("Cook 2 minutes 30 seconds")).toEqual(["2 min 30 sec"]);
  });

  it("starts a range at its lower end and names both ends", () => {
    expect(stepTimers("Bake for 8-10 minutes")).toEqual([
      { seconds: 480, label: "8–10 min" },
    ]);
    expect(stepTimers("Bake for 8 to 10 minutes")).toEqual([
      { seconds: 480, label: "8–10 min" },
    ]);
    expect(stepTimers("Chill 1–2 hours")).toEqual([
      { seconds: 3600, label: "1–2 hr" },
    ]);
  });

  it("reads fractions and words", () => {
    expect(seconds("Rest for 1/2 hour")).toEqual([1800]);
    expect(seconds("Rest for 1 1/2 hours")).toEqual([5400]);
    expect(seconds("Rest for ½ hour")).toEqual([1800]);
    expect(seconds("Rest for 1½ hours")).toEqual([5400]);
    expect(seconds("Leave for an hour")).toEqual([3600]);
    expect(seconds("Wait a minute")).toEqual([60]);
    expect(seconds("Leave for half an hour")).toEqual([1800]);
    expect(seconds("Fry for two minutes")).toEqual([120]);
  });

  it("finds every duration in a step, in order", () => {
    expect(
      seconds("Sear 3 minutes per side, then roast for 20 minutes."),
    ).toEqual([180, 1200]);
  });

  it.each([
    "Preheat the oven to 350 degrees.",
    "Add 2 cups of flour and 30 g butter.",
    "Use a 9 inch pan and 5 ml of oil.",
    "Cook until the minute steak is done.",
    "Serves 4 in 2 seconds flat",
    "Marinate for 3 days",
    "",
  ])("finds no timer in: %s", (text) => {
    // "2 seconds" is under the shortest useful timer.
    expect(stepTimers(text)).toEqual([]);
  });

  it("ignores a duration too long to be a kitchen timer", () => {
    expect(stepTimers("Ferment for 48 hours")).toEqual([]);
    expect(seconds("Slow cook for 12 hours")).toEqual([43200]);
  });

  it("does not read a unit out of the middle of a word", () => {
    expect(stepTimers("Add 2 minced cloves and 3 section pieces")).toEqual([]);
    expect(stepTimers("Use 2 hourglass shaped pasta")).toEqual([]);
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [600, "10:00"],
    [3600, "1:00:00"],
    [5405, "1:30:05"],
    [-3, "0:00"],
  ])("%i seconds reads %s", (s, text) => {
    expect(formatCountdown(s)).toBe(text);
  });
});

describe("remainingSeconds", () => {
  it("counts down from the end time, rounding up so 0 means done", () => {
    expect(remainingSeconds(10_000, 0)).toBe(10);
    expect(remainingSeconds(10_000, 9_001)).toBe(1);
    expect(remainingSeconds(10_000, 10_000)).toBe(0);
    expect(remainingSeconds(10_000, 60_000)).toBe(0);
  });
});

describe("cookCards", () => {
  const ingredients = [
    { name: "rice", quantity: "1", unit: "cup" },
    { name: "salt", quantity: null, unit: null },
  ];

  it("opens with the ingredients, then one card per step", () => {
    const cards = cookCards({
      ingredients,
      instructions: ["Rinse the rice.", "Simmer for 12 minutes."],
      details: [null, "Keep the lid on."],
    });
    expect(cards).toEqual([
      { kind: "ready", ingredients: ["1 cup rice", "salt"] },
      {
        kind: "step",
        number: 1,
        text: "Rinse the rice.",
        detail: null,
        timers: [],
      },
      {
        kind: "step",
        number: 2,
        text: "Simmer for 12 minutes.",
        detail: "Keep the lid on.",
        timers: [{ seconds: 720, label: "12 min" }],
      },
    ]);
  });

  it("skips the ingredients card when the recipe lists none", () => {
    const cards = cookCards({ ingredients: [], instructions: ["Stir."] });
    expect(cards.map((c) => c.kind)).toEqual(["step"]);
  });

  it("drops blank steps and keeps the numbering unbroken", () => {
    const cards = cookCards({
      ingredients: [],
      instructions: ["Chop.", "  ", "Fry."],
    });
    expect(
      cards.map((c) => (c.kind === "step" ? [c.number, c.text] : null)),
    ).toEqual([
      [1, "Chop."],
      [2, "Fry."],
    ]);
  });

  it("is empty for a recipe with no steps", () => {
    expect(cookCards({ ingredients, instructions: [] })).toEqual([]);
  });
});

describe("stepSpeech", () => {
  it("says the step number, then the step", () => {
    expect(
      stepSpeech(
        { kind: "step", number: 2, text: "Simmer.", detail: null, timers: [] },
        5,
      ),
    ).toBe("Step 2 of 5. Simmer.");
  });

  it("reads the ingredients card as a list", () => {
    expect(
      stepSpeech({ kind: "ready", ingredients: ["1 cup rice", "salt"] }, 3),
    ).toBe("Get ready. You need: 1 cup rice. salt.");
  });
});
