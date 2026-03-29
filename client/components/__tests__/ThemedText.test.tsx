// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ThemedText } from "../ThemedText";

describe("ThemedText", () => {
  it("renders text content", () => {
    renderComponent(<ThemedText>Hello world</ThemedText>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("defaults to body type", () => {
    renderComponent(<ThemedText>Body text</ThemedText>);
    const el = screen.getByText("Body text");
    // Body type should not have header accessibility role
    expect(el.getAttribute("role")).toBeNull();
  });

  it("applies header accessibility role for h1-h4 types", () => {
    const { unmount } = renderComponent(
      <ThemedText type="h1">Heading 1</ThemedText>,
    );
    expect(screen.getByText("Heading 1").getAttribute("role")).toBe("header");
    unmount();

    renderComponent(<ThemedText type="h2">Heading 2</ThemedText>);
    expect(screen.getByText("Heading 2").getAttribute("role")).toBe("header");
  });

  it("does not apply header role for body/small/caption/link types", () => {
    const types = ["body", "small", "caption", "link"] as const;
    for (const type of types) {
      const { unmount } = renderComponent(
        <ThemedText type={type}>Text</ThemedText>,
      );
      expect(screen.getByText("Text").getAttribute("role")).toBeNull();
      unmount();
    }
  });

  it("renders all 8 type variants without crashing", () => {
    const types = [
      "h1",
      "h2",
      "h3",
      "h4",
      "body",
      "small",
      "caption",
      "link",
    ] as const;
    for (const type of types) {
      const { unmount } = renderComponent(
        <ThemedText type={type}>{type}</ThemedText>,
      );
      expect(screen.getByText(type)).toBeDefined();
      unmount();
    }
  });

  it("passes through additional props", () => {
    renderComponent(
      <ThemedText testID="custom-text" numberOfLines={2}>
        Truncated
      </ThemedText>,
    );
    expect(screen.getByTestId("custom-text")).toBeDefined();
  });

  it("passes maxScale as maxFontSizeMultiplier", () => {
    renderComponent(
      <ThemedText testID="scaled-text" maxScale={1.5}>
        Capped text
      </ThemedText>,
    );
    const el = screen.getByTestId("scaled-text");
    expect(el.getAttribute("maxFontSizeMultiplier")).toBe("1.5");
  });
});
