// @vitest-environment jsdom
import React from "react";
import { Text } from "react-native";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SwipeableRow } from "../SwipeableRow";

// Mock useAccessibility to control reducedMotion
const mockReducedMotion = { reducedMotion: false, screenReaderEnabled: false };
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => mockReducedMotion,
}));

describe("SwipeableRow", () => {
  beforeEach(() => {
    mockReducedMotion.reducedMotion = false;
    mockReducedMotion.screenReaderEnabled = false;
  });

  // Accessibility audit 2026-11-06 M3: swipe actions were gesture-only for a
  // screen-reader user (a one-finger swipe navigates instead), and custom
  // accessibilityActions can't attach to a caller-owned child safely.
  it("renders inline action buttons when a screen reader is on", () => {
    mockReducedMotion.screenReaderEnabled = true;
    const onUsed = vi.fn();
    renderComponent(
      <SwipeableRow
        rightAction={{
          icon: "trash-2",
          label: "Delete",
          backgroundColor: "#D32F2F",
          onAction: vi.fn(),
        }}
        leftAction={{
          icon: "check",
          label: "Used",
          backgroundColor: "#2E7D32",
          onAction: onUsed,
        }}
      >
        <Text>Screen reader content</Text>
      </SwipeableRow>,
    );

    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
    screen.getByRole("button", { name: "Used" }).click();
    expect(onUsed).toHaveBeenCalledTimes(1);
  });

  it("renders children content", () => {
    renderComponent(
      <SwipeableRow>
        <Text>Test item</Text>
      </SwipeableRow>,
    );
    expect(screen.getByText("Test item")).toBeDefined();
  });

  it("renders with right action config", () => {
    renderComponent(
      <SwipeableRow
        rightAction={{
          icon: "trash-2",
          label: "Delete",
          backgroundColor: "#D32F2F",
          onAction: vi.fn(),
        }}
      >
        <Text>Swipeable content</Text>
      </SwipeableRow>,
    );
    expect(screen.getByText("Swipeable content")).toBeDefined();
  });

  it("renders with both left and right actions", () => {
    renderComponent(
      <SwipeableRow
        leftAction={{
          icon: "heart",
          label: "Favorite",
          backgroundColor: "#2196F3",
          onAction: vi.fn(),
        }}
        rightAction={{
          icon: "trash-2",
          label: "Delete",
          backgroundColor: "#D32F2F",
          onAction: vi.fn(),
        }}
      >
        <Text>Both actions</Text>
      </SwipeableRow>,
    );
    expect(screen.getByText("Both actions")).toBeDefined();
  });

  it("renders inline action buttons when reducedMotion is true", () => {
    mockReducedMotion.reducedMotion = true;
    renderComponent(
      <SwipeableRow
        rightAction={{
          icon: "trash-2",
          label: "Delete",
          backgroundColor: "#D32F2F",
          onAction: vi.fn(),
        }}
      >
        <Text>Reduced motion content</Text>
      </SwipeableRow>,
    );
    // Content should still render, just without gesture wrapper
    expect(screen.getByText("Reduced motion content")).toBeDefined();
    // Action button should be visible as an accessible button
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("renders both action buttons when reducedMotion is true with left and right actions", () => {
    mockReducedMotion.reducedMotion = true;
    const leftHandler = vi.fn();
    const rightHandler = vi.fn();
    renderComponent(
      <SwipeableRow
        leftAction={{
          icon: "heart",
          label: "Favorite",
          backgroundColor: "#2196F3",
          onAction: leftHandler,
        }}
        rightAction={{
          icon: "trash-2",
          label: "Delete",
          backgroundColor: "#D32F2F",
          onAction: rightHandler,
        }}
      >
        <Text>Both actions content</Text>
      </SwipeableRow>,
    );
    expect(screen.getByRole("button", { name: "Favorite" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("renders plain View when reducedMotion is true with no actions", () => {
    mockReducedMotion.reducedMotion = true;
    renderComponent(
      <SwipeableRow>
        <Text>No actions content</Text>
      </SwipeableRow>,
    );
    expect(screen.getByText("No actions content")).toBeDefined();
  });

  it("renders without any actions", () => {
    renderComponent(
      <SwipeableRow>
        <Text>No actions</Text>
      </SwipeableRow>,
    );
    expect(screen.getByText("No actions")).toBeDefined();
  });
});
