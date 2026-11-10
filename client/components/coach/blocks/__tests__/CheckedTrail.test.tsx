// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import CheckedTrail from "../CheckedTrail";

describe("CheckedTrail (show-the-work spec 2026-11-09)", () => {
  it("renders Checked: a · b", () => {
    renderComponent(<CheckedTrail items={["beef burger", "your pantry"]} />);
    expect(
      screen.getByText("Checked: beef burger · your pantry"),
    ).toBeDefined();
  });

  it("is not a button and reads with commas", () => {
    renderComponent(<CheckedTrail items={["beef burger", "your pantry"]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(
      screen.getByLabelText("Checked: beef burger, your pantry"),
    ).toBeDefined();
  });
});
