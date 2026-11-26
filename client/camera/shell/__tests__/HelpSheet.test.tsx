// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StyleProp, ViewStyle } from "react-native";

import { HelpSheet } from "../HelpSheet";

// Same PressableScale harness as ExampleCard.test.tsx (keeps style, drops scale).
vi.mock("@/components/PressableScale", async () => {
  const RN = await import("react-native");
  const flat = (s: unknown): unknown =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flat).filter(Boolean)) : s;
  return {
    PressableScale: ({
      style,
      scaleTo: _scaleTo,
      ...props
    }: Record<string, unknown>) => (
      <RN.TouchableOpacity
        {...props}
        style={flat(style) as StyleProp<ViewStyle>}
      />
    ),
  };
});

const accessibility = { reducedMotion: false };
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => accessibility,
}));

vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));

const selection = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection }),
}));

function renderSheet(
  over: Partial<React.ComponentProps<typeof HelpSheet>> = {},
) {
  const props = {
    visible: true,
    stepTitle: "Scanning the nutrition label",
    stepHint: "Fit the whole Nutrition Facts panel in the frame.",
    showTypeNumberTip: false,
    onShowExample: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<HelpSheet {...props} />);
  return props;
}

describe("HelpSheet", () => {
  it("shows step title and hint", () => {
    renderSheet();
    expect(screen.getByText("Scanning the nutrition label")).toBeTruthy();
    expect(
      screen.getByText("Fit the whole Nutrition Facts panel in the frame."),
    ).toBeTruthy();
    expect(screen.getByText("Tips for every scan")).toBeTruthy();
    expect(screen.getByText("Hold still for a moment")).toBeTruthy();
    expect(screen.getByText("Use plenty of light, or tap ⚡")).toBeTruthy();
    expect(screen.getByText("Fill the frame, nothing cut off")).toBeTruthy();
  });

  it('"Show the example again →" calls onShowExample', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByLabelText("Show the example again →"));
    expect(props.onShowExample).toHaveBeenCalledTimes(1);
  });

  it("type-number tip only when showTypeNumberTip", () => {
    renderSheet({ showTypeNumberTip: false });
    expect(
      screen.queryByText("Barcode won't read? Type the number"),
    ).toBeNull();
  });

  it("shows the type-number tip when showTypeNumberTip is true", () => {
    renderSheet({ showTypeNumberTip: true });
    expect(
      screen.getByText("Barcode won't read? Type the number"),
    ).toBeTruthy();
  });

  it("traps VoiceOver in the sheet content (accessibilityViewIsModal)", () => {
    renderSheet();
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();
  });
});
