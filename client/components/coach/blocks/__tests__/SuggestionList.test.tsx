// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import SuggestionList from "../SuggestionList";
import type { SuggestionList as SuggestionListType } from "@shared/schemas/coach-blocks";

const block: SuggestionListType = {
  type: "suggestion_list",
  items: [
    {
      title: "Open scanner",
      subtitle: "Log a meal by photo",
      action: { type: "navigate", screen: "Scan" },
    },
    {
      title: "Just a tip",
      subtitle: "No action attached",
      action: null,
    },
  ],
};

describe("SuggestionList", () => {
  it("renders all items with title and subtitle", () => {
    renderComponent(<SuggestionList block={block} />);
    expect(screen.getByText("Open scanner")).toBeTruthy();
    expect(screen.getByText("Just a tip")).toBeTruthy();
  });

  it("fires onAction when an actionable item is pressed", () => {
    const onAction = vi.fn();
    renderComponent(<SuggestionList block={block} onAction={onAction} />);
    fireEvent.click(screen.getByLabelText(/open scanner/i));
    expect(onAction).toHaveBeenCalledWith({ type: "navigate", screen: "Scan" });
  });

  it("does not fire onAction for an item without an action (disabled branch)", () => {
    const onAction = vi.fn();
    renderComponent(<SuggestionList block={block} onAction={onAction} />);
    fireEvent.click(screen.getByLabelText(/just a tip/i));
    expect(onAction).not.toHaveBeenCalled();
  });
});
