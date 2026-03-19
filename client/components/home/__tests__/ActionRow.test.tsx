// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { ActionRow } from "../ActionRow";

describe("ActionRow", () => {
  const defaultProps = {
    icon: "camera",
    label: "Scan Barcode",
    onPress: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with label", () => {
    renderComponent(<ActionRow {...defaultProps} />);
    expect(screen.getByText("Scan Barcode")).toBeDefined();
  });

  it("calls onPress when pressed", () => {
    renderComponent(<ActionRow {...defaultProps} />);
    fireEvent.click(screen.getByRole("button"));
    expect(defaultProps.onPress).toHaveBeenCalledTimes(1);
  });

  it("has correct accessibility label", () => {
    renderComponent(<ActionRow {...defaultProps} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Scan Barcode",
    );
  });

  it("shows Premium in accessibility label when locked", () => {
    renderComponent(<ActionRow {...defaultProps} isLocked />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Scan Barcode (Premium)",
    );
  });

  it("renders lock icon when locked", () => {
    renderComponent(<ActionRow {...defaultProps} isLocked />);
    expect(screen.getByText("lock")).toBeDefined();
  });

  it("does not render lock icon when not locked", () => {
    renderComponent(<ActionRow {...defaultProps} />);
    expect(screen.queryByText("lock")).toBeNull();
  });

  it("renders subtitle when provided (card variant)", () => {
    renderComponent(
      <ActionRow {...defaultProps} subtitle="Browse the recipe catalog" />,
    );
    expect(screen.getByText("Browse the recipe catalog")).toBeDefined();
  });

  it("does not render subtitle when not provided", () => {
    renderComponent(<ActionRow {...defaultProps} />);
    expect(screen.queryByText("Browse the recipe catalog")).toBeNull();
  });
});
