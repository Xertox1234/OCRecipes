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

const {
  mockReplace,
  mockParse,
  mockGoBack,
  mockPopTo,
  mockGetState,
  mockSetOptions,
  mockParentNavigate,
  mockRouteParams,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockParse: vi.fn(),
  mockGoBack: vi.fn(),
  mockPopTo: vi.fn(),
  mockGetState: vi.fn(),
  mockSetOptions: vi.fn(),
  mockParentNavigate: vi.fn(),
  mockRouteParams: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    replace: mockReplace,
    navigate: vi.fn(),
    goBack: mockGoBack,
    popTo: mockPopTo,
    getState: mockGetState,
    setOptions: mockSetOptions,
    setParams: vi.fn(),
    dispatch: vi.fn(),
    addListener: vi.fn(() => () => {}),
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
  useRoute: () => ({ params: mockRouteParams() }),
  usePreventRemove: vi.fn(),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useParseRecipeFromUrl: () => ({ mutateAsync: mockParse }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue(undefined);
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

/** Pull the headerLeft element the screen registered via setOptions. */
function renderHeaderLeft() {
  const call = mockSetOptions.mock.calls.at(-1)?.[0] as
    | { headerBackVisible?: boolean; headerLeft?: () => React.ReactElement }
    | undefined;
  expect(call?.headerBackVisible).toBe(false);
  expect(call?.headerLeft).toBeTypeOf("function");
  return call!.headerLeft!();
}

// Reached from Home before the Plan tab was ever opened, this screen is the
// only route in the Plan stack — no native back chevron, so without its own
// close control it was a dead end.
describe("RecipeImportScreen — leaving the screen", () => {
  it("from Home, as the only route: closes back to Home", () => {
    mockGetState.mockReturnValue({
      index: 0,
      routes: [{ key: "import-1", name: "RecipeImport" }],
    });
    mockRouteParams.mockReturnValue({ fromHome: true });
    renderComponent(<RecipeImportScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(mockPopTo).toHaveBeenCalledWith("MealPlanHome");
    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("within Plan, with a route beneath: goes back", () => {
    mockGetState.mockReturnValue({
      index: 1,
      routes: [
        { key: "hub-1", name: "RecipeEntryHub" },
        { key: "import-1", name: "RecipeImport" },
      ],
    });
    renderComponent(<RecipeImportScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockPopTo).not.toHaveBeenCalled();
    expect(mockParentNavigate).not.toHaveBeenCalled();
  });
});
