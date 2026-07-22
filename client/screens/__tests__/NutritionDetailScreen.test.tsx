// @vitest-environment jsdom
//
// Render coverage for the "Additional Nutrients" card's new Saturated Fat /
// Trans Fat / Cholesterol / Caffeine rows (Task 11, Smart Scan Universal
// Nutrition Flags v1). The screen has no prior render test — this file
// mocks useNutritionLookup (the screen's sole data source) plus
// @react-navigation/native, and pins the route to an `itemId` lookup so the
// serving-controls / verification-badge / manual-search / flags branches
// (each gated on `!itemId` or a non-empty array) stay out of the render
// tree — only the Additional Nutrients card is exercised.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../test/utils/render-component";
import NutritionDetailScreen from "../NutritionDetailScreen";

const { mockUseNutritionLookup } = vi.hoisted(() => ({
  mockUseNutritionLookup: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ params: { itemId: 42 } }),
}));

vi.mock("@/hooks/useNutritionLookup", () => ({
  useNutritionLookup: () => mockUseNutritionLookup(),
}));

/** Full useNutritionLookup return shape with every field the screen reads,
 * so a mock omission can't silently pass by leaving a destructured value
 * `undefined` where the real hook would supply one. `nutrition` defaults to
 * "Unknown Product" — the only field NutritionData requires — which also
 * keeps the productName !== "Unknown Product" MicronutrientSection guard
 * closed, so that unrelated subtree stays out of the tree. */
function baseHookReturn(nutrition: Record<string, unknown>) {
  return {
    nutrition: { productName: "Unknown Product", ...nutrition },
    flags: [],
    verificationLevel: "unverified",
    hasFrontLabelData: false,
    isLoading: false,
    error: null,
    isPer100g: false,
    servingQuantity: 1,
    setServingQuantity: vi.fn(),
    servingSizeGrams: null,
    setServingSizeGrams: vi.fn(),
    customGramsInput: "",
    setCustomGramsInput: vi.fn(),
    showCustomInput: false,
    setShowCustomInput: vi.fn(),
    correctionNotice: null,
    showManualSearch: false,
    manualSearchQuery: "",
    setManualSearchQuery: vi.fn(),
    isSearching: false,
    servingOptions: [],
    recalculateNutrition: vi.fn(),
    micronutrientData: undefined,
    micronutrientsLoading: false,
    handleManualSearch: vi.fn(),
    addToLogMutation: { isPending: false },
    handleAddToLog: vi.fn(),
  };
}

describe("NutritionDetailScreen — Additional Nutrients card", () => {
  it("renders a saturated fat row and a caffeine row when present", () => {
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ saturatedFat: 2.5, caffeine: 95 }),
    );

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    // Sanity check: the screen actually rendered (not a thrown/empty tree).
    expect(queryByText("Unknown Product")).toBeTruthy();

    expect(queryByText("Additional Nutrients")).toBeTruthy();
    expect(queryByText("Saturated Fat")).toBeTruthy();
    expect(queryByText("Caffeine")).toBeTruthy();
    // Only the two set fields should render — no "0 g"/"0 mg" row for the
    // undefined ones.
    expect(queryByText("Trans Fat")).toBeNull();
    expect(queryByText("Cholesterol")).toBeNull();
  });

  it("renders trans fat and cholesterol rows when present", () => {
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ transFat: 0.4, cholesterol: 15 }),
    );

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("Trans Fat")).toBeTruthy();
    expect(queryByText("Cholesterol")).toBeTruthy();
    expect(queryByText("Saturated Fat")).toBeNull();
    expect(queryByText("Caffeine")).toBeNull();
  });

  it("does not render the Additional Nutrients card when no nutrient field is present", () => {
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}));

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("Unknown Product")).toBeTruthy();
    expect(queryByText("Additional Nutrients")).toBeNull();
  });
});
