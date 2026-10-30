// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";

import { renderComponent } from "../../../../test/utils/render-component";
import RecipeImportScreen from "../RecipeImportScreen";

vi.mock("@/hooks/useFeatureTip", () => ({
  useMarkFeatureUsed: (feature: string) => mockMarkFeatureUsed(feature),
}));
const mockMarkFeatureUsed = vi.hoisted(() => vi.fn());

const { mockReplace, mockParse } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockParse: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    replace: mockReplace,
    navigate: vi.fn(),
    goBack: vi.fn(),
    addListener: vi.fn(() => () => {}),
    getParent: vi.fn(),
  }),
  useRoute: () => ({ params: undefined }),
  usePreventRemove: vi.fn(),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useParseRecipeFromUrl: () => ({ mutateAsync: mockParse }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// Spec §5.1: Import is pressable with an empty link; pressing it names the
// field, moves focus there and buzzes — and never parses.
describe("RecipeImportScreen — empty link", () => {
  it("Import with no link flags and focuses it, buzzes, and never parses", () => {
    renderComponent(<RecipeImportScreen />);
    const button = screen.getByRole("button", { name: "Import recipe" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(button);

    expect(screen.getByText("Paste a recipe link.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Recipe link"));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("a pasted link imports", async () => {
    mockParse.mockResolvedValue({ title: "Soup" });
    renderComponent(<RecipeImportScreen />);
    fireEvent.change(screen.getByLabelText("Recipe link"), {
      target: { value: " https://example.com/soup " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));
    await waitFor(() =>
      expect(mockParse).toHaveBeenCalledWith("https://example.com/soup"),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });
});

describe("RecipeImportScreen — teaching tips", () => {
  it("marks recipe import as used when the screen opens", () => {
    renderComponent(<RecipeImportScreen />);
    expect(mockMarkFeatureUsed).toHaveBeenCalledWith("import");
  });
});
