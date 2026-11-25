// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../../test/utils/render-component";
import WriteCard from "../WriteCard";
import type {
  PlanCardPayload,
  PlanRecipeRef,
  WriteCardBlock,
  WriteCardEdits,
} from "@shared/schemas/coach-write-cards";
import { planDayLabel, planShoppingPreview } from "../write-card-utils";

vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: vi.fn(),
    impact: vi.fn(),
    notification: vi.fn(),
  }),
}));

const ref = (id: number, title: string, calories = 500): PlanRecipeRef => ({
  source: "community",
  id,
  title,
  calories,
  protein: 40,
});
const payload = (over: Partial<PlanCardPayload> = {}): PlanCardPayload => ({
  rows: [
    {
      plannedDate: "2026-11-09",
      mealType: "dinner",
      recipe: ref(1, "Chicken shawarma bowl", 520),
      alternatives: [ref(11, "Turkey chili"), ref(12, "Tofu stir-fry")],
      alreadyPlanned: null,
    },
    {
      plannedDate: "2026-11-10",
      mealType: "dinner",
      recipe: ref(2, "Indian spiced lentil stew", 480),
      alternatives: [],
      alreadyPlanned: "Leftover curry",
    },
    {
      plannedDate: "2026-11-11",
      mealType: "dinner",
      recipe: ref(3, "Salmon with herb rice", 560),
      alternatives: [],
      alreadyPlanned: null,
    },
  ],
  shoppingListId: 7,
  ...over,
});
const blockOf = (p: PlanCardPayload): WriteCardBlock => ({
  type: "write_card",
  cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  kind: "plan",
  status: "live",
  payload: p,
});

function Harness({ p = payload() }: { p?: PlanCardPayload }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={blockOf(p)} edits={edits} onEdit={setEdits} />;
}

describe("PlanWriteCard", () => {
  it("Swap shows the alternatives and picking one replaces the row title", () => {
    renderComponent(<Harness />);
    const swap = screen.getByRole("button", {
      name: "Swap Chicken shawarma bowl",
    });
    // Audit L6: Swap reports whether its picker is open.
    expect(swap.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(swap);
    expect(
      screen
        .getByRole("button", { name: "Swap Chicken shawarma bowl" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    // Audit L6: the picker is a named group.
    expect(
      screen.getByRole("radiogroup", {
        name: "Alternatives for Chicken shawarma bowl",
      }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("radio", { name: "Tofu stir-fry, 500 cal" }),
    );
    expect(screen.queryByText("Chicken shawarma bowl")).toBeNull();
    expect(screen.getByText("Tofu stir-fry")).toBeDefined();
    // the picker closed
    expect(
      screen.queryByRole("radio", { name: "Turkey chili, 500 cal" }),
    ).toBeNull();
  });

  it("a row with no alternatives has no Swap", () => {
    renderComponent(<Harness />);
    expect(
      screen.queryByRole("button", { name: "Swap Salmon with herb rice" }),
    ).toBeNull();
  });

  it("Remove drops the row and the count in the button", () => {
    renderComponent(<Harness />);
    expect(
      screen.getByRole("button", { name: "Add 3 dinners to plan" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Salmon with herb rice" }),
    );
    expect(
      screen.getByRole("button", { name: "Add 2 dinners to plan" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Add back Salmon with herb rice" }),
    );
    expect(
      screen.getByRole("button", { name: "Add 3 dinners to plan" }),
    ).toBeDefined();
  });

  it("Already planned note renders", () => {
    renderComponent(<Harness />);
    expect(screen.getByText("Already planned: Leftover curry")).toBeDefined();
  });

  it("shopping tick hidden without a list", () => {
    const { unmount } = renderComponent(<Harness />);
    const tick = screen.getByRole("checkbox", {
      name: "Also add the shopping to my grocery list",
    });
    expect(tick.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(tick);
    expect(tick.getAttribute("aria-checked")).toBe("true");
    unmount();
    renderComponent(<Harness p={payload({ shoppingListId: null })} />);
    expect(
      screen.queryByRole("checkbox", {
        name: "Also add the shopping to my grocery list",
      }),
    ).toBeNull();
  });

  describe("with a shopping section (A1)", () => {
    const combined = () =>
      payload({
        shopping: {
          lists: [{ id: 7, title: "Weekly shop" }],
          defaultListId: 7,
          newListName: "Meal plan shopping",
          ingredients: {
            "community:1": ["Chicken", "Rice"],
            "community:12": ["Tofu", "Rice"],
            "community:2": ["Lentils"],
            "community:3": ["Salmon"],
          },
        },
      });
    const TICK = "Add the shopping for these meals";

    it("starts ticked, names what the meals need and offers the lists", () => {
      renderComponent(<Harness p={combined()} />);
      expect(
        screen
          .getByRole("checkbox", { name: TICK })
          .getAttribute("aria-checked"),
      ).toBe("true");
      expect(screen.getByText("Chicken, Rice, Lentils, Salmon")).toBeDefined();
      expect(
        screen
          .getByRole("radio", { name: "Weekly shop" })
          .getAttribute("aria-checked"),
      ).toBe("true");
      expect(
        screen.getByRole("radio", { name: "New list (Meal plan shopping)" }),
      ).toBeDefined();
      // Audit L6: the shopping list choice is a named group.
      expect(
        screen.getByRole("radiogroup", { name: "Shopping list" }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Plan 3 dinners + shopping" }),
      ).toBeDefined();
      // The older tick is not shown as well.
      expect(
        screen.queryByRole("checkbox", {
          name: "Also add the shopping to my grocery list",
        }),
      ).toBeNull();
    });

    it("the preview follows a swap", () => {
      renderComponent(<Harness p={combined()} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Swap Chicken shawarma bowl" }),
      );
      fireEvent.click(
        screen.getByRole("radio", { name: "Tofu stir-fry, 500 cal" }),
      );
      expect(screen.getByText("Tofu, Rice, Lentils, Salmon")).toBeDefined();
    });

    it("unticking hides the list and the button plans only", () => {
      renderComponent(<Harness p={combined()} />);
      fireEvent.click(screen.getByRole("checkbox", { name: TICK }));
      expect(screen.queryByRole("radio", { name: "Weekly shop" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Add 3 dinners to plan" }),
      ).toBeDefined();
    });
  });

  it("planShoppingPreview shortens a long list", () => {
    expect(planShoppingPreview(["a", "b", "c"], 2)).toBe("a, b and 1 more");
    expect(planShoppingPreview(["a", "b"], 2)).toBe("a, b");
  });

  it("planDayLabel names the day", () => {
    expect(planDayLabel("2026-11-09")).toMatch(/Mon/);
  });
});
