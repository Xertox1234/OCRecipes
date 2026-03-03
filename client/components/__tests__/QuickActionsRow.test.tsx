// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { QuickActionsRow } from "../QuickActionsRow";

describe("QuickActionsRow", () => {
  const mockActions = [
    { icon: "camera", label: "Scan", onPress: vi.fn() },
    { icon: "edit-3", label: "Quick Log", onPress: vi.fn() },
  ];

  it("renders all action labels", () => {
    renderComponent(<QuickActionsRow actions={mockActions} />);
    expect(screen.getByText("Scan")).toBeDefined();
    expect(screen.getByText("Quick Log")).toBeDefined();
  });

  it("renders accessible buttons", () => {
    renderComponent(<QuickActionsRow actions={mockActions} />);
    expect(screen.getByLabelText("Scan")).toBeDefined();
    expect(screen.getByLabelText("Quick Log")).toBeDefined();
  });

  it("renders as toolbar", () => {
    renderComponent(<QuickActionsRow actions={mockActions} />);
    expect(screen.getByRole("toolbar")).toBeDefined();
  });
});
