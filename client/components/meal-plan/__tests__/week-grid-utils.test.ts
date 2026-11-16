import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import { toLocalDateString } from "@shared/lib/date";

import {
  GRID_MEAL_TYPES,
  SLOTS_PER_WEEK,
  addDays,
  buildWeekGrid,
  countPlannedSlots,
  getCellAccessibilityLabel,
  getDayHeaderAccessibilityLabel,
  getInitialColumnIndex,
  getPantryPlanStartDate,
  getWeekDates,
  isBeyondForwardLimit,
  parseLocalDateString,
} from "../week-grid-utils";

let nextId = 1;

/** Only the fields the grid logic reads. */
function makeItem(
  overrides: Record<string, unknown> = {},
): MealPlanItemWithRelations {
  return {
    id: nextId++,
    userId: "user-1",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-11-17",
    mealType: "dinner",
    servings: "1",
    sortOrder: 0,
    createdAt: new Date(),
    recipe: null,
    scannedItem: null,
    ...overrides,
  } as MealPlanItemWithRelations;
}

function recipe(title: string, calories: number, imageUrl: string | null) {
  return { id: 1, title, caloriesPerServing: String(calories), imageUrl };
}

// Monday 16 November 2026; its week runs Sunday 15 to Saturday 21.
const today = new Date(2026, 10, 16);
const week = getWeekDates(today);
const nextWeek = getWeekDates(new Date(2026, 10, 24));
const lastWeek = getWeekDates(new Date(2026, 10, 10));

const items: MealPlanItemWithRelations[] = [
  // Listed out of order on purpose: the lower sortOrder must still win.
  makeItem({
    sortOrder: 1,
    recipeId: 2,
    recipe: recipe("Stir fry", 540, "https://img/stir-fry.jpg"),
  }),
  makeItem({
    sortOrder: 0,
    recipeId: 1,
    recipe: recipe("Tacos", 610, "https://img/tacos.jpg"),
  }),
  makeItem({
    plannedDate: "2026-11-18",
    mealType: "snack",
    scannedItemId: 5,
    scannedItem: {
      id: 5,
      productName: "Greek yogurt",
      calories: "120",
      imageUrl: "https://img/yogurt.jpg",
    },
  }),
  // Orphan: neither recipe nor scanned item.
  makeItem({ plannedDate: "2026-11-19", mealType: "lunch" }),
  // Outside the visible week.
  makeItem({
    plannedDate: "2026-11-25",
    recipeId: 3,
    recipe: recipe("Next week's soup", 300, null),
  }),
];

const days = buildWeekGrid(items, week, today);
const nextWeekDays = buildWeekGrid(items, nextWeek, today);

describe("getWeekDates", () => {
  it("returns the seven local days of the week, Sunday first", () => {
    expect(getWeekDates(new Date(2026, 10, 18)).map(toLocalDateString)).toEqual(
      [
        "2026-11-15",
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
        "2026-11-19",
        "2026-11-20",
        "2026-11-21",
      ],
    );
  });

  it("crosses a year boundary", () => {
    const dates = getWeekDates(new Date(2026, 11, 31)).map(toLocalDateString);
    expect(dates[0]).toBe("2026-12-27");
    expect(dates[6]).toBe("2027-01-02");
  });

  it("anchors a Sunday to itself", () => {
    const dates = getWeekDates(new Date(2026, 10, 15));
    expect(dates[0].getDay()).toBe(0);
    expect(toLocalDateString(dates[0])).toBe("2026-11-15");
  });

  it("returns local midnights whatever time the anchor carries", () => {
    const dates = getWeekDates(new Date(2026, 10, 18, 23, 59));
    expect(dates.every((d) => d.getHours() === 0 && d.getMinutes() === 0)).toBe(
      true,
    );
  });
});

