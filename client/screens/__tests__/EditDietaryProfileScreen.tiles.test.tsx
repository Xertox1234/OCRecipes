// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import EditDietaryProfileScreen from "../EditDietaryProfileScreen";

const { form, mockHandleSave, mockConfirm } = vi.hoisted(() => ({
  form: { selectedAllergen: null as string | null, needsConsent: false },
  mockHandleSave: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    ConfirmationModal: () => null,
  }),
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
    needsConsent: form.needsConsent,
    handleSave: mockHandleSave,
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
  form.needsConsent = false;
  mockHandleSave.mockReset();
  mockConfirm.mockReset();
});

// Privacy audit H2 — "no consent, no health data".
describe("EditDietaryProfileScreen — health-data consent on save", () => {
  it("saves straight away when no consent is needed", () => {
    renderComponent(<EditDietaryProfileScreen />);

    fireEvent.click(screen.getByLabelText("Save Changes"));

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockHandleSave).toHaveBeenCalledTimes(1);
    expect(mockHandleSave.mock.calls[0][0]).toBeUndefined();
  });

  it("asks for the consent first, and saves with it only after Agree", () => {
    form.needsConsent = true;
    renderComponent(<EditDietaryProfileScreen />);

    fireEvent.click(screen.getByLabelText("Save Changes"));

    expect(mockHandleSave).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const options = mockConfirm.mock.calls[0][0];
    expect(options).toEqual(expect.objectContaining({ confirmLabel: "Agree" }));

    options.onConfirm();

    expect(mockHandleSave).toHaveBeenCalledWith(true);
  });
});

describe("EditDietaryProfileScreen — one selection tick per pick", () => {
  it("every checkbox and radio tile ticks once, with no impact buzz", () => {
    renderComponent(<EditDietaryProfileScreen />);
    const count = tiles().length;
    // Denominator: all ten tile groups render.
    expect(count).toBeGreaterThan(20);

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

  it("a severity option is a button that ticks once", () => {
    form.selectedAllergen = "peanuts";
    renderComponent(<EditDietaryProfileScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Severe:/ }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});
