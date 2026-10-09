// @vitest-environment jsdom
//
// TalkBack double reads on the adjust card. Android is parked (no device), so
// these pin the a11y props instead of an on-device read:
//
// - The servings stepper is one `accessible` adjustable node. On iOS that
//   hides its −/+ buttons; on Android an actionable child of a focusable
//   parent is still its own TalkBack stop, so the buttons repeated the
//   stepper's own increment/decrement actions. They must leave the tree.
// - Each radiogroup carries the same name as the visible label above its
//   chips. Android reads both (the labelled group node AND the text); iOS
//   Fabric drops the group label, so the visible text is iOS's only read.
//   The text is hidden on Android only (`importantForAccessibility="no"`,
//   which iOS ignores) — never `accessible={false}`, which would mute iOS.
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeAdjust } from "../RecipeAdjust";
import type { RecipeAdjustBlock } from "@shared/schemas/recipe-finder";

// The shared RN mock maps only "no-hide-descendants" to aria-hidden and drops
// "no", so surface the raw value as a data attribute.
vi.mock("@/components/ThemedText", async () => {
  const RN = await import("react-native");
  const ReactMod = await import("react");
  // The shared mock's Text takes any props; the RN type does not.
  const MockText = RN.Text as unknown as React.ComponentType<
    Record<string, unknown>
  >;
  return {
    ThemedText: ({ maxScale: _maxScale, ...props }: Record<string, unknown>) =>
      ReactMod.createElement(MockText, {
        ...props,
        "data-important-for-a11y": props.importantForAccessibility,
      }),
  };
});

const FLOW = "00000000-0000-4000-8000-000000000000";

const block: RecipeAdjustBlock = {
  type: "recipe_adjust",
  prefill: { servings: 8, spice: "mild", time: "moderate" },
  avoiding: [],
  noted: { dislikes: [] },
  followUps: [
    { question: "Beef, pork, or a mix?", options: ["Beef", "Mix", "Pork"] },
  ],
  flow: {
    flowId: FLOW,
    stage: "adjust",
    request: "spaghetti and meatballs for 8",
    query: { q: "spaghetti and meatballs" },
    round: 0,
    shownIds: [],
    dish: "Spaghetti & meatballs",
  },
};

function setup() {
  renderComponent(<RecipeAdjust block={block} isActive onAction={vi.fn()} />);
}

describe("RecipeAdjust — one TalkBack read per control", () => {
  it("the stepper's −/+ buttons are not separate screen-reader stops", () => {
    setup();
    expect(screen.getByRole("adjustable", { name: "Servings" })).toBeDefined();
    for (const name of ["Fewer servings", "More servings"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("the hidden buttons still step for a sighted tap", () => {
    setup();
    // ByLabelText still finds hidden nodes (ByRole would compute no name).
    fireEvent.click(screen.getByLabelText("More servings"));
    expect(screen.getByTestId("adjust-servings").textContent).toBe("9");
  });

  it.each(["Spice", "Time", "Beef, pork, or a mix?"])(
    "the visible %s label is skipped on Android only, where its group carries the name",
    (label) => {
      setup();
      expect(screen.getByRole("radiogroup", { name: label })).toBeDefined();
      const text = screen.getByText(label);
      expect(text.getAttribute("data-important-for-a11y")).toBe("no");
      // Still readable on iOS, where Fabric drops the group's label.
      expect(text.closest("[aria-hidden='true']")).toBeNull();
    },
  );
});
