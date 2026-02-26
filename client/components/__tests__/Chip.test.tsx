// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { Chip } from "../Chip";

describe("Chip", () => {
  it("renders label text", () => {
    renderComponent(<Chip label="Vegan" />);
    expect(screen.getByText("Vegan")).toBeDefined();
  });

  it("renders as a button when onPress is provided", () => {
    const onPress = vi.fn();
    renderComponent(<Chip label="Filter" onPress={onPress} />);
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("renders as static (non-button) when onPress is absent", () => {
    renderComponent(<Chip label="Badge" />);
    // No button role — rendered as Animated.View (div), not Pressable
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Badge")).toBeDefined();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    renderComponent(<Chip label="Click" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("exposes selected accessibility state", () => {
    renderComponent(<Chip label="Active" selected onPress={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-selected")).toBe("true");
  });

  it("uses tab accessibility role for tab variant", () => {
    renderComponent(<Chip label="Tab" variant="tab" onPress={() => {}} />);
    expect(screen.getByRole("tab")).toBeDefined();
  });

  it("renders all 4 variants without crashing", () => {
    const variants = ["outline", "filled", "tab", "filter"] as const;
    for (const variant of variants) {
      const { unmount } = renderComponent(
        <Chip label={variant} variant={variant} />,
      );
      expect(screen.getByText(variant)).toBeDefined();
      unmount();
    }
  });

  it("uses label as default accessibility label", () => {
    renderComponent(<Chip label="Gluten Free" onPress={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Gluten Free",
    );
  });
});
