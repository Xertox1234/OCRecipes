// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import PhotoIntentScreen from "../PhotoIntentScreen";

// Accessibility audit 2026-11-06 M6: the captured-photo thumbnail is
// decorative — a bare RN Image ignores accessibilityLabel unless accessible.

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
    replace: vi.fn(),
  }),
  useRoute: () => ({ params: { imageUri: "file:///photo.jpg" } }),
}));

vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: { photoAnalysis: true, recipeGeneration: true },
    canGenerateRecipe: true,
  }),
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

describe("PhotoIntentScreen — photo thumbnail", () => {
  it("is hidden from screen readers rather than carrying an inert label", () => {
    const { container } = renderComponent(<PhotoIntentScreen />);

    expect(container.querySelector("img")).not.toBeNull();
    expect(screen.queryByLabelText("Captured food photo")).toBeNull();
  });
});
