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
function baseHookReturn(
  nutrition: Record<string, unknown>,
  flags: unknown[] = [],
) {
  return {
    nutrition: { productName: "Unknown Product", ...nutrition },
    flags,
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

describe("NutritionDetailScreen — For you / Heads up flags (Task 13)", () => {
  it("renders neither section when there are no flags", () => {
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, []));

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("For you")).toBeNull();
    expect(queryByText("Heads up")).toBeNull();
  });

  it("splits allergen flags into For-you and universal flags + Nutri-Score into a grouped Heads-up section", () => {
    const flags = [
      {
        id: "nutriscore:e",
        kind: "nutriscore",
        severity: "info",
        tier: "nutrition",
        title: "Nutri-Score E",
        grade: "e",
      },
      {
        id: "nutrient:caffeine",
        kind: "nutrient",
        severity: "info",
        tier: "nutrition",
        title: "Contains caffeine",
      },
      {
        id: "processing:ultra",
        kind: "processing",
        severity: "warn",
        tier: "nutrition",
        title: "Ultra-processed",
      },
      {
        id: "allergen:peanuts",
        kind: "allergen",
        severity: "danger",
        tier: "safety",
        title: "Contains Peanuts",
      },
    ];
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, flags));

    const { queryByText, getByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    // "For you" keeps only the Phase-1 personal (allergen) flag — its
    // existing rendering/behavior is otherwise unchanged.
    expect(queryByText("For you")).toBeTruthy();
    expect(queryByText("Contains Peanuts")).toBeTruthy();

    // "Heads up" gets the universal flags via the existing ScanFlagBadge,
    // and the Nutri-Score grade split out into its own chip.
    expect(queryByText("Heads up")).toBeTruthy();
    expect(queryByText("Ultra-processed")).toBeTruthy();
    expect(queryByText("Contains caffeine")).toBeTruthy();
    expect(getByLabelText("Nutri-Score E")).toBeTruthy();

    // The Heads-up badges are wrapped in ONE accessible={true} view whose
    // accessibilityLabel is the composed summary sentence, so
    // VoiceOver/TalkBack read the badge group as a single grouped
    // announcement instead of stepping through each badge. This jsdom
    // harness can't model the real subtree-collapse (see
    // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md);
    // what IS verifiable is that the exact composed label resolves to
    // exactly one element — getByLabelText throws on a missing or
    // duplicate match — and its content reflects the severity-sorted
    // (warn before info) universal flags.
    const badgeGroup = getByLabelText(
      "2 nutrition flags: Ultra-processed, Contains caffeine",
    );
    expect(badgeGroup).toBeTruthy();

    // The Nutri-Score chip must be a SIBLING of the badge group, not
    // nested inside it: an accessible={true} group's composed label
    // doesn't mention the grade, so a real VoiceOver/TalkBack collapse
    // would silently drop "Nutri-Score E" if the chip were nested here.
    // Its own label being reachable OUTSIDE this subtree (asserted above
    // via getByLabelText) plus its absence FROM this subtree is the
    // closest jsdom proxy for "the chip keeps its own accessible node."
    expect(badgeGroup.querySelector('[aria-label="Nutri-Score E"]')).toBeNull();
  });

  it("shows the Heads-up section for the Nutri-Score chip alone, omitting the badge-group wrapper when there are no universal flags to summarize", () => {
    const flags = [
      {
        id: "nutriscore:c",
        kind: "nutriscore",
        severity: "info",
        tier: "nutrition",
        title: "Nutri-Score C",
        grade: "c",
      },
    ];
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, flags));

    const { queryByText, getByLabelText, queryByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByText("For you")).toBeNull();
    expect(queryByText("Heads up")).toBeTruthy();
    expect(getByLabelText("Nutri-Score C")).toBeTruthy();
    // No universal flags means there is nothing for the grouped summary
    // to describe — the badge-group wrapper (and its "No additional
    // nutrition flags." fallback label) isn't rendered at all, so the
    // chip keeps its own independent accessible identity instead of
    // being nested inside an empty, misleadingly-labeled group.
    expect(queryByLabelText("No additional nutrition flags.")).toBeNull();
  });
});