describe("getWeekDates on a UTC-positive device", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("pins the timezone it claims to (guards the mechanism)", () => {
    expect(-new Date(2026, 10, 18).getTimezoneOffset()).toBe(60);
  });

  it("still returns the local calendar days, not the UTC ones", () => {
    // 00:30 local on the 18th is still the 17th in UTC.
    const dates = getWeekDates(new Date(2026, 10, 18, 0, 30));
    expect(dates.map(toLocalDateString)).toEqual([
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
  });
});

describe("addDays", () => {
  it("moves by whole days without changing its input", () => {
    const start = new Date(2026, 10, 30);
    expect(toLocalDateString(addDays(start, 2))).toBe("2026-12-02");
    expect(toLocalDateString(addDays(start, -7))).toBe("2026-11-23");
    expect(toLocalDateString(start)).toBe("2026-11-30");
  });
});

describe("buildWeekGrid", () => {
  it("lists the grid's meals with snack before dinner", () => {
    expect(GRID_MEAL_TYPES).toEqual(["breakfast", "lunch", "snack", "dinner"]);
    expect(SLOTS_PER_WEEK).toBe(28);
  });

  it("returns one day per date and marks today", () => {
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.dateStr)).toEqual(week.map(toLocalDateString));
    expect(days.map((d) => d.isToday)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("shows the lowest sortOrder first and counts the rest", () => {
    const cell = days[2].cells.dinner;
    expect(cell.title).toBe("Tacos");
    expect(cell.imageUrl).toBe("https://img/tacos.jpg");
    expect(cell.extraCount).toBe(1);
    expect(cell.items.map((i) => i.recipe?.title)).toEqual([
      "Tacos",
      "Stir fry",
    ]);
  });

  it("sums the calories of every item in a slot", () => {
    expect(days[2].cells.dinner.calories).toBe(610 + 540);
    expect(days[2].calories).toBe(1150);
  });

  it("multiplies calories by the item's servings", () => {
    const grid = buildWeekGrid(
      [makeItem({ servings: "2", recipe: recipe("Tacos", 610, null) })],
      week,
      today,
    );
    expect(grid[2].cells.dinner.calories).toBe(1220);
  });

  it("titles a scanned item by its product name, with no image", () => {
    const cell = days[3].cells.snack;
    expect(cell.title).toBe("Greek yogurt");
    expect(cell.imageUrl).toBeNull();
    expect(cell.calories).toBe(120);
  });

  it("shows an orphan as Unknown item with no calories", () => {
    const cell = days[4].cells.lunch;
    expect(cell.title).toBe("Unknown item");
    expect(cell.calories).toBe(0);
    expect(cell.extraCount).toBe(0);
  });

  it("gives an empty slot an empty cell", () => {
    expect(days[0].cells.breakfast).toEqual({
      items: [],
      title: null,
      imageUrl: null,
      extraCount: 0,
      calories: 0,
    });
  });

  it("ignores items dated outside the week", () => {
    expect(days.reduce((sum, d) => sum + d.calories, 0)).toBe(1150 + 120);
    expect(nextWeekDays[3].cells.dinner.title).toBe("Next week's soup");
  });

  it("ignores an item with an unknown meal type", () => {
    const grid = buildWeekGrid(
      [makeItem({ mealType: "brunch", recipe: recipe("Eggs", 300, null) })],
      week,
      today,
    );
    expect(countPlannedSlots(grid)).toBe(0);
  });

  it("returns an empty week while items are still undefined", () => {
    const empty = buildWeekGrid(undefined, week, today);
    expect(empty).toHaveLength(7);
    expect(empty.every((d) => d.calories === 0)).toBe(true);
  });
});

describe("countPlannedSlots", () => {
  it("counts filled cells, not items", () => {
    expect(countPlannedSlots(days)).toBe(3);
  });
});

describe("isBeyondForwardLimit", () => {
  it("allows exactly the limit and refuses one day more", () => {
    expect(isBeyondForwardLimit(new Date(2026, 10, 23), today, 7)).toBe(false);
    expect(isBeyondForwardLimit(new Date(2026, 10, 24), today, 7)).toBe(true);
  });

  it("never limits moving into the past", () => {
    expect(isBeyondForwardLimit(new Date(2026, 9, 1), today, 7)).toBe(false);
  });
});

describe("getInitialColumnIndex", () => {
  it("opens on today's column when today is in the week", () => {
    expect(getInitialColumnIndex(days)).toBe(1);
  });

  it("opens on the first column otherwise", () => {
    expect(getInitialColumnIndex(nextWeekDays)).toBe(0);
  });
});

describe("accessibility labels", () => {
  it("describes a slot with several items", () => {
    expect(getCellAccessibilityLabel(days[2], "dinner")).toBe(
      "Tuesday dinner, Tacos and 1 more, 1,150 calories",
    );
  });

  it("describes a slot with one item", () => {
    expect(getCellAccessibilityLabel(days[3], "snack")).toBe(
      "Wednesday snack, Greek yogurt, 120 calories",
    );
  });

  it("describes an empty slot as an add button", () => {
    expect(getCellAccessibilityLabel(days[0], "breakfast")).toBe(
      "Sunday breakfast, empty, add a meal",
    );
  });

  it("describes a day header, naming today", () => {
    expect(getDayHeaderAccessibilityLabel(days[1])).toBe(
      "Today, Monday November 16, 0 calories planned",
    );
    expect(getDayHeaderAccessibilityLabel(days[2])).toBe(
      "Tuesday November 17, 1,150 calories planned",
    );
  });
});

describe("getPantryPlanStartDate", () => {
  it("starts a future week on its Sunday", () => {
    expect(getPantryPlanStartDate(nextWeek, today)).toBe("2026-11-22");
  });

  it("leaves the current week to the screen's own default", () => {
    expect(getPantryPlanStartDate(week, today)).toBeUndefined();
  });

  it("leaves a past week to the screen's own default", () => {
    expect(getPantryPlanStartDate(lastWeek, today)).toBeUndefined();
  });
});

describe("parseLocalDateString", () => {
  it("reads a YYYY-MM-DD string as that local day", () => {
    const date = parseLocalDateString("2026-11-19");
    expect(date && toLocalDateString(date)).toBe("2026-11-19");
    expect(date?.getHours()).toBe(0);
  });

  it("refuses anything that is not a real calendar day in that shape", () => {
    expect(parseLocalDateString(undefined)).toBeNull();
    expect(parseLocalDateString("")).toBeNull();
    expect(parseLocalDateString("2026-02-30")).toBeNull();
    expect(parseLocalDateString("2026-13-01")).toBeNull();
    expect(parseLocalDateString("19/11/2026")).toBeNull();
    expect(parseLocalDateString("2026-11-19T00:00:00Z")).toBeNull();
    expect(parseLocalDateString(20261119)).toBeNull();
  });
});
