// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import TimeServingsStep from "../TimeServingsStep";
import {
  MAX_SERVINGS,
  MIN_SERVINGS,
  clampServings,
  computeTotalMinutes,
  isServingsAtMax,
  isServingsAtMin,
  sanitizeMinutesInput,
} from "../time-servings-step-utils";

const { mockImpact, mockNotification, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSelection: vi.fn(),
}));

// Asserts the servings stepper routes through the centralized useHaptics()
// hook (reducedMotion gating + Android performAndroidHapticsAsync routing)
// rather than calling expo-haptics directly.
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: mockSelection,
    disabled: false,
  }),
}));

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("clampServings", () => {
  it("applies positive delta when below the ceiling", () => {
    expect(clampServings(2, 1)).toBe(3);
  });

  it("applies negative delta when above the floor", () => {
    expect(clampServings(2, -1)).toBe(1);
  });

  it("clamps to MIN when decrementing below the floor", () => {
    expect(clampServings(MIN_SERVINGS, -1)).toBe(MIN_SERVINGS);
  });

  it("clamps to MAX when incrementing above the ceiling", () => {
    expect(clampServings(MAX_SERVINGS, 1)).toBe(MAX_SERVINGS);
  });

  it("returns the same value for a zero delta (no-op)", () => {
    expect(clampServings(4, 0)).toBe(4);
  });
});

describe("sanitizeMinutesInput", () => {
  it("strips non-digit characters", () => {
    expect(sanitizeMinutesInput("12a3")).toBe("123");
  });

  it("returns an empty string for non-numeric input", () => {
    expect(sanitizeMinutesInput("abc")).toBe("");
  });

  it("preserves leading zeros (caller interprets them)", () => {
    expect(sanitizeMinutesInput("001")).toBe("001");
  });

  it("strips decimal points — minutes are integers", () => {
    expect(sanitizeMinutesInput("1.5")).toBe("15");
  });
});

describe("computeTotalMinutes", () => {
  it("sums prep + cook when both are numeric", () => {
    expect(computeTotalMinutes("10", "20")).toBe(30);
  });

  it("treats empty strings as zero", () => {
    expect(computeTotalMinutes("", "")).toBe(0);
  });

  it("ignores non-numeric garbage in either field", () => {
    expect(computeTotalMinutes("abc", "5")).toBe(5);
  });
});

describe("isServingsAtMin / isServingsAtMax", () => {
  it("detects the floor", () => {
    expect(isServingsAtMin(MIN_SERVINGS)).toBe(true);
    expect(isServingsAtMin(MIN_SERVINGS + 1)).toBe(false);
  });

  it("detects the ceiling", () => {
    expect(isServingsAtMax(MAX_SERVINGS)).toBe(true);
    expect(isServingsAtMax(MAX_SERVINGS - 1)).toBe(false);
  });
});

// ── Rendered TimeServingsStep ────────────────────────────────────────────────

function makeData(overrides?: {
  servings?: number;
  prepTime?: string;
  cookTime?: string;
}) {
  return {
    servings: overrides?.servings ?? 4,
    prepTime: overrides?.prepTime ?? "",
    cookTime: overrides?.cookTime ?? "",
  };
}

describe("TimeServingsStep — render", () => {
  it("renders the current servings value in the stepper", () => {
    renderComponent(
      <TimeServingsStep
        timeServings={makeData({ servings: 6 })}
        setTimeServings={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("6 servings")).toBeDefined();
  });

  it("disables '-' at MIN_SERVINGS and '+' at MAX_SERVINGS", () => {
    const { unmount } = renderComponent(
      <TimeServingsStep
        timeServings={makeData({ servings: MIN_SERVINGS })}
        setTimeServings={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Decrease servings")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Increase servings")).toHaveProperty(
      "disabled",
      false,
    );
    unmount();

    renderComponent(
      <TimeServingsStep
        timeServings={makeData({ servings: MAX_SERVINGS })}
        setTimeServings={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Decrease servings")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByLabelText("Increase servings")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("calls setTimeServings with incremented servings on '+'", () => {
    const setTimeServings = vi.fn();
    renderComponent(
      <TimeServingsStep
        timeServings={makeData({ servings: 2 })}
        setTimeServings={setTimeServings}
      />,
    );
    fireEvent.click(screen.getByLabelText("Increase servings"));
    expect(setTimeServings).toHaveBeenCalledWith(
      expect.objectContaining({ servings: 3 }),
    );
  });

  // Regression guard: the servings stepper must route through the
  // centralized useHaptics() hook (reducedMotion gating + Android
  // performAndroidHapticsAsync routing) rather than calling expo-haptics
  // directly, which bypasses both.
  it("fires haptics.impact via the centralized useHaptics hook on a servings change, not the raw expo-haptics call", () => {
    const impactAsyncSpy = vi.spyOn(Haptics, "impactAsync");
    renderComponent(
      <TimeServingsStep
        timeServings={makeData({ servings: 2 })}
        setTimeServings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Increase servings"));
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(impactAsyncSpy).not.toHaveBeenCalled();
  });

  it("does not fire haptics when the servings change is a no-op at the boundary", () => {
    renderComponent(
      <TimeServingsStep
        timeServings={makeData({ servings: MAX_SERVINGS })}
        setTimeServings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Increase servings"));
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("sanitizes non-digit prep time input before calling setTimeServings", () => {
    const setTimeServings = vi.fn();
    renderComponent(
      <TimeServingsStep
        timeServings={makeData()}
        setTimeServings={setTimeServings}
      />,
    );
    fireEvent.change(screen.getByLabelText("Prep time in minutes"), {
      target: { value: "1a5b" },
    });
    expect(setTimeServings).toHaveBeenCalledWith(
      expect.objectContaining({ prepTime: "15" }),
    );
  });

  it("shows total time only when it is > 0", () => {
    const { unmount } = renderComponent(
      <TimeServingsStep
        timeServings={makeData({ prepTime: "", cookTime: "" })}
        setTimeServings={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Total:/)).toBeNull();
    unmount();

    renderComponent(
      <TimeServingsStep
        timeServings={makeData({ prepTime: "10", cookTime: "20" })}
        setTimeServings={vi.fn()}
      />,
    );
    expect(screen.getByText("Total: 30 minutes")).toBeDefined();
  });
});
