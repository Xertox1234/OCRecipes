// @vitest-environment jsdom
import React from "react";
import { Text } from "react-native";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SwipeableRow } from "../SwipeableRow";

// Mock useAccessibility to control reducedMotion
const mockReducedMotion = { reducedMotion: false };
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => mockReducedMotion,
}));

describe("SwipeableRow", () => {
  beforeEach(() => {
    mockReducedMotion.reducedMotion = false;
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

  it("renders plain View when reducedMotion is true", () => {
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
