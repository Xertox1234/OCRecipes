// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import AllergiesScreen from "../AllergiesScreen";

// Accessibility audit 2026-11-06 L1: a selected allergen tile announced its
// state twice — ", selected" in the label plus the checkbox's own checked
// state. The checked state alone carries it; the label keeps the severity.

vi.mock("@/context/OnboardingContext", () => ({
  useOnboarding: () => ({
    data: {
      allergies: [{ name: "peanuts", severity: "severe" }],
      healthConditions: [],
    },
    updateData: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    currentStep: 1,
    totalSteps: 8,
  }),
}));

describe("AllergiesScreen — allergen tile label", () => {
  it("a selected tile states its selection once, via the checked state", () => {
    renderComponent(<AllergiesScreen />);
    const tile = screen.getByRole("checkbox", { name: /^Peanuts/ });

    expect(tile.getAttribute("aria-checked")).toBe("true");
    expect(tile.getAttribute("aria-label")).toBe("Peanuts, severity: severe");
  });
});
