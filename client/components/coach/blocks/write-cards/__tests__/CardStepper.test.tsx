// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../../../test/utils/render-component";
import { CardStepper } from "../CardStepper";

// Accessibility audit 2026-11-21 M2: the row carried role="adjustable", a
// value and increment/decrement actions but no `accessible`, so iOS ignored
// all of it and VoiceOver met two loose buttons and a bare number instead.
// jsdom cannot prove the iOS grouping (see docs/solutions/conventions/
// jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md); this
// pins the props that make it, and that the touch buttons leave the tree.
describe("CardStepper accessibility", () => {
  it("is one accessible adjustable element whose buttons are hidden from assistive tech", () => {
    renderComponent(
      <CardStepper value={3} name="Large eggs" onChange={vi.fn()} />,
    );

    // The row is the one adjustable element (its boolean `accessible` is not
    // rendered by the jsdom mock, so the iOS half needs a device check).
    expect(screen.getByRole("adjustable", { name: "Large eggs" })).toBeTruthy();

    expect(
      screen.queryByRole("button", { name: "More Large eggs" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Fewer Large eggs" }),
    ).toBeNull();
  });

  it("keeps the touch buttons working", () => {
    const onChange = vi.fn();
    renderComponent(
      <CardStepper value={3} name="Large eggs" onChange={onChange} />,
    );
    fireEvent.click(
      // Hidden from assistive tech, so found by label (ByRole skips it).
      screen.getByLabelText("More Large eggs"),
    );
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
