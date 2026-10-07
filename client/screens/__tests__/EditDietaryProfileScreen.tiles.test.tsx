// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import EditDietaryProfileScreen from "../EditDietaryProfileScreen";

const { form } = vi.hoisted(() => ({
  form: { selectedAllergen: null as string | null },
}));

// The form hook is mocked so the screen renders without queries; its own
// toggles are covered by useDietaryProfileForm.toggles.test. The tiles call
// the real useHaptics, so expo-haptics counts their ticks.
vi.mock("@/hooks/useDietaryProfileForm", () => ({
  useDietaryProfileForm: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isSaving: false,
    saveError: null,
    selectedAllergen: form.selectedAllergen,
    allergies: [],
    healthConditions: [],
    dietType: null,
    setDietType: vi.fn(),
    primaryGoal: null,
    setPrimaryGoal: vi.fn(),
    activityLevel: null,
    setActivityLevel: vi.fn(),
    foodDislikes: [],
    cuisinePreferences: [],
    cookingSkillLevel: null,
    setCookingSkillLevel: vi.fn(),
    cookingTimeAvailable: null,
    setCookingTimeAvailable: vi.fn(),
    toggleAllergen: vi.fn(),
    setSeverity: vi.fn(),
    toggleHealthCondition: vi.fn(),
    toggleDislike: vi.fn(),
    toggleCuisine: vi.fn(),
    handleSave: vi.fn(),
  }),
}));

function tiles() {
  return [
    ...screen.queryAllByRole("checkbox"),
    ...screen.queryAllByRole("radio"),
  ];
}

beforeEach(() => {
  form.selectedAllergen = null;
});

describe("EditDietaryProfileScreen — one selection tick per pick", () => {
  it("every checkbox and radio tile ticks once, with no impact buzz", () => {
    const { unmount } = renderComponent(<EditDietaryProfileScreen />);
    const count = tiles().length;
    unmount();
    // Denominator: all ten tile groups render.
    expect(count).toBeGreaterThan(20);

    for (let i = 0; i < count; i++) {
      vi.mocked(Haptics.selectionAsync).mockClear();
      vi.mocked(Haptics.impactAsync).mockClear();
      const r = renderComponent(<EditDietaryProfileScreen />);
      fireEvent.click(tiles()[i]);
      expect(
        vi.mocked(Haptics.selectionAsync).mock.calls.length,
        `tile ${i}`,
      ).toBe(1);
      expect(
        vi.mocked(Haptics.impactAsync),
        `tile ${i}`,
      ).not.toHaveBeenCalled();
      r.unmount();
    }
  });

  it("a severity option is a button that ticks once", () => {
    form.selectedAllergen = "peanuts";
    renderComponent(<EditDietaryProfileScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Severe:/ }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});
