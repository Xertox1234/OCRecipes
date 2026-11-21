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

  // Accessibility audit 2026-11-21 L5: the header role sat on a plain card
  // View (not an accessibility element, so iOS ignored it); it belongs on
  // the headline text alone.
  it("makes the headline, and only the headline, a header", () => {
    renderComponent(
      <HeadlineCard
        headline="A steady week."
        subline="You logged 6 of 7 days."
        celebrate={false}
        onCelebrated={vi.fn()}
      />,
    );
    const headers = screen.queryAllByRole("header");
    expect(headers.map((h) => h.textContent)).toEqual(["A steady week."]);
  });
});
