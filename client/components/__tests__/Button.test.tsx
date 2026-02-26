// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { Button } from "../Button";

describe("Button", () => {
  it("renders children text", () => {
    renderComponent(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeDefined();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    renderComponent(<Button onPress={onPress}>Press</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("does not call onPress when disabled", () => {
    const onPress = vi.fn();
    renderComponent(
      <Button onPress={onPress} disabled>
        Disabled
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("does not call onPress when loading", () => {
    const onPress = vi.fn();
    renderComponent(
      <Button onPress={onPress} loading>
        Loading
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows loading indicator instead of text when loading", () => {
    renderComponent(<Button loading>Save</Button>);
    // Loading shows ActivityIndicator (role=progressbar), not text
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("sets accessibility state for disabled", () => {
    renderComponent(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("sets accessibility state for loading (busy)", () => {
    renderComponent(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });

  it("renders all 4 variants without crashing", () => {
    const variants = ["primary", "secondary", "outline", "ghost"] as const;
    for (const variant of variants) {
      const { unmount } = renderComponent(
        <Button variant={variant}>{variant}</Button>,
      );
      expect(screen.getByText(variant)).toBeDefined();
      unmount();
    }
  });

  it("derives accessibility label from string children", () => {
    renderComponent(<Button>Submit form</Button>);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Submit form",
    );
  });

  it("uses explicit accessibilityLabel over derived", () => {
    renderComponent(<Button accessibilityLabel="Custom label">Text</Button>);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Custom label",
    );
  });
});
