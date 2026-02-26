// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import CuisineTag from "../CuisineTag";

describe("CuisineTag", () => {
  it("renders the cuisine name", () => {
    renderComponent(<CuisineTag cuisine="Japanese" />);
    expect(screen.getByText("Japanese")).toBeDefined();
  });

  it("renders known cuisines", () => {
    renderComponent(<CuisineTag cuisine="Korean" />);
    expect(screen.getByText("Korean")).toBeDefined();
  });

  it("renders unknown cuisines with fallback color", () => {
    renderComponent(<CuisineTag cuisine="Martian" />);
    expect(screen.getByText("Martian")).toBeDefined();
  });

  it("renders with medium size variant", () => {
    renderComponent(<CuisineTag cuisine="Italian" size="medium" />);
    expect(screen.getByText("Italian")).toBeDefined();
  });

  it("defaults to small size", () => {
    renderComponent(<CuisineTag cuisine="Mexican" />);
    expect(screen.getByText("Mexican")).toBeDefined();
  });
});
