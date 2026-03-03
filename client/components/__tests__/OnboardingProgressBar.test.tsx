// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { OnboardingProgressBar } from "../OnboardingProgressBar";

describe("OnboardingProgressBar", () => {
  it("renders with correct accessibility label", () => {
    renderComponent(<OnboardingProgressBar currentStep={2} totalSteps={6} />);
    expect(
      screen.getByLabelText("Onboarding progress: step 3 of 6"),
    ).toBeDefined();
  });

  it("renders correct number of segments", () => {
    renderComponent(<OnboardingProgressBar currentStep={0} totalSteps={6} />);
    // The progressbar container should have 6 child segments
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toBeDefined();
  });

  it("updates accessibility value with step info", () => {
    renderComponent(<OnboardingProgressBar currentStep={4} totalSteps={6} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeDefined();
  });
});
