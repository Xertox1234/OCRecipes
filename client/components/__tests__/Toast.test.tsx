// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { Toast } from "../Toast";
import { Colors } from "@/constants/theme";

const mockDismiss = vi.fn();

describe("Toast", () => {
  beforeEach(() => {
    mockDismiss.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders message text", () => {
    renderComponent(
      <Toast
        message="Item saved"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText("Item saved")).toBeDefined();
  });

  it("has correct accessibility label", () => {
    renderComponent(
      <Toast
        message="Something went wrong"
        variant="error"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByLabelText("Something went wrong")).toBeDefined();
  });

  it("renders with info variant", () => {
    renderComponent(
      <Toast
        message="Tip: try scanning"
        variant="info"
        theme={Colors.dark}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText("Tip: try scanning")).toBeDefined();
  });

  it("has polite live region for accessibility", () => {
    renderComponent(
      <Toast
        message="Test toast"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    const toast = screen.getByLabelText("Test toast");
    expect(toast.getAttribute("aria-live")).toBe("polite");
  });

  it("auto-dismisses after 3 seconds", () => {
    renderComponent(
      <Toast
        message="Auto dismiss"
        variant="success"
        theme={Colors.light}
        onDismiss={mockDismiss}
      />,
    );
    expect(mockDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    // onDismiss is called via runOnJS in animation callback or directly in reduced motion
    // With mocked reanimated, the withTiming callback fires synchronously
    expect(mockDismiss).toHaveBeenCalled();
  });
});
