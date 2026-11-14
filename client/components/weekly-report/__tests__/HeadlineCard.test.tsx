// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { HeadlineCard } from "../HeadlineCard";

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({
    reducedMotion: false,
    screenReaderEnabled: false,
  }),
}));

describe("HeadlineCard celebration", () => {
  it("keeps the badge once it started, even after the shown-mark refetch clears `celebrate`", () => {
    const onCelebrated = vi.fn();
    const { rerender } = renderComponent(
      <HeadlineCard
        headline="Protein on target 5 of 7 days."
        celebrate
        onCelebrated={onCelebrated}
      />,
    );
    expect(screen.getByTestId("weekly-celebration-badge")).toBeTruthy();
    rerender(
      <HeadlineCard
        headline="Protein on target 5 of 7 days."
        celebrate={false}
        onCelebrated={onCelebrated}
      />,
    );
    expect(screen.getByTestId("weekly-celebration-badge")).toBeTruthy();
    expect(onCelebrated).toHaveBeenCalledTimes(1);
  });

  it("shows no badge when the week has nothing to celebrate", () => {
    renderComponent(
      <HeadlineCard
        headline="A steady week."
        celebrate={false}
        onCelebrated={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("weekly-celebration-badge")).toBeNull();
  });
});
