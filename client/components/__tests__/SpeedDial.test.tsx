// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SpeedDial } from "../SpeedDial";

describe("SpeedDial", () => {
  const mockActions = [
    { icon: "camera", label: "Camera Scan", onPress: vi.fn() },
    { icon: "edit-3", label: "Quick Log", onPress: vi.fn() },
  ];

  it("renders all action labels", () => {
    renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
    expect(screen.getByText("Camera Scan")).toBeDefined();
    expect(screen.getByText("Quick Log")).toBeDefined();
  });

  it("renders close backdrop", () => {
    renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Close speed dial")).toBeDefined();
  });

  it("renders accessible action buttons", () => {
    renderComponent(<SpeedDial actions={mockActions} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Camera Scan")).toBeDefined();
    expect(screen.getByLabelText("Quick Log")).toBeDefined();
  });
});
