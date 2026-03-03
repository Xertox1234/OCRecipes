// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    renderComponent(
      <EmptyState
        variant="firstTime"
        icon="camera"
        title="No scans yet"
        description="Start scanning to track your food"
      />,
    );
    expect(screen.getByText("No scans yet")).toBeDefined();
    expect(screen.getByText("Start scanning to track your food")).toBeDefined();
  });

  it("renders action button for firstTime variant", () => {
    const onAction = vi.fn();
    renderComponent(
      <EmptyState
        variant="firstTime"
        icon="camera"
        title="No scans yet"
        description="Start scanning"
        actionLabel="Scan Now"
        onAction={onAction}
      />,
    );
    expect(screen.getByText("Scan Now")).toBeDefined();
  });

  it("does not render action button for temporary variant", () => {
    renderComponent(
      <EmptyState
        variant="temporary"
        icon="calendar"
        title="No meals planned"
        description="Add items to your meal plan"
        actionLabel="Plan Now"
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText("Plan Now")).toBeNull();
  });

  it("has correct accessibility label", () => {
    renderComponent(
      <EmptyState
        variant="noResults"
        icon="search"
        title="No results"
        description="Try a different search"
      />,
    );
    expect(
      screen.getByLabelText("No results. Try a different search"),
    ).toBeDefined();
  });
});
