// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecentActionsRow } from "../RecentActionsRow";
import type { HomeAction } from "../action-config";

const mockActions: HomeAction[] = [
  {
    id: "scan-barcode",
    group: "scanning",
    icon: "maximize",
    label: "Scan Barcode",
  },
  {
    id: "quick-log",
    group: "nutrition",
    icon: "edit-3",
    label: "Quick Log",
  },
];

describe("RecentActionsRow", () => {
  const onActionPress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows onboarding hint when no recent actions", () => {
    renderComponent(
      <RecentActionsRow
        recentActionIds={[]}
        allActions={mockActions}
        onActionPress={onActionPress}
      />,
    );
    expect(
      screen.getByText("Your recent actions will appear here"),
    ).toBeDefined();
  });

  it("renders action chips for recent actions", () => {
    renderComponent(
      <RecentActionsRow
        recentActionIds={["scan-barcode", "quick-log"]}
        allActions={mockActions}
        onActionPress={onActionPress}
      />,
    );
    expect(screen.getByText("Scan Barcode")).toBeDefined();
    expect(screen.getByText("Quick Log")).toBeDefined();
  });

  it("skips unknown action IDs gracefully", () => {
    renderComponent(
      <RecentActionsRow
        recentActionIds={["scan-barcode", "unknown-action"]}
        allActions={mockActions}
        onActionPress={onActionPress}
      />,
    );
    expect(screen.getByText("Scan Barcode")).toBeDefined();
    expect(screen.queryByText("unknown-action")).toBeNull();
  });

  it("calls onActionPress when chip is pressed", () => {
    renderComponent(
      <RecentActionsRow
        recentActionIds={["scan-barcode"]}
        allActions={mockActions}
        onActionPress={onActionPress}
      />,
    );
    fireEvent.click(screen.getByText("Scan Barcode"));
    expect(onActionPress).toHaveBeenCalledWith(
      expect.objectContaining({ id: "scan-barcode" }),
    );
  });

  it("shows Recent label when actions exist", () => {
    renderComponent(
      <RecentActionsRow
        recentActionIds={["scan-barcode"]}
        allActions={mockActions}
        onActionPress={onActionPress}
      />,
    );
    expect(screen.getByText("Recent")).toBeDefined();
  });
});
