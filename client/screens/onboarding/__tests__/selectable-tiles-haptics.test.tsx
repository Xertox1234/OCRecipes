// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import AllergiesScreen from "../AllergiesScreen";
import DietTypeScreen from "../DietTypeScreen";
import GoalsScreen from "../GoalsScreen";
import HealthConditionsScreen from "../HealthConditionsScreen";
import PreferencesScreen from "../PreferencesScreen";

vi.mock("@/context/OnboardingContext", () => ({
  useOnboarding: () => ({
    data: {
      allergies: [],
      healthConditions: [],
      dietType: null,
      foodDislikes: [],
      primaryGoal: null,
      activityLevel: null,
      householdSize: 1,
      cuisinePreferences: [],
      cookingSkillLevel: null,
      cookingTimeAvailable: null,
      healthDataConsent: false,
    },
    updateData: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    currentStep: 1,
    totalSteps: 8,
  }),
}));

const SCREENS = [
  ["AllergiesScreen", AllergiesScreen],
  ["DietTypeScreen", DietTypeScreen],
  ["GoalsScreen", GoalsScreen],
  ["HealthConditionsScreen", HealthConditionsScreen],
  ["PreferencesScreen", PreferencesScreen],
] as const;

function tiles() {
  return [
    ...screen.queryAllByRole("checkbox"),
    ...screen.queryAllByRole("radio"),
  ];
}

// Every checkbox/radio tile on the screen, not a hand-picked sample: each
// one is tapped in turn (one render) and must give exactly one selection tick
// and no impact buzz.
describe("onboarding selectable tiles — one selection tick per pick", () => {
  it.each(SCREENS)("%s: every tile ticks once", (_name, Screen) => {
    renderComponent(<Screen />);
    const count = tiles().length;
    // Denominator: the screen must actually render tiles.
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      vi.mocked(Haptics.selectionAsync).mockClear();
      vi.mocked(Haptics.impactAsync).mockClear();
      fireEvent.click(tiles()[i]);
      expect(
        vi.mocked(Haptics.selectionAsync).mock.calls.length,
        `tile ${i}`,
      ).toBe(1);
      expect(
        vi.mocked(Haptics.impactAsync),
        `tile ${i}`,
      ).not.toHaveBeenCalled();
    }
  });

  it("AllergiesScreen: picking a severity ticks once more", () => {
    renderComponent(<AllergiesScreen />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(/^Severe:/));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
