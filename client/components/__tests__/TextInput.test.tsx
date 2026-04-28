// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { TextInput } from "../TextInput";

describe("TextInput", () => {
  it("renders an input element", () => {
    renderComponent(<TextInput placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeDefined();
  });

  it("renders left icon when provided", () => {
    renderComponent(<TextInput leftIcon="search" placeholder="Search" />);
    // Feather mock renders a span with data-icon attribute
    expect(screen.getByText("search")).toBeDefined();
  });

  it("renders right icon when provided", () => {
    renderComponent(<TextInput rightIcon="eye" placeholder="Password" />);
    expect(screen.getByText("eye")).toBeDefined();
  });

  it("calls onRightIconPress when right icon button is clicked", () => {
    const onRightIconPress = vi.fn();
    renderComponent(
      <TextInput
        rightIcon="eye-off"
        onRightIconPress={onRightIconPress}
        placeholder="Password"
      />,
    );
    // Right icon should be wrapped in a Pressable (renders as button)
    const iconBtn = screen.getByRole("button");
    fireEvent.click(iconBtn);
    expect(onRightIconPress).toHaveBeenCalledOnce();
  });

  it("renders right icon as static when no onRightIconPress", () => {
    renderComponent(<TextInput rightIcon="check" placeholder="Done" />);
    expect(screen.getByText("check")).toBeDefined();
    // No button for the icon
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("applies error accessibility hint when error is set", () => {
    renderComponent(
      <TextInput
        placeholder="Email"
        error
        errorMessage="Invalid email address"
      />,
    );
    const input = screen.getByPlaceholderText("Email");
    expect(input.getAttribute("aria-hint")).toBe("Invalid email address");
  });

  it("appends error message to caller-supplied accessibilityHint when error is set", () => {
    renderComponent(
      <TextInput
        placeholder="Email"
        error
        errorMessage="Invalid email address"
        accessibilityHint="Enter a valid email address"
      />,
    );
    const input = screen.getByPlaceholderText("Email");
    expect(input.getAttribute("aria-hint")).toBe(
      "Enter a valid email address. Invalid email address",
    );
  });

  it("uses rightIconAccessibilityLabel for icon button", () => {
    renderComponent(
      <TextInput
        rightIcon="eye"
        onRightIconPress={() => {}}
        rightIconAccessibilityLabel="Toggle password visibility"
        placeholder="Password"
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Toggle password visibility");
  });

  it("has displayName set", () => {
    expect(TextInput.displayName).toBe("TextInput");
  });
});
