// @vitest-environment jsdom
/**
 * H4 (2026-06-03 full audit): BeveragePickerSheet announces error state
 * transitions to VoiceOver on iOS, and exposes an assertive live region for
 * Android (where the imperative announce is suppressed to avoid double-announce).
 * See docs/rules/accessibility.md.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { BeveragePickerSheet } from "../BeveragePickerSheet";
import type { BeverageSheetOptions } from "@/hooks/useBeverageSheet";

// Expected error message from the calorie validation branch
// (MAX_CUSTOM_CALORIES = 5000, defined in BeveragePickerSheet.tsx)
const CALORIE_ERROR = "Calories must be between 0 and 5000";

function renderSheet() {
  const sheetRef = { current: null } as React.RefObject<null>;
  const optionsRef: React.RefObject<BeverageSheetOptions | null> = {
    current: { mealType: null, onLogged: vi.fn() },
  };
  return renderComponent(
    <BeveragePickerSheet sheetRef={sheetRef} optionsRef={optionsRef} />,
  );
}

/**
 * Drive the sheet into the error state via the synchronous calorie-validation
 * path (no network involved):
 *   1. Press "Custom beverage" → step = "custom"
 *   2. Enter an out-of-range calorie value ("9999")
 *   3. Press "Next" → step = "size"
 *   4. Press a size button → logBeverage fires the validation and sets error
 */
function triggerCalorieError() {
  fireEvent.click(screen.getByRole("button", { name: /custom beverage/i }));

  const input = screen.getByLabelText("Beverage name or calories");
  fireEvent.change(input, { target: { value: "9999" } });

  fireEvent.click(
    screen.getByRole("button", { name: /continue to size selection/i }),
  );

  // Click the first size button ("Small") to trigger logBeverage
  fireEvent.click(
    screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.includes("Small"))!,
  );
}

describe("BeveragePickerSheet — error announce gating (H4)", () => {
  const originalPlatformOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
    announceSpy.mockRestore();
  });

  it("renders the error with an assertive live region for Android", () => {
    RN.Platform.OS = "android";
    renderSheet();
    triggerCalorieError();

    const errorText = screen.getByText(CALORIE_ERROR);
    // accessibilityLiveRegion="assertive" is on the parent View, not the text
    const liveRegionEl =
      errorText.closest("[aria-live]") ?? errorText.parentElement;
    expect(liveRegionEl?.getAttribute("aria-live")).toBe("assertive");
  });

  it("announces the error to VoiceOver on iOS", () => {
    RN.Platform.OS = "ios";
    renderSheet();
    triggerCalorieError();

    expect(announceSpy).toHaveBeenCalledWith(CALORIE_ERROR);
  });

  it("does not announce the error on Android (live region handles it)", () => {
    RN.Platform.OS = "android";
    renderSheet();
    triggerCalorieError();

    expect(announceSpy).not.toHaveBeenCalledWith(CALORIE_ERROR);
  });
});
