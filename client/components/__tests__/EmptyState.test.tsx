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

  it("renders action button for temporary variant", () => {
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
    expect(screen.getByText("Plan Now")).toBeDefined();
  });

  it("does not render action button when actionLabel is not provided", () => {
    renderComponent(
      <EmptyState
        variant="temporary"
        icon="calendar"
        title="No meals planned"
        description="Add items to your meal plan"
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

  it("renders secondary link when secondaryLabel and onSecondaryAction are provided", () => {
    const onSecondaryAction = vi.fn();
    renderComponent(
      <EmptyState
        variant="firstTime"
        icon="camera"
        title="Your pantry is empty"
        description="Scan a receipt"
        actionLabel="Scan a Receipt"
        onAction={vi.fn()}
        secondaryLabel="or add items manually"
        onSecondaryAction={onSecondaryAction}
      />,
    );
    expect(screen.getByText("or add items manually")).toBeDefined();
  });

  it("does not render secondary link when secondaryLabel is absent", () => {
    renderComponent(
      <EmptyState
        variant="firstTime"
        icon="camera"
        title="Title"
        description="Desc"
      />,
    );
    expect(screen.queryByText("or add items manually")).toBeNull();
  });
});
