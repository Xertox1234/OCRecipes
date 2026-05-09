// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { CuratedBadge } from "../CuratedBadge";

describe("CuratedBadge", () => {
  it("renders Curated label in default mode", () => {
    renderComponent(<CuratedBadge />);
    expect(screen.getByText("Curated")).toBeDefined();
  });

  it("hides text in compact mode", () => {
    renderComponent(<CuratedBadge compact />);
    expect(screen.queryByText("Curated")).toBeNull();
  });

  it("renders with accessibilityLabel", () => {
    renderComponent(<CuratedBadge />);
    expect(screen.getByLabelText("Curated recipe")).toBeDefined();
  });
});
