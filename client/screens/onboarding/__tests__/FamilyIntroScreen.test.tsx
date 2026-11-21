// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import FamilyIntroScreen from "../FamilyIntroScreen";

// Owner ruling 2026-11-21: onboarding shows one card promoting family
// planning. It must say the feature is part of Premium and where to turn it
// on, and it collects nothing: Continue only moves on.

const nextStep = vi.fn();
const prevStep = vi.fn();
const updateData = vi.fn();

vi.mock("@/context/OnboardingContext", () => ({
  useOnboarding: () => ({ nextStep, prevStep, updateData }),
}));

describe("FamilyIntroScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has a headline that is a header", () => {
    renderComponent(<FamilyIntroScreen />);
    // The test renderer keeps React Native's role name ("header").
    expect(screen.getByRole("header").textContent).toBe(
      "Cooking for more than one?",
    );
  });

  it("says family planning is part of Premium and where to turn it on", () => {
    renderComponent(<FamilyIntroScreen />);
    expect(screen.getByText(/part of Premium/)).toBeTruthy();
    expect(screen.getByText(/Profile.*Plan for my family/)).toBeTruthy();
  });

  it("lists the three things family planning does today", () => {
    renderComponent(<FamilyIntroScreen />);
    expect(screen.getByText("One plan for everyone")).toBeTruthy();
    expect(screen.getByText("Allergy checks for each person")).toBeTruthy();
    expect(screen.getByText("Grocery lists for every plate")).toBeTruthy();
  });

  it("Continue moves to the next step and saves nothing", () => {
    renderComponent(<FamilyIntroScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(nextStep).toHaveBeenCalledTimes(1);
    expect(updateData).not.toHaveBeenCalled();
  });

  it("the back button goes to the previous step", () => {
    renderComponent(<FamilyIntroScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(prevStep).toHaveBeenCalledTimes(1);
  });
});
