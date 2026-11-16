import { beforeEach, describe, expect, it } from "vitest";

import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import { toLocalDateString } from "@shared/lib/date";

import {
  type GridDay,
  GRID_MEAL_TYPES,
  SLOTS_PER_WEEK,
  addDays,
  buildWeekGrid,
  countPlannedSlots,
  formatSheetDayLabel,
  getCellAccessibilityLabel,
  getDayHeaderAccessibilityLabel,
  getInitialColumnIndex,
  getInitialScrollOffset,
  getGridColumnWidth,
  GRID_COLUMN_GAP,
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

// Everything the code under test produces is built in `beforeEach`, never at
// file scope: the mutation runner attributes a mutant to the tests that run
// it, and work done while the file loads belongs to no test, so a mutant in
// it would look uncaught however good the assertions are.
let week: Date[];
let nextWeek: Date[];
let lastWeek: Date[];
let days: GridDay[];
let nextWeekDays: GridDay[];

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

beforeEach(() => {
  week = getWeekDates(today);
  nextWeek = getWeekDates(new Date(2026, 10, 24));
  lastWeek = getWeekDates(new Date(2026, 10, 10));
  days = buildWeekGrid(items, week, today);
  nextWeekDays = buildWeekGrid(items, nextWeek, today);
});

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

describe("formatSheetDayLabel", () => {
  it("names the local day a sheet is adding to", () => {
    expect(formatSheetDayLabel("2026-11-17")).toBe("Tue, Nov 17");
  });

  it("returns nothing for a value that is not a real date", () => {
    expect(formatSheetDayLabel("2026-02-30")).toBe("");
  });
});

describe("getInitialScrollOffset", () => {
  const WINDOW = 402; // iPhone 17 Pro
  const weekWith = (todayDate: Date) =>
    buildWeekGrid([], getWeekDates(todayDate), todayDate);
  let stride: number;
  // The furthest the grid can scroll: the last column flush with the right gutter.
  let maxOffset: number;
  beforeEach(() => {
    stride = getGridColumnWidth(WINDOW) + GRID_COLUMN_GAP;
    maxOffset = getInitialScrollOffset(
      weekWith(new Date(2026, 10, 21)),
      WINDOW,
    );
  });

  it("can scroll exactly as far as the content overflows the space beside the labels", () => {
    // 7 columns of 96 + 6 gaps of 6 + 16 end padding = 724; 402 - 76 = 326.
    expect(getGridColumnWidth(WINDOW)).toBe(96);
    expect(maxOffset).toBe(724 - 326);
  });

  it("puts today's column first early in the week", () => {
    expect(
      getInitialScrollOffset(weekWith(new Date(2026, 10, 15)), WINDOW),
    ).toBe(0);
    expect(
      getInitialScrollOffset(weekWith(new Date(2026, 10, 16)), WINDOW),
    ).toBe(stride);
    expect(
      getInitialScrollOffset(weekWith(new Date(2026, 10, 17)), WINDOW),
    ).toBe(2 * stride);
  });

  it("never asks to scroll past the end, Thursday to Saturday", () => {
    // Unclamped these would be 4, 5 and 6 strides: further than the content.
    expect(maxOffset).toBeLessThan(4 * stride);
    expect(maxOffset).toBeGreaterThan(3 * stride);
    for (const day of [19, 20, 21]) {
      expect(
        getInitialScrollOffset(weekWith(new Date(2026, 10, day)), WINDOW),
      ).toBe(maxOffset);
    }
  });

  it("opens at the start for a week that does not contain today", () => {
    const otherWeek = buildWeekGrid(
      [],
      getWeekDates(new Date(2026, 10, 24)),
      today,
    );
    expect(getInitialScrollOffset(otherWeek, WINDOW)).toBe(0);
  });

  it("stays between the start and the end on every screen width and weekday", () => {
    for (const width of [320, 375, 402, 430, 768]) {
      const widthStride = getGridColumnWidth(width) + GRID_COLUMN_GAP;
      const widthMax = getInitialScrollOffset(
        weekWith(new Date(2026, 10, 21)),
        width,
      );
      for (let day = 15; day <= 21; day++) {
        const offset = getInitialScrollOffset(
          weekWith(new Date(2026, 10, day)),
          width,
        );
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(widthMax);
        expect(offset).toBeLessThanOrEqual((day - 15) * widthStride);
      }
    }
  });
});

describe("cases the first pass left unpinned", () => {
  it("breaks a sortOrder tie by id, lowest first", () => {
    const grid = buildWeekGrid(
      [
        makeItem({
          id: 902,
          sortOrder: 0,
          recipe: recipe("Second", 100, null),
        }),
        makeItem({ id: 901, sortOrder: 0, recipe: recipe("First", 100, null) }),
      ],
      week,
      today,
    );
    expect(grid[2].cells.dinner.items.map((i) => i.id)).toEqual([901, 902]);
    expect(grid[2].cells.dinner.title).toBe("First");
  });

  it("treats a missing sortOrder as 0", () => {
    const grid = buildWeekGrid(
      [
        makeItem({ id: 911, sortOrder: 1, recipe: recipe("Later", 100, null) }),
        makeItem({
          id: 912,
          sortOrder: null,
          recipe: recipe("Unset", 100, null),
        }),
      ],
      week,
      today,
    );
    expect(grid[2].cells.dinner.title).toBe("Unset");
  });

  it("refuses a date with anything before or after it", () => {
    expect(parseLocalDateString("x2026-11-19")).toBeNull();
    expect(parseLocalDateString("2026-11-19x")).toBeNull();
    expect(parseLocalDateString(" 2026-11-19")).toBeNull();
  });

  it("leaves the pantry start to the screen for a week that starts today", () => {
    // Sunday 15 November is the first day of its own week.
    const sunday = new Date(2026, 10, 15);
    expect(
      getPantryPlanStartDate(getWeekDates(sunday), sunday),
    ).toBeUndefined();
  });

  it("has no pantry start for an empty list of days", () => {
    expect(getPantryPlanStartDate([], today)).toBeUndefined();
  });
});
