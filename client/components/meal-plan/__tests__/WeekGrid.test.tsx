// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";

import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

import { renderComponent } from "../../../../test/utils/render-component";
import { WeekGrid } from "../WeekGrid";
import {
  CELL_HEIGHT,
  DAY_HEADER_HEIGHT,
  GRID_MAX_FONT_SCALE,
  getCellContentHeight,
} from "../WeekGridCell";
import {
  GRID_COLUMN_GAP,
  buildWeekGrid,
  getGridColumnWidth,
  getWeekDates,
} from "../week-grid-utils";

// Counts cell renders through a function every cell calls exactly once per
// render. The real implementation still runs: this is a spy, not a stand-in.
const labelSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../week-grid-utils", async (importActual) => {
  const actual = await importActual<typeof import("../week-grid-utils")>();
  return {
    ...actual,
    getCellAccessibilityLabel: (
      ...args: Parameters<typeof actual.getCellAccessibilityLabel>
    ) => {
      labelSpy.calls += 1;
      return actual.getCellAccessibilityLabel(...args);
    },
  };
});

vi.mock("@/lib/query-client", () => ({
  resolveImageUrl: (url: string | null | undefined) => url ?? null,
}));

vi.mock("@/components/FallbackImage", () => ({
  FallbackImage: ({ source }: { source?: { uri?: string | null } | null }) => (
    <div data-testid="cell-image" data-uri={source?.uri ?? ""} />
  ),
}));

let nextId = 1;
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

const today = new Date(2026, 10, 16);
const week = getWeekDates(today);
const items = [
  makeItem({
    sortOrder: 0,
    recipeId: 1,
    recipe: {
      id: 1,
      title: "Tacos",
      caloriesPerServing: "610",
      imageUrl: "https://img/tacos.jpg",
    },
  }),
  makeItem({
    sortOrder: 1,
    recipeId: 2,
    recipe: {
      id: 2,
      title: "Stir fry",
      caloriesPerServing: "540",
      imageUrl: null,
    },
  }),
  makeItem({
    plannedDate: "2026-11-18",
    mealType: "snack",
    scannedItemId: 5,
    scannedItem: { id: 5, productName: "Greek yogurt", calories: "120" },
  }),
];
const days = buildWeekGrid(items, week, today);

describe("WeekGrid", () => {
  const onAddPress = vi.fn();
  const onDayPress = vi.fn();

  // The ScrollView double is a plain div, which jsdom gives no scrollTo.
  const scrollTo = vi.fn();
  beforeAll(() => {
    Element.prototype.scrollTo = scrollTo as typeof Element.prototype.scrollTo;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    labelSpy.calls = 0;
  });

  afterEach(() => cleanup());

  function renderGrid() {
    return renderComponent(
      <WeekGrid days={days} onAddPress={onAddPress} onDayPress={onDayPress} />,
    );
  }

  it("an empty cell asks to add a meal for its own day and meal", () => {
    renderGrid();
    fireEvent.click(screen.getByLabelText("Tuesday lunch, empty, add a meal"));
    expect(onAddPress).toHaveBeenCalledTimes(1);
    expect(onAddPress).toHaveBeenCalledWith("2026-11-17", "lunch");
    expect(onDayPress).not.toHaveBeenCalled();
  });

  it("a filled cell opens its day", () => {
    renderGrid();
    fireEvent.click(
      screen.getByLabelText("Tuesday dinner, Tacos and 1 more, 1,150 calories"),
    );
    expect(onDayPress).toHaveBeenCalledTimes(1);
    expect(onDayPress).toHaveBeenCalledWith("2026-11-17");
    expect(onAddPress).not.toHaveBeenCalled();
  });

  it("a day header opens its day", () => {
    renderGrid();
    fireEvent.click(
      screen.getByLabelText("Tuesday November 17, 1,150 calories planned"),
    );
    expect(onDayPress).toHaveBeenCalledWith("2026-11-17");
  });

  it("opens scrolled to today's column", () => {
    renderGrid();
    // Today is the second column (Monday); one column plus its gap.
    const stride = getGridColumnWidth(375) + GRID_COLUMN_GAP;
    expect(scrollTo).toHaveBeenCalledWith({ x: stride, animated: false });
  });

  it("names today in its header", () => {
    renderGrid();
    expect(
      screen.getByLabelText("Today, Monday November 16, 0 calories planned"),
    ).toBeDefined();
  });

  it("renders 28 cells and 7 day headers, all buttons", () => {
    renderGrid();
    expect(screen.getAllByRole("button")).toHaveLength(35);
  });

  it("shows the extra count on the bottom line of a slot with several items, and nowhere else", () => {
    renderGrid();
    expect(screen.getByText("1,150 · +1")).toBeDefined();
    expect(screen.queryAllByText(/· \+\d/)).toHaveLength(1);
    // A single-item slot shows the bare calories: once in the cell, once as
    // that day's total.
    expect(screen.getAllByText("120")).toHaveLength(2);
  });

  it("shows the first item's recipe image, and none for a slot without one", () => {
    renderGrid();
    const images = screen.getAllByTestId("cell-image");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("data-uri")).toBe("https://img/tacos.jpg");
  });

  it("shows each day's planned calories under its column", () => {
    renderGrid();
    // Tuesday's total; the cell's own bottom line carries the "· +1" suffix.
    expect(screen.getByText("1,150")).toBeDefined();
  });

  it("keeps every target at least 44pt on both axes, down to a 320pt screen", () => {
    expect(CELL_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(DAY_HEADER_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(getGridColumnWidth(320)).toBeGreaterThanOrEqual(44);
    expect(getGridColumnWidth(402)).toBeGreaterThan(getGridColumnWidth(320));
  });

  describe("with a larger system text size", () => {
    it("caps text scaling on every piece of grid text, since the cells cannot grow", () => {
      const { container } = renderGrid();
      // The icon double also renders a span (its glyph name); icons are a
      // fixed size and are not text.
      const texts = Array.from(container.querySelectorAll("span")).filter(
        (el) => el.textContent !== "plus",
      );
      // Row labels, day headers, cell text and day totals.
      expect(texts.length).toBeGreaterThanOrEqual(30);
      const uncapped = texts.filter(
        (el) =>
          el.getAttribute("maxfontsizemultiplier") !==
          String(GRID_MAX_FONT_SCALE),
      );
      expect(uncapped.map((el) => el.textContent)).toEqual([]);
    });

    it("still fits a cell's text inside the cell at the cap, with and without an image", () => {
      expect(
        getCellContentHeight(GRID_MAX_FONT_SCALE, true),
      ).toBeLessThanOrEqual(CELL_HEIGHT);
      expect(
        getCellContentHeight(GRID_MAX_FONT_SCALE, false),
      ).toBeLessThanOrEqual(CELL_HEIGHT);
      // And the cap is a real allowance, not a ban on scaling.
      expect(GRID_MAX_FONT_SCALE).toBeGreaterThan(1);
    });
  });

  it("does not re-render its cells when the parent re-renders with the same days and handlers", () => {
    function Harness() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button onClick={() => setCount((c) => c + 1)}>bump {count}</button>
          <WeekGrid
            days={days}
            onAddPress={onAddPress}
            onDayPress={onDayPress}
          />
        </>
      );
    }
    renderComponent(<Harness />);
    expect(labelSpy.calls).toBe(28);
    fireEvent.click(screen.getByText("bump 0"));
    // Proof the parent really re-rendered.
    expect(screen.getByText("bump 1")).toBeDefined();
    expect(labelSpy.calls).toBe(28);
  });
});
