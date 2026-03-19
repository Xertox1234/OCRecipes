// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { Text } from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import { CollapsibleSection } from "../CollapsibleSection";

describe("CollapsibleSection", () => {
  const defaultProps = {
    title: "Camera & Scanning",
    isExpanded: true,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders section title", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Camera & Scanning")).toBeDefined();
  });

  it("renders children", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Child content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Child content")).toBeDefined();
  });

  it("calls onToggle when header is pressed", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Content</Text>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(defaultProps.onToggle).toHaveBeenCalledTimes(1);
  });

  it("has correct accessibility label", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Camera & Scanning section",
    );
  });

  it("renders chevron icon", () => {
    renderComponent(
      <CollapsibleSection {...defaultProps}>
        <Text>Content</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText("chevron-down")).toBeDefined();
  });
});
