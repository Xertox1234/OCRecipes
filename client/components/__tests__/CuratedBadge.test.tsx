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

  it("is decorative — exposes no accessibility label of its own", () => {
    // Both call sites place the badge inside an already-labeled Pressable;
    // curated status must be announced via the parent's label, never the
    // badge (decorative-badge-double-announcement solution).
    renderComponent(<CuratedBadge />);
    expect(screen.queryByLabelText("Curated recipe")).toBeNull();
  });
});
