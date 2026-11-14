// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { AccessibilityInfo, Platform } from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import { InlineSettings } from "../InlineSettings";

// Accessibility audit 2026-11-06 M2: the appearance row has no live region,
// so its change must be announced on Android too, not only iOS.
describe("InlineSettings — appearance toggle announcement", () => {
  const originalOS = Platform.OS;
  let announce: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announce.mockRestore();
    Platform.OS = originalOS;
  });

  it.each(["ios", "android"] as const)(
    "announces the new appearance on %s",
    (os) => {
      Platform.OS = os;
      const onThemeToggle = vi.fn();
      renderComponent(
        <InlineSettings
          themePreference="system"
          onThemeToggle={onThemeToggle}
          onDietaryProfile={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText("Appearance: System"));

      expect(onThemeToggle).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith("Appearance changed to Light");
    },
  );
});
