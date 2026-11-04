// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { reactProps } from "../../../../test/utils/react-props";
import { WizardStepBar } from "../WizardStepBar";

const onSelect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WizardStepBar", () => {
  it("says 'Go to' for a step already reached ahead of the current one", () => {
    renderComponent(
      <WizardStepBar step="basics" furthest={3} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByLabelText("Go to Review"));
    expect(onSelect).toHaveBeenCalledWith("review");
    expect(screen.queryByLabelText("Go back to Review")).toBeNull();
  });

  it("says 'Go back to' for a step behind the current one", () => {
    renderComponent(
      <WizardStepBar step="review" furthest={3} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByLabelText("Go back to Basics"));
    expect(onSelect).toHaveBeenCalledWith("basics");
  });

  it.each([
    ["basics", "Step 1 of 4, Basics"],
    ["cover", "Step 2 of 4, Cover"],
    ["recipes", "Step 3 of 4, Recipes"],
    ["review", "Step 4 of 4, Review"],
  ] as const)("reads the progress for %s as '%s'", (step, text) => {
    renderComponent(
      <WizardStepBar step={step} furthest={3} onSelect={onSelect} />,
    );
    const bar = screen.getByRole("progressbar");
    expect((reactProps(bar).accessibilityValue as { text: string }).text).toBe(
      text,
    );
  });
});
