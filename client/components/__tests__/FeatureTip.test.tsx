// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { FeatureTip } from "../FeatureTip";

const { mockAnnounce, a11y } = vi.hoisted(() => ({
  mockAnnounce: vi.fn(),
  a11y: { reducedMotion: false, screenReaderEnabled: false },
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: mockAnnounce,
    },
  };
});

describe("FeatureTip", () => {
  beforeEach(() => {
    mockAnnounce.mockClear();
    a11y.reducedMotion = false;
  });

  it("renders the text when visible", () => {
    renderComponent(
      <FeatureTip
        text="Snap it instead."
        visible
        onDismiss={vi.fn()}
        pointer="down"
      />,
    );
    expect(screen.getByText("Snap it instead.")).toBeDefined();
  });

  it("renders nothing when hidden", () => {
    renderComponent(
      <FeatureTip
        text="Snap it instead."
        visible={false}
        onDismiss={vi.fn()}
        pointer="down"
      />,
    );
    expect(screen.queryByText("Snap it instead.")).toBeNull();
    expect(screen.queryByLabelText("Dismiss tip")).toBeNull();
  });

  it("announces the text once when it appears", () => {
    const { rerender } = renderComponent(
      <FeatureTip
        text="Snap it instead."
        visible={false}
        onDismiss={vi.fn()}
        pointer="up"
      />,
    );
    expect(mockAnnounce).not.toHaveBeenCalled();
    rerender(
      <FeatureTip
        text="Snap it instead."
        visible
        onDismiss={vi.fn()}
        pointer="up"
      />,
    );
    rerender(
      <FeatureTip
        text="Snap it instead."
        visible
        onDismiss={vi.fn()}
        pointer="up"
      />,
    );
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith("Tip: Snap it instead.");
  });

  it('calls onDismiss from the "Dismiss tip" button', () => {
    const onDismiss = vi.fn();
    renderComponent(
      <FeatureTip
        text="Snap it instead."
        visible
        onDismiss={onDismiss}
        pointer="down"
      />,
    );
    fireEvent.click(screen.getByLabelText("Dismiss tip"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("is not grouped into one accessible element, so its close button stays reachable", () => {
    renderComponent(
      <FeatureTip
        text="Snap it instead."
        visible
        onDismiss={vi.fn()}
        pointer="down"
        testID="tip"
      />,
    );
    expect(screen.getByTestId("tip").getAttribute("accessible")).not.toBe(
      "true",
    );
  });
});
