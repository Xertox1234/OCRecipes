// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { FocusTextInput } from "../FocusTextInput";

describe("FocusTextInput", () => {
  it("renders an input and forwards props", () => {
    renderComponent(
      <FocusTextInput placeholder="Type here" accessibilityLabel="Notes" />,
    );
    expect(screen.getByPlaceholderText("Type here")).toBeDefined();
  });

  it("calls the caller's onFocus and onBlur", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderComponent(
      <FocusTextInput
        placeholder="Type here"
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByPlaceholderText("Type here");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("forwards onChangeText", () => {
    const onChangeText = vi.fn();
    renderComponent(
      <FocusTextInput placeholder="Type here" onChangeText={onChangeText} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Type here"), {
      target: { value: "hi" },
    });
    expect(onChangeText).toHaveBeenCalledWith("hi");
  });
});
