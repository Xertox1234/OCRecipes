// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, cleanup } from "@testing-library/react";

import type { FamilyProfile } from "@shared/schema";
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

describe("WeekGrid family markers", () => {
  const scrollTo = vi.fn();
  beforeAll(() => {
    Element.prototype.scrollTo = scrollTo as typeof Element.prototype.scrollTo;
  });
  afterEach(() => cleanup());

  const ivy = {
    id: 7,
    name: "Ivy",
    allergies: [{ name: "peanuts", severity: "severe" }],
  } as unknown as FamilyProfile;
  const recipeWith = (title: string, allergens: unknown[]) => ({
    id: 1,
    title,
    caloriesPerServing: "300",
    imageUrl: null,
    allergens,
  });
  const familyItems = [
    makeItem({
      audience: "shared",
      recipeId: 1,
      recipe: recipeWith("Tacos", []),
    }),
    makeItem({
      plannedDate: "2026-11-18",
      mealType: "lunch",
      audience: "profile",
      familyProfileId: 7,
      recipeId: 2,
      recipe: recipeWith("Satay", [
        { id: "peanuts", viaDerived: false, possible: false },
      ]),
    }),
    makeItem({
      plannedDate: "2026-11-19",
      mealType: "lunch",
      audience: "self",
      recipeId: 3,
      recipe: recipeWith("Soup", []),
    }),
  ];

  function renderFamilyGrid(withFamily: boolean) {
    const familyDays = buildWeekGrid(
      familyItems,
      week,
      today,
      withFamily ? { profiles: [ivy], userAllergies: [] } : undefined,
    );
    return renderComponent(
      <WeekGrid days={familyDays} onAddPress={vi.fn()} onDayPress={vi.fn()} />,
    );
  }

  it("shows a group badge for a shared meal and the initial for a profile's", () => {
    renderFamilyGrid(true);
    const badges = screen.getAllByTestId("cell-audience-badge");
    expect(badges).toHaveLength(2);
    expect(screen.getByText("I")).toBeDefined();
  });

  it("shows the warning mark only on the clashing cell", () => {
    renderFamilyGrid(true);
    expect(screen.getAllByTestId("cell-allergen-warning")).toHaveLength(1);
  });

  it("hides the badge and the warning from the accessibility tree", () => {
    renderFamilyGrid(true);
    for (const el of [
      ...screen.getAllByTestId("cell-audience-badge"),
      ...screen.getAllByTestId("cell-allergen-warning"),
    ]) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("carries the audience and the warning in the cell's own label", () => {
    renderFamilyGrid(true);
    expect(
      screen.getByLabelText(
        "Tuesday dinner, Tacos, 300 calories, for everyone",
      ),
    ).toBeDefined();
    expect(
      screen.getByLabelText(
        "Wednesday lunch, Satay, 300 calories, for Ivy, allergen warning",
      ),
    ).toBeDefined();
    expect(
      screen.getByLabelText("Thursday lunch, Soup, 300 calories"),
    ).toBeDefined();
  });

  it("draws nothing extra without a family", () => {
    renderFamilyGrid(false);
    expect(screen.queryAllByTestId("cell-audience-badge")).toHaveLength(0);
    expect(screen.queryAllByTestId("cell-allergen-warning")).toHaveLength(0);
  });

  it("leaves the cell's height and text allowance alone", () => {
    expect(CELL_HEIGHT).toBe(100);
    expect(GRID_MAX_FONT_SCALE).toBe(1.2);
    expect(getCellContentHeight(1, false)).toBe(5 + (3 * 14 + 13) + 6);
  });

  it("gives the warning a backing only where it sits over a picture", () => {
    const withPicture = buildWeekGrid(
      [
        makeItem({
          audience: "profile",
          familyProfileId: 7,
          recipeId: 2,
          recipe: {
            ...recipeWith("Satay", [
              { id: "peanuts", viaDerived: false, possible: false },
            ]),
            imageUrl: "https://img/satay.jpg",
          },
        }),
      ],
      week,
      today,
      { profiles: [ivy], userAllergies: [] },
    );
    renderComponent(
      <WeekGrid days={withPicture} onAddPress={vi.fn()} onDayPress={vi.fn()} />,
    );
    // Drawn after the overlay, so the overlay cannot cover it.
    const overlay = screen.getByTestId("cell-title-overlay");
    const warning = screen.getByTestId("cell-allergen-warning");
    expect(
      overlay.compareDocumentPosition(warning) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

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

  it("shows the extra count on a slot with several items, and nowhere else", () => {
    renderGrid();
    expect(screen.getByText("+1")).toBeDefined();
    expect(screen.queryAllByText(/^\+\d/)).toHaveLength(1);
  });

  it("shows no calorie number inside a cell; the day total keeps it", () => {
    renderGrid();
    expect(screen.queryByText(/1,150 ·/)).toBeNull();
    // Each number appears once: as that day's total under the column.
    expect(screen.getAllByText("1,150")).toHaveLength(1);
    expect(screen.getAllByText("120")).toHaveLength(1);
  });

  it("sets the title on an overlay over the picture, and only where there is a picture", () => {
    renderGrid();
    const overlays = screen.getAllByTestId("cell-title-overlay");
    expect(overlays).toHaveLength(1);
    expect(overlays[0].textContent).toContain("Tacos");
    // A slot without a picture keeps its title on the plain cell.
    expect(screen.getByText("Greek yogurt")).toBeDefined();
  });

  it("shows the first item's recipe image, and none for a slot without one", () => {
    renderGrid();
    const images = screen.getAllByTestId("cell-image");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("data-uri")).toBe("https://img/tacos.jpg");
  });

  it("shows each day's planned calories under its column", () => {
    renderGrid();
    // Tuesday's total.
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
      // Row labels, day headers, cell text and day totals (29 in this
      // fixture; the floor only proves the filter did not empty the list).
      expect(texts.length).toBeGreaterThanOrEqual(25);
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
