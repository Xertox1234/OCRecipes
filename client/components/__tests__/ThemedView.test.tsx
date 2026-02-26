// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ThemedView } from "../ThemedView";

describe("ThemedView", () => {
  it("renders children", () => {
    renderComponent(
      <ThemedView>
        <span>child content</span>
      </ThemedView>,
    );
    expect(screen.getByText("child content")).toBeDefined();
  });

  it("passes through testID", () => {
    renderComponent(<ThemedView testID="themed-view" />);
    expect(screen.getByTestId("themed-view")).toBeDefined();
  });

  it("passes through additional props", () => {
    renderComponent(
      <ThemedView testID="view" accessibilityLabel="container">
        <span>inside</span>
      </ThemedView>,
    );
    const el = screen.getByTestId("view");
    expect(el.getAttribute("aria-label")).toBe("container");
  });
});
