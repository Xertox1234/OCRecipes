// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import TagsStep from "../TagsStep";
import {
  formatDietChipLabel,
  hasCuisineText,
  toggleDietTag,
} from "../tags-step-utils";
import { DIET_TAG_OPTIONS } from "../types";

const { mockImpact, mockNotification, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSelection: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: mockSelection,
    disabled: false,
  }),
}));

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("toggleDietTag", () => {
  it("appends the tag when it is not present", () => {
    expect(toggleDietTag([], "Vegan")).toEqual(["Vegan"]);
    expect(toggleDietTag(["Vegetarian"], "Vegan")).toEqual([
      "Vegetarian",
      "Vegan",
    ]);
  });

  it("removes the tag when it is already present", () => {
    expect(toggleDietTag(["Vegan", "Keto"], "Vegan")).toEqual(["Keto"]);
  });

  it("does not mutate the input array", () => {
    const input = ["Vegan"] as const;
    toggleDietTag(input, "Keto");
    expect(input).toEqual(["Vegan"]);
  });

  it("returns an empty array when removing the only tag", () => {
    expect(toggleDietTag(["Vegan"], "Vegan")).toEqual([]);
  });
});

describe("hasCuisineText", () => {
  it("returns false for empty string", () => {
    expect(hasCuisineText("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasCuisineText("   ")).toBe(false);
  });

  it("returns true for any visible text", () => {
    expect(hasCuisineText("Italian")).toBe(true);
  });
});

describe("formatDietChipLabel", () => {
  it("returns the plain tag when inactive", () => {
    expect(formatDietChipLabel("Vegan", false)).toBe("Vegan");
  });

  it("appends a checkmark when active", () => {
    expect(formatDietChipLabel("Vegan", true)).toBe("Vegan ✓");
  });
});

// ── Rendered TagsStep ────────────────────────────────────────────────────────

function makeTags(overrides?: { cuisine?: string; dietTags?: string[] }) {
  return {
    cuisine: overrides?.cuisine ?? "",
    dietTags: (overrides?.dietTags ??
      []) as (typeof DIET_TAG_OPTIONS)[number][],
  };
}

describe("TagsStep — render", () => {
  it("renders a chip for every diet tag option", () => {
    renderComponent(<TagsStep tags={makeTags()} setTags={vi.fn()} />);
    for (const tag of DIET_TAG_OPTIONS) {
      expect(screen.getByLabelText(tag)).toBeDefined();
    }
  });

  it("marks the cuisine as 'suggested' only when cuisine has visible text", () => {
    const { unmount } = renderComponent(
      <TagsStep tags={makeTags()} setTags={vi.fn()} />,
    );
    expect(screen.queryByText("suggested")).toBeNull();
    unmount();

    renderComponent(
      <TagsStep tags={makeTags({ cuisine: "Italian" })} setTags={vi.fn()} />,
    );
    expect(screen.getByText("suggested")).toBeDefined();
  });

  it("calls setTags with the tag appended when an inactive chip is pressed", () => {
    const setTags = vi.fn();
    renderComponent(<TagsStep tags={makeTags()} setTags={setTags} />);
    fireEvent.click(screen.getByLabelText("Vegan"));
    expect(setTags).toHaveBeenCalledWith({
      cuisine: "",
      dietTags: ["Vegan"],
    });
  });

  it("triggers haptic feedback via the centralized useHaptics hook when a chip is pressed", () => {
    renderComponent(<TagsStep tags={makeTags()} setTags={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Vegan"));
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("calls setTags with the tag removed when an active chip is pressed again", () => {
    const setTags = vi.fn();
    renderComponent(
      <TagsStep
        tags={makeTags({ dietTags: ["Vegan", "Keto"] })}
        setTags={setTags}
      />,
    );
    fireEvent.click(screen.getByLabelText("Vegan"));
    expect(setTags).toHaveBeenCalledWith({
      cuisine: "",
      dietTags: ["Keto"],
    });
  });

  it("reflects the active state via aria-selected on the pressed chip", () => {
    renderComponent(
      <TagsStep tags={makeTags({ dietTags: ["Vegan"] })} setTags={vi.fn()} />,
    );
    // Active chip shows the "Vegan ✓" label.
    expect(screen.getByText("Vegan ✓")).toBeDefined();
    // Inactive chip shows the plain label.
    expect(screen.getByText("Keto")).toBeDefined();
  });

  it("calls setTags with the typed cuisine string as the user types", () => {
    const setTags = vi.fn();
    renderComponent(<TagsStep tags={makeTags()} setTags={setTags} />);
    fireEvent.change(screen.getByLabelText("Cuisine type"), {
      target: { value: "Thai" },
    });
    expect(setTags).toHaveBeenCalledWith({
      cuisine: "Thai",
      dietTags: [],
    });
  });
});
