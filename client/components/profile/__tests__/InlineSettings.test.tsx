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

describe("InlineSettings — family planning rows", () => {
  const baseProps = {
    themePreference: "system" as const,
    onThemeToggle: vi.fn(),
    onDietaryProfile: vi.fn(),
  };
  const family = {
    visible: true,
    value: false,
    disabled: false,
    onToggle: vi.fn(),
    showFamilyRow: false,
    onOpenProfiles: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it("shows no family row without the family prop, or while it is hidden", () => {
    const { unmount } = renderComponent(<InlineSettings {...baseProps} />);
    expect(screen.queryByRole("switch")).toBeNull();
    unmount();
    renderComponent(
      <InlineSettings {...baseProps} family={{ ...family, visible: false }} />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByLabelText("Family")).toBeNull();
  });

  it("renders a named switch that reports the new value, and reads its state", () => {
    const onToggle = vi.fn();
    renderComponent(
      <InlineSettings {...baseProps} family={{ ...family, onToggle }} />,
    );
    const toggle = screen.getByRole("switch", { name: "Plan for my family" });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("disables the switch while the change is saving", () => {
    renderComponent(
      <InlineSettings
        {...baseProps}
        family={{ ...family, value: true, disabled: true }}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "Plan for my family",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
  });

  it("shows the Family row only when asked, and it opens the list", () => {
    const onOpenProfiles = vi.fn();
    const { unmount } = renderComponent(
      <InlineSettings {...baseProps} family={family} />,
    );
    expect(screen.queryByRole("button", { name: "Family" })).toBeNull();
    unmount();

    renderComponent(
      <InlineSettings
        {...baseProps}
        family={{ ...family, showFamilyRow: true, onOpenProfiles }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Family" }));
    expect(onOpenProfiles).toHaveBeenCalledTimes(1);
  });
});
