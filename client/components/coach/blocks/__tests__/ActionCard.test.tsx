// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import ActionCard from "../ActionCard";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

const mockBlock: ActionCardType = {
  type: "action_card",
  title: "Log breakfast",
  subtitle: "500 calories",
  actionLabel: "Log",
  action: {
    type: "log_food",
    description: "oats",
    calories: 300,
    protein: 10,
    carbs: 50,
    fat: 5,
  },
};

describe("ActionCard", () => {
  it("calls onAction when no onPressAsync is provided", () => {
    const onAction = vi.fn();
    renderComponent(<ActionCard block={mockBlock} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledWith(mockBlock.action);
  });

  it("shows success state after onPressAsync resolves", async () => {
    const onPressAsync = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <ActionCard block={mockBlock} onPressAsync={onPressAsync} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Done")).toBeDefined());
  });

  it("shows error state after onPressAsync rejects", async () => {
    const onPressAsync = vi.fn().mockRejectedValue(new Error("fail"));
    renderComponent(
      <ActionCard block={mockBlock} onPressAsync={onPressAsync} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Failed")).toBeDefined());
  });
});
