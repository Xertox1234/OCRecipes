// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { KeyboardAwareScrollViewCompat } from "../KeyboardAwareScrollViewCompat";

vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "keyboard-scroll", ...props },
      children,
    ),
}));

describe("KeyboardAwareScrollViewCompat", () => {
  it("renders children", () => {
    renderComponent(
      <KeyboardAwareScrollViewCompat>
        <span>Input form</span>
      </KeyboardAwareScrollViewCompat>,
    );
    expect(screen.getByText("Input form")).toBeDefined();
  });

  it("renders the wrapper div", () => {
    renderComponent(
      <KeyboardAwareScrollViewCompat>
        <span>Content</span>
      </KeyboardAwareScrollViewCompat>,
    );
    expect(screen.getByTestId("keyboard-scroll")).toBeDefined();
  });
});
