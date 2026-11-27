// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StyleProp, ViewStyle } from "react-native";

import { ManualBarcodeSheet } from "../ManualBarcodeSheet";

// Same PressableScale harness as HelpSheet.test.tsx (keeps style, drops scale).
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

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));

const selection = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection }),
}));

beforeEach(() => selection.mockClear());

function renderSheet() {
  const props = {
    visible: true,
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };
  render(<ManualBarcodeSheet {...props} />);
  return props;
}

const input = () => screen.getByLabelText("Barcode number");
const submit = () => screen.getByLabelText("Look up barcode");

describe("ManualBarcodeSheet", () => {
  it("uses the numeric keyboard and traps VoiceOver in the content", () => {
    renderSheet();
    expect(input().getAttribute("keyboardtype") ?? "").toBe("number-pad");
    expect(document.querySelector('[aria-modal="true"]')).toBeTruthy();
    expect(
      screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible"),
    ).toBe("false");
  });

  it("shows the valid-length hint", () => {
    renderSheet();
    expect(
      screen.getByText("The 8, 12, 13 or 14 digits under the barcode"),
    ).toBeTruthy();
  });

  it("submit is disabled for a short number", () => {
    const props = renderSheet();
    fireEvent.change(input(), { target: { value: "123" } });
    expect(submit().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(submit());
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("submit is disabled with nothing typed", () => {
    renderSheet();
    expect(submit().getAttribute("aria-disabled")).toBe("true");
  });

  it("submit calls onSubmit with the normalized digits", () => {
    const props = renderSheet();
    fireEvent.change(input(), { target: { value: "0 32601 03105 3" } });
    expect(submit().getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(submit());
    expect(props.onSubmit).toHaveBeenCalledWith("032601031053");
    expect(selection).toHaveBeenCalledTimes(1);
  });
});
