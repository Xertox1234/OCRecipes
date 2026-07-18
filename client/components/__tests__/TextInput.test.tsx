// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Reanimated from "react-native-reanimated";
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

describe("TextInput floating label & focus", () => {
  it("renders the floating label text when label is provided", () => {
    renderComponent(<TextInput label="Note title" />);
    expect(screen.getByText("Note title")).toBeDefined();
  });

  it("uses the label as the input accessibility label by default", () => {
    renderComponent(<TextInput label="Note title" />);
    expect(screen.getByLabelText("Note title")).toBeDefined();
  });

  it("prefers an explicit accessibilityLabel over the label", () => {
    renderComponent(
      <TextInput label="Note title" accessibilityLabel="Custom" />,
    );
    expect(screen.getByLabelText("Custom")).toBeDefined();
  });

  it("suppresses the placeholder while the label is resting in its place", () => {
    renderComponent(
      <TextInput label="Note title" placeholder="e.g. Less salt" />,
    );
    expect(screen.queryByPlaceholderText("e.g. Less salt")).toBeNull();
  });

  it("shows the placeholder once the input is focused", () => {
    renderComponent(
      <TextInput label="Note title" placeholder="e.g. Less salt" />,
    );
    fireEvent.focus(screen.getByLabelText("Note title"));
    expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
  });

  it("keeps the label floated at rest when the input has a value", () => {
    renderComponent(
      <TextInput
        label="Note title"
        placeholder="e.g. Less salt"
        value="Less salt"
        onChangeText={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
  });

  it("keeps the label floated after typing and blurring (uncontrolled)", () => {
    renderComponent(
      <TextInput label="Note title" placeholder="e.g. Less salt" />,
    );
    const input = screen.getByLabelText("Note title");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Less salt" } });
    fireEvent.blur(input);
    // internalValue tracking keeps the label floated once content exists
    expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
  });

  it("still reveals the placeholder on focus when reduced motion is enabled", () => {
    const spy = vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    try {
      renderComponent(
        <TextInput label="Note title" placeholder="e.g. Less salt" />,
      );
      fireEvent.focus(screen.getByLabelText("Note title"));
      // reduced motion snaps the transition but must never drop the state
      expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("forwards onFocus and onBlur to callers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderComponent(
      <TextInput placeholder="Email" onFocus={onFocus} onBlur={onBlur} />,
    );
    const input = screen.getByPlaceholderText("Email");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });
});
