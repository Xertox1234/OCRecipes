// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { HomeInlineDrawer } from "../HomeInlineDrawer";

describe("HomeInlineDrawer", () => {
  it("renders the subtitle under the label when given one", () => {
    renderComponent(
      <HomeInlineDrawer
        icon="search"
        label="Search Recipes"
        subtitle="Browse the recipe catalog"
        isOpen={false}
        onToggle={vi.fn()}
      >
        <></>
      </HomeInlineDrawer>,
    );
    expect(screen.getByText("Search Recipes")).toBeDefined();
    expect(screen.getByText("Browse the recipe catalog")).toBeDefined();
  });

  it("renders only the label when there is no subtitle", () => {
    renderComponent(
      <HomeInlineDrawer
        icon="search"
        label="Search Recipes"
        isOpen={false}
        onToggle={vi.fn()}
      >
        <></>
      </HomeInlineDrawer>,
    );
    expect(screen.getByText("Search Recipes")).toBeDefined();
    expect(screen.queryByText("Browse the recipe catalog")).toBeNull();
  });
});
